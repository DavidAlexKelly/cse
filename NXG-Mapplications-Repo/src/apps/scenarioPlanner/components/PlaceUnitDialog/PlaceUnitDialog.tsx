// PlaceUnitDialog — place a unit into the selected phase's command tree.
//
// Branch → Echelon → Type, a name, and "Generate ORBAT beneath". On Place the
// App writes the unit, its parent edge and any adoptions in ONE reconcile
// (shared/orbat/phaseOrbat.placeUnitInPhase). The dialog stays open showing
// progress until that write finishes, so a slow generate never looks like a
// click that did nothing.
import { useMemo, useRef, useState } from "react";
import ms from "milsymbol";
import { useSvgInnerHtml } from "@/shared/lib/sanitizeSvg";
import {
  ALL_ECHELONS,
  type EchelonOption,
  UNIT_ARCHETYPES,
  type UnitArchetype,
  archetypeSidcForEchelon,
  withAffiliation,
} from "../../map/unitTemplates";
import "./PlaceUnitDialog.css";

export interface PlaceUnitChoice {
  label: string;
  sidc: string;
  templateId: string;
  generateBeneath: boolean;
}

interface Props {
  /** Where it will be placed — shown so the planner knows which click this is. */
  at: { lat: number; lng: number };
  busy: boolean;
  error: string | null;
  /** Side to preselect (the side last placed). */
  defaultSide?: "friend" | "hostile";
  onPlace: (choice: PlaceUnitChoice) => void;
  onClose: () => void;
}

type Branch = "land" | "maritime" | "air" | "space";
const BRANCHES: { id: Branch; label: string; enabled: boolean }[] = [
  { id: "land", label: "Land", enabled: true },
  { id: "maritime", label: "Maritime", enabled: false },
  { id: "air", label: "Air", enabled: false },
  { id: "space", label: "Space", enabled: false },
];

/** Formations only — a platform has no ORBAT beneath it to place into. */
const LAND_ARCHETYPES = UNIT_ARCHETYPES.filter(
  (a) => a.dim === "G" && a.entityType === "organisation",
);
const ECHELONS: EchelonOption[] = ALL_ECHELONS.filter(
  (e) =>
    e.echelonValue &&
    LAND_ARCHETYPES.some((a) => a.echelons.length === 0 || a.echelons.includes(e.label)),
);

function symbolSvg(sidc: string): string {
  try {
    return new ms.Symbol(sidc, { size: 22 }).asSVG();
  } catch {
    return "";
  }
}

function SymbolPreview({ sidc }: { sidc: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useSvgInnerHtml(ref, symbolSvg(sidc));
  return <span className="pud__sym" ref={ref} aria-hidden="true" />;
}

export function PlaceUnitDialog({
  at,
  busy,
  error,
  defaultSide = "friend",
  onPlace,
  onClose,
}: Props) {
  const [side, setSide] = useState<"friend" | "hostile">(defaultSide);
  const [echelon, setEchelon] = useState<EchelonOption>(
    ECHELONS.find((e) => e.echelonValue === "Battalion") ?? ECHELONS[0],
  );
  const [archetype, setArchetype] = useState<UnitArchetype | null>(null);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [generateBeneath, setGenerateBeneath] = useState(false);

  const types = useMemo(() => {
    const q = search.trim().toLowerCase();
    return LAND_ARCHETYPES.filter(
      (a) => a.echelons.length === 0 || a.echelons.includes(echelon.label),
    ).filter(
      (a) => !q || a.label.toLowerCase().includes(q) || a.keywords?.some((k) => k.includes(q)),
    );
  }, [echelon, search]);

  const chosen = archetype && types.includes(archetype) ? archetype : null;
  const sidc = chosen ? withAffiliation(archetypeSidcForEchelon(chosen, echelon), side) : "";
  const defaultName = chosen ? `${chosen.label} ${echelon.label}` : "";

  const place = () => {
    if (!chosen || busy) return;
    onPlace({
      label: name.trim() || defaultName,
      sidc,
      templateId: `${chosen.id}__${echelon.echelonValue}`,
      generateBeneath,
    });
  };

  return (
    <div className="pud__backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}>
      <div
        className="pud"
        role="dialog"
        aria-modal="true"
        aria-label="Place unit"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="pud__header">
          <span>Place unit</span>
          <span className="pud__at">
            {at.lat.toFixed(4)}, {at.lng.toFixed(4)}
          </span>
        </header>

        <div className="pud__row">
          {BRANCHES.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`pud__chip ${b.id === "land" ? "pud__chip--on" : ""}`}
              disabled={!b.enabled}
              title={b.enabled ? undefined : "Land only for now"}
            >
              {b.label}
            </button>
          ))}
          <span className="pud__spacer" />
          <button
            type="button"
            className={`pud__chip ${side === "friend" ? "pud__chip--blue" : ""}`}
            onClick={() => setSide("friend")}
          >
            Blue
          </button>
          <button
            type="button"
            className={`pud__chip ${side === "hostile" ? "pud__chip--red" : ""}`}
            onClick={() => setSide("hostile")}
          >
            Red
          </button>
        </div>

        <div className="pud__label">Echelon</div>
        <div className="pud__row pud__row--wrap">
          {ECHELONS.map((e) => (
            <button
              key={e.label}
              type="button"
              className={`pud__chip ${e.label === echelon.label ? "pud__chip--on" : ""}`}
              onClick={() => setEchelon(e)}
            >
              {e.label}
            </button>
          ))}
        </div>

        <div className="pud__label">Type</div>
        <input
          className="pud__input"
          placeholder="Search — e.g. armour, recce, artillery"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <div className="pud__list" role="listbox" aria-label="Unit type">
          {types.map((a) => {
            const preview = withAffiliation(archetypeSidcForEchelon(a, echelon), side);
            return (
              <button
                key={a.id}
                type="button"
                role="option"
                aria-selected={chosen === a}
                className={`pud__type ${chosen === a ? "pud__type--on" : ""}`}
                onClick={() => setArchetype(a)}
              >
                <SymbolPreview sidc={preview} />
                <span className="pud__type-text">
                  <span className="pud__type-name">{a.label}</span>
                  <span className="pud__type-desc">{a.description}</span>
                </span>
              </button>
            );
          })}
          {types.length === 0 && (
            <div className="pud__empty">No land unit types at this echelon.</div>
          )}
        </div>

        <div className="pud__label">Name</div>
        <input
          className="pud__input"
          placeholder={defaultName || "Choose a type"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && place()}
        />

        <label className="pud__check">
          <input
            type="checkbox"
            checked={generateBeneath}
            onChange={(e) => setGenerateBeneath(e.target.checked)}
          />
          Generate ORBAT beneath (SWORD compositions where available, capped by echelon)
        </label>

        {error && (
          <div className="pud__error" role="alert">
            {error}
          </div>
        )}

        <footer className="pud__footer">
          {busy && (
            <span className="pud__busy" aria-live="polite">
              {generateBeneath ? "Generating ORBAT…" : "Placing…"}
            </span>
          )}
          <button
            type="button"
            className="mil-btn mil-btn--sm mil-btn--ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="mil-btn mil-btn--sm mil-btn--primary"
            onClick={place}
            disabled={!chosen || busy}
          >
            Place
          </button>
        </footer>
      </div>
    </div>
  );
}
