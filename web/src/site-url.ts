export const OFFICIAL_ORIGIN = 'https://aipoch.network';

export interface SiteConfig {
  origin: string;
  base: string;
  indexing: boolean;
}

export function parseSiteOrigin(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('SITE_ORIGIN must be an absolute https URL'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('SITE_ORIGIN must be https, without credentials, port, path, query, or fragment');
  }
  if (parsed.origin !== OFFICIAL_ORIGIN) throw new Error('SITE_ORIGIN must be the official https://aipoch.network origin');
  return parsed.origin;
}

export function validSiteBase(base: string): boolean {
  return /^\/(?:[a-zA-Z0-9._-]+\/)*$/.test(base) && !base.split('/').some(segment => segment === '.' || segment === '..');
}

export function siteConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SiteConfig {
  const origin = parseSiteOrigin(env.SITE_ORIGIN ?? OFFICIAL_ORIGIN);
  const base = env.SITE_BASE ?? '/';
  if (!validSiteBase(base)) throw new Error('SITE_BASE must be / or a slash-terminated static path');
  const indexing = env.SITE_INDEXING === '0' ? false : env.SITE_INDEXING === '1' ? true : origin === OFFICIAL_ORIGIN && base === '/';
  return { origin, base, indexing };
}

export function sitePath(pathname: string, search = ''): string {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const query = search && search !== '?' ? search.startsWith('?') ? search : `?${search}` : '';
  return `${path}${query}`;
}

export function absoluteUrl(pathname: string, config: SiteConfig, search = ''): string {
  const relative = `${config.base}${pathname.replace(/^\//, '')}${search && search !== '?' ? search.startsWith('?') ? search : `?${search}` : ''}`;
  return new URL(relative, `${config.origin}/`).href;
}
