/**
 * AppSwitcher — floating pill button that opens a small popover menu letting
 * the user jump between the four apps: ORBAT Manager, Scenario Planner,
 * CSE-Prep, and Map View.
 *
 * Designed to sit in the top-right corner of every app's header without
 * disturbing existing layout — each app adds it wherever there is a natural
 * "right actions" slot.
 *
 * Styles are scoped under `.asw-*` so they never clash with om-*, sp-*, or
 * cse-* class names.
 */

import { useNavigate, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";

// ── App catalogue ─────────────────────────────────────────────────────────────

const APPS = [
  {
    path: "/orbat",
    label: "ORBAT Manager",
    icon: "⬡",
    sub: "Hierarchy & composition",
    accent: "#2fbf71",
  },
  {
    path: "/scenario-plan",
    label: "Scenario Planner",
    icon: "◈",
    sub: "Phase planning & map",
    accent: "#4A90D9",
  },
  {
    path: "/cse-prep",
    label: "CSE Prep",
    icon: "⚙",
    sub: "Simulation control panel",
    accent: "#58a6ff",
  },
  {
    path: "/execution-demo",
    label: "Execution Demo",
    icon: "▶",
    sub: "Force simulation & COP",
    accent: "#4fc3f7",
  },
  {
    path: "/hlamap",
    label: "HLA Map",
    icon: "⌖",
    sub: "Map & HLA bridge commands",
    accent: "#d95c5c",
  },
  {
    path: "/analysis",
    label: "Analysis",
    icon: "◷",
    sub: "Replay & after-action review",
    accent: "#4fc3f7",
  },
] as const;

// ── Styles (injected once as a stylesheet node) ───────────────────────────────

const STYLE = `
.asw-btn {
  display: flex; align-items: center; gap: 6px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 3px; cursor: pointer; padding: 0 10px; height: 28px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
  color: rgba(255,255,255,0.45); font-family: inherit;
  transition: background 0.13s, border-color 0.13s, color 0.13s;
  flex-shrink: 0;
}
.asw-btn:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.22); color: rgba(255,255,255,0.75); }
.asw-btn__grid { font-size: 13px; line-height: 1; opacity: 0.7; }
.asw-btn__chevron { font-size: 8px; opacity: 0.5; }

.asw-popover {
  position: fixed; z-index: 9999;
  background: #0f1117; border: 1px solid #2e3449;
  border-radius: 6px; padding: 6px;
  box-shadow: 0 12px 36px rgba(0,0,0,0.65);
  min-width: 210px;
  animation: aswFadeIn 0.12s ease;
}
@keyframes aswFadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

.asw-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 4px; cursor: pointer;
  background: none; border: none; font-family: inherit; width: 100%; text-align: left;
  transition: background 0.12s;
  text-decoration: none;
}
.asw-item:hover { background: rgba(255,255,255,0.06); }
.asw-item--active { background: rgba(255,255,255,0.04); cursor: default; }

.asw-item__icon {
  width: 28px; height: 28px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; flex-shrink: 0;
  background: rgba(255,255,255,0.06);
}
.asw-item__text { flex: 1; min-width: 0; }
.asw-item__label { font-size: 12px; font-weight: 600; color: #e9ecfb; letter-spacing: 0.03em; }
.asw-item--active .asw-item__label { color: rgba(255,255,255,0.45); }
.asw-item__sub { font-size: 10px; color: #6a7292; margin-top: 1px; }
.asw-item__active-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

.asw-divider { height: 1px; background: #191e37; margin: 4px 2px; }
`.trim();

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const el = document.createElement("style");
  el.textContent = STYLE;
  document.head.appendChild(el);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AppSwitcher() {
  injectStyle();

  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Derive the current app label for the button
  const current = APPS.find(
    (a) => location.pathname === a.path || (a.path === "/orbat" && location.pathname === "/"),
  );

  // Position popover below-right of the button on open
  function handleOpen() {
    if (!btnRef.current) { setOpen((v) => !v); return; }
    const rect = btnRef.current.getBoundingClientRect();
    setPopoverStyle({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right,
    });
    setOpen((v) => !v);
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        className="asw-btn"
        onClick={handleOpen}
        aria-haspopup="true"
        aria-expanded={open}
        title="Switch application"
      >
        <span className="asw-btn__grid">⊞</span>
        <span>{current?.label ?? "Apps"}</span>
        <span className="asw-btn__chevron">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="asw-popover"
          style={popoverStyle}
          role="menu"
          aria-label="Switch application"
        >
          {APPS.map((app, i) => {
            const isActive =
              location.pathname === app.path ||
              (app.path === "/orbat" && location.pathname === "/");
            return (
              <button
                key={app.path}
                role="menuitem"
                className={`asw-item${isActive ? " asw-item--active" : ""}`}
                style={{ marginTop: i === 0 ? 0 : 2 }}
                onClick={() => {
                  if (!isActive) navigate(app.path);
                  setOpen(false);
                }}
                aria-current={isActive ? "page" : undefined}
              >
                <span
                  className="asw-item__icon"
                  style={{ color: app.accent, background: `${app.accent}18` }}
                >
                  {app.icon}
                </span>
                <span className="asw-item__text">
                  <div className="asw-item__label">{app.label}</div>
                  <div className="asw-item__sub">{app.sub}</div>
                </span>
                {isActive && (
                  <span
                    className="asw-item__active-dot"
                    style={{ background: app.accent }}
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
