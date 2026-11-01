import { describe, expect, it } from "vitest";
import type { HlaEntity } from "@/shared/hla/types";
import {
  candidatesFromFrames,
  rosterFromFrames,
  sampleStepSeconds,
  trackFromFrames,
} from "./trackSample";

function e(id: string, lat: number, lon: number, force: "BLUE" | "RED" = "BLUE"): HlaEntity {
  return {
    id,
    callsign: `CS-${id}`,
    unit: `Unit ${id}`,
    force,
    sisoType: "",
    lat,
    lon,
    heading: 0,
    speed: 0,
    damageState: "NoDamage",
    aggregateState: "Aggregated" as HlaEntity["aggregateState"],
    roe: "return_fire",
    simulator: "vbs4",
  };
}

describe("track sampling", () => {
  const frames = [
    { ts: 1060, entities: [e("a", 54.1, 20.1), e("b", 54.9, 21, "RED")] },
    { ts: 1000, entities: [e("a", 54.0, 20.0)] },
    { ts: 1120, entities: [e("a", 54.2, NaN)] },
  ];

  it("orders each entity's samples by time and skips unknown positions", () => {
    const track = trackFromFrames(frames, 1000);
    expect(track.get("a")).toEqual([
      { tSec: 0, lat: 54.0, lon: 20.0 },
      { tSec: 60, lat: 54.1, lon: 20.1 },
    ]);
    expect(track.get("b")).toEqual([{ tSec: 60, lat: 54.9, lon: 21 }]);
  });

  it("matches candidates at their first appearance", () => {
    const candidates = candidatesFromFrames(frames);
    expect(candidates.find((c) => c.id === "a")).toMatchObject({
      lat: 54.0,
      lon: 20.0,
      force: "blue",
    });
    expect(candidates.find((c) => c.id === "b")).toMatchObject({ force: "red" });
  });

  it("builds a roster from what entities call themselves", () => {
    expect(rosterFromFrames(frames).get("b")).toEqual({ label: "Unit b", force: "RED" });
  });

  it("keeps the read to a fixed number of buckets, never finer than 30 s", () => {
    expect(sampleStepSeconds(600)).toBe(30);
    expect(sampleStepSeconds(16 * 3600)).toBe(144);
  });
});
