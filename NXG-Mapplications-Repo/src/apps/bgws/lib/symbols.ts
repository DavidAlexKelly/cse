// ── bgws/lib/symbols.ts ────────────────────────────────────────────────────
// APP-6 / 2525C SIDCs for units placed in the builder.
//
// The live map gets its symbols from shared/hla/symbology, which works from
// what the federation publishes (names, DIS types). A unit in the builder has
// not been published yet — all it has is a BGWS platform id and a side — so it
// is drawn from the platform's nature path (data/platforms.ts) through the same
// nature → function-ID table, so placed and live units look alike.

import { functionIdForNature } from "@/shared/hla/symbology/app6";
import { platformById, type PlatformEchelon } from "../data/platforms";
import type { Side } from "../types";

const AFFILIATION: Record<Side, string> = { blue: "F", red: "H", neutral: "N" };

/** 2525C echelon (SIDC position 12) for a BGWS echelon word. */
const ECHELON: Record<PlatformEchelon, string> = {
  team: "A",
  section: "C",
  platoon: "D",
  company: "E",
  battalion: "F",
  brigade: "H",
  division: "I",
};

function dimension(nature: string): string {
  if (nature.startsWith("ground track")) return "G";
  if (nature.startsWith("air track")) return "A";
  if (nature.startsWith("sea surface track")) return "S";
  if (nature.startsWith("subsurface")) return "U";
  return "Z";
}

/**
 * The SIDC for a platform on a side. An unknown platform draws as a bare
 * ground frame of the right affiliation — visible, and honestly unspecific.
 */
export function sidcForPlatform(platformId: string, side: Side): string {
  const p = platformById(platformId);
  const nature = p?.nature ?? "ground track/unit";
  const functionId = p?.functionId ?? functionIdForNature(nature);
  const hq = p?.hq ? "A" : "-";
  const echelon = p?.echelon ? ECHELON[p.echelon] : "-";
  return `S${AFFILIATION[side]}${dimension(nature)}P${functionId}${hq}${echelon}---`;
}

/** Map colour for a side, matching the live map's force tints. */
export function sideColour(side: Side | string): string {
  switch (String(side).toLowerCase()) {
    case "blue":
      return "#80C0FF";
    case "red":
      return "#FF8080";
    case "neutral":
      return "#AAFFAA";
    default:
      return "#c0c8d4";
  }
}
