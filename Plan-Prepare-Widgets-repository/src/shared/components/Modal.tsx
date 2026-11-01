/* eslint-disable jsx-a11y/no-autofocus */
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { Icon } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import React from "react";
import "../styling/components.css";
import { MilButton } from "./Button.js";
import type { MilButtonVariant } from "./Button.js";

// ── MilModal ───────────────────────────────────────────────────────────────

export interface MilModalAction {
  label: string;
  variant?: MilButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  onClick: () => void;
}

export interface MilModalProps {
  /** Title shown in the header */
  title: string;
  /** Optional BlueprintJS icon shown next to the title */
  titleIcon?: IconName;
  /** Extra width class: "sm" (360px), "md" (640px), or omit for default (560px) */
  size?: "sm" | "md";
  /** Footer action buttons — rendered right-to-left */
  actions?: MilModalAction[];
  /** Called when the backdrop or the × button is clicked */
  onClose: () => void;
  children: React.ReactNode;
}

export const MilModal: React.FC<MilModalProps> = ({
  title,
  titleIcon = "edit",
  size,
  actions = [],
  onClose,
  children,
}) => (
  <div className="mel-overlay" onClick={onClose}>
    <div
      className={["mel-modal bp5-dark", size === "sm" ? "mel-modal--sm" : size === "md" ? "mel-modal--md" : ""].filter(Boolean).join(" ")}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="mel-modal__header">
        <div className="mel-modal__title">
          <Icon icon={titleIcon} size={13} />
          {title}
        </div>
        <button
          className="mil-btn mil-btn--ghost mil-btn--sm mil-btn--icon-only"
          onClick={onClose}
          title="Close"
        >
          <Icon icon="cross" size={12} />
        </button>
      </div>

      {/* Body — caller supplies all content */}
      <div className="mel-modal__body">{children}</div>

      {/* Footer */}
      {actions.length > 0 && (
        <div className="mel-modal__footer">
          {actions.map((action, i) => (
            <MilButton
              key={i}
              variant={action.variant ?? "default"}
              icon={action.icon}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.label}
            </MilButton>
          ))}
        </div>
      )}
    </div>
  </div>
);

// ── MilFormField ───────────────────────────────────────────────────────────
// Lightweight wrappers for common form primitives that follow the mil theme.

export interface MilFormRowProps {
  children: React.ReactNode;
}

/** Horizontal row that wraps form groups */
export const MilFormRow: React.FC<MilFormRowProps> = ({ children }) => (
  <div className="mel-form-row">{children}</div>
);

export interface MilFormGroupProps {
  label: string;
  /** Renders at a fixed narrow width instead of flex-grow */
  compact?: boolean;
  children: React.ReactNode;
}

/** Labelled wrapper around a single form control */
export const MilFormGroup: React.FC<MilFormGroupProps> = ({ label, compact = false, children }) => (
  <div className={["mel-form-group", compact ? "mel-form-group--sm" : ""].filter(Boolean).join(" ")}>
    <label className="mel-form-label">{label}</label>
    {children}
  </div>
);

export interface MilTextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export const MilTextInput: React.FC<MilTextInputProps> = ({ value, onChange, placeholder, autoFocus }) => (
  <input
    type="text"
    className="mel-input"
    value={value}
    placeholder={placeholder}
    autoFocus={autoFocus}
    onChange={e => onChange(e.target.value)}
  />
);

export interface MilTextAreaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}

export const MilTextArea: React.FC<MilTextAreaProps> = ({ value, onChange, placeholder, rows = 4 }) => (
  <textarea
    className="mel-textarea"
    value={value}
    placeholder={placeholder}
    rows={rows}
    onChange={e => onChange(e.target.value)}
  />
);

export interface MilSelectOption {
  value: string;
  label: string;
}

export interface MilSelectProps {
  value: string;
  options: MilSelectOption[];
  onChange: (value: string) => void;
}

export const MilSelect: React.FC<MilSelectProps> = ({ value, options, onChange }) => (
  <select className="mel-select" value={value} onChange={e => onChange(e.target.value)}>
    {options.map(opt => (
      <option key={opt.value} value={opt.value}>{opt.label}</option>
    ))}
  </select>
);

export interface MilDateTimeInputProps {
  value: string;
  onChange: (value: string) => void;
}

export const MilDateTimeInput: React.FC<MilDateTimeInputProps> = ({ value, onChange }) => (
  <input
    type="datetime-local"
    className="mel-input"
    value={value}
    onChange={e => onChange(e.target.value)}
  />
);

export interface MilDateInputProps {
  value: string;        // ISO date string: "YYYY-MM-DD"
  onChange: (value: string) => void;
  placeholder?: string;
}

/** Plain date picker — stores value as "YYYY-MM-DD" */
export const MilDateInput: React.FC<MilDateInputProps> = ({ value, onChange }) => (
  <input
    type="date"
    className="mel-input"
    value={value}
    onChange={e => onChange(e.target.value)}
  />
);
