/**
 * MilModal.tsx — lightweight modal replacing the widget-set's shared MilModal.
 * Matches the prop API used by GroupBuilderPanel, UnitFormDialog, TemplatesPanel.
 */

import React, { useEffect } from "react";
import { C, overlayStyle, modalStyle, inputStyle, selectStyle, textAreaStyle } from "./milStyles";
import { MilButton } from "./MilButton";

// ── Modal ──────────────────────────────────────────────────────────────────

interface ModalAction {
  label: string;
  variant?: "primary" | "default" | "danger";
  onClick: () => void;
  disabled?: boolean;
}

interface MilModalProps {
  title: string;
  /** Not rendered — kept for API compat */
  titleIcon?: string;
  onClose: () => void;
  actions?: ModalAction[];
  children: React.ReactNode;
}

export const MilModal: React.FC<MilModalProps> = ({
  title,
  onClose,
  actions = [],
  children,
}) => {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modalStyle}>
        {/* Header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          padding: "12px 16px",
          background: C.navyDk,
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.text }}>{title}</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 18, lineHeight: 1, padding: "0 2px" }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}>
          {children}
        </div>

        {/* Footer */}
        {actions.length > 0 && (
          <div style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "10px 16px",
            background: C.navyDk,
            borderTop: `1px solid ${C.border}`,
            flexShrink: 0,
          }}>
            {actions.map((a) => (
              <MilButton
                key={a.label}
                variant={a.variant ?? "default"}
                onClick={a.onClick}
                disabled={a.disabled}
              >
                {a.label}
              </MilButton>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Form helpers (used inside modals) ─────────────────────────────────────

export const MilFormGroup: React.FC<{
  label: string;
  children: React.ReactNode;
  compact?: boolean;
}> = ({ label, children, compact }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: compact ? "0 0 auto" : undefined }}>
    <label style={{
      fontSize: 10,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      color: C.muted,
    }}>
      {label}
    </label>
    {children}
  </div>
);

export const MilFormRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: "flex", gap: 10 }}>
    {React.Children.map(children, (child) => (
      <div style={{ flex: 1, minWidth: 0 }}>{child}</div>
    ))}
  </div>
);

export const MilTextInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}> = ({ value, onChange, placeholder, autoFocus }) => (
  <input
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    autoFocus={autoFocus}
    style={inputStyle}
  />
);

export const MilTextArea: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}> = ({ value, onChange, placeholder, rows = 3 }) => (
  <textarea
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    rows={rows}
    style={textAreaStyle}
  />
);

export const MilSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}> = ({ value, onChange, options }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
    {options.map((o) => (
      <option key={o.value} value={o.value}>{o.label}</option>
    ))}
  </select>
);

/** Thin label badge — replaces MilLabel from the widget-set */
export const MilLabel: React.FC<{
  intent?: "blue" | "green" | "amber" | "red";
  children: React.ReactNode;
}> = ({ intent = "blue", children }) => {
  const COLOURS: Record<string, { bg: string; color: string; border: string }> = {
    blue:  { bg: "rgba(34,168,192,0.15)",   color: C.cyanLt,  border: "rgba(34,168,192,0.4)"  },
    green: { bg: "rgba(74,124,89,0.2)",     color: "#5dc485", border: "rgba(74,124,89,0.4)"   },
    amber: { bg: "rgba(201,146,42,0.18)",   color: "#d9ad4a", border: "rgba(201,146,42,0.4)"  },
    red:   { bg: "rgba(176,58,46,0.18)",    color: "#ef9a9a", border: "rgba(176,58,46,0.4)"   },
  };
  const s = COLOURS[intent];
  return (
    <span style={{
      fontSize: 9,
      fontWeight: 700,
      padding: "1px 6px",
      borderRadius: 2,
      background: s.bg,
      color: s.color,
      border: `1px solid ${s.border}`,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
    }}>
      {children}
    </span>
  );
};
