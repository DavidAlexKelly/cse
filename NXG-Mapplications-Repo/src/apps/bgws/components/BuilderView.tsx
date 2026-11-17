// ── bgws/components/BuilderView.tsx ────────────────────────────────────────
// The scenario builder: the initial state BGWS is sent.
//
// Left, the scenario: its settings, a unit palette, the units and objectives
// placed, what is wrong with it, and drafts/import/export. Right, the map,
// where the area is dragged out and units and objectives are placed and moved.
// The draft itself is owned by the app shell, because the control bar's
// "Load scenario" sends it.

import { type ChangeEvent, type FC, useEffect, useMemo, useRef, useState } from "react";
import { groupedPlatforms, platformById } from "../data/platforms";
import type {
  CommandMode,
  LatLon,
  Quality,
  ScenarioDraft,
  Side,
  ValidationIssue,
  Weather,
} from "../types";
import { QUALITIES, SIDES, WEATHERS } from "../types";
import { areaSizeKm } from "../lib/geo";
import { newObjective, newUnit, scenarioJson } from "../lib/scenario";
import { browserStorage, deleteDraft, listDrafts, saveDraft, type SavedDraft } from "../lib/drafts";
import { sideColour } from "../lib/symbols";
import BuilderMap, { type BuilderTool } from "./BuilderMap";
import { field, heading, input, mono, panel, row, section, UI } from "./styles";

interface Props {
  draft: ScenarioDraft;
  onChange: (update: (draft: ScenarioDraft) => ScenarioDraft) => void;
  /** Replace the whole draft (load a saved one, import); re-frames the map. */
  onReplace: (draft: ScenarioDraft) => void;
  issues: ValidationIssue[];
  /** A native BGWS scenario imported as-is, which Load sends instead of the draft. */
  native: { name: string; json: string } | null;
  onImportFile: (text: string) => string | null;
  onDiscardNative: () => void;
  fitToken: number;
}

const TOOLS: { id: BuilderTool; label: string; title: string }[] = [
  { id: "select", label: "Select", title: "Select and drag units and objectives" },
  { id: "area", label: "Area", title: "Drag a box on the map: the area of operations" },
  { id: "unit", label: "+ Unit", title: "Click the map to place a unit from the palette" },
  { id: "objective", label: "+ Objective", title: "Click the map to place an objective" },
];

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function fileName(name: string): string {
  return `${name.trim().replace(/[^A-Za-z0-9._-]+/g, "_") || "scenario"}.bgws.json`;
}

const BuilderView: FC<Props> = ({ draft, onChange, onReplace, issues, native, onImportFile, onDiscardNative, fitToken }) => {
  const [tool, setTool] = useState<BuilderTool>(draft.area ? "select" : "area");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [palette, setPalette] = useState<{ side: Side; platform: string; count: number; quality: Quality }>({
    side: "blue",
    platform: "generic/mbt",
    count: 1,
    quality: "regular",
  });
  const [placeSide, setPlaceSide] = useState<Side>("blue");
  const [drafts, setDrafts] = useState<SavedDraft[]>(() => listDrafts(browserStorage()));
  const [note, setNote] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const groups = useMemo(groupedPlatforms, []);

  const selectedUnit = draft.units.find((u) => u.id === selectedId) ?? null;
  const selectedObjective = draft.objectives.find((o) => o.id === selectedId) ?? null;
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  const removeSelected = () => {
    if (!selectedId) return;
    onChange((d) => ({
      ...d,
      units: d.units.filter((u) => u.id !== selectedId),
      objectives: d.objectives.filter((o) => o.id !== selectedId),
    }));
    setSelectedId(null);
  };

  // Delete/Backspace removes the selection — but not while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        removeSelected();
      }
      if (e.key === "Escape") setTool("select");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const place = (at: LatLon) => {
    // Ids are allocated against the draft as rendered: clicks are far apart
    // enough that it is current, and it keeps the state updater pure.
    if (tool === "unit") {
      const unit = newUnit(draft, palette.side, palette.platform, at, { count: palette.count, quality: palette.quality });
      onChange((d) => ({ ...d, units: [...d.units, unit] }));
      setSelectedId(unit.id);
    } else if (tool === "objective") {
      const objective = newObjective(draft, placeSide, at);
      onChange((d) => ({ ...d, objectives: [...d.objectives, objective] }));
      setSelectedId(objective.id);
    }
  };

  const setUnit = (patch: Partial<ScenarioDraft["units"][number]>) =>
    onChange((d) => ({ ...d, units: d.units.map((u) => (u.id === selectedId ? { ...u, ...patch } : u)) }));
  const setObjective = (patch: Partial<ScenarioDraft["objectives"][number]>) =>
    onChange((d) => ({ ...d, objectives: d.objectives.map((o) => (o.id === selectedId ? { ...o, ...patch } : o)) }));

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const error = onImportFile(await file.text());
    setNote(error ?? `Imported ${file.name}.`);
  };

  const json = useMemo(() => (showJson ? scenarioJson(draft, true) : null), [showJson, draft]);
  const size = draft.area ? areaSizeKm(draft.area) : null;

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      <div style={panel(370)}>
        {/* ── Tools ─────────────────────────────────────────────────────── */}
        <div style={{ ...section, position: "sticky", top: 0, background: UI.bg1, zIndex: 1 }}>
          <div className="hc-seg" role="group" aria-label="Map tool" style={{ display: "flex" }}>
            {TOOLS.map((t) => (
              <button key={t.id} type="button" aria-pressed={tool === t.id} title={t.title} onClick={() => setTool(t.id)} style={{ flex: 1, padding: "5px 6px" }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {native && (
          <div style={{ ...section, background: "rgba(240,180,41,0.1)", color: "#f5d27a", fontSize: 11 }}>
            Native BGWS scenario <b>{native.name}</b> imported. “Load scenario” sends it unchanged; it cannot be
            edited here.{" "}
            <button type="button" className="mil-btn mil-btn--sm mil-btn--ghost" onClick={onDiscardNative}>
              Discard
            </button>
          </div>
        )}

        {/* ── Scenario settings ─────────────────────────────────────────── */}
        <div style={section}>
          <div style={heading}>Scenario</div>
          <label style={field}>
            Name
            <input style={input} value={draft.name} onChange={(e) => onChange((d) => ({ ...d, name: e.target.value }))} />
          </label>
          <div style={{ ...row, marginTop: 6 }}>
            <label style={field}>
              Start (UTC)
              <input
                style={input}
                type="datetime-local"
                value={draft.startUtc.slice(0, 16)}
                onChange={(e) => e.target.value && onChange((d) => ({ ...d, startUtc: `${e.target.value}:00Z` }))}
              />
            </label>
            <label style={{ ...field, flex: "0 0 80px" }}>
              Duration (min)
              <input style={input} type="number" min={1} value={draft.durationMin} onChange={(e) => onChange((d) => ({ ...d, durationMin: Number(e.target.value) }))} />
            </label>
          </div>
          <div style={{ ...row, marginTop: 6 }}>
            <label style={field}>
              Weather
              <select style={input} value={draft.weather} onChange={(e) => onChange((d) => ({ ...d, weather: e.target.value as Weather }))}>
                {WEATHERS.map((w) => (
                  <option key={w} value={w}>
                    {w.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label style={field} title="real: BGWS builds terrain from elevation, land cover and OpenStreetMap roads (needs internet on the BGWS host; a minute or more). generated: synthetic ground (only if BGWS allows it).">
              Terrain
              <select style={input} value={draft.terrain} onChange={(e) => onChange((d) => ({ ...d, terrain: e.target.value as ScenarioDraft["terrain"] }))}>
                <option value="real">real</option>
                <option value="generated">generated</option>
              </select>
            </label>
            <label style={{ ...field, flex: "0 0 56px" }}>
              Seed
              <input style={input} type="number" value={draft.seed} onChange={(e) => onChange((d) => ({ ...d, seed: Number(e.target.value) }))} />
            </label>
            <label style={{ ...field, flex: "0 0 70px" }} title="A side breaks when it has lost this share of its strength">
              Break %
              <input style={input} type="number" min={1} max={100} value={draft.breakpointPct} onChange={(e) => onChange((d) => ({ ...d, breakpointPct: Number(e.target.value) }))} />
            </label>
          </div>
          <div style={{ ...row, marginTop: 6 }}>
            {(["blue", "red", ...(draft.units.some((u) => u.side === "neutral") ? ["neutral" as const] : [])] as Side[]).map((side) => (
              <label key={side} style={field} title="rules: BGWS decides, Foundry orders override. foundry: units hold until ordered from here.">
                <span style={{ color: sideColour(side) }}>{side} command</span>
                <select
                  style={input}
                  value={draft.command[side] ?? "rules"}
                  onChange={(e) => onChange((d) => ({ ...d, command: { ...d.command, [side]: e.target.value as CommandMode } }))}
                >
                  <option value="rules">rules</option>
                  <option value="foundry">foundry</option>
                </select>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: UI.textDim }}>
            {draft.area && size ? (
              <span style={mono}>
                Area {draft.area.south.toFixed(3)}…{draft.area.north.toFixed(3)} N, {draft.area.west.toFixed(3)}…
                {draft.area.east.toFixed(3)} E · {size.widthKm.toFixed(1)} × {size.heightKm.toFixed(1)} km
              </span>
            ) : (
              <span style={{ color: UI.amber }}>No area yet — choose “Area” and drag a box on the map.</span>
            )}
          </div>
        </div>

        {/* ── Palette ───────────────────────────────────────────────────── */}
        <div style={section}>
          <div style={heading}>Unit palette {tool === "unit" ? "· click the map to place" : ""}</div>
          <div style={row}>
            <label style={{ ...field, flex: "0 0 80px" }}>
              Side
              <select style={input} value={palette.side} onChange={(e) => setPalette((p) => ({ ...p, side: e.target.value as Side }))}>
                {SIDES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ ...field, flex: "0 0 52px" }}>
              Count
              <input style={input} type="number" min={1} max={99} value={palette.count} onChange={(e) => setPalette((p) => ({ ...p, count: Number(e.target.value) }))} />
            </label>
            <label style={field}>
              Quality
              <select style={input} value={palette.quality} onChange={(e) => setPalette((p) => ({ ...p, quality: e.target.value as Quality }))}>
                {QUALITIES.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label style={{ ...field, marginTop: 6 }}>
            Platform
            <PlatformSelect value={palette.platform} groups={groups} onChange={(platform) => setPalette((p) => ({ ...p, platform }))} />
          </label>
          <button type="button" className="mil-btn mil-btn--sm mil-btn--default" style={{ marginTop: 8 }} onClick={() => setTool("unit")}>
            Place on map
          </button>
        </div>

        {/* ── Selected unit ─────────────────────────────────────────────── */}
        {selectedUnit && (
          <div style={{ ...section, background: UI.bg2 }}>
            <div style={heading}>Unit {selectedUnit.id}</div>
            <label style={field}>
              Label
              <input style={input} value={selectedUnit.label} onChange={(e) => setUnit({ label: e.target.value })} />
            </label>
            <div style={{ ...row, marginTop: 6 }}>
              <label style={{ ...field, flex: "0 0 80px" }}>
                Side
                <select style={input} value={selectedUnit.side} onChange={(e) => setUnit({ side: e.target.value as Side })}>
                  {SIDES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...field, flex: "0 0 52px" }}>
                Count
                <input style={input} type="number" min={1} max={99} value={selectedUnit.count} onChange={(e) => setUnit({ count: Number(e.target.value) })} />
              </label>
              <label style={field}>
                Quality
                <select style={input} value={selectedUnit.quality} onChange={(e) => setUnit({ quality: e.target.value as Quality })}>
                  {QUALITIES.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...field, flex: "0 0 60px" }}>
                Heading°
                <input style={input} type="number" min={0} max={359} value={selectedUnit.headingDeg} onChange={(e) => setUnit({ headingDeg: Number(e.target.value) })} />
              </label>
            </div>
            <label style={{ ...field, marginTop: 6 }}>
              Platform
              <PlatformSelect value={selectedUnit.platform} groups={groups} onChange={(platform) => setUnit({ platform })} />
            </label>
            <div style={{ ...row, marginTop: 6, justifyContent: "space-between" }}>
              <span style={{ ...mono, color: UI.textDim }}>
                {selectedUnit.lat.toFixed(5)}, {selectedUnit.lon.toFixed(5)}
              </span>
              <button type="button" className="mil-btn mil-btn--sm mil-btn--danger" onClick={removeSelected}>
                Delete
              </button>
            </div>
          </div>
        )}

        {/* ── Selected objective ────────────────────────────────────────── */}
        {selectedObjective && (
          <div style={{ ...section, background: UI.bg2 }}>
            <div style={heading}>Objective</div>
            <div style={row}>
              <label style={field}>
                Label
                <input style={input} value={selectedObjective.label} onChange={(e) => setObjective({ label: e.target.value })} />
              </label>
              <label style={{ ...field, flex: "0 0 80px" }}>
                Side
                <select style={input} value={selectedObjective.side} onChange={(e) => setObjective({ side: e.target.value as Side })}>
                  {SIDES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div style={{ ...row, marginTop: 6 }}>
              <label style={field}>
                Radius (m)
                <input style={input} type="number" min={1} value={selectedObjective.radiusM} onChange={(e) => setObjective({ radiusM: Number(e.target.value) })} />
              </label>
              <label style={field} title="Minutes the side must hold it">
                Hold (min)
                <input style={input} type="number" min={0} value={selectedObjective.holdMin} onChange={(e) => setObjective({ holdMin: Number(e.target.value) })} />
              </label>
              <button type="button" className="mil-btn mil-btn--sm mil-btn--danger" onClick={removeSelected} style={{ alignSelf: "flex-end" }}>
                Delete
              </button>
            </div>
          </div>
        )}

        {/* ── Units ─────────────────────────────────────────────────────── */}
        <div style={section}>
          <div style={heading}>Units ({draft.units.length})</div>
          {draft.units.length === 0 && <div style={{ fontSize: 11, color: UI.textFaint }}>None placed.</div>}
          {draft.units.map((u) => (
            <div
              key={u.id}
              onClick={() => setSelectedId(u.id)}
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                padding: "3px 4px",
                fontSize: 11,
                cursor: "pointer",
                background: u.id === selectedId ? UI.bg2 : "transparent",
                borderLeft: `3px solid ${sideColour(u.side)}`,
                marginBottom: 2,
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.label}</span>
              <span style={{ color: UI.textDim, fontSize: 10, whiteSpace: "nowrap" }}>
                {platformById(u.platform)?.name ?? u.platform}
                {u.count > 1 ? ` ×${u.count}` : ""}
              </span>
            </div>
          ))}
        </div>

        {/* ── Objectives ────────────────────────────────────────────────── */}
        <div style={section}>
          <div style={{ ...heading, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Objectives ({draft.objectives.length})</span>
            <span style={{ display: "flex", gap: 4, alignItems: "center", textTransform: "none", letterSpacing: 0 }}>
              <select style={{ ...input, width: 80, padding: "2px 4px" }} value={placeSide} onChange={(e) => setPlaceSide(e.target.value as Side)}>
                {SIDES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button type="button" className="mil-btn mil-btn--sm mil-btn--ghost" onClick={() => setTool("objective")}>
                + Place
              </button>
            </span>
          </div>
          {draft.objectives.map((o) => (
            <div
              key={o.id}
              onClick={() => setSelectedId(o.id)}
              style={{
                display: "flex",
                gap: 6,
                padding: "3px 4px",
                fontSize: 11,
                cursor: "pointer",
                background: o.id === selectedId ? UI.bg2 : "transparent",
                borderLeft: `3px solid ${sideColour(o.side)}`,
                marginBottom: 2,
              }}
            >
              <span style={{ flex: 1 }}>{o.label}</span>
              <span style={{ color: UI.textDim, fontSize: 10 }}>
                {o.radiusM} m · hold {o.holdMin} min
              </span>
            </div>
          ))}
        </div>

        {/* ── Validation ────────────────────────────────────────────────── */}
        <div style={section}>
          <div style={heading}>
            Checks · <span style={{ color: errors.length ? UI.red : UI.green }}>{errors.length} errors</span> ·{" "}
            <span style={{ color: warnings.length ? UI.amber : UI.textFaint }}>{warnings.length} warnings</span>
          </div>
          {issues.length === 0 && <div style={{ fontSize: 11, color: UI.green }}>Ready to load.</div>}
          {issues.map((issue, i) => (
            <div
              key={i}
              onClick={() => issue.ref && setSelectedId(issue.ref)}
              style={{ fontSize: 11, color: issue.level === "error" ? UI.red : UI.amber, padding: "1px 0", cursor: issue.ref ? "pointer" : "default" }}
            >
              {issue.level === "error" ? "✗" : "!"} {issue.message}
            </div>
          ))}
        </div>

        {/* ── Drafts, import, export ────────────────────────────────────── */}
        <div style={section}>
          <div style={heading}>Drafts (this browser)</div>
          <div style={row}>
            <button
              type="button"
              className="mil-btn mil-btn--sm mil-btn--default"
              onClick={() => {
                const ok = saveDraft(browserStorage(), draft);
                setDrafts(listDrafts(browserStorage()));
                setNote(ok ? `Saved “${draft.name.trim() || "Untitled"}”.` : "Browser storage is unavailable here — use Export.");
              }}
            >
              Save draft
            </button>
            <button type="button" className="mil-btn mil-btn--sm mil-btn--ghost" onClick={() => fileRef.current?.click()}>
              Import JSON…
            </button>
            <button
              type="button"
              className="mil-btn mil-btn--sm mil-btn--ghost"
              disabled={!draft.area}
              onClick={() => {
                const text = scenarioJson(draft, true);
                if (text) download(fileName(draft.name), text);
              }}
            >
              Export JSON
            </button>
            <button type="button" className="mil-btn mil-btn--sm mil-btn--ghost" onClick={() => setShowJson((v) => !v)}>
              {showJson ? "Hide JSON" : "Show JSON"}
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => void onFile(e)} />
          </div>
          {note && <div style={{ fontSize: 11, color: UI.textDim, marginTop: 6 }}>{note}</div>}
          {drafts.map((d) => (
            <div key={d.name} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, marginTop: 4 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
              <span style={{ color: UI.textFaint, fontSize: 10 }}>{d.savedAt.slice(0, 16).replace("T", " ")}</span>
              <button type="button" className="mil-btn mil-btn--sm mil-btn--ghost" onClick={() => onReplace(d.draft)}>
                Open
              </button>
              <button
                type="button"
                className="mil-btn mil-btn--sm mil-btn--ghost"
                onClick={() => {
                  deleteDraft(browserStorage(), d.name);
                  setDrafts(listDrafts(browserStorage()));
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {showJson && (
            <pre style={{ ...mono, fontSize: 10, maxHeight: 260, overflow: "auto", background: UI.bg0, padding: 8, marginTop: 8, whiteSpace: "pre-wrap" }}>
              {json ?? "Draw the area first: a scenario cannot be built without one."}
            </pre>
          )}
        </div>
      </div>

      <BuilderMap
        area={draft.area}
        units={draft.units}
        objectives={draft.objectives}
        selectedId={selectedId}
        tool={tool}
        fitToken={fitToken}
        onArea={(area) => {
          onChange((d) => ({ ...d, area }));
          setTool("select");
        }}
        onPlace={place}
        onSelect={setSelectedId}
        onMoveUnit={(id, at) => onChange((d) => ({ ...d, units: d.units.map((u) => (u.id === id ? { ...u, lat: at.lat, lon: at.lon } : u)) }))}
        onMoveObjective={(id, at) =>
          onChange((d) => ({ ...d, objectives: d.objectives.map((o) => (o.id === id ? { ...o, lat: at.lat, lon: at.lon } : o)) }))
        }
      />
    </div>
  );
};

/** The catalogue grouped by domain and class, plus the platform's id for anyone who knows BGWS. */
const PlatformSelect: FC<{
  value: string;
  groups: ReturnType<typeof groupedPlatforms>;
  onChange: (id: string) => void;
}> = ({ value, groups, onChange }) => (
  <select style={input} value={value} onChange={(e) => onChange(e.target.value)}>
    {!platformById(value) && <option value={value}>{value} (not in catalogue)</option>}
    {groups.map((g) => (
      <optgroup key={g.label} label={g.label}>
        {g.platforms.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.echelon ? ` · ${p.echelon}` : ""}
          </option>
        ))}
      </optgroup>
    ))}
  </select>
);

export default BuilderView;
