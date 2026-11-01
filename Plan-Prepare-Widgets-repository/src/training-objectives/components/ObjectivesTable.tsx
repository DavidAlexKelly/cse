/* eslint-disable jsx-a11y/no-autofocus */
import { Icon } from "@blueprintjs/core";
import React, { useMemo, useState } from "react";
import { MilButton } from "../../shared/components/Button.js";
import { MilLabel } from "../../shared/components/Label.js";
import type { MilLabelIntent } from "../../shared/components/Label.js";
import type {
  TrainingObjectivePriority,
  TrainingObjectiveRecord,
} from "../../shared/data/index.js";

interface Props {
  objectives: TrainingObjectiveRecord[];
  onChange: (next: TrainingObjectiveRecord[]) => void;
}

const PRIORITY_OPTIONS: TrainingObjectivePriority[] = ["High", "Medium", "Low"];

/**
 * Conventional RAG mapping.
 *   High   → Red
 *   Medium → Amber
 *   Low    → Green
 */
const PRIORITY_INTENT: Record<TrainingObjectivePriority, MilLabelIntent> = {
  High: "red",
  Medium: "amber",
  Low: "green",
};

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Re-stamp the `ref` field on every row so they always read TO-01,
 * TO-02, … in display order. Ref is auto-generated per the spec.
 */
function renumber(rows: TrainingObjectiveRecord[]): TrainingObjectiveRecord[] {
  return rows.map((r, i) => ({
    ...r,
    ref: `TO-${String(i + 1).padStart(2, "0")}`,
  }));
}

function nextObjectiveId(existing: TrainingObjectiveRecord[]): string {
  let n = existing.length + 1;
  while (existing.some((o) => o.objectiveId === `to_new_${n}`)) n++;
  return `to_new_${n}`;
}

// ── Row component ─────────────────────────────────────────────────────────

interface RowProps {
  index: number;
  row: TrainingObjectiveRecord;
  /** Datalist suggestions for the Functional Area field */
  functionalAreaSuggestions: string[];
  onChange: (next: TrainingObjectiveRecord) => void;
  onDelete: () => void;
  /** DnD callbacks */
  onDragStart: (index: number) => void;
  onDragOver: (index: number, position: "before" | "after") => void;
  onDragEnd: () => void;
  onDrop: (index: number, position: "before" | "after") => void;
  /** Visual state during drag */
  isDragging: boolean;
  dropIndicator: "before" | "after" | null;
}

const ObjectiveRow: React.FC<RowProps> = ({
  index,
  row,
  functionalAreaSuggestions,
  onChange,
  onDelete,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  isDragging,
  dropIndicator,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TrainingObjectiveRecord>(row);

  const startEdit = () => {
    setDraft(row);
    setEditing(true);
  };

  const save = () => {
    onChange({
      ...draft,
      objective: draft.objective.trim() || row.objective,
      functionalArea: draft.functionalArea.trim() || row.functionalArea,
    });
    setEditing(false);
  };

  const rowClass = [
    isDragging ? "scn-table__row--dragging" : "",
    dropIndicator === "before" ? "scn-table__row--drop-before" : "",
    dropIndicator === "after" ? "scn-table__row--drop-after" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Drag-over handler with before/after split based on cursor Y position
  const handleDragOver = (e: React.DragEvent<HTMLTableRowElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const isAfter = e.clientY - rect.top > rect.height / 2;
    onDragOver(index, isAfter ? "after" : "before");
  };

  const handleDrop = (e: React.DragEvent<HTMLTableRowElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const isAfter = e.clientY - rect.top > rect.height / 2;
    onDrop(index, isAfter ? "after" : "before");
  };

  if (editing) {
    return (
      <tr className={rowClass}>
        <td className="scn-table__drag-cell">
          <Icon icon="drag-handle-vertical" size={12} />
        </td>
        <td style={{ fontFamily: "monospace", color: "#98a1c0" }}>{row.ref}</td>
        <td>
          <input
            className="scn-table__cell-input"
            value={draft.objective}
            onChange={(e) => setDraft({ ...draft, objective: e.target.value })}
            placeholder="What should the audience demonstrate?"
            autoFocus
          />
        </td>
        <td style={{ width: 180 }}>
          <input
            className="scn-table__cell-input"
            list="to-fa-suggestions"
            value={draft.functionalArea}
            onChange={(e) =>
              setDraft({ ...draft, functionalArea: e.target.value })
            }
            placeholder="e.g. C2, Fires, Logistics"
          />
          <datalist id="to-fa-suggestions">
            {functionalAreaSuggestions.map((fa) => (
              <option key={fa} value={fa} />
            ))}
          </datalist>
        </td>
        <td style={{ width: 110 }}>
          <select
            className="scn-table__cell-select"
            value={draft.priority}
            onChange={(e) =>
              setDraft({
                ...draft,
                priority: e.target.value as TrainingObjectivePriority,
              })
            }
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </td>
        <td style={{ width: 130 }}>
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
    <tr
      className={rowClass}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(index));
        onDragStart(index);
      }}
      onDragOver={handleDragOver}
      onDragEnd={onDragEnd}
      onDrop={handleDrop}
    >
      <td className="scn-table__drag-cell" title="Drag to reorder">
        <Icon icon="drag-handle-vertical" size={12} />
      </td>
      <td style={{ fontFamily: "monospace", color: "#98a1c0", fontWeight: 700 }}>
        {row.ref}
      </td>
      <td>{row.objective}</td>
      <td>{row.functionalArea}</td>
      <td>
        <MilLabel intent={PRIORITY_INTENT[row.priority]}>
          {row.priority}
        </MilLabel>
      </td>
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
            title="Remove this objective"
            onClick={onDelete}
          >
            Delete
          </MilButton>
        </div>
      </td>
    </tr>
  );
};

// ── Table ──────────────────────────────────────────────────────────────────

export const ObjectivesTable: React.FC<Props> = ({ objectives, onChange }) => {
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    index: number;
    position: "before" | "after";
  } | null>(null);

  // Build a deduped list of seen functional areas so editors get autocomplete
  const functionalAreaSuggestions = useMemo(() => {
    const seen = new Set<string>();
    for (const o of objectives) {
      if (o.functionalArea) seen.add(o.functionalArea);
    }
    return Array.from(seen).sort();
  }, [objectives]);

  const updateRow = (index: number, next: TrainingObjectiveRecord) => {
    const copy = [...objectives];
    copy[index] = next;
    onChange(renumber(copy));
  };

  const deleteRow = (index: number) => {
    onChange(renumber(objectives.filter((_, i) => i !== index)));
  };

  const addRow = () => {
    const newRow: TrainingObjectiveRecord = {
      objectiveId: nextObjectiveId(objectives),
      ref: `TO-${String(objectives.length + 1).padStart(2, "0")}`,
      objective: "New training objective",
      functionalArea: "",
      priority: "Medium",
    };
    onChange(renumber([...objectives, newRow]));
  };

  // ── Drag-and-drop helpers ────────────────────────────────────────────────

  const handleDragStart = (index: number) => setDragging(index);

  const handleDragOver = (
    index: number,
    position: "before" | "after",
  ) => {
    if (dragging === null) return;
    // Don't show indicator on the source row itself
    if (index === dragging) {
      setDropTarget(null);
      return;
    }
    setDropTarget({ index, position });
  };

  const handleDragEnd = () => {
    setDragging(null);
    setDropTarget(null);
  };

  const handleDrop = (index: number, position: "before" | "after") => {
    if (dragging === null || dragging === index) {
      handleDragEnd();
      return;
    }
    const from = dragging;
    let to = position === "after" ? index + 1 : index;
    // When moving downwards, the target index shrinks by 1 after the
    // source is spliced out.
    if (from < to) to -= 1;
    if (from === to) {
      handleDragEnd();
      return;
    }
    const next = [...objectives];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(renumber(next));
    handleDragEnd();
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="scn-table-wrap">
      <table className="scn-table">
        <thead>
          <tr>
            <th style={{ width: 24 }}>&nbsp;</th>
            <th style={{ width: 80 }}>Ref</th>
            <th>Objective</th>
            <th style={{ width: 180 }}>Functional area</th>
            <th style={{ width: 110 }}>Priority</th>
            <th style={{ width: 130, textAlign: "right" }}>&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          {objectives.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                style={{
                  textAlign: "center",
                  color: "#6a7292",
                  fontStyle: "italic",
                }}
              >
                No objectives defined yet
              </td>
            </tr>
          ) : (
            objectives.map((o, i) => (
              <ObjectiveRow
                key={o.objectiveId}
                index={i}
                row={o}
                functionalAreaSuggestions={functionalAreaSuggestions}
                onChange={(next) => updateRow(i, next)}
                onDelete={() => deleteRow(i)}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                onDrop={handleDrop}
                isDragging={dragging === i}
                dropIndicator={
                  dropTarget && dropTarget.index === i ? dropTarget.position : null
                }
              />
            ))
          )}
        </tbody>
      </table>

      <div className="scn-table__add-row">
        <MilButton icon="add" variant="default" onClick={addRow}>
          Add objective
        </MilButton>
      </div>
    </div>
  );
};
