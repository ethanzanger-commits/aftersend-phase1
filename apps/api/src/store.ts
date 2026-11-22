/** All database access goes through Postgres functions (see supabase/migrations/*_api_functions.sql). */
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export type Resolved = {
  email_id: string; user_id: string; target_id: string | null; status: string;
  send_confirmed_at: string | Date | null; destination_url: string | null; title: string | null;
};
export type EventInput = {
  emailId: string; userId: string; type: 'email_sent' | 'open_signal' | 'link_clicked' | 'document_visit';
  source: 'extension' | 'pixel' | 'redirect' | 'landing_page'; linkId?: string | null; documentId?: string | null;
  confidence: string; reason: string; uaFamily: string; ipHash: string; dedupe: string; occurred: Date;
};
export interface Store {
  registerEmail(a: { userId: string; pixelHash: string; recipients: string[]; subject: string | null;
    links: { hash: string; url: string; label: string | null }[]; documents: { hash: string; title: string; url: string }[] }): Promise<string>;
  resolveToken(kind: 'pixel' | 'link' | 'document', hash: string): Promise<Resolved | null>;
  recordEvent(e: EventInput): Promise<boolean>;
  markInjected(a: { userId: string; emailId: string; pixelInjected: boolean; linksRewritten: number }): Promise<boolean>;
  confirmSent(a: { userId: string; emailId: string }): Promise<string | null>;
  purgeExpired(): Promise<number>;
  ping(): Promise<boolean>;
}

const scalar = (d: unknown): any => (Array.isArray(d) ? (d.length ? Object.values(d[0] as object)[0] : null) : d);

export function createRpcStore(rpc: Rpc): Store {
  return {
    async registerEmail(a) {
      return scalar(await rpc('register_tracked_email', {
        p_user_id: a.userId, p_pixel_hash: a.pixelHash, p_recipients: a.recipients, p_subject: a.subject,
        p_links: a.links, p_documents: a.documents,
      })) as string;
    },
    async resolveToken(kind, hash) {
      const d = await rpc('resolve_token', { p_kind: kind, p_hash: hash });
      return Array.isArray(d) && d.length ? (d[0] as Resolved) : null;
    },
    async recordEvent(e) {
      return !!scalar(await rpc('record_event', {
        p_email_id: e.emailId, p_user_id: e.userId, p_type: e.type, p_source: e.source,
        p_link_id: e.linkId ?? null, p_document_id: e.documentId ?? null, p_confidence: e.confidence,
        p_reason: e.reason, p_ua_family: e.uaFamily, p_ip_hash: e.ipHash, p_dedupe: e.dedupe, p_occurred: e.occurred.toISOString(),
      }));
    },
    async markInjected(a) {
      return !!scalar(await rpc('mark_email_injected', {
        p_user_id: a.userId, p_email_id: a.emailId, p_pixel_injected: a.pixelInjected, p_links_rewritten: a.linksRewritten }));
    },
    async confirmSent(a) {
      return (scalar(await rpc('confirm_email_sent', { p_user_id: a.userId, p_email_id: a.emailId })) as string | null) ?? null;
    },
    async purgeExpired() { return Number(scalar(await rpc('purge_expired_data', {})) ?? 0); },
    async ping() { return scalar(await rpc('health_check', {})) === true; },
  };
}
