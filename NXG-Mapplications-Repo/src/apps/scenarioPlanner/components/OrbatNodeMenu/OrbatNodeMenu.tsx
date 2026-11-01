// OrbatNodeMenu — right-click menu for a unit in the phase ORBAT level view.
//
//   Generate ORBAT beneath   only when it has no subordinates yet
//   Change parent…           12 nearest senior same-side units, never its own subtree
//   Open in ORBAT Manager
//   Remove unit / subtree    phase-native units only, after a confirm
//
// position:fixed at client coordinates, like MapContextMenu.
import { useEffect, useRef, useState } from "react";

export interface ParentOption {
  key: string;
  label: string;
  echelon: string;
}

interface Props {
  client: { x: number; y: number };
  label: string;
  echelon: string;
  /** Null → allowed; a string → why not (shown as the disabled item's tooltip). */
  generateBlockedReason: string | null;
  parentOptions: ParentOption[];
  currentParentKey: string | null;
  /** Units a remove would delete (itself + descendants). 0 → not removable. */
  removeCount: number;
  busy?: boolean;
  onGenerateBeneath: () => void;
  onChangeParent: (parentKey: string | null) => void;
  onOpenInOrbatManager?: () => void;
  onRemove: () => void;
  onClose: () => void;
}

export function OrbatNodeMenu(props: Props) {
  const { client, label, echelon, generateBlockedReason, parentOptions, currentParentKey } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<"main" | "parent" | "confirm-remove">("main");

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    const t = setTimeout(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onKey);
    }, 50);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onClose]);

  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(client.x, window.innerWidth - 260),
    top: Math.min(client.y, window.innerHeight - 320),
    zIndex: 10000,
    minWidth: 220,
    maxWidth: 280,
    padding: 4,
    background: "rgba(17,19,24,0.96)",
    border: "1px solid var(--border-default)",
    borderRadius: 6,
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    backdropFilter: "blur(8px)",
    color: "#e0e4ec",
    font: "12px/1.4 var(--font-sans, 'Inter', sans-serif)",
  };

  return (
    <div ref={ref} style={style} role="menu" aria-label={`${label} actions`}>
      <div style={header}>
        <div style={{ fontWeight: 700 }}>{label}</div>
        {echelon && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{echelon}</div>}
      </div>

      {view === "main" && (
        <>
          <button
            type="button"
            role="menuitem"
            style={item(!!generateBlockedReason || props.busy)}
            disabled={!!generateBlockedReason || props.busy}
            title={generateBlockedReason ?? "Build its ORBAT beneath it, capped by echelon"}
            onClick={() => {
              props.onGenerateBeneath();
              props.onClose();
            }}
          >
            ⚙ Generate ORBAT beneath
          </button>
          <button
            type="button"
            role="menuitem"
            style={item(props.busy)}
            disabled={props.busy}
            onClick={() => setView("parent")}
          >
            ⇅ Change parent…
          </button>
          {props.onOpenInOrbatManager && (
            <button
              type="button"
              role="menuitem"
              style={item(false)}
              onClick={() => {
                props.onOpenInOrbatManager!();
                props.onClose();
              }}
            >
              🌳 Open in ORBAT Manager
            </button>
          )}
          <div style={divider} />
          <button
            type="button"
            role="menuitem"
            style={{ ...item(props.removeCount === 0 || props.busy), color: "#ff8a8a" }}
            disabled={props.removeCount === 0 || props.busy}
            title={
              props.removeCount === 0
                ? "Inherited from another phase — save this phase's ORBAT first"
                : undefined
            }
            onClick={() => setView("confirm-remove")}
          >
            🗑 Remove {props.removeCount > 1 ? `unit and ${props.removeCount - 1} below` : "unit"}
          </button>
        </>
      )}

      {view === "parent" && (
        <>
          <button type="button" style={item(false)} onClick={() => setView("main")}>
            ← Back
          </button>
          <div style={divider} />
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {parentOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                role="menuitemradio"
                aria-checked={option.key === currentParentKey}
                style={item(false, option.key === currentParentKey)}
                onClick={() => {
                  props.onChangeParent(option.key);
                  props.onClose();
                }}
              >
                {option.label}
                {option.echelon && (
                  <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                    {" "}
                    · {option.echelon}
                  </span>
                )}
              </button>
            ))}
            {parentOptions.length === 0 && (
              <div style={{ padding: "6px 10px", color: "var(--text-muted)" }}>
                No senior unit on this side.
              </div>
            )}
          </div>
          {currentParentKey && (
            <>
              <div style={divider} />
              <button
                type="button"
                style={item(false)}
                onClick={() => {
                  props.onChangeParent(null);
                  props.onClose();
                }}
              >
                Make it a top-level unit
              </button>
            </>
          )}
        </>
      )}

      {view === "confirm-remove" && (
        <div style={{ padding: "6px 8px" }}>
          <div style={{ marginBottom: 8 }}>
            Remove <b>{label}</b>
            {props.removeCount > 1 ? ` and the ${props.removeCount - 1} units below it` : ""} from
            this phase? Other phases are not affected.
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button
              type="button"
              className="mil-btn mil-btn--sm mil-btn--ghost"
              onClick={() => setView("main")}
            >
              Cancel
            </button>
            <button
              type="button"
              className="mil-btn mil-btn--sm mil-btn--danger"
              onClick={() => {
                props.onRemove();
                props.onClose();
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const header: React.CSSProperties = {
  padding: "6px 10px 4px",
  borderBottom: "1px solid var(--border-subtle)",
  marginBottom: 4,
};

const divider: React.CSSProperties = {
  height: 1,
  background: "var(--border-default)",
  margin: "4px 0",
};

function item(disabled?: boolean, active?: boolean): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    padding: "6px 10px",
    background: active ? "rgba(74,144,217,0.25)" : "none",
    border: "none",
    borderRadius: 4,
    color: "inherit",
    textAlign: "left",
    fontSize: 12,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
  };
}
