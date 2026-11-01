import React, { useCallback, useState } from "react";
import type { TaskPageContent, ContentSection, Comment } from "./pageContent.js";
import type { TaskNodeData } from "./data.js";
import { ExerciseAreaMap } from "./ExerciseAreaMap.js";
import { OrbatTree } from "./OrbatTree.js";
import { UserSearch } from "./UserSearch.js";

// ── Colour helpers ──────────────────────────────────────────────────────
const TAG_COLORS: Record<string, { bg: string; border: string; color: string }> = {
  INTEL:      { bg: "rgba(76, 126, 243,0.2)",  border: "rgba(76, 126, 243,0.4)",  color: "#63a2ff" },
  CYBER:      { bg: "rgba(239, 77, 77,0.2)",   border: "rgba(239, 77, 77,0.4)",   color: "#d06050" },
  CIMIC:      { bg: "rgba(240, 168, 60,0.2)",  border: "rgba(240, 168, 60,0.4)",  color: "#f0a83c" },
  METOC:      { bg: "rgba(106, 114, 146,0.2)",   border: "rgba(106, 114, 146,0.4)",   color: "#98a1c0" },
  POLMIL:     { bg: "rgba(130,80,160,0.2)",  border: "rgba(130,80,160,0.4)",  color: "#c47af5" },
  LOG:        { bg: "rgba(240, 168, 60,0.2)",  border: "rgba(240, 168, 60,0.4)",  color: "#f0a83c" },
  "INFO OPS": { bg: "rgba(239, 77, 77,0.2)",   border: "rgba(239, 77, 77,0.4)",   color: "#d06050" },
};

const STATUS_DOT: Record<string, string> = {
  Complete:   "#24b47e",
  "In review": "#f0a83c",
  Empty:      "#454c68",
  Confirmed:  "#24b47e",
  Connected:  "#24b47e",
  Pending:    "#98a1c0",
  "In test":  "#f0a83c",
  "Not started": "#454c68",
  High:       "#ef4d4d",
  Medium:     "#f0a83c",
  Low:        "#98a1c0",
};

// ── Status workflow ─────────────────────────────────────────────────────
const STATUS_TRANSITIONS: Record<TaskNodeData["status"], { next: TaskNodeData["status"]; label: string }[]> = {
  pending:     [{ next: "in-review", label: "Submit for review" }],
  save:        [{ next: "in-review", label: "Submit for review" }],
  "in-review": [{ next: "approved", label: "Approve" }, { next: "pending", label: "Request changes" }],
  approved:    [{ next: "in-review", label: "Reopen for review" }],
};

const STATUS_LABELS: Record<TaskNodeData["status"], { label: string; color: string }> = {
  pending:     { label: "Pending", color: "#98a1c0" },
  save:        { label: "Draft", color: "#4c7ef3" },
  "in-review": { label: "In Review", color: "#f0a83c" },
  approved:    { label: "Approved", color: "#24b47e" },
};

// ── Sub-components ──────────────────────────────────────────────────────

const Badge: React.FC<{ text: string }> = ({ text }) => (
  <span
    style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 2,
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      background: "rgba(108, 92, 231,0.15)",
      border: "1px solid rgba(108, 92, 231,0.3)",
      color: "#8b7cf6",
      marginRight: 4,
      marginBottom: 4,
    }}
  >
    {text}
  </span>
);

const AiBadge: React.FC = () => (
  <span
    style={{
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: "#c47af5",
      marginLeft: 8,
    }}
  >
    ✦ AI generated
  </span>
);

const SectionHeading: React.FC<{ title: string; generated?: boolean; subtitle?: string }> = ({
  title,
  generated,
  subtitle,
}) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ display: "flex", alignItems: "center" }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#98a1c0",
        }}
      >
        {title}
      </span>
      {generated && <AiBadge />}
    </div>
    {subtitle && (
      <div style={{ fontSize: 14, fontWeight: 700, color: "#e6eaf8", marginTop: 4 }}>
        {subtitle}
      </div>
    )}
  </div>
);

// ── Section renderers ───────────────────────────────────────────────────

const TextSection: React.FC<{ section: ContentSection }> = ({ section }) => (
  <div style={{ padding: "12px 0", borderBottom: "1px solid #232a45" }}>
    <SectionHeading title={section.title ?? ""} generated={section.generated} subtitle={section.subtitle} />
    {section.body && (
      <p style={{ fontSize: 12, color: "#98a1c0", lineHeight: 1.7, margin: "6px 0 8px" }}>
        {section.body}
      </p>
    )}
    {section.badges && section.badges.length > 0 && (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 0 }}>
        {section.badges.map((b) => (
          <Badge key={b} text={b} />
        ))}
      </div>
    )}
  </div>
);

const HeroSection: React.FC<{ section: ContentSection }> = ({ section }) => (
  <div
    style={{
      padding: 14,
      background: "#1a1f36",
      border: "1px solid #2f3860",
      borderRadius: 3,
      marginBottom: 12,
    }}
  >
    <SectionHeading title={section.title ?? ""} generated={section.generated} subtitle={section.subtitle} />
    {section.body && (
      <p style={{ fontSize: 12, color: "#98a1c0", lineHeight: 1.7, margin: "6px 0 8px" }}>
        {section.body}
      </p>
    )}
    {section.badges && section.badges.length > 0 && (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 0 }}>
        {section.badges.map((b) => (
          <Badge key={b} text={b} />
        ))}
      </div>
    )}
  </div>
);

const TableSection: React.FC<{ section: ContentSection }> = ({ section }) => (
  <div style={{ padding: "12px 0", borderBottom: "1px solid #232a45" }}>
    <SectionHeading title={section.title ?? ""} generated={section.generated} />
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 11,
          marginTop: 6,
        }}
      >
        <thead>
          <tr>
            {section.columns?.map((col) => (
              <th
                key={col}
                style={{
                  textAlign: "left",
                  padding: "6px 8px",
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "#6a7292",
                  borderBottom: "1px solid #232a45",
                  whiteSpace: "nowrap",
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.rows?.map((row, ri) => (
            <tr
              key={ri}
              style={{
                borderBottom: "1px solid #1a1f36",
              }}
            >
              {row.cells.map((cell, ci) => {
                const dotColor = STATUS_DOT[cell];
                return (
                  <td
                    key={ci}
                    style={{
                      padding: "7px 8px",
                      color: ci === 0 ? "#e6eaf8" : "#98a1c0",
                      fontWeight: ci === 0 ? 600 : 400,
                      whiteSpace: ci === 0 ? "nowrap" : undefined,
                    }}
                  >
                    {dotColor ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: dotColor,
                            flexShrink: 0,
                          }}
                        />
                        {cell}
                      </span>
                    ) : (
                      cell
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const TimelineSection: React.FC<{ section: ContentSection }> = ({ section }) => (
  <div style={{ padding: "12px 0" }}>
    <SectionHeading title={section.title ?? ""} generated={section.generated} />
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {section.items?.map((item, i) => {
        const tagStyle = TAG_COLORS[item.tag] ?? TAG_COLORS.INTEL;
        return (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 12,
              padding: "10px 0",
              borderBottom: "1px solid #1a1f36",
            }}
          >
            <div
              style={{
                width: 48,
                flexShrink: 0,
                fontSize: 11,
                fontWeight: 700,
                color: "#6a7292",
                letterSpacing: "0.04em",
                paddingTop: 2,
              }}
            >
              {item.day}
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: "#e6eaf8" }}>
                  {item.title}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    padding: "1px 6px",
                    borderRadius: 2,
                    background: tagStyle.bg,
                    border: `1px solid ${tagStyle.border}`,
                    color: tagStyle.color,
                    flexShrink: 0,
                  }}
                >
                  {item.tag}
                </span>
              </div>
              <p style={{ fontSize: 11, color: "#98a1c0", lineHeight: 1.6, margin: 0 }}>
                {item.body}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

const PlaceholderSection: React.FC<{ section: ContentSection }> = ({ section }) => (
  <div
    style={{
      padding: 20,
      background: "#1a1f36",
      border: "1px dashed #2f3860",
      borderRadius: 3,
      textAlign: "center",
      marginBottom: 12,
    }}
  >
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6a7292", marginBottom: 6 }}>
      {section.title}
    </div>
    <div style={{ fontSize: 12, color: "#98a1c0" }}>{section.body}</div>
  </div>
);

const renderSection = (section: ContentSection, index: number) => {
  switch (section.type) {
    case "hero":
      return <HeroSection key={index} section={section} />;
    case "table":
      return <TableSection key={index} section={section} />;
    case "timeline":
      return <TimelineSection key={index} section={section} />;
    case "placeholder":
      return <PlaceholderSection key={index} section={section} />;
    case "text":
    case "badges":
    default:
      return <TextSection key={index} section={section} />;
  }
};

// ── Comments thread ─────────────────────────────────────────────────────

const AVATAR_COLORS: Record<string, string> = {
  AL: "#6c5ce7",
  MK: "#f0a83c",
  BG: "#4c7ef3",
  TW: "#ef4d4d",
  JR: "#98a1c0",
};

const CommentsThread: React.FC<{ comments: Comment[] }> = ({ comments }) => {
  if (comments.length === 0) return null;
  return (
    <div style={{ padding: "12px 0" }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#6a7292",
          marginBottom: 10,
        }}
      >
        Comments & review thread
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {comments.map((c, i) => (
          <div key={i} style={{ display: "flex", gap: 10 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: AVATAR_COLORS[c.initials] ?? "#2f3860",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                fontWeight: 700,
                color: "#fff",
                flexShrink: 0,
              }}
            >
              {c.initials}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#e6eaf8" }}>{c.name}</span>
                <span style={{ fontSize: 10, color: "#6a7292" }}>{c.time}</span>
              </div>
              <p style={{ fontSize: 12, color: "#98a1c0", lineHeight: 1.6, margin: 0 }}>{c.text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Main Panel ──────────────────────────────────────────────────────────

interface TaskDetailPanelProps {
  nodeId: string;
  content: TaskPageContent | null;
  nodeData: TaskNodeData | null;
  onClose: () => void;
  onDelete: (nodeId: string) => void;
  onStatusChange: (nodeId: string, status: TaskNodeData["status"]) => void;
  onToggleSubtask: (nodeId: string, subtaskId: string) => void;
}

export const TaskDetailPanel: React.FC<TaskDetailPanelProps> = ({
  nodeId,
  content,
  nodeData,
  onClose,
  onDelete,
  onStatusChange,
  onToggleSubtask,
}) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [assignee, setAssignee] = useState(nodeData?.assignee ?? "");
  const [reviewer, setReviewer] = useState(nodeData?.reviewer ?? "");

  const handleDelete = useCallback(() => {
    onDelete(nodeId);
  }, [onDelete, nodeId]);

  const currentStatus = nodeData?.status ?? "pending";
  const statusInfo = STATUS_LABELS[currentStatus];
  const transitions = STATUS_TRANSITIONS[currentStatus] ?? [];

  // Determine if this node should show the map or orbat
  const isExerciseArea = nodeId === "exercise-area";
  const isOrbat = nodeId === "orbat-positions";

  const title = content?.taskTitle ?? nodeData?.label ?? "Task Details";
  const assignment = content?.taskAssignment ?? nodeData?.description ?? "";

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 540,
        height: "100%",
        background: "#0e1120",
        borderLeft: "1px solid #232a45",
        display: "flex",
        flexDirection: "column",
        zIndex: 100,
        boxShadow: "-4px 0 24px rgba(0,0,0,0.5)",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* ── Panel Header ─────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          background: "#080a12",
          borderBottom: "1px solid #232a45",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#e6eaf8",
          }}
        >
          {title}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            style={{
              background: "transparent",
              border: "1px solid rgba(239, 77, 77,0.4)",
              borderRadius: 2,
              color: "#ef4d4d",
              cursor: "pointer",
              padding: "3px 8px",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontFamily: "inherit",
            }}
          >
            Delete
          </button>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid #2f3860",
              borderRadius: 2,
              color: "#98a1c0",
              cursor: "pointer",
              padding: "3px 8px",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontFamily: "inherit",
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* ── Status + Workflow bar ──────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          background: "#141828",
          borderBottom: "1px solid #232a45",
          flexShrink: 0,
        }}
      >
        {/* Current status */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: statusInfo.color,
            }}
          />
          <span style={{ fontSize: 11, fontWeight: 700, color: statusInfo.color, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {statusInfo.label}
          </span>
        </div>

        {/* Transition buttons */}
        <div style={{ display: "flex", gap: 6 }}>
          {transitions.map((t) => (
            <button
              key={t.next}
              onClick={() => onStatusChange(nodeId, t.next)}
              style={{
                padding: "3px 10px",
                borderRadius: 2,
                border: t.next === "approved" ? "1px solid #6c5ce7" : "1px solid #2f3860",
                background: t.next === "approved" ? "#6c5ce7" : "transparent",
                color: t.next === "approved" ? "#fff" : "#e6eaf8",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Assignment bar ────────────────────────────────────── */}
      <div
        style={{
          padding: "8px 16px",
          background: "#141828",
          borderBottom: "1px solid #232a45",
          fontSize: 11,
          color: "#98a1c0",
          lineHeight: 1.5,
          flexShrink: 0,
        }}
      >
        {assignment}
      </div>

      {/* ── Scrollable body ───────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 16px 16px",
        }}
      >
        {/* User assignment section */}
        <div style={{ padding: "0 0 12px", borderBottom: "1px solid #232a45", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <UserSearch label="Assignee" selectedUser={assignee} onSelect={setAssignee} />
            </div>
            <div style={{ flex: 1 }}>
              <UserSearch label="Reviewer" selectedUser={reviewer} onSelect={setReviewer} />
            </div>
          </div>
        </div>

        {/* Subtasks checklist */}
        {nodeData?.subtasks && nodeData.subtasks.length > 0 && (
          <div style={{ padding: "0 0 12px", borderBottom: "1px solid #232a45", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#98a1c0" }}>
                Subtasks — {nodeData.subtasks.filter((s) => s.done).length}/{nodeData.subtasks.length} complete
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#e6eaf8" }}>
                {Math.round(nodeData.progress * 100)}%
              </span>
            </div>
            {/* Progress bar */}
            <div style={{ height: 6, background: "#232a45", borderRadius: 3, overflow: "hidden", marginBottom: 10 }}>
              <div
                style={{
                  width: `${Math.round(nodeData.progress * 100)}%`,
                  height: "100%",
                  background: nodeData.progress === 1 ? "#24b47e" : "#6c5ce7",
                  borderRadius: 3,
                  transition: "width 0.3s ease",
                }}
              />
            </div>
            {/* Subtask items */}
            {nodeData.subtasks.map((st) => {
              const isBlocked = st.blocked && !st.done;
              return (
                <div
                  key={st.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => !isBlocked && onToggleSubtask(nodeId, st.id)}
                  onKeyDown={(e) => !isBlocked && (e.key === "Enter" || e.key === " ") && onToggleSubtask(nodeId, st.id)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    padding: "6px 8px",
                    marginBottom: 2,
                    borderRadius: 2,
                    cursor: isBlocked ? "not-allowed" : "pointer",
                    background: st.done ? "rgba(36, 180, 126,0.06)" : "transparent",
                    border: "1px solid transparent",
                    transition: "background 0.1s",
                  }}
                >
                  {/* Checkbox */}
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 2,
                      border: st.done
                        ? "1.5px solid #24b47e"
                        : isBlocked
                          ? "1.5px solid #f0a83c"
                          : "1.5px solid #2f3860",
                      background: st.done ? "rgba(36, 180, 126,0.2)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  >
                    {st.done && (
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="#24b47e">
                        <path d="M6.5 12.5l-4-4 1.5-1.5 2.5 2.5 6-6 1.5 1.5z" />
                      </svg>
                    )}
                    {isBlocked && (
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="#f0a83c">
                        <circle cx="8" cy="8" r="3" />
                      </svg>
                    )}
                  </div>
                  {/* Label */}
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: st.done ? "#6a7292" : "#e6eaf8",
                        textDecoration: st.done ? "line-through" : "none",
                        lineHeight: 1.5,
                      }}
                    >
                      {st.label}
                    </div>
                    {isBlocked && (
                      <div style={{ fontSize: 10, color: "#f0a83c", marginTop: 2 }}>
                        ⊘ Blocked — waiting on upstream dependency
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Exercise area → render SVG map */}
        {isExerciseArea && (
          <div style={{ marginBottom: 12 }}>
            <ExerciseAreaMap />
          </div>
        )}

        {/* ORBAT → render ORBAT tree */}
        {isOrbat && (
          <div style={{ marginBottom: 12 }}>
            <OrbatTree />
          </div>
        )}

        {/* Content sections */}
        {content && (
          <>
            {content.sections.map(renderSection)}
            <CommentsThread comments={content.comments} />
          </>
        )}

        {/* Fallback for dynamically added nodes with no content */}
        {!content && nodeData && (
          <div style={{ padding: "24px 0", textAlign: "center" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6a7292", marginBottom: 8 }}>
              No detailed content yet
            </div>
            <div style={{ fontSize: 12, color: "#98a1c0" }}>
              This task node has been created but does not have content defined.
            </div>
          </div>
        )}
      </div>

      {/* ── Delete confirmation ───────────────────────────────── */}
      {showDeleteConfirm && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
          }}
          onClick={() => setShowDeleteConfirm(false)}
        >
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <div
            role="dialog"
            aria-modal="true"
            style={{
              background: "#141828",
              border: "1px solid #2f3860",
              borderRadius: 4,
              padding: 20,
              width: 320,
              textAlign: "center",
              boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && setShowDeleteConfirm(false)}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e6eaf8", marginBottom: 8 }}>
              Delete this node?
            </div>
            <div style={{ fontSize: 12, color: "#98a1c0", marginBottom: 16 }}>
              This will remove &quot;{nodeData?.label}&quot; and all its connections. This cannot be undone.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                style={{
                  padding: "5px 14px",
                  borderRadius: 2,
                  border: "1px solid #2f3860",
                  background: "#1a1f36",
                  color: "#e6eaf8",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                style={{
                  padding: "5px 14px",
                  borderRadius: 2,
                  border: "1px solid #ef4d4d",
                  background: "#ef4d4d",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
