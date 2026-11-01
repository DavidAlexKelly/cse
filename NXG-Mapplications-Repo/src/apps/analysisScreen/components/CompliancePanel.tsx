// ── analysisScreen/components/CompliancePanel.tsx ──────────────────────────
// What the plan asked for, against what the run did.
//
// A drawer above the Timeline rather than a third tab in the 320px SidePanel:
// this is a table with eight columns, and the side panel is the wrong shape
// for it. Collapsed by default so the map is not squeezed until the analyst
// asks for it.
//
// It leads with the summary line and only then lists the orders. That is not
// decoration — measuring this plan against this run produces "late" for every
// single order that arrives, because the planner's timings come from a
// cross-country rate table and the execution is paced by something else. Listed
// as fourteen rows it reads as a broken tool; stated once as a distribution it
// reads as what it is, a finding about the plan's movement assumptions. The
// rows below it are then free to show the things that differ from each other.

import { type FC, useMemo } from "react";
import {
  describeCompliance,
  statusTone,
  STATUS_LABEL,
  summariseCompliance,
  type ComplianceTone,
  type OrderCompliance,
  type RunCompliance,
} from "../lib/compliance";
import { UI } from "./ui";

const TONE_COLOUR: Record<ComplianceTone, string> = {
  good: UI.green,
  warn: UI.amber,
  bad: UI.red,
  muted: UI.textFaint,
};

interface Props {
  compliance: RunCompliance;
  /** Epoch second the run starts at, for turning run-relative times into seeks. */
  runStartS: number;
  selectedOrderId: string | null;
  onSelectOrder: (orderId: string | null) => void;
  /** Move the playhead, in epoch seconds. */
  onSeek: (ts: number) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}

function hours(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1);
}

function km(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

const HEADERS = [
  "UNIT",
  "TASK",
  "STATUS",
  "PLANNED",
  "ACTUAL",
  "Δ",
  "PROGRESS",
  "MAX OFF AXIS",
  "",
] as const;

const cell: React.CSSProperties = {
  padding: "3px 8px",
  whiteSpace: "nowrap",
  textAlign: "left",
};

const numericCell: React.CSSProperties = { ...cell, textAlign: "right" };

const CompliancePanel: FC<Props> = ({
  compliance,
  runStartS,
  selectedOrderId,
  onSelectOrder,
  onSeek,
  expanded,
  onToggleExpanded,
}) => {
  const summary = useMemo(() => summariseCompliance(compliance), [compliance]);

  // Most-interesting first. Everything arriving late means arrival order says
  // very little, whereas "this one never moved" and "this one was never
  // published" are the rows worth reading, so they sort to the top.
  const ordered = useMemo(() => {
    const rank: Record<OrderCompliance["status"], number> = {
      NEVER_MOVED: 0,
      OFF_ROUTE: 1,
      NOT_OBSERVED: 2,
      EN_ROUTE_AT_END: 3,
      ACHIEVED_LATE: 4,
      ACHIEVED_ON_TIME: 5,
      NO_PLANNED_ROUTE: 6,
    };
    return [...compliance.orders].sort((a, b) => {
      // Within a status, a unit that abandoned its objective is more
      // interesting than one that held it.
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      if (a.withdrewAfterArrival !== b.withdrewAfterArrival) {
        return a.withdrewAfterArrival ? -1 : 1;
      }
      return (b.deltaPhaseHours ?? 0) - (a.deltaPhaseHours ?? 0);
    });
  }, [compliance.orders]);

  const selected = useMemo(
    () => compliance.orders.find((order) => order.orderId === selectedOrderId) ?? null,
    [compliance.orders, selectedOrderId],
  );

  return (
    <div
      style={{
        background: UI.bg1,
        borderTop: `1px solid ${UI.border}`,
        fontFamily: UI.fontSans,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        maxHeight: expanded ? "42vh" : undefined,
      }}
    >
      {/* ── Summary strip, always visible ── */}
      <button
        onClick={onToggleExpanded}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "transparent",
          border: "none",
          borderBottom: expanded ? `1px solid ${UI.border}` : "none",
          color: UI.text,
          cursor: "pointer",
          padding: "7px 14px",
          textAlign: "left",
          width: "100%",
        }}
      >
        <span
          style={{
            fontFamily: UI.fontSans,
            fontSize: 10,
            color: UI.accent,
            letterSpacing: 1,
            fontWeight: 700,
          }}
        >
          {expanded ? "▾" : "▸"} PLAN VS EXECUTION
        </span>

        <span style={{ fontFamily: UI.fontSans, fontSize: 10, color: UI.textDim }}>
          {compliance.phaseName} · {summary.total} orders · planned across{" "}
          {compliance.phaseDurationHours} h
        </span>

        <span style={{ flex: 1 }} />

        {/* The headline: the distribution, not a row-by-row verdict. */}
        {summary.lateCount > 0 && summary.medianLatePhaseHours != null && (
          <span style={{ fontFamily: UI.fontSans, fontSize: 10, color: UI.amber }}>
            {summary.lateCount}/{summary.arrived} arrivals late · median{" "}
            {hours(summary.medianLatePhaseHours)} h
          </span>
        )}
        {summary.withdrewCount > 0 && (
          <span style={{ fontFamily: UI.fontSans, fontSize: 10, color: UI.amber }}>
            {summary.withdrewCount} did not hold
          </span>
        )}
        {summary.byStatus.NOT_OBSERVED > 0 && (
          <span style={{ fontFamily: UI.fontSans, fontSize: 10, color: UI.textDim }}>
            {summary.byStatus.NOT_OBSERVED} never published
          </span>
        )}
        {summary.conflictedUnitCount > 0 && (
          <span style={{ fontFamily: UI.fontSans, fontSize: 10, color: UI.red }}>
            {summary.conflictedUnitCount} unit
            {summary.conflictedUnitCount === 1 ? "" : "s"} with conflicting orders
          </span>
        )}
      </button>

      {expanded && (
        <>
          {selected && (
            <div
              style={{
                padding: "7px 14px",
                borderBottom: `1px solid ${UI.border}`,
                background: UI.bg2,
                fontFamily: UI.fontSans,
                fontSize: 11,
                color: UI.text,
                lineHeight: 1.5,
              }}
            >
              {describeCompliance(selected)}
              {selected.conflictingOrderIds.length > 0 && (
                <div style={{ color: UI.red, marginTop: 3 }}>
                  This unit also holds {selected.conflictingOrderIds.length} other order
                  {selected.conflictingOrderIds.length === 1 ? "" : "s"} in the same phase.
                </div>
              )}
              {selected.predictedEndDistanceKm != null && (
                <div style={{ color: UI.textDim, marginTop: 3 }}>
                  Finished {km(selected.predictedEndDistanceKm)} km from where the plan
                  predicted it would end up.
                </div>
              )}
            </div>
          )}

          <div style={{ overflowY: "auto", flex: 1 }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontFamily: UI.fontSans,
                fontSize: 10,
              }}
            >
              <thead>
                <tr style={{ color: UI.textFaint, letterSpacing: 1 }}>
                  {HEADERS.map((header, index) => (
                    <th
                      key={header || `spacer-${index}`}
                      style={{
                        ...(index >= 3 && index <= 7 ? numericCell : cell),
                        position: "sticky",
                        top: 0,
                        background: UI.bg1,
                        fontWeight: 400,
                        borderBottom: `1px solid ${UI.border}`,
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordered.map((order) => {
                  const isSelected = order.orderId === selectedOrderId;
                  const tone = TONE_COLOUR[statusTone(order.status)];
                  return (
                    <tr
                      key={order.orderId}
                      onClick={() => {
                        onSelectOrder(isSelected ? null : order.orderId);
                        // Jump to the moment the row is about: where it got
                        // there, or failing that where it strayed furthest.
                        const seekAt = order.actualArrivalSec ?? order.maxCrossTrackAtSec;
                        if (!isSelected && seekAt != null) onSeek(runStartS + seekAt);
                      }}
                      style={{
                        background: isSelected ? UI.bg2 : "transparent",
                        cursor: "pointer",
                        color: isSelected ? UI.text : UI.textDim,
                      }}
                    >
                      <td style={{ ...cell, borderLeft: `3px solid ${tone}` }}>
                        {order.unitLabel}
                        {order.conflictingOrderIds.length > 0 && (
                          <span style={{ color: UI.red }} title="This unit holds more than one order">
                            {" "}
                            ⚠
                          </span>
                        )}
                      </td>
                      <td style={cell}>{order.taskLabel}</td>
                      <td style={{ ...cell, color: tone }}>
                        {STATUS_LABEL[order.status]}
                        {order.withdrewAfterArrival && (
                          <span style={{ color: UI.amber }} title="Reached the objective, then left it">
                            {" "}
                            ↩
                          </span>
                        )}
                      </td>
                      <td style={numericCell}>{hours(order.plannedDurationHours)} h</td>
                      <td style={numericCell}>
                        {order.actualArrivalPhaseHours != null
                          ? `${hours(order.actualArrivalPhaseHours)} h`
                          : "—"}
                      </td>
                      <td
                        style={{
                          ...numericCell,
                          color:
                            order.deltaPhaseHours != null && order.deltaPhaseHours > 0
                              ? UI.amber
                              : undefined,
                        }}
                      >
                        {order.deltaPhaseHours != null
                          ? `${order.deltaPhaseHours > 0 ? "+" : ""}${hours(order.deltaPhaseHours)} h`
                          : "—"}
                      </td>
                      <td style={numericCell} title="Furthest along the axis / where it ended up">
                        {order.status === "NOT_OBSERVED" || order.status === "NO_PLANNED_ROUTE"
                          ? "—"
                          : `${order.maxProgressPct.toFixed(0)}% / ${order.finalProgressPct.toFixed(0)}%`}
                      </td>
                      <td style={numericCell}>
                        {order.status === "NOT_OBSERVED" || order.status === "NO_PLANNED_ROUTE"
                          ? "—"
                          : `${km(order.maxCrossTrackKm)} km`}
                      </td>
                      <td style={cell} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div
            style={{
              padding: "5px 14px",
              borderTop: `1px solid ${UI.border}`,
              fontFamily: UI.fontSans,
              fontSize: 9,
              color: UI.textFaint,
              lineHeight: 1.5,
            }}
          >
            Timings are fractions of the {compliance.phaseDurationHours} h phase, not wall
            clock — the replay compresses the phase, so only the proportions compare.
            PLANNED is the planner&apos;s own distance-over-rate estimate. The plan predicts
            positions only, so nothing here is a claim about losses: this feed publishes no
            attrition.
          </div>
        </>
      )}
    </div>
  );
};

export default CompliancePanel;
