-- Server-only functions used by the tracking API (service_role only).
-- Tokens arrive as SHA-256 hex strings; raw tokens are never sent to the database.

create function public.health_check() returns boolean
language sql stable set search_path = '' as $$ select true $$;

create function public.register_tracked_email(
  p_user_id uuid, p_pixel_hash text, p_recipients text[], p_subject text,
  p_links jsonb, p_documents jsonb
) returns uuid language plpgsql set search_path = '' as $$
declare v_id uuid; l jsonb; d jsonb;
begin
  insert into public.tracked_emails (user_id, pixel_token_hash, recipients, subject)
  values (p_user_id, decode(p_pixel_hash, 'hex'), coalesce(p_recipients, '{}'), p_subject)
  returning id into v_id;
  for l in select * from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) loop
    insert into public.tracked_links (user_id, email_id, token_hash, destination_url, label)
    values (p_user_id, v_id, decode(l->>'hash', 'hex'), l->>'url', l->>'label');
  end loop;
  for d in select * from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) loop
    insert into public.tracked_documents (user_id, email_id, token_hash, title, destination_url)
    values (p_user_id, v_id, decode(d->>'hash', 'hex'), d->>'title', d->>'url');
  end loop;
  return v_id;
end $$;

create function public.resolve_token(p_kind text, p_hash text)
returns table (email_id uuid, user_id uuid, target_id uuid, status public.email_status,
               send_confirmed_at timestamptz, destination_url text, title text)
language plpgsql stable set search_path = '' as $$
declare h bytea := decode(p_hash, 'hex');
begin
  if p_kind = 'pixel' then
    return query select e.id, e.user_id, null::uuid, e.status, e.send_confirmed_at, null::text, null::text
      from public.tracked_emails e where e.pixel_token_hash = h;
  elsif p_kind = 'link' then
    return query select e.id, e.user_id, l.id, e.status, e.send_confirmed_at, l.destination_url, l.label
      from public.tracked_links l join public.tracked_emails e on e.id = l.email_id where l.token_hash = h;
  elsif p_kind = 'document' then
    return query select e.id, e.user_id, d.id, e.status, e.send_confirmed_at, d.destination_url, d.title
      from public.tracked_documents d join public.tracked_emails e on e.id = d.email_id where d.token_hash = h;
  end if;
end $$;

-- Returns true if a new event row was inserted, false if it was a duplicate.
create function public.record_event(
  p_email_id uuid, p_user_id uuid, p_type public.event_type, p_source public.event_source,
  p_link_id uuid, p_document_id uuid, p_confidence public.event_confidence, p_reason text,
  p_ua_family text, p_ip_hash text, p_dedupe text, p_occurred timestamptz default now()
) returns boolean language plpgsql set search_path = '' as $$
declare n integer;
begin
  insert into public.email_events (user_id, email_id, link_id, document_id, event_type, source,
      confidence, confidence_reason, ua_family, ip_hash, dedupe_key, occurred_at)
  values (p_user_id, p_email_id, p_link_id, p_document_id, p_type, p_source, p_confidence, p_reason,
      p_ua_family, case when p_ip_hash is null then null else decode(p_ip_hash, 'hex') end, p_dedupe, p_occurred)
  on conflict (email_id, dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- registered -> injected. Requires that something was actually injected.
create function public.mark_email_injected(p_user_id uuid, p_email_id uuid, p_pixel_injected boolean, p_links_rewritten integer)
returns boolean language plpgsql set search_path = '' as $$
begin
  if not (coalesce(p_pixel_injected, false) or coalesce(p_links_rewritten, 0) > 0) then return false; end if;
  update public.tracked_emails e
     set status = 'injected', pixel_injected = p_pixel_injected, links_rewritten = p_links_rewritten, injected_at = now()
   where e.id = p_email_id and e.user_id = p_user_id and e.status = 'registered'
     and p_links_rewritten between 0 and (select count(*) from public.tracked_links l where l.email_id = e.id);
  return found;
end $$;

-- injected -> send_confirmed (+ email_sent event). Cannot skip the injected step. Idempotent.
create function public.confirm_email_sent(p_user_id uuid, p_email_id uuid)
returns text language plpgsql set search_path = '' as $$
declare v_status public.email_status;
begin
  update public.tracked_emails e
     set status = 'send_confirmed', send_confirmed_at = now(),
         followup_due_at = (select now() + make_interval(days => s.followup_reminder_days)
                              from public.user_settings s
                             where s.user_id = e.user_id and s.followup_reminder_days is not null)
   where e.id = p_email_id and e.user_id = p_user_id and e.status = 'injected';
  if found then
    insert into public.email_events (user_id, email_id, event_type, source, confidence, dedupe_key)
    values (p_user_id, p_email_id, 'email_sent', 'extension', 'uncertain', 'email_sent')
    on conflict do nothing;
    return 'send_confirmed';
  end if;
  select e.status into v_status from public.tracked_emails e where e.id = p_email_id and e.user_id = p_user_id;
  return case when v_status = 'send_confirmed' then 'send_confirmed' else null end;
end $$;

revoke all on function public.health_check(), public.register_tracked_email(uuid,text,text[],text,jsonb,jsonb),
  public.resolve_token(text,text),
  public.record_event(uuid,uuid,public.event_type,public.event_source,uuid,uuid,public.event_confidence,text,text,text,text,timestamptz),
  public.mark_email_injected(uuid,uuid,boolean,integer), public.confirm_email_sent(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.health_check(), public.register_tracked_email(uuid,text,text[],text,jsonb,jsonb),
  public.resolve_token(text,text),
  public.record_event(uuid,uuid,public.event_type,public.event_source,uuid,uuid,public.event_confidence,text,text,text,text,timestamptz),
  public.mark_email_injected(uuid,uuid,boolean,integer), public.confirm_email_sent(uuid,uuid)
  to service_role;
