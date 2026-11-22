declare const __API_BASE_URL__: string;
/** The only build-time value the Gmail-facing content script receives. */
export const API_BASE = __API_BASE_URL__.replace(/\/+$/, '');
