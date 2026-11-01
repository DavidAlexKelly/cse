// OrbatLevelControl — Units | Auto | L0 … Ln
//
// "Units" is the classic view: one marker per placement. L0…Ln show the phase
// command tree at that level (the frontier — see shared/orbat/orbatLevels.ts).
// "Auto", on by default, picks the level from the zoom so the force breaks down
// as you zoom in and groups up as you zoom out.
import "./OrbatLevelControl.css";

export type OrbatLevelMode =
  { kind: "units" } | { kind: "auto" } | { kind: "level"; level: number };

export interface OrbatLevelInfo {
  level: number;
  /** Units drawn at this level (the frontier size). */
  count: number;
  /** Most common echelon at this depth, for the tooltip. */
  echelon: string | null;
}

interface Props {
  mode: OrbatLevelMode;
  /** Level Auto currently resolves to — highlighted when in Auto. */
  autoLevel: number;
  levels: OrbatLevelInfo[];
  onChange: (mode: OrbatLevelMode) => void;
  loading?: boolean;
}

export function OrbatLevelControl({ mode, autoLevel, levels, onChange, loading }: Props) {
  const activeLevel = mode.kind === "level" ? mode.level : mode.kind === "auto" ? autoLevel : -1;
  return (
    <div className="olc" role="group" aria-label="ORBAT level">
      <span className="olc__label">ORBAT</span>
      <button
        type="button"
        className={`olc__seg ${mode.kind === "units" ? "olc__seg--on" : ""}`}
        onClick={() => onChange({ kind: "units" })}
        title="Show placed map markers"
      >
        Units
      </button>
      <button
        type="button"
        className={`olc__seg ${mode.kind === "auto" ? "olc__seg--on" : ""}`}
        onClick={() => onChange({ kind: "auto" })}
        title="Pick the level from the zoom: zoom in to break units down"
        disabled={levels.length === 0}
      >
        Auto
      </button>
      {levels.map((info) => (
        <button
          key={info.level}
          type="button"
          className={[
            "olc__seg",
            "olc__seg--level",
            mode.kind === "level" && mode.level === info.level ? "olc__seg--on" : "",
            mode.kind === "auto" && activeLevel === info.level ? "olc__seg--auto" : "",
          ].join(" ")}
          onClick={() => onChange({ kind: "level", level: info.level })}
          title={`Level ${info.level}${info.echelon ? ` — mostly ${info.echelon}` : ""}: ${info.count} unit${info.count === 1 ? "" : "s"} shown`}
        >
          L{info.level}
        </button>
      ))}
      {loading && <span className="olc__busy" aria-label="Loading ORBAT" />}
    </div>
  );
}
