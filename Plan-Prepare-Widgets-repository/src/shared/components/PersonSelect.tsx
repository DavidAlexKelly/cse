import { Icon } from "@blueprintjs/core";
import React, { useEffect, useRef, useState } from "react";
import { PEOPLE, personById } from "../data/index.js";

interface Props {
  label: string;
  /** personId of the currently-selected person */
  value: string;
  onChange: (personId: string) => void;
}

export const PersonSelect: React.FC<Props> = ({ label, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const selected = personById(value);

  return (
    <div className="scn-person-field">
      <label className="scn-person-field__label">{label}</label>
      <div ref={rootRef} style={{ position: "relative" }}>
        <div
          className={`scn-person-select ${open ? "scn-person-select--open" : ""}`}
          onClick={() => setOpen((o) => !o)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen((o) => !o);
            }
          }}
        >
          {selected ? (
            <>
              <div
                className="scn-person-select__avatar"
                style={{ background: selected.avatarBg }}
              >
                {selected.initials}
              </div>
              <div className="scn-person-select__name">{selected.name}</div>
            </>
          ) : (
            <div
              className="scn-person-select__name"
              style={{ color: "#6a7292" }}
            >
              Unassigned
            </div>
          )}
          <Icon
            icon={open ? "chevron-up" : "chevron-down"}
            size={12}
            className="scn-person-select__chevron"
          />
        </div>

        {open && (
          <div className="scn-person-menu" role="listbox">
            {PEOPLE.map((p) => (
              <div
                key={p.personId}
                className={`scn-person-menu__item ${
                  p.personId === value ? "scn-person-menu__item--active" : ""
                }`}
                role="option"
                tabIndex={0}
                aria-selected={p.personId === value}
                onClick={() => {
                  onChange(p.personId);
                  setOpen(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onChange(p.personId);
                    setOpen(false);
                  }
                }}
              >
                <div
                  className="scn-person-select__avatar"
                  style={{ background: p.avatarBg }}
                >
                  {p.initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="scn-person-menu__name">{p.name}</div>
                  <div className="scn-person-menu__role">{p.role}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
