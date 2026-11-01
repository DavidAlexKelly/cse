// analysisScreen/components/NextPhaseCard.tsx
//
// "Plan the next phase from this run" — the debrief's closing action.
// Creates a phase based on the one this run executed, starting where the
// units ACTUALLY ended (lib/nextPhase.ts, data/nextPhase.ts), then opens it in
// the Scenario Planner.
import { type FC, useEffect, useState } from "react";
import { UI, tint } from "./ui";

export interface NextPhaseState {
  status: "idle" | "working" | "done" | "error";
  step?: string;
  error?: string;
  result?: {
    phaseName: string;
    observed: number;
    notObserved: { label: string; from: "predicted" | "start" }[];
    orbatUnits: number;
  };
}

interface Props {
  sourcePhaseName: string;
  defaultName: string;
  /** Why it cannot be done right now, or null. */
  blockedReason: string | null;
  /** The run is synthetic — say so before writing a real phase from it. */
  demo: boolean;
  state: NextPhaseState;
  onCreate: (name: string) => void;
  onOpenPlanner: () => void;
}

const NextPhaseCard: FC<Props> = ({
  sourcePhaseName,
  defaultName,
  blockedReason,
  demo,
  state,
  onCreate,
  onOpenPlanner,
}) => {
  const [name, setName] = useState(defaultName);
  useEffect(() => setName(defaultName), [defaultName]);
  const working = state.status === "working";

  return (
    <div
      style={{
        marginTop: 22,
        border: `1px solid ${UI.border}`,
        borderLeft: `3px solid ${UI.green}`,
        background: UI.bg1,
        borderRadius: UI.radiusCard,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          fontFamily: UI.fontSans,
          fontSize: 10,
          color: UI.green,
          letterSpacing: 1.5,
          fontWeight: 700,
        }}
      >
        NEXT PHASE
      </div>
      <div style={{ fontSize: 13, color: UI.text, margin: "6px 0 10px", lineHeight: 1.5 }}>
        Plan the next phase from where the force <b>actually</b> ended {sourcePhaseName} — not where
        the plan predicted. Each unit starts at its last observed position, its ORBAT comes with it,
        and the new phase opens in the Scenario Planner ready for orders.
        {demo && (
          <span style={{ color: UI.amber }}>
            {" "}
            This is the demo run: the positions are synthetic, but the phase is written to the
            ontology.
          </span>
        )}
      </div>

      {state.status !== "done" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={working || !!blockedReason}
            aria-label="New phase name"
            style={{
              minWidth: 260,
              background: UI.bg2,
              color: UI.text,
              border: `1px solid ${UI.border}`,
              fontSize: 12,
              padding: "5px 8px",
            }}
          />
          <button
            type="button"
            onClick={() => onCreate(name.trim() || defaultName)}
            disabled={working || !!blockedReason}
            title={blockedReason ?? undefined}
            style={{
              background: blockedReason ? UI.bg2 : tint(UI.green, 13),
              color: blockedReason ? UI.textFaint : UI.green,
              border: `1px solid ${blockedReason ? UI.border : UI.green}`,
              fontFamily: UI.fontSans,
              fontSize: 11,
              padding: "6px 12px",
              cursor: working || blockedReason ? "default" : "pointer",
              letterSpacing: 0.5,
            }}
          >
            {working ? (state.step ?? "WORKING…") : "PLAN NEXT PHASE FROM ACTUALS"}
          </button>
          {blockedReason && (
            <span style={{ fontSize: 11, color: UI.textDim }}>{blockedReason}</span>
          )}
        </div>
      )}

      {state.status === "error" && (
        <div style={{ marginTop: 8, fontSize: 12, color: UI.red }}>
          Could not create the phase: {state.error}
        </div>
      )}

      {state.status === "done" && state.result && (
        <div style={{ fontSize: 12, color: UI.text, lineHeight: 1.6 }}>
          <div>
            Created <b>{state.result.phaseName}</b>: {state.result.observed} unit
            {state.result.observed === 1 ? "" : "s"} at their observed end positions
            {state.result.orbatUnits > 0
              ? `, ${state.result.orbatUnits} ORBAT units carried across`
              : ""}
            .
          </div>
          {state.result.notObserved.length > 0 && (
            <div style={{ color: UI.amber }}>
              Not seen in the run, so placed from the plan:{" "}
              {state.result.notObserved
                .map(
                  (u) =>
                    `${u.label} (${u.from === "predicted" ? "predicted end" : "start position"})`,
                )
                .join(", ")}
              .
            </div>
          )}
          <button
            type="button"
            onClick={onOpenPlanner}
            style={{
              marginTop: 8,
              background: tint(UI.green, 13),
              color: UI.green,
              border: `1px solid ${UI.green}`,
              fontFamily: UI.fontSans,
              fontSize: 11,
              padding: "6px 12px",
              cursor: "pointer",
            }}
          >
            OPEN IN SCENARIO PLANNER →
          </button>
        </div>
      )}
    </div>
  );
};

export default NextPhaseCard;
