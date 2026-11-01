// analysisScreen/components/MatchReview.tsx
//
// Review and correct which simulated entity each planned unit is. Every
// automatic match is shown with how it was made; the analyst can pick another
// entity (by its simulator name) or say the unit is not in the run. Corrections
// are kept per phase and re-score the run at once.
import { type FC, useMemo } from "react";
import type { PlannedUnit } from "@/shared/hla/balticShieldPlan";
import type { EntityCandidate, EntityMatch } from "../lib/entityMatch";
import { distanceKm } from "../lib/geo";
import { type MatchOverrides, NOT_IN_RUN, simulatorName } from "../lib/matchOverrides";
import { UI } from "./ui";

const AUTO = "\u0000auto";

const METHOD_LABEL: Record<EntityMatch["method"], string> = {
  manual: "corrected",
  name: "by name",
  position: "by position (inferred)",
};

interface Props {
  units: readonly PlannedUnit[];
  matches: readonly EntityMatch[];
  candidates: readonly EntityCandidate[];
  overrides: MatchOverrides;
  stale: readonly string[];
  onChange: (plannedId: string, value: string | undefined) => void;
  onClearAll: () => void;
  onClose: () => void;
}

export const MatchReview: FC<Props> = ({
  units,
  matches,
  candidates,
  overrides,
  stale,
  onChange,
  onClearAll,
  onClose,
}) => {
  const matchFor = useMemo(() => new Map(matches.map((m) => [m.plannedId, m])), [matches]);
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  // One option per simulator name per side, nearest-first for each unit.
  const names = useMemo(() => {
    const out = {
      blue: new Map<string, EntityCandidate>(),
      red: new Map<string, EntityCandidate>(),
    };
    for (const c of candidates) {
      const n = simulatorName(c);
      if (!out[c.force].has(n)) out[c.force].set(n, c);
    }
    return out;
  }, [candidates]);
  // Unmatched and inferred first: that is where a correction is needed.
  const order = (u: PlannedUnit) => {
    const m = matchFor.get(u.id);
    return !m ? 0 : m.method === "position" ? 1 : 2;
  };
  const rows = [...units].sort((a, b) => order(a) - order(b) || a.label.localeCompare(b.label));
  const corrected = Object.keys(overrides).length;

  const cell = {
    padding: "4px 8px",
    borderTop: `1px solid ${UI.border}`,
    verticalAlign: "middle" as const,
  };

  return (
    <div
      style={{
        background: UI.bg1,
        borderBottom: `1px solid ${UI.border}`,
        padding: "8px 14px 10px",
        maxHeight: "40vh",
        overflow: "auto",
        flexShrink: 0,
        fontSize: 12,
        color: UI.text,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span style={{ fontFamily: UI.fontSans, fontSize: 10, letterSpacing: 1, color: UI.accent }}>
          REVIEW MATCHES
        </span>
        <span style={{ color: UI.textDim }}>
          Corrections are kept for this phase on this device, by simulator name, so they carry to
          later runs.
        </span>
        <span style={{ flex: 1 }} />
        {corrected > 0 && (
          <button type="button" onClick={onClearAll} style={buttonStyle}>
            Clear {corrected} correction{corrected === 1 ? "" : "s"}
          </button>
        )}
        <button type="button" onClick={onClose} style={buttonStyle}>
          Close
        </button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: UI.textDim, fontSize: 10, textAlign: "left" }}>
            <th style={cell}>Planned unit</th>
            <th style={cell}>Matched to</th>
            <th style={cell}>How</th>
            <th style={cell}>Correct it</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => {
            const m = matchFor.get(u.id);
            const e = m ? byId.get(m.entityId) : undefined;
            const override = overrides[u.id];
            const value = override === undefined ? AUTO : override;
            const options = [...names[u.force].values()].sort(
              (a, b) =>
                distanceKm({ lat: u.lat, lng: u.lng }, { lat: a.lat, lng: a.lon }) -
                distanceKm({ lat: u.lat, lng: u.lng }, { lat: b.lat, lng: b.lon }),
            );
            const isStale = stale.includes(u.id);
            return (
              <tr key={u.id}>
                <td style={cell}>
                  <span style={{ color: u.force === "blue" ? UI.blue : UI.red }}>●</span> {u.label}
                </td>
                <td style={{ ...cell, fontFamily: UI.fontMono }}>
                  {e ? `${simulatorName(e)} · ${m!.distanceKm.toFixed(1)} km from plan` : "—"}
                </td>
                <td
                  style={{
                    ...cell,
                    color: !m ? UI.amber : m.method === "position" ? UI.amber : UI.textDim,
                  }}
                >
                  {isStale
                    ? `"${override}" is not in this run`
                    : m
                      ? METHOD_LABEL[m.method]
                      : override === NOT_IN_RUN
                        ? "marked not in run"
                        : "not found"}
                </td>
                <td style={cell}>
                  <select
                    value={value}
                    onChange={(ev) =>
                      onChange(u.id, ev.target.value === AUTO ? undefined : ev.target.value)
                    }
                    style={{
                      background: UI.bg2,
                      color: UI.text,
                      border: `1px solid ${UI.border}`,
                      fontSize: 11,
                      maxWidth: 260,
                    }}
                  >
                    <option value={AUTO}>Automatic</option>
                    <option value={NOT_IN_RUN}>Not in this run</option>
                    {override !== undefined &&
                      override !== NOT_IN_RUN &&
                      !names[u.force].has(override) && (
                        <option value={override}>{override} (not in this run)</option>
                      )}
                    {options.map((c) => {
                      const n = simulatorName(c);
                      const km = distanceKm({ lat: u.lat, lng: u.lng }, { lat: c.lat, lng: c.lon });
                      return (
                        <option key={n} value={n}>
                          {n} — {km.toFixed(1)} km
                        </option>
                      );
                    })}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const buttonStyle = {
  background: UI.bg2,
  color: UI.textDim,
  border: `1px solid ${UI.border}`,
  fontFamily: UI.fontSans,
  fontSize: 10,
  padding: "3px 8px",
  cursor: "pointer",
} as const;
