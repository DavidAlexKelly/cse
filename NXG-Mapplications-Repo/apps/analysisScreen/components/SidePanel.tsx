// ── analysisScreen/components/SidePanel.tsx ────────────────────────────────
// Order of battle at the playhead, plus detail on the selected unit.
//
// Deliberately close to hlamap's CommandPanel in layout and wording, minus the
// tasking controls: the same unit should read the same way whether you are
// looking at it live or in replay. What replaces the controls is the list —
// scrubbing is a searching activity, and finding a unit by name matters more
// here than it does on the live map.

import { type FC, useMemo, useState } from "react";
import type { HlaEntity } from "@/shared/hla/types";
import { forceColor, UI } from "./ui";

interface Props {
  entities: HlaEntity[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 3 }}>
      <span style={{ color: UI.textFaint }}>{label}</span>
      <span style={{ color: UI.text, textAlign: "right", wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

const SidePanel: FC<Props> = ({ entities, selectedId, onSelect }) => {
  const [filter, setFilter] = useState("");

  const selected = useMemo(
    () => entities.find((e) => e.id === selectedId) ?? null,
    [entities, selectedId]
  );

  const counts = useMemo(() => {
    let blue = 0;
    let red = 0;
    for (const entity of entities) {
      if (entity.force === "RED") red += 1;
      else blue += 1;
    }
    return { blue, red };
  }, [entities]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = needle
      ? entities.filter(
          (e) =>
            e.unit.toLowerCase().includes(needle) ||
            e.callsign.toLowerCase().includes(needle) ||
            e.simulator.toLowerCase().includes(needle)
        )
      : entities;
    // By name: the federation's ordering is not stable between frames, and a
    // list that reshuffles 15 times a second cannot be read, let alone clicked.
    return [...list].sort((a, b) =>
      (a.unit || a.callsign).localeCompare(b.unit || b.callsign)
    );
  }, [entities, filter]);

  return (
    <div
      style={{
        width: 320,
        flexShrink: 0,
        background: UI.bg1,
        borderLeft: `1px solid ${UI.border}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: UI.fontSans,
      }}
    >
      {/* ── Force composition at the playhead ── */}
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${UI.border}` }}>
        <div
          style={{
            fontFamily: UI.fontMono,
            fontSize: 10,
            color: UI.textFaint,
            letterSpacing: 1,
            marginBottom: 7,
          }}
        >
          ON THE MAP
        </div>
        <div style={{ display: "flex", gap: 6, fontFamily: UI.fontMono, fontSize: 10 }}>
          <span
            style={{
              color: forceColor("BLUE"),
              background: UI.bg2,
              border: `1px solid ${UI.border}`,
              padding: "2px 7px",
            }}
          >
            BLUE {counts.blue}
          </span>
          <span
            style={{
              color: forceColor("RED"),
              background: UI.bg2,
              border: `1px solid ${UI.border}`,
              padding: "2px 7px",
            }}
          >
            RED {counts.red}
          </span>
          {entities.length === 0 && (
            <span style={{ color: UI.textFaint, alignSelf: "center" }}>
              no units at this time
            </span>
          )}
        </div>
      </div>

      {/* ── Selected unit ── */}
      {selected && (
        <div
          style={{
            padding: "10px 12px",
            borderBottom: `1px solid ${UI.border}`,
            background: UI.bg2,
            fontFamily: UI.fontMono,
            fontSize: 10,
          }}
        >
          <div
            style={{
              color: forceColor(selected.force),
              fontSize: 12,
              fontWeight: 700,
              marginBottom: 7,
              wordBreak: "break-word",
            }}
          >
            {selected.unit || selected.callsign}
          </div>
          <Row label="force" value={selected.force} />
          <Row label="simulator" value={selected.simulator} />
          <Row label="position" value={`${selected.lat.toFixed(5)}, ${selected.lon.toFixed(5)}`} />
          <Row
            label="altitude"
            value={
              selected.altitudeMeters != null ? `${selected.altitudeMeters.toFixed(1)} m` : "—"
            }
          />
          <Row
            label="heading"
            value={Number.isFinite(selected.heading) ? `${selected.heading.toFixed(1)}°` : "—"}
          />
          {/* speed_mps is null on every row of this feed today, so this is
              almost always 0 — shown anyway rather than hidden, so that a feed
              which starts publishing it is visibly different. */}
          <Row label="speed" value={`${selected.speed.toFixed(1)} km/h`} />
          <Row label="damage" value={selected.damageState} />
          <Row label="aggregation" value={selected.aggregateState} />
          <Row label="handle" value={selected.id} />
          {selected.uniqueId && <Row label="uuid" value={selected.uniqueId} />}
        </div>
      )}

      {/* ── Unit list ── */}
      <div style={{ padding: "8px 12px 6px" }}>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter units…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: UI.bg0,
            border: `1px solid ${UI.border}`,
            color: UI.text,
            fontFamily: UI.fontMono,
            fontSize: 11,
            padding: "5px 7px",
            outline: "none",
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 6px 10px" }}>
        {visible.map((entity) => {
          const isSelected = entity.id === selectedId;
          return (
            <button
              key={entity.id}
              onClick={() => onSelect(isSelected ? null : entity.id)}
              title={entity.unit || entity.callsign}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: isSelected ? UI.bg2 : "transparent",
                border: "none",
                borderLeft: `3px solid ${forceColor(entity.force)}`,
                color: isSelected ? UI.accent : UI.textDim,
                fontFamily: UI.fontMono,
                fontSize: 10,
                padding: "4px 8px",
                cursor: "pointer",
                marginBottom: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {entity.unit || entity.callsign}
            </button>
          );
        })}
        {visible.length === 0 && entities.length > 0 && (
          <div
            style={{
              fontFamily: UI.fontMono,
              fontSize: 10,
              color: UI.textFaint,
              padding: "8px 10px",
            }}
          >
            nothing matches “{filter}”
          </div>
        )}
      </div>
    </div>
  );
};

export default SidePanel;
