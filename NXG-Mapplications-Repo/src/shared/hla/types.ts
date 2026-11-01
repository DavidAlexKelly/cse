// ── shared/hla/types.ts ────────────────────────────────────────────────────
// The entity model shared by every view of the HLA federation.
//
// Originally hlamap/types.ts, which mirrored the CSE HLA Bridge's Entity DTO
// (com.decho.cse.bridge.model.Entity). It lives here now because the analysis
// screen replays the same entities from the same track stream and has to draw
// them with the same symbology — the only difference between the two apps is
// where the entities come from (live stream vs. historical window) and what
// you can do with them (task them vs. scrub through them).
//
// Command/tasking-only shapes (PickMode, CommandAction, obstacles, comms
// zones) stay in hlamap: they describe things you can only do to a live
// federation, and the analysis screen has no use for them.

export type Force = "BLUE" | "RED";

export type DamageState = "NoDamage" | "SlightDamage" | "ModerateDamage" | "Destroyed";

export type AggregateState =
  | "aggregated"
  | "disaggregated"
  | "fully_disaggregated"
  | "pseudo_disaggregated";

export type Roe = "hold_fire" | "return_fire" | "fire_at_will";

export type Simulator = "mock" | "vbs4" | "sword" | "simworks" | "unknown";

export interface HlaEntity {
  /**
   * The bridge's `id`: an HLA object-instance handle such as
   * `ObjectInstanceHandle<1104>`. Unique within a federation execution, but
   * **reassigned whenever the federation restarts** — fine as a React key,
   * not durable, and not comparable across runs.
   */
  id: string;
  /**
   * NETN UniqueId (a UUID), when the publisher provides one. This is the
   * stable identity and the thing ETR tasks address, so commands prefer it.
   * Absent for entities published without the NETN MIM's UniqueId attribute,
   * which cannot be tasked.
   */
  uniqueId?: string;
  callsign: string;
  unit: string;
  force: Force;
  /** SISO DIS entity type code, e.g. "1.1.276.3.1.1.2". */
  sisoType: string;
  /**
   * Explicit APP-6 nature path, e.g. "ground track/unit/combat/armor".
   *
   * Normally the nature is looked up from the SWORD catalogue by unit name.
   * Anything the catalogue does not know — every non-SWORD publisher, including
   * the mock federation — resolves to no nature, which renders as an empty
   * frame with no icon. Setting this bypasses the lookup.
   */
  natureApp6?: string;
  lat: number;
  lon: number;
  /** Metres above the WGS-84 ellipsoid. */
  altitudeMeters?: number;
  /** degrees, 0 = North */
  heading: number;
  /** km/h — 0 means stationary */
  speed: number;
  damageState: DamageState;
  aggregateState: AggregateState;
  roe: Roe;
  simulator: Simulator;
}

export interface LatLon {
  lat: number;
  lon: number;
}
