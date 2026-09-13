import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

type Navigation = { path: string; base: string; href(to: string): string; navigate(to: string, options?: { replace?: boolean; preserveScroll?: boolean }): Promise<void> };
const Context = createContext<Navigation>({ path: '/', base: '/', href: to => to, navigate: async () => {} });
export const useNavigation = () => useContext(Context);

export function internalHref(to: string, base: string): string {
  if (to.startsWith('#')) return to;
  return `${base}${to.replace(/^\//, '')}`;
}

export function NavigationProvider({ initialPath, base, prepare, children }: {
  initialPath: string; base: string; prepare(): Promise<void>; children: React.ReactNode;
}) {
  const [path, setPath] = useState(initialPath);
  const generation = useRef(0);
  const href = useCallback((to: string) => internalHref(to, base), [base]);
  const remember = () => history.replaceState({ ...history.state, aipochScroll: [scrollX, scrollY] }, '', location.href);
  const finish = (url: URL, position?: [number, number], focus = true) => {
    const attempt = generation.current;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (attempt !== generation.current) return;
      if (url.hash) {
        try { document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView(); } catch { /* Invalid anchor stays on the page. */ }
      } else scrollTo(...(position ?? [0, 0]));
      if (focus) document.querySelector<HTMLElement>('#content')?.focus({ preventScroll: true });
    }));
  };
  const navigate = useCallback(async (to: string, options: { replace?: boolean; preserveScroll?: boolean } = {}) => {
    const url = new URL(href(to), location.origin);
    if (url.origin !== location.origin || !url.pathname.startsWith(base)) throw new Error('Not a site navigation');
    const attempt = ++generation.current;
    if (url.pathname !== location.pathname) await prepare();
    if (generation.current !== attempt) return;
    const oldPosition: [number, number] = [scrollX, scrollY];
    remember();
    const method = options.replace ? 'replaceState' : 'pushState';
    history[method]({ ...(options.replace ? history.state : {}), aipochScroll: options.preserveScroll ? oldPosition : [0, 0] }, '', url);
    setPath(`/${url.pathname.slice(base.length)}${url.search}`);
    finish(url, options.preserveScroll ? oldPosition : undefined, !options.preserveScroll);
  }, [base, href, prepare]);
  useEffect(() => {
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    setPath(`/${location.pathname.slice(base.length)}${location.search}`);
    // Back changes history before popstate; keep the departing entry current on each scroll.
    const onScroll = () => remember();
    const onPop = async (event: PopStateEvent) => {
      const attempt = ++generation.current;
      try {
        await prepare();
        if (attempt !== generation.current) return;
        const url = new URL(location.href);
        setPath(`/${url.pathname.slice(base.length)}${url.search}`);
        const saved: unknown = event.state?.aipochScroll;
        finish(url, Array.isArray(saved) && saved.length === 2 && saved.every(value => typeof value === 'number' && Number.isFinite(value)) ? saved as [number, number] : undefined);
      } catch { location.reload(); }
    };
    addEventListener('popstate', onPop);
    addEventListener('scroll', onScroll, { passive: true });
    return () => { removeEventListener('popstate', onPop); removeEventListener('scroll', onScroll); history.scrollRestoration = previousRestoration; };
  }, [base, prepare]);
  return <Context.Provider value={{ path, base, href, navigate }}>{children}</Context.Provider>;
}

/** Retain ordinary links for static HTML, new tabs, downloads, and no-JavaScript browsing. */
export function Link({ to, onClick, ...props }: { to: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { href, navigate } = useNavigation();
  return <a {...props} href={href(to)} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.download || (props.target && props.target !== '_self') || to.startsWith('#')) return;
    event.preventDefault();
    void navigate(to).catch(() => { location.assign(href(to)); });
  }}/>;
}
