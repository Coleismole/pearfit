// The current route, read from the address bar's hash (see src/lib/router.ts).
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { parseHash } from "./lib/router.ts";
import type { Route } from "./lib/router.ts";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const route = useMemo(() => parseHash(hash), [hash]);
  const path = route.segments.join("/");
  const firstScreen = useRef(true);

  // What a browser does by itself when a new page loads, done here for a new screen: start at the top, name the
  // tab after the screen, and put keyboard and screen-reader focus on its heading. A change in the query only
  // (another size, an opened picker) is the same screen and keeps its place.
  useEffect(() => {
    const heading = document.querySelector<HTMLElement>("main h1");
    const title = heading?.textContent?.trim();
    document.title = title && title !== "Pearfit" ? `${title} · Pearfit` : "Pearfit";
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    window.scrollTo(0, 0);
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [path]);
  return route;
}

export function go(hash: string): void {
  window.location.hash = hash;
}

// Like go(), but the Back button skips over it. Used for a choice made on a screen, such as another size.
export function swap(hash: string): void {
  window.location.replace(hash);
}
