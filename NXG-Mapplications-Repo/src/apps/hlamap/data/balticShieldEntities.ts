// ── hlamap/data/balticShieldEntities.ts ──────────────────────────────────────
// Re-export of the shared OP-BALTIC-SHIELD-2026 laydown.
//
// The laydown moved to shared/hla/balticShield so the analysis screen's
// mock-demo replay can draw the same operation as the live map's mock-demo
// federation — the same reason the palette lives in shared/hla/ui. Kept as a
// module so the rest of hlamap can go on importing from "../data/balticShieldEntities".

export {
  ADVANCE_DURATION_S,
  BALTIC_SHIELD_ENTITIES,
  BALTIC_SHIELD_FEDERATION_NAME,
  laydownAt,
  type MockSeed,
} from "@/shared/hla/balticShield";
