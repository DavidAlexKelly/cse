// ============================================================
//  Layer definitions for the group builder overlay views
// ============================================================

export type LayerId = "base" | "weapons" | "platforms" | "comms" | "logistics";

export interface LayerDef {
  id: LayerId;
  label: string;
  icon: string;
  description: string;
  accentColor: string;
}

export const LAYERS: LayerDef[] = [
  {
    id: "base",
    label: "BASE",
    icon: "◉",
    description: "Command structure, echelon, personnel, status and combat effectiveness",
    accentColor: "#22a8c0",
  },
  {
    id: "weapons",
    label: "WEAPONS",
    icon: "⚔",
    description: "Individual weapons carried — small arms, crew-served, missiles",
    accentColor: "#f87171",
  },
  {
    id: "platforms",
    label: "PLATFORMS",
    icon: "🚁",
    description: "Vehicles, aircraft, naval vessels with crew structure",
    accentColor: "#fb923c",
  },
  {
    id: "comms",
    label: "COMMS",
    icon: "📻",
    description: "Call-signs, radio frequencies and IFF codes",
    accentColor: "#fcd34d",
  },
  {
    id: "logistics",
    label: "LOGI",
    icon: "⛽",
    description: "Fuel levels, ammo levels and operational range",
    accentColor: "#4ade80",
  },
];

export const DEFAULT_LAYER: LayerId = "base";
