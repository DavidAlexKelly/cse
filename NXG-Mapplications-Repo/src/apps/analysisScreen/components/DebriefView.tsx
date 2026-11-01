// ── analysisScreen/components/DebriefView.tsx ──────────────────────────────
// The run, read rather than watched.
//
// The map answers "where was everything at 14:07". This answers "what happened,
// and what should I go and look at" — a written debrief, the numbers behind it,
// and the events it is drawn from, each of which jumps the replay to its moment.
//
// Two things it is careful about, because a debrief is the easiest place in the
// product to imply more certainty than exists:
//   · the write-up is composed locally from the run data, and says so;
//   · every statistic is labelled with where it came from, because measured
//     movement and scripted attrition are not the same kind of fact.

import { type FC, useMemo, useState } from "react";
import type { RunEvent, RunEventKind } from "@/shared/hla/runEvents";
import type { Debrief } from "../lib/debriefNarrative";
import type { RunStatistics } from "../lib/runStatistics";
import { formatClock, UI } from "./ui";

interface Props {
  debrief: Debrief;
  statistics: RunStatistics;
  events: RunEvent[];
  runDurationSec: number;
  /** Jump the replay to a moment and show the map. Epoch seconds. */
  onJumpToMoment: (ts: number) => void;
}

const KIND_STYLE: Record<RunEventKind, { colour: string; label: string }> = {
  detection: { colour: UI.accent, label: "DETECTION" },
  engagement: { colour: UI.amber, label: "ENGAGEMENT" },
  loss: { colour: UI.red, label: "LOSS" },
  objective: { colour: UI.green, label: "OBJECTIVE" },
  ew: { colour: "#a78bfa", label: "EW" },
  command: { colour: UI.textDim, label: "COMMAND" },
  phase: { colour: UI.textDim, label: "PHASE" },
};

function elapsed(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `T+${m}:${String(s).padStart(2, "0")}`;
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div
      style={{
        background: UI.bg1,
        border: `1px solid ${UI.border}`,
        padding: "8px 10px",
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: UI.fontMono,
          fontSize: 9,
          color: UI.textFaint,
          letterSpacing: 1,
          marginBottom: 4,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
      <div style={{ fontFamily: UI.fontMono, fontSize: 17, color: tone ?? UI.text }}>{value}</div>
      {hint && (
        <div style={{ fontFamily: UI.fontMono, fontSize: 9, color: UI.textDim, marginTop: 3 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function SectionHeading({ children, note }: { children: string; note?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "18px 0 8px" }}>
      <div
        style={{
          fontFamily: UI.fontMono,
          fontSize: 10,
          color: UI.accent,
          letterSpacing: 1.5,
          fontWeight: 700,
        }}
      >
        {children.toUpperCase()}
      </div>
      {note && (
        <div style={{ fontFamily: UI.fontMono, fontSize: 9, color: UI.textFaint }}>{note}</div>
      )}
    </div>
  );
}

const DebriefView: FC<Props> = ({
  debrief,
  statistics,
  events,
  runDurationSec,
  onJumpToMoment,
}) => {
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const [blue, red] = statistics.movement;
  const attrition = statistics.attrition;
  const plan = statistics.plan;

  const ordered = useMemo(() => [...events].sort((a, b) => a.tSec - b.tSec), [events]);

  // Scripted attrition must not be shown in the same voice as measured
  // movement. One badge on the section is clearer than a caveat per number.
  const scripted = attrition?.provenance === "scripted";

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        background: UI.bg0,
        padding: "0 0 40px",
        fontFamily: UI.fontSans,
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 24px" }}>
        {/* ── Headline and provenance ── */}
        <div
          style={{
            border: `1px solid ${UI.border}`,
            borderLeft: `3px solid ${UI.accent}`,
            background: UI.bg1,
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontFamily: UI.fontMono,
                fontSize: 9,
                letterSpacing: 1,
                color: UI.amber,
                border: `1px solid ${UI.amber}66`,
                background: `${UI.amber}18`,
                padding: "2px 6px",
              }}
            >
              SYNTHETIC WRITE-UP
            </span>
            <span style={{ fontFamily: UI.fontMono, fontSize: 9, color: UI.textDim }}>
              {debrief.source === "local-template"
                ? "composed in the browser from this run's data — not a language model"
                : debrief.source}
            </span>
          </div>

          <div style={{ fontSize: 16, color: UI.text, lineHeight: 1.5 }}>{debrief.headline}</div>
        </div>

        {/* ── Findings ── */}
        {debrief.findings.length > 0 && (
          <>
            <SectionHeading note="the rows worth opening the replay for">
              Worth a look
            </SectionHeading>
            <ul style={{ margin: 0, paddingLeft: 18, color: UI.textDim }}>
              {debrief.findings.map((finding) => (
                <li
                  key={finding}
                  style={{ fontSize: 12, lineHeight: 1.65, marginBottom: 6, color: UI.text }}
                >
                  {finding}
                </li>
              ))}
            </ul>
          </>
        )}

        {/* ── Key statistics ── */}
        <SectionHeading note="measured from the track">Manoeuvre</SectionHeading>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 8,
          }}
        >
          <Stat
            label="RUN LENGTH"
            value={`${Math.round(runDurationSec / 60)} min`}
            hint={`${statistics.eventCounts.engagement + statistics.eventCounts.loss} contacts logged`}
          />
          <Stat
            label="BLUE GROUND COVERED"
            value={`${Math.round(blue?.totalDistanceKm ?? 0)} km`}
            hint={`${blue?.unitCount ?? 0} units · ${blue?.staticUnits ?? 0} static`}
            tone="#80C0FF"
          />
          <Stat
            label="RED GROUND COVERED"
            value={`${Math.round(red?.totalDistanceKm ?? 0)} km`}
            hint={`${red?.unitCount ?? 0} units · ${red?.staticUnits ?? 0} static`}
            tone="#FF8080"
          />
          <Stat
            label="FURTHEST ADVANCE"
            value={`${(red?.furthestAdvanceKm ?? 0) > (blue?.furthestAdvanceKm ?? 0) ? Math.round(red?.furthestAdvanceKm ?? 0) : Math.round(blue?.furthestAdvanceKm ?? 0)} km`}
            hint={
              (red?.furthestAdvanceKm ?? 0) > (blue?.furthestAdvanceKm ?? 0)
                ? (red?.furthestAdvanceUnit ?? "—")
                : (blue?.furthestAdvanceUnit ?? "—")
            }
          />
          <Stat
            label="CLOSEST APPROACH"
            value={
              statistics.contact.closestApproachKm != null
                ? `${statistics.contact.closestApproachKm.toFixed(1)} km`
                : "—"
            }
            hint={statistics.contact.closestApproachPair?.join(" / ") ?? "no opposing contact"}
          />
          <Stat
            label="TIME IN CONTACT"
            value={`${Math.round(statistics.contact.secondsInContact / 60)} min`}
            hint={
              statistics.contact.firstContactSec != null
                ? `first at ${elapsed(statistics.contact.firstContactSec)}`
                : "never within range"
            }
          />
        </div>

        {/* ── Attrition ── */}
        {attrition && (
          <>
            <SectionHeading
              note={
                scripted
                  ? "scripted scenario content — this feed publishes no attrition"
                  : "measured"
              }
            >
              Attrition
            </SectionHeading>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 8,
              }}
            >
              <Stat
                label="BLUE LOSSES"
                value={String(attrition.blueLosses)}
                hint="platforms"
                tone="#80C0FF"
              />
              <Stat
                label="RED LOSSES"
                value={String(attrition.redLosses)}
                hint="platforms"
                tone="#FF8080"
              />
              <Stat
                label="EXCHANGE RATIO"
                value={
                  attrition.exchangeRatio != null ? `${attrition.exchangeRatio.toFixed(1)} : 1` : "—"
                }
                hint="adversary lost per friendly lost"
              />
              <Stat
                label="ENGAGEMENTS"
                value={String(attrition.engagements)}
                hint={
                  attrition.firstEngagementSec != null
                    ? `first at ${elapsed(attrition.firstEngagementSec)}`
                    : "none"
                }
              />
            </div>
          </>
        )}

        {/* ── Plan ── */}
        {plan && (
          <>
            <SectionHeading note="measured against the phase plan">Plan execution</SectionHeading>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 8,
              }}
            >
              <Stat
                label="ORDERS"
                value={String(plan.totalOrders)}
                hint={`${plan.measurable} measurable`}
              />
              <Stat
                label="OBJECTIVES REACHED"
                value={`${plan.arrived}/${plan.measurable}`}
                hint={plan.late > 0 ? `${plan.late} of them late` : "none late"}
              />
              <Stat
                label="MEDIAN LATENESS"
                value={
                  plan.medianLatePhaseHours != null
                    ? `${plan.medianLatePhaseHours.toFixed(1)} h`
                    : "—"
                }
                hint="of phase time"
                tone={plan.medianLatePhaseHours != null ? UI.amber : undefined}
              />
              <Stat
                label="NOT HELD"
                value={String(plan.withdrew)}
                hint="reached, then left"
                tone={plan.withdrew > 0 ? UI.amber : undefined}
              />
              <Stat
                label="NEVER PUBLISHED"
                value={String(plan.notObserved)}
                hint="orders with no unit"
                tone={plan.notObserved > 0 ? UI.textDim : undefined}
              />
              <Stat
                label="CONFLICTING ORDERS"
                value={String(plan.conflictedUnits)}
                hint="units holding more than one"
                tone={plan.conflictedUnits > 0 ? UI.red : undefined}
              />
            </div>
          </>
        )}

        {/* ── The written debrief ── */}
        {debrief.sections.map((section) => (
          <div key={section.heading}>
            <SectionHeading>{section.heading}</SectionHeading>
            {section.paragraphs.map((paragraph, index) => (
              <p
                key={index}
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.7,
                  color: UI.text,
                  margin: "0 0 10px",
                }}
              >
                {paragraph}
              </p>
            ))}
          </div>
        ))}

        {/* ── Event log ── */}
        <SectionHeading note={scripted ? "scripted scenario content" : "derived from the run"}>
          Key events
        </SectionHeading>
        <div style={{ border: `1px solid ${UI.border}` }}>
          {ordered.map((event, index) => {
            const style = KIND_STYLE[event.kind];
            const isOpen = expandedEventId === event.id;
            return (
              <div
                key={event.id}
                style={{
                  borderTop: index === 0 ? "none" : `1px solid ${UI.border}`,
                  background: isOpen ? UI.bg1 : "transparent",
                }}
              >
                <button
                  onClick={() => setExpandedEventId(isOpen ? null : event.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    borderLeft: `3px solid ${style.colour}`,
                    color: UI.text,
                    cursor: "pointer",
                    padding: "7px 10px",
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      fontFamily: UI.fontMono,
                      fontSize: 10,
                      color: UI.textDim,
                      minWidth: 52,
                    }}
                  >
                    {elapsed(event.tSec)}
                  </span>
                  <span
                    style={{
                      fontFamily: UI.fontMono,
                      fontSize: 9,
                      color: style.colour,
                      letterSpacing: 1,
                      minWidth: 88,
                    }}
                  >
                    {style.label}
                  </span>
                  <span style={{ fontSize: 12, flex: 1 }}>{event.label}</span>
                  {event.losses && (event.losses.blue > 0 || event.losses.red > 0) && (
                    <span style={{ fontFamily: UI.fontMono, fontSize: 10 }}>
                      <span style={{ color: "#80C0FF" }}>−{event.losses.blue}</span>
                      <span style={{ color: UI.textFaint }}> / </span>
                      <span style={{ color: "#FF8080" }}>−{event.losses.red}</span>
                    </span>
                  )}
                  <span style={{ fontFamily: UI.fontMono, fontSize: 10, color: UI.textFaint }}>
                    {isOpen ? "▾" : "▸"}
                  </span>
                </button>

                {isOpen && (
                  <div style={{ padding: "0 10px 12px 65px" }}>
                    <div
                      style={{
                        fontSize: 12,
                        lineHeight: 1.65,
                        color: UI.textDim,
                        marginBottom: 8,
                      }}
                    >
                      {event.detail}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 14,
                        fontFamily: UI.fontMono,
                        fontSize: 10,
                        color: UI.textDim,
                        marginBottom: 8,
                      }}
                    >
                      {event.actor && (
                        <span>
                          actor{" "}
                          <span style={{ color: UI.text }}>{event.actor.label}</span>
                        </span>
                      )}
                      {event.target && (
                        <span>
                          target{" "}
                          <span style={{ color: UI.text }}>{event.target.label}</span>
                        </span>
                      )}
                      {event.means && (
                        <span>
                          means <span style={{ color: UI.text }}>{event.means}</span>
                        </span>
                      )}
                      {event.location && (
                        <span>
                          at{" "}
                          <span style={{ color: UI.text }}>
                            {event.location.lat.toFixed(4)}, {event.location.lon.toFixed(4)}
                          </span>
                        </span>
                      )}
                      <span>
                        clock <span style={{ color: UI.text }}>{formatClock(event.ts)}</span>
                      </span>
                    </div>

                    <button
                      onClick={() => onJumpToMoment(event.ts)}
                      style={{
                        background: UI.bg2,
                        color: UI.accent,
                        border: `1px solid ${UI.accent}66`,
                        fontFamily: UI.fontMono,
                        fontSize: 10,
                        padding: "4px 9px",
                        cursor: "pointer",
                        letterSpacing: 0.5,
                      }}
                    >
                      ▸ SHOW ME ON THE MAP
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default DebriefView;
