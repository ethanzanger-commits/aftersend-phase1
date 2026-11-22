export type Confidence = 'likely_human' | 'likely_automated' | 'uncertain';
export type EventKind = 'open_signal' | 'link_clicked' | 'document_visit';
export type Classification = { confidence: Confidence; reason: string; uaFamily: string };

export function uaFamily(ua: string | null | undefined): string {
  const s = (ua ?? '').trim();
  if (!s) return 'none';
  if (/GoogleImageProxy/i.test(s)) return 'gmail_image_proxy';
  if (/ms-office|SafeLinks|BingPreview|MSOffice/i.test(s)) return 'microsoft_scanner';
  if (/Barracuda|Proofpoint|Mimecast|Symantec|Forcepoint|FireEye|Trend ?Micro|Zscaler|urlscan|Cisco/i.test(s)) return 'security_scanner';
  if (/bot|crawl|spider|slurp|facebookexternalhit|curl\/|wget|python-requests|python-urllib|node-fetch|axios|go-http-client|java\/|libwww|headless|phantomjs|httpclient|okhttp|Google-Read-Aloud|Google-Safety/i.test(s)) return 'bot';
  if (/Edg\//.test(s)) return 'edge';
  if (/Firefox\//.test(s)) return 'firefox';
  if (/Chrome\//.test(s)) return 'chrome';
  if (/Safari\//.test(s)) return 'safari';
  return 'other';
}

/**
 * Conservative labelling. Opens are NEVER labelled likely_human (pixels are imperfect: proxies, prefetching, caching).
 * "likely_human" means only "ordinary browser client, not immediately after send" - not confirmed human engagement.
 */
export function classify(kind: EventKind, ua: string | null | undefined, secondsSinceSend: number | null): Classification {
  const fam = uaFamily(ua);
  const mk = (confidence: Confidence, reason: string): Classification => ({ confidence, reason, uaFamily: fam });
  if (fam === 'bot' || fam === 'security_scanner' || fam === 'microsoft_scanner') return mk('likely_automated', `automated_user_agent:${fam}`);
  if (fam === 'none') return mk('uncertain', 'no_user_agent');
  const quick = secondsSinceSend !== null && secondsSinceSend <= 5;
  if (kind === 'open_signal') {
    if (quick) return mk('uncertain', 'immediately_after_send');
    if (fam === 'gmail_image_proxy') return mk('uncertain', 'image_proxy_may_prefetch_or_cache');
    return mk('uncertain', 'open_pixels_are_imperfect');
  }
  if (quick) return mk('likely_automated', 'immediately_after_send');
  if (fam === 'other') return mk('uncertain', 'unrecognized_user_agent');
  return mk('likely_human', 'browser_user_agent');
}
