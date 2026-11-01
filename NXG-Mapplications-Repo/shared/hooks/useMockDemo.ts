// ── shared/hooks/useMockDemo.ts ────────────────────────────────────────────
// Who decides whether mock-demo mode is on.
//
// In Workshop it is a variable the module owns, wired to the same boolean on
// every widget so the HLA map and the analysis replay switch together. Outside
// Workshop — `npm run dev`, `vite preview`, or the deployed app opened directly
// — there is no such variable and no way to set one, so the screen is stuck on
// whatever the default happens to be. That makes the mock demo impossible to
// look at without embedding the widget first, which is precisely backwards.
//
// So: when there is no Workshop to take the setting from, the app owns it
// instead and offers a toggle.
//
// How "no Workshop" is detected
// -----------------------------
// Not by build mode. `import.meta.env.DEV` is false under `vite preview` and
// false for a deployed app, both of which are cases we want the toggle in, and
// it would be true for a dev build that someone had embedded in Workshop, where
// we very much do not.
//
// Not by "am I in an iframe" either, which was the first attempt at this and was
// wrong: Foundry's Code Workspaces preview runs the app in an iframe too, so
// every preview looked exactly like a Workshop embed and never got a toggle —
// which is the one place the toggle was most wanted.
//
// A top-level window still settles it immediately: a widget is always embedded,
// so a top-level window cannot be one. For everything else the test is whether
// a Workshop actually answers. useWorkshopContext completes a postMessage
// handshake with its host; with no Workshop out there it simply stays pending
// forever. So if no context has arrived after a short grace period, there is
// nobody to ask and the app takes the setting over.
//
// The setting also reads from and writes to `?mock=1`, which is both a
// shareable link and the escape hatch if the detection below ever gets it
// wrong again: the parameter is honoured whether or not a toggle is shown.

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * How long to wait for a Workshop to answer before concluding there isn't one.
 *
 * Long enough that a real embed will have completed its handshake well inside
 * it, short enough not to be a visible wait. If a genuine embed ever were
 * slower than this the toggle would appear and then remove itself, which is
 * untidy but self-correcting.
 */
export const WORKSHOP_HANDSHAKE_GRACE_MS = 2000;

/** Query parameter that carries the setting in a standalone session. */
export const MOCK_DEMO_PARAM = "mock";

/** Whether a query string asks for mock-demo mode. */
export function readMockDemoParam(search: string): boolean {
  const raw = new URLSearchParams(search).get(MOCK_DEMO_PARAM);
  if (raw == null) return false;
  const value = raw.trim().toLowerCase();
  // A bare `?mock` is an instruction, not an empty value.
  return value === "" || value === "1" || value === "true" || value === "yes" || value === "on";
}

/**
 * Whether the app should offer its own toggle.
 *
 * `contextLoaded`    a Workshop context has arrived, so Workshop owns the
 *                    setting — whatever that context happens to contain.
 * `topLevel`         this window is not embedded in anything, so it cannot
 *                    possibly be a widget.
 * `handshakeExpired` the grace period passed with no context. Either there is
 *                    no Workshop, or one that cannot answer; both mean the
 *                    setting is unreachable unless the app owns it.
 *
 * The order matters. A loaded context always wins, so an embedded widget never
 * grows a second control that could disagree with its module.
 */
export function isStandalone(
  contextLoaded: boolean,
  topLevel: boolean,
  handshakeExpired: boolean,
): boolean {
  if (contextLoaded) return false;
  return topLevel || handshakeExpired;
}

/** Workshop wins wherever it has an opinion. */
export function resolveMockDemo(workshopValue: boolean | null, localValue: boolean): boolean {
  return workshopValue ?? localValue;
}

/** Whether this window is the top-level one, i.e. not embedded anywhere. */
function topLevelWindow(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self === window.top;
  } catch {
    // A cross-origin parent can make the comparison throw, which is itself
    // proof that there is a parent.
    return false;
  }
}

export interface MockDemoControl {
  /** The setting in force, whoever decided it. */
  mockDemo: boolean;
  /** True when this app owns the setting and should render a toggle for it. */
  standalone: boolean;
  setMockDemo: (value: boolean) => void;
}

export interface MockDemoSource {
  /** The loaded value of the module's boolean, or null if it has none. */
  value: boolean | null;
  /**
   * Whether a Workshop context has arrived at all.
   *
   * Separate from `value` on purpose: a context that loaded without the field
   * still means a Workshop is present and in charge, and must not be mistaken
   * for no Workshop at all.
   */
  contextLoaded: boolean;
}

/**
 * Resolve mock-demo mode from Workshop, or own it when there is no Workshop.
 */
export function useMockDemo(source: MockDemoSource): MockDemoControl {
  const { value: workshopValue, contextLoaded } = source;

  const topLevel = useMemo(topLevelWindow, []);
  const [handshakeExpired, setHandshakeExpired] = useState(false);

  // Give a Workshop a moment to answer before concluding there isn't one. Not
  // started at all when the window is top-level, because that already settles
  // it, or once a context has arrived.
  useEffect(() => {
    if (topLevel || contextLoaded) return;
    const timer = window.setTimeout(() => setHandshakeExpired(true), WORKSHOP_HANDSHAKE_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [topLevel, contextLoaded]);

  const standalone = isStandalone(contextLoaded, topLevel, handshakeExpired);

  const [localValue, setLocalValue] = useState(() =>
    typeof window === "undefined" ? false : readMockDemoParam(window.location.search),
  );

  const setMockDemo = useCallback((value: boolean) => setLocalValue(value), []);

  // Keep the URL in step so a reload holds the setting and the link carries it.
  // replaceState rather than pushState: flipping a display mode is not a place
  // in the app's history that Back should return to.
  useEffect(() => {
    if (!standalone || typeof window === "undefined") return;

    const url = new URL(window.location.href);
    if (localValue) url.searchParams.set(MOCK_DEMO_PARAM, "1");
    else url.searchParams.delete(MOCK_DEMO_PARAM);

    if (url.toString() !== window.location.href) {
      window.history.replaceState(window.history.state, "", url.toString());
    }
  }, [standalone, localValue]);

  return {
    mockDemo: resolveMockDemo(workshopValue, localValue),
    standalone,
    setMockDemo,
  };
}

export default useMockDemo;
