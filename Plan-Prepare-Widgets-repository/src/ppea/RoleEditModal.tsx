/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
import React, { useState } from "react";
import type { PpeaRole } from "./ppeaData.js";

interface Props {
  initial: Partial<PpeaRole> | null;
  mode: "create" | "edit";
  onClose: () => void;
  onSave: (role: PpeaRole) => void;
  onDelete?: () => void;
}

export const RoleEditModal: React.FC<Props> = ({
  initial,
  mode,
  onClose,
  onSave,
  onDelete,
}) => {
  const [abbr, setAbbr] = useState(initial?.abbr ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [sub, setSub] = useState(initial?.sub ?? "");
  const [desc, setDesc] = useState(initial?.desc ?? "");

  const canSave = abbr.trim() && name.trim();

  return (
    <div
      className="ppea-modal-backdrop open"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="ppea-modal bp5-dark"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ppea-modal__header">
          <div className="ppea-modal__title-wrap">
            <div className="ppea-modal__phase-label">
              {mode === "create" ? "Add role" : "Edit role"}
            </div>
            <div className="ppea-modal__title">
              {name || "New role"}
            </div>
          </div>
          <button
            type="button"
            className="ppea-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="ppea-modal__body">
          <div className="ppea-form-grid">
            <label className="ppea-form-field">
              <span className="ppea-form-label">Abbreviation</span>
              <input
                className="ppea-input"
                value={abbr}
                onChange={(e) => setAbbr(e.target.value)}
                placeholder="e.g. CIMIC"
              />
            </label>
            <label className="ppea-form-field">
              <span className="ppea-form-label">Display name</span>
              <input
                className="ppea-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full role name"
              />
            </label>
            <label className="ppea-form-field">
              <span className="ppea-form-label">Subtitle</span>
              <input
                className="ppea-input"
                value={sub}
                onChange={(e) => setSub(e.target.value)}
                placeholder="Short tagline"
              />
            </label>
            <label className="ppea-form-field">
              <span className="ppea-form-label">Description</span>
              <textarea
                className="ppea-textarea"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="What does this role do?"
              />
            </label>
          </div>
        </div>
        <div className="ppea-modal__footer">
          {mode === "edit" && onDelete && (
            <button
              type="button"
              className="ppea-btn ppea-btn--danger"
              onClick={onDelete}
            >
              Delete role
            </button>
          )}
          <div className="ppea-spacer" />
          <button
            type="button"
            className="ppea-btn ppea-btn--ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="ppea-btn ppea-btn--primary"
            disabled={!canSave}
            onClick={() =>
              onSave({
                id: initial?.id ?? "",
                abbr: abbr.trim(),
                name: name.trim(),
                sub: sub.trim(),
                desc: desc.trim(),
              })
            }
          >
            {mode === "create" ? "Create role" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
};
