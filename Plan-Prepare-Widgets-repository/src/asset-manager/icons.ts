// ============================================================
//  Asset Manager — Shared icon / visual helpers
// ============================================================
//
//  Tactical-styled marks: single-glyph typographic symbols rather
//  than colour emoji, so the widget matches the ORBAT Manager's
//  military dark theme.  All marks are BMP characters that render
//  crisply in monospaced UI fonts.

// ─── Domain ──────────────────────────────────────────────────────────────────

export interface DomainStyle {
  emoji: string; // large mark used in cards
  icon: string; // small inline mark for tags/labels
  label: string;
  cssClass: string; // am-tag class suffix
  color: string; // CSS custom-property value
  bg: string;
}

const DOMAIN_MAP: [RegExp, DomainStyle][] = [
  [
    /air|avia|helo|helicopter|rotary|fixed.wing|uav|uas|drone|fighter/i,
    {
      emoji: "▲",
      icon: "▲",
      label: "Air",
      cssClass: "domain-air",
      color: "var(--am-accent)",
      bg: "rgba(34,168,192,0.15)",
    },
  ],
  [
    /ground|land|armou?r|infantry|vehicle|wheeled|tracked|mbt|tank/i,
    {
      emoji: "■",
      icon: "■",
      label: "Ground",
      cssClass: "domain-ground",
      color: "var(--am-green)",
      bg: "rgba(108, 92, 231,0.15)",
    },
  ],
  [
    /mar|sea|naval|ship|vessel|coast|littor/i,
    {
      emoji: "▼",
      icon: "▼",
      label: "Maritime",
      cssClass: "domain-maritime",
      color: "var(--am-teal)",
      bg: "rgba(19,157,175,0.15)",
    },
  ],
  [
    /cyber|electronic|ew|sigint|istar/i,
    {
      emoji: "◈",
      icon: "◈",
      label: "Electronic",
      cssClass: "domain-cyber",
      color: "var(--am-purple)",
      bg: "rgba(157,112,196,0.15)",
    },
  ],
  [
    /space/i,
    {
      emoji: "✦",
      icon: "✦",
      label: "Space",
      cssClass: "domain-space",
      color: "#c0b0f0",
      bg: "rgba(192,176,240,0.15)",
    },
  ],
];

const DOMAIN_FALLBACK: DomainStyle = {
  emoji: "◇",
  icon: "◇",
  label: "Unknown",
  cssClass: "domain-unknown",
  color: "var(--am-text-muted)",
  bg: "rgba(143,153,168,0.12)",
};

export function getDomainStyle(domain: string | null | undefined): DomainStyle {
  if (!domain) return DOMAIN_FALLBACK;
  for (const [pattern, style] of DOMAIN_MAP) {
    if (pattern.test(domain)) return style;
  }
  return { ...DOMAIN_FALLBACK, label: domain };
}

// ─── Asset category ───────────────────────────────────────────────────────────

const CATEGORY_MARK: [RegExp, string][] = [
  [/tank|mbt|challenger|leopard|abrams/i, "■"],
  [/attack.helo|apache|tiger/i, "▲"],
  [/transport.helo|chinook|merlin/i, "▲"],
  [/helo|helicopter|rotary/i, "▲"],
  [/fighter|typhoon|f.35|f.16|rafale/i, "▲"],
  [/transport.aircraft|c.130|a400/i, "▲"],
  [/aircraft|fixed.wing|plane/i, "▲"],
  [/drone|uav|uas|reaper|predator/i, "◈"],
  [/frigate|destroyer|ship|vessel/i, "▼"],
  [/submarine/i, "▽"],
  [/armou?red.carrier|apc|ifv|bradley|warrior/i, "■"],
  [/wheeled|jeep|truck|land.rover/i, "▪"],
  [/artillery|howitzer|mlrs|rocket/i, "✷"],
  [/missile|sam|air.def/i, "✕"],
  [/radar|sensor|istar/i, "◉"],
  [/engineering|bridg|pioneer/i, "⚒"],
  [/medical|ambulance/i, "✚"],
  [/supply|logistics|truck/i, "▦"],
];

export function getCategoryEmoji(category: string | null | undefined): string {
  if (!category) return "◇";
  for (const [pattern, mark] of CATEGORY_MARK) {
    if (pattern.test(category)) return mark;
  }
  return "◇";
}

// ─── Nationality codes ────────────────────────────────────────────────────────
//
//  ISO 3166 alpha-3 codes rendered as small tactical tags instead of
//  colour emoji flags. Returns an empty string if no match, so callers
//  can conditionally render.

const NAT_CODES: [RegExp, string][] = [
  [/united.states|usa|us.army|us.air.force|american/i, "USA"],
  [/united.kingdom|uk\b|british|british.army|royal/i, "GBR"],
  [/germany|german|bundeswehr/i, "DEU"],
  [/france|french/i, "FRA"],
  [/netherlands|dutch/i, "NLD"],
  [/poland|polish/i, "POL"],
  [/canada|canadian/i, "CAN"],
  [/australia|australian/i, "AUS"],
  [/norway|norwegian/i, "NOR"],
  [/denmark|danish/i, "DNK"],
  [/turkey|turkish/i, "TUR"],
  [/spain|spanish/i, "ESP"],
  [/italy|italian/i, "ITA"],
  [/belgium|belgian/i, "BEL"],
  [/sweden|swedish/i, "SWE"],
  [/finland|finnish/i, "FIN"],
  [/portugal|portuguese/i, "PRT"],
  [/czech|czechia/i, "CZE"],
  [/romania|romanian/i, "ROU"],
  [/hungary|hungarian/i, "HUN"],
  [/ukraine|ukrainian/i, "UKR"],
  [/nato/i, "NATO"],
];

export function getNatFlag(nationality: string | null | undefined): string {
  if (!nationality) return "";
  for (const [pattern, code] of NAT_CODES) {
    if (pattern.test(nationality)) return code;
  }
  return "";
}

// ─── Severity ─────────────────────────────────────────────────────────────────

export const SEV_EMOJI: Record<string, string> = {
  error: "●",
  warning: "▲",
  info: "◆",
};

// ─── Mapping status ───────────────────────────────────────────────────────────

export function getMappingBadge(count: number): {
  label: string;
  cssClass: string;
  emoji: string;
} {
  if (count === 0)
    return { label: "No VBS4", cssClass: "unmapped", emoji: "!" };
  if (count === 1) return { label: "1 VBS4", cssClass: "mapped", emoji: "✓" };
  return { label: `${count} VBS4`, cssClass: "mapped", emoji: "✓" };
}

// ─── Nav marks ────────────────────────────────────────────────────────────────

export const NAV_ICONS: Record<string, string> = {
  inventory: "▤",
  categoryBrowser: "▦",
  vbs4: "▣",
  simworks: "◈",
  sword: "⚔",
  disReference: "§",
  sidcReference: "▧",
  mismatches: "!",
};

// ─── Mismatch category marks ──────────────────────────────────────────────────

export const MISMATCH_EMOJI: Record<string, string> = {
  // Simulator ↔ canonical mapping
  orphan_vbs4: "⇋",
  orphan_simworks: "⇋",
  orphan_sword: "⇋",
  unmapped_canonical: "∅",
  single_simulator_only: "◔",
  // Cross-simulator agreement
  cross_sim_disagreement: "⇆",
  // Simulator internal quality
  domain_mismatch: "⇄",
  nationality_mismatch: "◐",
  missing_crew_config: "☰",
  missing_dis_code: "#",
  missing_dis6: "§",
  duplicate_sim_class: "≡",
  branch_inconsistency: "⚔",
  drone_flag_mismatch: "◈",
  // Unit wiring
  dead_unit_reference: "†",
  unit_missing_sim_code: "⌀",
  unit_sim_owner_mismatch: "⇎",
  unit_broken_canonical: "✗",
  // Catalogue usage
  unused_vbs4: "○",
  unused_simworks: "○",
  unused_sword: "○",
};
