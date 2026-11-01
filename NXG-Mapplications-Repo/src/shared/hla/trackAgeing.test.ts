import { describe, expect, it } from "vitest";
import { ENTITY_TTL_MS, isExpired, rowObservedAt } from "./trackAgeing";
import type { TrackRow } from "./trackRow";

const ms = (iso: string) => Date.parse(iso);

describe("rowObservedAt", () => {
  it("reads observed_at", () => {
    expect(rowObservedAt({ observed_at: "2026-09-11T14:14:33.661Z" })).toBe(
      ms("2026-09-11T14:14:33.661Z")
    );
  });

  // The regression. Taken verbatim from a row of HLA.Human1151, which sat
  // still for half an hour while being published in every 1 Hz tick: fresh
  // observed_at, bridge_last_updated frozen ~31 minutes earlier. Reading the
  // bridge clock here is what deleted it — and seven others — before they ever
  // reached the map.
  it("ignores bridge_last_updated on a stationary entity", () => {
    const parked: TrackRow = {
      entity_id: "ObjectInstanceHandle<1151>",
      name: "HLA.Human1151",
      observed_at: "2026-09-11T14:14:33.661Z",
      bridge_last_updated: "2026-09-11T13:43:55.866Z",
    };

    expect(rowObservedAt(parked)).toBe(ms("2026-09-11T14:14:33.661Z"));
  });

  it("does not fall back to bridge_last_updated when observed_at is missing", () => {
    expect(rowObservedAt({ bridge_last_updated: "2026-09-11T13:43:55.866Z" })).toBeNull();
    expect(rowObservedAt({ observed_at: "", bridge_last_updated: "2026-09-11T13:43:55.866Z" }))
      .toBeNull();
  });

  it("tolerates an epoch number, in case the publisher's format changes", () => {
    expect(rowObservedAt({ observed_at: "1789136073661" })).toBe(1789136073661);
  });

  it("returns null for an unparseable value rather than a wrong number", () => {
    expect(rowObservedAt({ observed_at: "not a timestamp" })).toBeNull();
    expect(rowObservedAt({})).toBeNull();
  });
});

describe("isExpired", () => {
  const newest = ms("2026-09-11T14:14:33.661Z");

  it("keeps an entity still being published", () => {
    expect(isExpired(newest, newest)).toBe(false);
    expect(isExpired(newest - 3_000, newest)).toBe(false);
  });

  it("keeps a stationary entity, published every tick but never changing", () => {
    // What the bug looked like from the other side: had this been measured on
    // the bridge clock the lag would have been ~1,838,000 ms and the unit gone.
    const parkedButPublished = newest;
    expect(isExpired(parkedButPublished, newest)).toBe(false);
  });

  it("drops an entity that has stopped being published", () => {
    expect(isExpired(newest - ENTITY_TTL_MS - 1, newest)).toBe(true);
    expect(isExpired(ms("2026-09-11T13:43:55.866Z"), newest)).toBe(true);
  });

  it("is exclusive at the TTL boundary", () => {
    expect(isExpired(newest - ENTITY_TTL_MS, newest)).toBe(false);
  });

  it("evicts nothing before the first row establishes a high-water mark", () => {
    expect(isExpired(0, 0)).toBe(false);
  });
});
