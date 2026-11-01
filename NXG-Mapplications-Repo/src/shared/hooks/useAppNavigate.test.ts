import { describe, expect, it } from "vitest";
import { carryDemoParam } from "./useAppNavigate";

describe("carryDemoParam", () => {
  it("carries demo mode to the next app", () => {
    expect(carryDemoParam("/execute", "?mock=1")).toBe("/execute?mock=1");
    expect(carryDemoParam("/orbat?define=1", "?x=2&mock=true")).toBe("/orbat?define=1&mock=1");
  });
  it("leaves live mode, and explicit choices, alone", () => {
    expect(carryDemoParam("/execute", "")).toBe("/execute");
    expect(carryDemoParam("/execute", "?mock=0")).toBe("/execute");
    expect(carryDemoParam("/hlamap?mock=1", "?mock=1")).toBe("/hlamap?mock=1");
  });
  it("keeps a hash", () => {
    expect(carryDemoParam("/analysis#debrief", "?mock")).toBe("/analysis?mock=1#debrief");
  });
});
