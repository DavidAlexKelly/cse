// src/apps/scenarioPlanner/components/OrderAssignmentPanel/OrderAssignmentPanel.tsx
//
// Floating panel shown when a tactical order arrow is clicked in "select" tool mode.
// Lets the planner set which unit executes the order, and optionally which objective
// it targets — the two fields resolveOrders.ts needs to do anything useful.

import { useMemo, useState } from "react";
import ms from "milsymbol";
import { lookupTaskForOrder } from "@acc/app6d/core";

export interface OrderAssignmentUnit {
  id: string;
  label: string;
  sidc: string;
  force?: "blue" | "red";
}

export interface OrderAssignmentObjective {
  id: string;
  name: string;
}

export interface OrderAssignmentTarget {
  id: string;
  tacticLabel?: string;
  tacticSidc?: string;
  assignedUnitId?: string;
  targetObjectiveId?: string;
}

interface Props {
  order: OrderAssignmentTarget;
  units: OrderAssignmentUnit[];
  objectives: OrderAssignmentObjective[];
  anchor: { x: number; y: number };
  onAssignUnit: (unitId: string | undefined) => void;
  onAssignObjective: (objectiveId: string | undefined) => void;
  onClose: () => void;
  readOnly?: boolean;
}

function symbolDataUri(sidc: string, size = 20): string {
  try {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new ms.Symbol(sidc, { size }).asSVG())}`;
  } catch {
    return "";
  }
}

export function OrderAssignmentPanel({
  order,
  units,
  objectives,
  anchor,
  onAssignUnit,
  onAssignObjective,
  onClose,
  readOnly,
}: Props) {
  const [search, setSearch] = useState("");
  const task = useMemo(() => lookupTaskForOrder(order.tacticLabel), [order.tacticLabel]);
  const assignedUnit = units.find((u) => u.id === order.assignedUnitId);

  const filteredUnits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return units;
    return units.filter((u) => u.label.toLowerCase().includes(q));
  }, [units, search]);

  return (
    <div
      className={"sp-order-panel"}
      style={{ left: anchor.x, top: anchor.y }}
      role="dialog"
      aria-label="Assign order"
    >
      <div className={"sp-order-panel__header"}>
        <span className={"sp-order-panel__title"}>{order.tacticLabel ?? "Order"}</span>
        <button
          type="button"
          className={"sp-order-panel__close"}
          onClick={onClose}
          aria-label="Close"
          title="Close"
        >
          ×
        </button>
      </div>

      {task && <p className={"sp-order-panel__desc"}>{task.description}</p>}

      <div className={"sp-order-panel__section"}>
        <span className={"sp-order-panel__label"}>Assigned unit</span>
        {assignedUnit ? (
          <div className={"sp-order-panel__assigned-row"}>
            <img src={symbolDataUri(assignedUnit.sidc)} width={20} height={20} alt="" aria-hidden="true" />
            <span className={"sp-order-panel__assigned-name"}>{assignedUnit.label}</span>
            {!readOnly && (
              <button
                type="button"
                className={"sp-order-panel__clear-btn"}
                onClick={() => onAssignUnit(undefined)}
                title="Unassign"
              >
                Clear
              </button>
            )}
          </div>
        ) : (
          <span className={"sp-order-panel__unassigned-hint"}>
            No unit assigned — this order is a standing graphic until one is set.
          </span>
        )}

        {!readOnly && (
          <>
            <input
              className={"sp-order-panel__search"}
              placeholder="Search units on this phase…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search units"
            />
            <div className={"sp-order-panel__unit-list"} role="listbox" aria-label="Units">
              {filteredUnits.length === 0 && (
                <div className={"sp-order-panel__empty"}>No units placed on this phase yet.</div>
              )}
              {filteredUnits.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  role="option"
                  aria-selected={u.id === order.assignedUnitId}
                  className={`sp-order-panel__unit-row${u.id === order.assignedUnitId ? " sp-order-panel__unit-row--active" : ""}`}
                  onClick={() => onAssignUnit(u.id)}
                >
                  <img src={symbolDataUri(u.sidc)} width={18} height={18} alt="" aria-hidden="true" />
                  <span className={"sp-order-panel__unit-name"}>{u.label}</span>
                  <span
                    className={"sp-order-panel__force-dot"}
                    data-force={u.force ?? "blue"}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {objectives.length > 0 && (
        <div className={"sp-order-panel__section"}>
          <span className={"sp-order-panel__label"}>Target objective (optional)</span>
          <select
            className={"sp-order-panel__select"}
            value={order.targetObjectiveId ?? ""}
            disabled={readOnly}
            onChange={(e) => onAssignObjective(e.target.value || undefined)}
          >
            <option value="">— none (use drawn end point) —</option>
            {objectives.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
