// analysisScreen/components/TrainingObjectivesSection.tsx
//
// The debrief's first section: each training objective for the phase, the
// evidence the run offers for it, a suggested rating, and the analyst's call.
//
// The suggestion is labelled as one, and so is every link between an
// objective and an order — the ontology records no such link, so it is
// inferred (lib/objectiveAssessment.ts). The analyst's rating, when made,
// replaces the suggestion everywhere, including the copied summary.
import { type FC, useState } from "react";
import { STATUS_LABEL, statusTone } from "../lib/compliance";
import {
  type AnalystCall,
  type ObjectiveAssessment,
  type ObjectiveRating,
  RATING_LABEL,
  finalRating,
  objectivesAsText,
  summariseObjectives,
} from "../lib/objectiveAssessment";
import { UI } from "./ui";

const RATING_COLOUR: Record<ObjectiveRating, string> = {
  DEMONSTRATED: UI.green,
  PARTIALLY_DEMONSTRATED: UI.amber,
  NOT_DEMONSTRATED: UI.red,
  NOT_OBSERVED: UI.textDim,
  NEEDS_JUDGEMENT: UI.accent,
};

const TONE_COLOUR = { good: UI.green, warn: UI.amber, bad: UI.red, muted: UI.textDim } as const;

const RATINGS: ObjectiveRating[] = [
  "DEMONSTRATED",
  "PARTIALLY_DEMONSTRATED",
  "NOT_DEMONSTRATED",
  "NOT_OBSERVED",
  "NEEDS_JUDGEMENT",
];

interface Props {
  phaseName: string;
  assessments: ObjectiveAssessment[];
  /** Where the objectives came from — demo objectives are labelled as such. */
  source: "ontology" | "demo";
  calls: Record<string, AnalystCall>;
  onCall: (objectiveId: string, call: AnalystCall) => void;
  /** Where the analyst's calls are kept — shown so nobody assumes they are shared when they are not. */
  storage?: "loading" | "foundry" | "device";
  storageNote?: string | null;
}

function Badge({ colour, children }: { colour: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: UI.fontMono,
        fontSize: 9,
        letterSpacing: 1,
        color: colour,
        border: `1px solid ${colour}66`,
        background: `${colour}18`,
        padding: "2px 6px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

const TrainingObjectivesSection: FC<Props> = ({
  phaseName,
  assessments,
  source,
  calls,
  onCall,
  storage,
  storageNote,
}) => {
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(objectivesAsText(phaseName, assessments, calls));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — nothing to do */
    }
  };

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <div
          style={{
            fontFamily: UI.fontMono,
            fontSize: 10,
            color: UI.accent,
            letterSpacing: 1.5,
            fontWeight: 700,
          }}
        >
          TRAINING OBJECTIVES
        </div>
        <div style={{ fontFamily: UI.fontMono, fontSize: 9, color: UI.textFaint }}>
          suggested from the measured orders · the analyst&rsquo;s call stands
        </div>
        {source === "demo" && <Badge colour={UI.amber}>DEMO OBJECTIVES</Badge>}
        {storage === "foundry" && <Badge colour={UI.green}>SAVED TO FOUNDRY</Badge>}
        {storage === "device" && <Badge colour={UI.amber}>SAVED ON THIS DEVICE ONLY</Badge>}
        <div style={{ flex: 1 }} />
        {assessments.length > 0 && (
          <button
            type="button"
            onClick={() => void copy()}
            style={{
              background: UI.bg2,
              color: copied ? UI.green : UI.textDim,
              border: `1px solid ${UI.border}`,
              fontFamily: UI.fontMono,
              fontSize: 10,
              padding: "4px 9px",
              cursor: "pointer",
            }}
          >
            {copied ? "COPIED" : "COPY SUMMARY"}
          </button>
        )}
      </div>

      <div style={{ fontSize: 14, color: UI.text, marginBottom: 10 }}>
        {summariseObjectives(assessments, calls)}
      </div>
      {storageNote && (
        <div style={{ fontFamily: UI.fontMono, fontSize: 10, color: UI.amber, marginBottom: 8 }}>
          {storageNote}
        </div>
      )}

      {assessments.map((a) => {
        const call = calls[a.objectiveId];
        const rating = finalRating(a, call);
        const expanded = open === a.objectiveId;
        return (
          <div
            key={a.objectiveId}
            style={{
              border: `1px solid ${UI.border}`,
              borderLeft: `3px solid ${RATING_COLOUR[rating]}`,
              background: UI.bg1,
              marginBottom: 6,
            }}
          >
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : a.objectiveId)}
              aria-expanded={expanded}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                width: "100%",
                padding: "10px 12px",
                background: "none",
                border: "none",
                color: UI.text,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span
                style={{ fontFamily: UI.fontMono, fontSize: 11, color: UI.textDim, minWidth: 48 }}
              >
                {a.ref || "TO"}
              </span>
              <span style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>{a.objective}</span>
              {a.priority === "High" && <Badge colour={UI.red}>HIGH</Badge>}
              <Badge colour={RATING_COLOUR[rating]}>
                {RATING_LABEL[rating].toUpperCase()}
                {call?.rating ? " · ANALYST" : ""}
              </Badge>
              <span style={{ color: UI.textDim, fontSize: 11 }}>{expanded ? "▾" : "▸"}</span>
            </button>

            {expanded && (
              <div style={{ padding: "0 12px 12px 70px", fontSize: 12, color: UI.text }}>
                <div style={{ color: UI.textDim, marginBottom: 8 }}>
                  {a.functionalArea && <span>{a.functionalArea} · </span>}
                  Suggested:{" "}
                  <b style={{ color: RATING_COLOUR[a.suggested] }}>
                    {RATING_LABEL[a.suggested]}
                  </b> — {a.basis}
                </div>

                {a.orders.length > 0 && (
                  <>
                    <div
                      style={{
                        fontFamily: UI.fontMono,
                        fontSize: 9,
                        color: UI.textFaint,
                        margin: "6px 0 4px",
                      }}
                    >
                      ORDERS IN THE PLAN THAT EXERCISE IT (INFERRED)
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {a.orders.map((o) => (
                        <li key={o.orderId} style={{ marginBottom: 3 }}>
                          <span
                            style={{
                              color: TONE_COLOUR[statusTone(o.status)],
                              fontFamily: UI.fontMono,
                              fontSize: 10,
                            }}
                          >
                            {STATUS_LABEL[o.status]}
                          </span>{" "}
                          {o.unitLabel} — {o.taskLabel}{" "}
                          <span style={{ color: UI.textFaint, fontSize: 11 }}>({o.reason})</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {a.injects.length > 0 && (
                  <>
                    <div
                      style={{
                        fontFamily: UI.fontMono,
                        fontSize: 9,
                        color: UI.textFaint,
                        margin: "8px 0 4px",
                      }}
                    >
                      MEL / MIL INJECTS FOR THIS PHASE (INFERRED)
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {a.injects.map((i) => (
                        <li key={i.injectId} style={{ marginBottom: 3 }}>
                          <span
                            style={{ fontFamily: UI.fontMono, fontSize: 10, color: UI.textDim }}
                          >
                            {i.dayOffset}
                          </span>{" "}
                          {i.title}
                          {i.expectedResponse && (
                            <span style={{ color: UI.textDim }}>
                              {" "}
                              — expected: {i.expectedResponse}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    marginTop: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <label style={{ fontFamily: UI.fontMono, fontSize: 10, color: UI.textDim }}>
                    ANALYST RATING{" "}
                    <select
                      value={call?.rating ?? ""}
                      onChange={(e) =>
                        onCall(a.objectiveId, {
                          ...call,
                          rating: (e.target.value || undefined) as ObjectiveRating | undefined,
                        })
                      }
                      style={{
                        background: UI.bg2,
                        color: UI.text,
                        border: `1px solid ${UI.border}`,
                        fontSize: 11,
                        padding: "3px 6px",
                      }}
                    >
                      <option value="">Use suggestion</option>
                      {RATINGS.map((r) => (
                        <option key={r} value={r}>
                          {RATING_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    value={call?.note ?? ""}
                    placeholder="Observer note — what was seen, by whom"
                    onChange={(e) =>
                      onCall(a.objectiveId, { ...call, note: e.target.value || undefined })
                    }
                    style={{
                      flex: 1,
                      minWidth: 240,
                      background: UI.bg2,
                      color: UI.text,
                      border: `1px solid ${UI.border}`,
                      fontSize: 12,
                      padding: "4px 8px",
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default TrainingObjectivesSection;
