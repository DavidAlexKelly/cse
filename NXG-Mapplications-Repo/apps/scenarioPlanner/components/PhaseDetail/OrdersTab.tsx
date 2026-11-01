// src/apps/scenarioPlanner/components/PhaseDetail/OrdersTab.tsx
//
// "ORDERS" tab inside PhaseDetail — provides the UI for:
//   1. Free-text intent → Generate Orders (LLM call)
//   2. Review/display orders per unit
//   3. Generate End State (LLM call) once all units have valid orders

import { useState, type KeyboardEvent } from "react";
import type { Phase } from "../../shared/types";
import type {
  UnitOrder,
  GenerateEndStateOutput,
  MapUnitPlacement,
} from "../../phaseCreator/types";
import type { OrderAdjustment } from "../../lib/orderReachability";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OrdersTabProps {
  phase: Phase; // kept for future per-phase context
  /** Units in the phase's current start state. */
  startStateUnits: MapUnitPlacement[];
  /** Current orders (populated after Generate Orders). */
  orders: UnitOrder[];
  /** Current end state (populated after Generate End State). */
  endState: GenerateEndStateOutput | null;
  /** Whether an LLM call is currently running. */
  isGenerating: boolean;
  /** Error from last LLM call, if any. */
  lastError: string | null;
  /** Orders summary from LLM. */
  ordersSummary: string;
  /**
   * Corrections the terrain check made to the AI's orders (destinations in
   * water, unreachable in the phase, etc). Empty when everything the model
   * proposed was achievable.
   */
  adjustments?: OrderAdjustment[];
  /** Callback to generate orders from free-text intent. */
  onGenerateOrders: (userIntent: string) => Promise<void>;
  /** Callback to generate the end state from current orders. */
  onGenerateEndState: () => Promise<void>;
  readOnly?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const TASK_COLOURS: Record<string, string> = {
  attack: "#E74C3C",
  seize: "#E74C3C",
  breach: "#E74C3C",
  destroy: "#E74C3C",
  clear: "#E67E22",
  screen: "#3498DB",
  guard: "#3498DB",
  defend: "#2ECC71",
  retain: "#2ECC71",
  block: "#2ECC71",
  reserve: "#95A5A6",
  hold: "#95A5A6",
  move: "#9B59B6",
  advance: "#9B59B6",
  withdraw: "#F39C12",
  delay: "#F39C12",
};

function taskColour(taskName: string): string {
  return TASK_COLOURS[taskName.toLowerCase()] ?? "#4A90D9";
}

// ─── Component ──────────────────────────────────────────────────────────────

export function OrdersTab({
  phase: _phase,
  startStateUnits,
  orders,
  endState,
  isGenerating,
  lastError,
  ordersSummary,
  adjustments = [],
  onGenerateOrders,
  onGenerateEndState,
  readOnly,
}: OrdersTabProps) {
  const [intent, setIntent] = useState("");
  const hasOrders = orders.length > 0;
  const allUnitsHaveOrders = hasOrders && startStateUnits.length > 0
    && startStateUnits.every((u) => orders.some((o) => o.unitId === u.id));

  function handleGenerateOrders() {
    if (!intent.trim() || isGenerating) return;
    onGenerateOrders(intent.trim());
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleGenerateOrders();
    }
  }

  return (
    <div className="sp-orders-tab">
      {/* ── Generate Orders section ──────────────────────────────────────── */}
      <div className="sp-detail__section">
        <div className="sp-detail__section-header">
          <span className="sp-detail__section-icon" aria-hidden="true">⚔️</span>
          Generate Orders
        </div>

        {!readOnly && (
          <>
            <textarea
              className="sp-orders-tab__intent-input"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the intent for this phase, e.g. 'Attack OBJ ALPHA from the south with 1PWRR while 2MERCIAN provides a screen to the east. Red forces defend in depth along PL CAESAR.'"
              rows={4}
              disabled={isGenerating}
            />
            <div className="sp-orders-tab__actions">
              <button
                type="button"
                className="sp-btn--primary sp-btn--sm"
                onClick={handleGenerateOrders}
                disabled={!intent.trim() || isGenerating}
              >
                {isGenerating ? "✦ Generating…" : "✦ Generate Orders"}
              </button>
              <span className="sp-orders-tab__hint">
                {startStateUnits.length} unit{startStateUnits.length !== 1 ? "s" : ""} in start state
                {hasOrders && ` · ${orders.length} order${orders.length !== 1 ? "s" : ""} assigned`}
              </span>
            </div>
          </>
        )}

        {lastError && (
          <div className="sp-orders-tab__error" role="alert">
            ⚠ {lastError}
          </div>
        )}
      </div>

      {/* ── Orders summary ───────────────────────────────────────────────── */}
      {ordersSummary && (
        <div className="sp-detail__section">
          <div className="sp-detail__section-header">
            <span className="sp-detail__section-icon" aria-hidden="true">📋</span>
            Concept of Operations
          </div>
          <p className="sp-orders-tab__summary">{ordersSummary}</p>
        </div>
      )}

      {/* ── Terrain corrections ──────────────────────────────────────────── */}
      {adjustments.length > 0 && (
        <div className="sp-detail__section">
          <div className="sp-detail__section-header">
            <span className="sp-detail__section-icon" aria-hidden="true">🗺️</span>
            Terrain Check ({adjustments.length} adjusted)
          </div>
          <p className="sp-orders-tab__end-state-hint">
            These destinations were changed because the unit could not reach the position
            the AI proposed — routed on the terrain grid for the unit's mobility class.
          </p>
          <div className="sp-orders-tab__list">
            {adjustments.map((adj) => (
              <div key={`${adj.unitId}-${adj.kind}`} className="sp-orders-tab__order-card">
                <div className="sp-orders-tab__order-header">
                  <span className="sp-orders-tab__unit-label">{adj.unitLabel}</span>
                  <span
                    className="sp-orders-tab__task-badge"
                    style={{
                      backgroundColor:
                        adj.kind === "no-route" || adj.kind === "destination-impassable"
                          ? "#E74C3C"
                          : "#F39C12",
                    }}
                  >
                    {adj.kind === "unreachable-in-phase"
                      ? `SHORT BY ${adj.shortfallKm.toFixed(1)}KM`
                      : adj.kind === "destination-impassable"
                        ? "IMPASSABLE"
                        : adj.kind === "no-route"
                          ? "NO ROUTE"
                          : "ADJUSTED"}
                  </span>
                </div>
                <p className="sp-orders-tab__order-rationale">{adj.note}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Orders per unit ──────────────────────────────────────────────── */}
      {startStateUnits.length > 0 && (
        <div className="sp-detail__section">
          <div className="sp-detail__section-header">
            <span className="sp-detail__section-icon" aria-hidden="true">📌</span>
            Unit Orders ({orders.length}/{startStateUnits.length})
          </div>
          <div className="sp-orders-tab__list">
            {startStateUnits.map((unit) => {
              const order = orders.find((o) => o.unitId === unit.id);
              return (
                <div key={unit.id} className="sp-orders-tab__order-card">
                  <div className="sp-orders-tab__order-header">
                    <span className="sp-orders-tab__unit-label">
                      {unit.label ?? unit.id}
                    </span>
                    {order ? (
                      <span
                        className="sp-orders-tab__task-badge"
                        style={{ backgroundColor: taskColour(order.taskName) }}
                      >
                        {order.taskName.toUpperCase()}
                      </span>
                    ) : (
                      <span
                        className="sp-orders-tab__task-badge"
                        style={{ backgroundColor: "#7f8c8d" }}
                      >
                        NO ORDERS
                      </span>
                    )}
                  </div>
                  {order ? (
                    <p className="sp-orders-tab__order-rationale">{order.rationale}</p>
                  ) : (
                    <p className="sp-orders-tab__order-rationale" style={{ opacity: 0.6, fontStyle: "italic" }}>
                      No orders assigned — unit will hold current position.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Generate End State section ────────────────────────────────────── */}
      {startStateUnits.length > 0 && !readOnly && (
        <div className="sp-detail__section">
          <div className="sp-detail__section-header">
            <span className="sp-detail__section-icon" aria-hidden="true">🏁</span>
            Generate End State
          </div>
          <p className="sp-orders-tab__end-state-hint">
            {hasOrders
              ? allUnitsHaveOrders
                ? "All units have orders. Generate the end state to resolve unit positions, engagements, and outcomes."
                : `${startStateUnits.length - orders.length} unit(s) still need orders. You can still generate the end state with the current orders.`
              : "No explicit orders assigned — the end state will be resolved using unit positions and any arrows drawn on the map."}
          </p>
          <button
            type="button"
            className="sp-btn--primary sp-btn--sm"
            onClick={onGenerateEndState}
            disabled={isGenerating || startStateUnits.length === 0}
          >
            {isGenerating ? "✦ Resolving…" : "✦ Generate End State"}
          </button>
        </div>
      )}

      {/* ── End State results ────────────────────────────────────────────── */}
      {endState && (
        <div className="sp-detail__section">
          <div className="sp-detail__section-header">
            <span className="sp-detail__section-icon" aria-hidden="true">📊</span>
            End State Results
          </div>

          {/* Summary */}
          {endState.summary && (
            <p className="sp-orders-tab__summary">{endState.summary}</p>
          )}

          {/* Engagements */}
          {endState.engagements.length > 0 && (
            <div className="sp-orders-tab__engagements">
              <div className="sp-orders-tab__sub-header">
                Engagements ({endState.engagements.length})
              </div>
              {endState.engagements.map((eng, i) => (
                <div key={i} className="sp-orders-tab__engagement-card">
                  <span className={`sp-orders-tab__outcome sp-orders-tab__outcome--${eng.outcome}`}>
                    {eng.outcome.replace("-", " ").toUpperCase()}
                  </span>
                  <p>{eng.description}</p>
                </div>
              ))}
            </div>
          )}

          {/* Unit outcomes */}
          <div className="sp-orders-tab__sub-header">
            Unit Outcomes ({endState.units.length})
          </div>
          <div className="sp-orders-tab__list">
            {endState.units.map((u) => (
              <div key={u.unitId} className="sp-orders-tab__order-card">
                <div className="sp-orders-tab__order-header">
                  <span className="sp-orders-tab__unit-label">{u.label}</span>
                  <span className={`sp-badge sp-badge--${u.status === "operational" ? "approved" : u.status === "degraded" ? "review" : "draft"}`}>
                    {u.status.toUpperCase()}
                  </span>
                </div>
                <p className="sp-orders-tab__order-rationale">{u.resolution}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────────────── */}
      {!hasOrders && !isGenerating && (
        <div className="sp-detail__empty">
          <span className="sp-detail__empty-icon" aria-hidden="true">⚔️</span>
          <p className="sp-detail__empty-text">
            Enter your intent above and click Generate Orders to assign tactical orders to each unit.
          </p>
        </div>
      )}
    </div>
  );
}
