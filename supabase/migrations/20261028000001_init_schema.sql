-- AfterSend schema. Metadata only: NO email bodies are stored.
-- Tokens (pixel/link/document) are random 128-bit values; only their SHA-256 hash is stored.
-- Clients (extension, authenticated role) can READ and DELETE their own tracking data.
-- All writes to tracking tables go through the server API using the service-role key.

-- ---------- enums ----------
create type public.email_status as enum ('registered', 'injected', 'send_confirmed', 'failed');
create type public.event_type as enum (
  'email_sent', 'open_signal', 'link_clicked', 'document_visit',
  'reply_received',   -- reserved: needs a verified Gmail integration (not in MVP)
  'bounce_detected'   -- reserved: needs a reliable signal (not in MVP)
);
create type public.event_source as enum ('extension', 'pixel', 'redirect', 'landing_page', 'gmail_api');
create type public.event_confidence as enum ('likely_human', 'likely_automated', 'uncertain');

-- ---------- helpers ----------
create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- user_settings ----------
create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  retention_days integer not null default 90 check (retention_days between 7 and 730),
  default_include_pixel boolean not null default true,
  default_rewrite_links boolean not null default true,
  notifications_enabled boolean not null default false,
  notify_first_link_click boolean not null default true,
  notify_document_visit boolean not null default true,
  notify_reply boolean not null default true,
  followup_reminder_days integer check (followup_reminder_days is null or followup_reminder_days between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger user_settings_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();

-- Every new auth user gets a settings row with privacy-conservative defaults.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_settings (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- tracked_emails ----------
create table public.tracked_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pixel_token_hash bytea not null unique check (octet_length(pixel_token_hash) = 32),
  recipients text[] not null default '{}' check (cardinality(recipients) <= 50),
  subject text check (subject is null or char_length(subject) <= 500),
  -- Only 'send_confirmed' may be presented to the user as "tracked and sent".
  status public.email_status not null default 'registered',
  pixel_injected boolean not null default false,
  links_rewritten integer not null default 0 check (links_rewritten >= 0),
  injected_at timestamptz,
  send_confirmed_at timestamptz,
  last_activity_at timestamptz,
  followup_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index tracked_emails_user_created_idx on public.tracked_emails (user_id, created_at desc);
create index tracked_emails_user_activity_idx on public.tracked_emails (user_id, last_activity_at desc nulls last);
create index tracked_emails_user_status_idx on public.tracked_emails (user_id, status);
create index tracked_emails_recipients_gin on public.tracked_emails using gin (recipients);
create trigger tracked_emails_updated_at before update on public.tracked_emails
  for each row execute function public.set_updated_at();

-- ---------- tracked_links ----------
create table public.tracked_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  destination_url text not null check (char_length(destination_url) <= 2048 and destination_url ~* '^https?://[^[:space:]]+$'),
  label text check (label is null or char_length(label) <= 100),
  created_at timestamptz not null default now(),
  unique (id, email_id),
  unique (email_id, destination_url),
  foreign key (email_id, user_id) references public.tracked_emails (id, user_id) on delete cascade
);
create index tracked_links_email_idx on public.tracked_links (email_id);
create index tracked_links_user_idx on public.tracked_links (user_id);

-- ---------- tracked_documents ----------
-- A per-email landing-page link for a document hosted elsewhere (CV, portfolio...).
create table public.tracked_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  title text not null check (char_length(title) between 1 and 200),
  destination_url text not null check (char_length(destination_url) <= 2048 and destination_url ~* '^https?://[^[:space:]]+$'),
  created_at timestamptz not null default now(),
  unique (id, email_id),
  foreign key (email_id, user_id) references public.tracked_emails (id, user_id) on delete cascade
);
create index tracked_documents_email_idx on public.tracked_documents (email_id);
create index tracked_documents_user_idx on public.tracked_documents (user_id);

-- ---------- email_events ----------
-- No raw IP or raw user-agent is stored: only a salted IP hash and a coarse UA family.
create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email_id uuid not null,
  link_id uuid,
  document_id uuid,
  event_type public.event_type not null,
  source public.event_source not null,
  confidence public.event_confidence not null default 'uncertain',
  confidence_reason text check (confidence_reason is null or char_length(confidence_reason) <= 100),
  ua_family text check (ua_family is null or char_length(ua_family) <= 50),
  ip_hash bytea check (ip_hash is null or octet_length(ip_hash) = 32),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (email_id, dedupe_key),
  foreign key (email_id, user_id) references public.tracked_emails (id, user_id) on delete cascade,
  foreign key (link_id, email_id) references public.tracked_links (id, email_id) on delete cascade,
  foreign key (document_id, email_id) references public.tracked_documents (id, email_id) on delete cascade,
  -- Targets must match the event type.
  check ((event_type = 'link_clicked') = (link_id is not null)),
  check ((event_type = 'document_visit') = (document_id is not null)),
  -- Source must be one that can actually produce the event type (prevents mislabeled data).
  check (
    (event_type = 'email_sent'      and source = 'extension') or
    (event_type = 'open_signal'     and source = 'pixel') or
    (event_type = 'link_clicked'    and source = 'redirect') or
    (event_type = 'document_visit'  and source = 'landing_page') or
    (event_type in ('reply_received', 'bounce_detected') and source = 'gmail_api')
  )
);
create index email_events_email_time_idx on public.email_events (email_id, occurred_at desc);
create index email_events_user_time_idx on public.email_events (user_id, occurred_at desc);
create index email_events_user_type_time_idx on public.email_events (user_id, event_type, occurred_at desc);
create index email_events_link_idx on public.email_events (link_id) where link_id is not null;
create index email_events_document_idx on public.email_events (document_id) where document_id is not null;

-- Keep tracked_emails.last_activity_at current (the email_sent marker is not "activity").
create function public.bump_last_activity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.event_type <> 'email_sent' then
    update public.tracked_emails
       set last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at)
     where id = new.email_id;
  end if;
  return new;
end $$;
create trigger email_events_bump_activity after insert on public.email_events
  for each row execute function public.bump_last_activity();

-- ---------- privileges (defense in depth, on top of RLS) ----------
revoke all on public.user_settings, public.tracked_emails, public.tracked_links,
  public.tracked_documents, public.email_events from public, anon, authenticated;
grant select, insert, update on public.user_settings to authenticated;
grant select, delete on public.tracked_emails, public.tracked_links,
  public.tracked_documents, public.email_events to authenticated;
grant select, insert, update, delete on public.user_settings, public.tracked_emails,
  public.tracked_links, public.tracked_documents, public.email_events to service_role;

-- ---------- row level security ----------
alter table public.user_settings enable row level security;
alter table public.tracked_emails enable row level security;
alter table public.tracked_links enable row level security;
alter table public.tracked_documents enable row level security;
alter table public.email_events enable row level security;

create policy user_settings_select_own on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_settings_insert_own on public.user_settings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy user_settings_update_own on public.user_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy tracked_emails_select_own on public.tracked_emails for select to authenticated
  using (user_id = (select auth.uid()));
create policy tracked_emails_delete_own on public.tracked_emails for delete to authenticated
  using (user_id = (select auth.uid()));

create policy tracked_links_select_own on public.tracked_links for select to authenticated
  using (user_id = (select auth.uid()));
create policy tracked_links_delete_own on public.tracked_links for delete to authenticated
  using (user_id = (select auth.uid()));

create policy tracked_documents_select_own on public.tracked_documents for select to authenticated
  using (user_id = (select auth.uid()));
create policy tracked_documents_delete_own on public.tracked_documents for delete to authenticated
  using (user_id = (select auth.uid()));

create policy email_events_select_own on public.email_events for select to authenticated
  using (user_id = (select auth.uid()));
create policy email_events_delete_own on public.email_events for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------- data deletion and retention ----------
-- User-invoked: delete all of MY tracking data (cascades to links, documents, events).
create function public.delete_my_tracking_data() returns integer
language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  delete from public.tracked_emails where user_id = (select auth.uid());
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.delete_my_tracking_data() from public, anon;
grant execute on function public.delete_my_tracking_data() to authenticated;

-- Server-invoked (cron): delete emails older than each user's retention window.
create function public.purge_expired_data() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from public.tracked_emails e
   using (select u.id as uid, coalesce(s.retention_days, 90) as days
            from auth.users u left join public.user_settings s on s.user_id = u.id) r
   where e.user_id = r.uid and e.created_at < now() - make_interval(days => r.days);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.purge_expired_data() from public, anon, authenticated;
grant execute on function public.purge_expired_data() to service_role;
