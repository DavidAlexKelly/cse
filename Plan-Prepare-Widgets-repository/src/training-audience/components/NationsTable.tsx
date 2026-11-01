import { Icon } from "@blueprintjs/core";
import React, { useState } from "react";
import { MilButton } from "../../shared/components/Button.js";
import { MilLabel } from "../../shared/components/Label.js";
import type { ParticipatingNation } from "../trainingAudienceData.js";

interface Props {
  nations: ParticipatingNation[];
  onChange: (next: ParticipatingNation[]) => void;
}

const ROLE_OPTIONS = ["Lead nation", "Participant", "Observer"];

const EMPTY_NATION: ParticipatingNation = {
  nation: "",
  role: "Participant",
  participantCount: 0,
  directorates: [],
};

interface RowProps {
  nation: ParticipatingNation;
  onChange: (next: ParticipatingNation) => void;
  onDelete: () => void;
}

const NationRow: React.FC<RowProps> = ({ nation, onChange, onDelete }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ParticipatingNation>(nation);
  const [draftDirs, setDraftDirs] = useState(nation.directorates.join(", "));

  const startEdit = () => {
    setDraft(nation);
    setDraftDirs(nation.directorates.join(", "));
    setEditing(true);
  };

  const save = () => {
    onChange({
      ...draft,
      participantCount: Number(String(draft.participantCount).replace(/[^0-9]/g, "")) || 0,
      directorates: draftDirs
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean),
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <tr>
        <td>
          <input
            className="scn-table__cell-input"
            value={draft.nation}
            onChange={(e) => setDraft({ ...draft, nation: e.target.value })}
            placeholder="Nation"
          />
        </td>
        <td>
          <select
            className="scn-table__cell-select"
            value={draft.role}
            onChange={(e) => setDraft({ ...draft, role: e.target.value })}
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </td>
        <td style={{ width: 100 }}>
          <input
            className="scn-table__cell-input"
            value={String(draft.participantCount)}
            onChange={(e) =>
              setDraft({
                ...draft,
                participantCount: Number(e.target.value.replace(/[^0-9]/g, "")) || 0,
              })
            }
          />
        </td>
        <td>
          <input
            className="scn-table__cell-input"
            value={draftDirs}
            onChange={(e) => setDraftDirs(e.target.value)}
            placeholder="J1, J2, …"
          />
        </td>
        <td style={{ width: 110 }}>
          <div className="scn-table__row-actions" style={{ opacity: 1 }}>
            <MilButton variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </MilButton>
            <MilButton icon="floppy-disk" variant="primary" onClick={save}>
              Save
            </MilButton>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{nation.nation}</td>
      <td>
        {nation.role === "Lead nation" ? (
          <MilLabel intent="green">{nation.role}</MilLabel>
        ) : nation.role === "Observer" ? (
          <MilLabel intent="amber">{nation.role}</MilLabel>
        ) : (
          <MilLabel intent="grey">{nation.role}</MilLabel>
        )}
      </td>
      <td>~{nation.participantCount}</td>
      <td>{nation.directorates.join(", ")}</td>
      <td>
        <div className="scn-table__row-actions">
          <MilButton
            icon="edit"
            variant="ghost"
            iconOnly
            title="Edit"
            onClick={startEdit}
          >
            Edit
          </MilButton>
          <MilButton
            icon="trash"
            variant="danger"
            iconOnly
            title="Remove this nation"
            onClick={onDelete}
          >
            Delete
          </MilButton>
        </div>
      </td>
    </tr>
  );
};

export const NationsTable: React.FC<Props> = ({ nations, onChange }) => {
  const updateRow = (index: number, next: ParticipatingNation) => {
    onChange(nations.map((n, i) => (i === index ? next : n)));
  };

  const deleteRow = (index: number) => {
    onChange(nations.filter((_, i) => i !== index));
  };

  const addRow = () => {
    onChange([...nations, { ...EMPTY_NATION, nation: "New nation" }]);
  };

  return (
    <div className="scn-section">
      <div className="scn-section__head">
        <div className="scn-section__title">
          <Icon icon="globe" size={11} />
          Participating nations
          <span style={{ color: "#454c68" }}>·</span>
          <span style={{ color: "#98a1c0", fontWeight: 600 }}>
            {nations.length}
          </span>
        </div>
      </div>

      <div className="scn-table-wrap">
        <table className="scn-table">
          <thead>
            <tr>
              <th>Nation</th>
              <th>Role</th>
              <th>Est. participants</th>
              <th>Key directorates</th>
              <th style={{ width: 110, textAlign: "right" }}>&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {nations.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    textAlign: "center",
                    color: "#6a7292",
                    fontStyle: "italic",
                  }}
                >
                  No nations added yet
                </td>
              </tr>
            ) : (
              nations.map((n, i) => (
                <NationRow
                  key={`${n.nation}-${i}`}
                  nation={n}
                  onChange={(next) => updateRow(i, next)}
                  onDelete={() => deleteRow(i)}
                />
              ))
            )}
          </tbody>
        </table>

        <div className="scn-table__add-row">
          <MilButton icon="add" variant="default" onClick={addRow}>
            Add nation
          </MilButton>
        </div>
      </div>
    </div>
  );
};
