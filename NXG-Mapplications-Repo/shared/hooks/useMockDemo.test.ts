// ── shared/hooks/useMockDemo.test.ts ───────────────────────────────────────
// The decision rules, tested without a DOM.
//
// The hook itself is a thin wrapper over these three functions plus
// window.location; the rules are where the mistakes would be, and they are
// pure, so they are what is tested here.

import { describe, expect, it } from "vitest";
import { isStandalone, readMockDemoParam, resolveMockDemo } from "./useMockDemo";

describe("readMockDemoParam", () => {
  it("accepts the spellings someone would actually type", () => {
    for (const search of ["?mock=1", "?mock=true", "?mock=TRUE", "?mock=yes", "?mock=on"]) {
      expect(readMockDemoParam(search)).toBe(true);
    }
  });

  it("treats a bare ?mock as an instruction rather than an empty value", () => {
    expect(readMockDemoParam("?mock")).toBe(true);
    expect(readMockDemoParam("?mock=")).toBe(true);
  });

  it("is off when absent, and off when explicitly off", () => {
    expect(readMockDemoParam("")).toBe(false);
    expect(readMockDemoParam("?other=1")).toBe(false);
    expect(readMockDemoParam("?mock=0")).toBe(false);
    expect(readMockDemoParam("?mock=false")).toBe(false);
  });

  it("finds the parameter alongside others", () => {
    expect(readMockDemoParam("?run=abc&mock=1&zoom=9")).toBe(true);
  });
});

describe("isStandalone", () => {
  // Arguments are (contextLoaded, topLevel, handshakeExpired).

  it("offers a toggle to a top-level window immediately", () => {
    expect(isStandalone(false, true, false)).toBe(true);
  });

  it("offers one to an embedded app once no Workshop has answered", () => {
    // This is the Code Workspaces preview case. It runs the app in an iframe,
    // so an "am I framed" test called it a widget and never showed a toggle —
    // in the one place the toggle is most wanted.
    expect(isStandalone(false, false, true)).toBe(true);
  });

  it("waits before deciding an embedded app is standalone", () => {
    // A real widget is in an iframe too, and must not sprout a toggle in the
    // moment before its context arrives.
    expect(isStandalone(false, false, false)).toBe(false);
  });

  it("defers to a loaded Workshop context however it is hosted", () => {
    expect(isStandalone(true, false, false)).toBe(false);
    expect(isStandalone(true, true, false)).toBe(false);
    // Even if the grace period had already expired before the context landed.
    expect(isStandalone(true, false, true)).toBe(false);
  });
});

describe("resolveMockDemo", () => {
  it("lets Workshop win wherever it has an opinion", () => {
    expect(resolveMockDemo(true, false)).toBe(true);
    expect(resolveMockDemo(false, true)).toBe(false);
  });

  it("falls back to the local setting when Workshop has none", () => {
    expect(resolveMockDemo(null, true)).toBe(true);
    expect(resolveMockDemo(null, false)).toBe(false);
  });
});
