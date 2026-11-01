/* eslint-disable jsx-a11y/no-autofocus */
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { Icon, InputGroup } from "@blueprintjs/core";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFoundryWidgetContext } from "@osdk/widget.client-react";
import { NxgInject } from "@custom-widget/sdk";
import { client } from "../client.js";
import { useScenarioIdFromObjectSet } from "../shared/hooks/useScenarioIdFromParam.js";
import { useFirstObjectPropertyValue } from "../shared/hooks/useFirstObjectPropertyValue.js";
import { ScenarioGate } from "../shared/components/ScenarioGate.js";
import { useNxgPhases } from "../shared/hooks/useNxgPhases.js";
import { useNxgInjectMutations } from "../shared/hooks/useNxgInjectMutations.js";
import { MilButton } from "../shared/components/Button.js";
import { MilLabel } from "../shared/components/Label.js";
import {
  MilModal,
  MilFormRow,
  MilFormGroup,
  MilTextInput,
  MilTextArea,
  MilSelect,
  MilDateTimeInput,
} from "../shared/components/Modal.js";
import type MilMelConfig from "./milMel.config.js";
import "../shared/styling/index.css";

const useWidgetContext =
  useFoundryWidgetContext.withTypes<typeof MilMelConfig>();

type EventStatus = "open" | "under-review" | "closed";
type EventType = "Incident" | "Event";
type EventClass = "UNCLASSIFIED" | "RESTRICTED" | "CONFIDENTIAL";
type TaskStatus = "pending" | "in-progress" | "complete" | "cancelled";

interface MelTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignee: string;
  dueTime: string;
}

interface MelEvent {
  id: string;
  serial: string;
  title: string;
  description: string;
  type: EventType;
  classification: EventClass;
  status: EventStatus;
  startTime: string;
  endTime: string;
  tasks: MelTask[];
  phaseId?: string;
  /**
   * The inject's original category. `type` is a lossy view of this
   * (INTEL/CYBER read as "Incident", everything else as "Event"), so the
   * raw value is kept to avoid overwriting e.g. "LOG" with "OPS" when an
   * unrelated field is edited.
   */
  injectCategory?: string | null;
  /** True when this event is backed by an NxgInject and so can be saved. */
  isLive?: boolean;
}

const BASE_DATE = new Date("2026-01-01T00:00:00Z");

function dayOffsetToDateStr(dayOffset: string | null | undefined): string {
  if (!dayOffset) return BASE_DATE.toISOString().slice(0, 10);
  const match = dayOffset.match(/D[+-]?(\d+)/i);
  const n = match ? parseInt(match[1]!, 10) : 0;
  const sign = dayOffset.includes("-") ? -1 : 1;
  const d = new Date(BASE_DATE);
  d.setUTCDate(d.getUTCDate() + sign * n);
  return d.toISOString().slice(0, 10);
}

/** Inverse of dayOffsetToDateStr — turns a "YYYY-MM-DD" back into "D+n". */
function dateStrToDayOffset(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.round(
    (d.getTime() - BASE_DATE.getTime()) / 86_400_000,
  );
  return days < 0 ? `D-${Math.abs(days)}` : `D+${days}`;
}

function injectCategoryToType(category: string | null | undefined): EventType {
  if (category === "INTEL" || category === "CYBER") return "Incident";
  return "Event";
}

/**
 * Chooses the category to store for an event.
 *
 * `type` only distinguishes Incident from Event, so it cannot round-trip
 * the full category list. Keep the original category whenever it still
 * agrees with the chosen type, and only substitute a default when the
 * user has actually flipped the type across the boundary.
 */
function typeToInjectCategory(
  type: EventType,
  originalCategory: string | null | undefined,
): string {
  const originalType = injectCategoryToType(originalCategory);
  if (originalCategory && originalType === type) return originalCategory;
  return type === "Incident" ? "INTEL" : "OPS";
}

function injectToMelEvent(
  inject: Record<string, unknown>,
  index: number
): MelEvent {
  const injectId = String(inject["injectId"] ?? `inject-${index}`);
  const injectTitle = String(inject["injectTitle"] ?? "Untitled Inject");
  const injectBody = String(inject["injectBody"] ?? "");
  const injectCategory = inject["injectCategory"] as string | null | undefined;
  const dayOffset = inject["dayOffset"] as string | null | undefined;
  const phaseId = inject["phaseId"] as string | undefined;
  const eventType = injectCategoryToType(injectCategory);
  const dateStr = dayOffsetToDateStr(dayOffset);
  const serial = `${eventType === "Incident" ? "MIL" : "MEL"}-${String(
    index + 1
  ).padStart(3, "0")}`;
  return {
    id: injectId,
    serial,
    title: injectTitle,
    description: injectBody,
    type: eventType,
    classification: "UNCLASSIFIED",
    status: "open",
    startTime: `${dateStr}T09:00`,
    endTime: `${dateStr}T10:00`,
    tasks: [],
    phaseId,
    injectCategory: injectCategory ?? null,
    isLive: true,
  };
}

const genId = (): string => crypto.randomUUID();

const genSerial = (type: EventType, allEvents: MelEvent[]): string => {
  const prefix = type === "Incident" ? "MIL" : "MEL";
  const max = allEvents
    .filter((e) => e.type === type)
    .map((e) => {
      const parts = e.serial.split("-");
      const n =
        parts.length >= 2 ? parseInt(parts[parts.length - 1]!, 10) : NaN;
      return isNaN(n) ? 0 : n;
    })
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
};

const fmtTime = (iso: string) => {
  try {
    return (
      new Date(iso).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }) + "Z"
    );
  } catch {
    return iso;
  }
};

const fmtDateShort = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString([], {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return iso;
  }
};

const isoDateStr = (iso: string) => iso.slice(0, 10);

const STATUS_BADGE: Record<EventStatus, React.ReactNode> = {
  open: <MilLabel intent="red">Open</MilLabel>,
  "under-review": <MilLabel intent="amber">Under Review</MilLabel>,
  closed: <MilLabel intent="green">Closed</MilLabel>,
};

const CLASS_BADGE: Record<EventClass, React.ReactNode> = {
  CONFIDENTIAL: <MilLabel intent="red">CONF</MilLabel>,
  RESTRICTED: <MilLabel intent="amber">REST</MilLabel>,
  UNCLASSIFIED: <MilLabel intent="grey">UNCL</MilLabel>,
};

const TASK_STATUS_BADGE: Record<TaskStatus, React.ReactNode> = {
  pending: <MilLabel intent="grey">Pending</MilLabel>,
  "in-progress": <MilLabel intent="amber">In Progress</MilLabel>,
  complete: <MilLabel intent="green">Complete</MilLabel>,
  cancelled: <MilLabel intent="red">Cancelled</MilLabel>,
};

const EVENT_ACCENT_COLOR: Record<EventStatus, string> = {
  open: "#ef4d4d",
  "under-review": "#f0a83c",
  closed: "#6c5ce7",
};

const TASK_DOT_COLOR: Record<TaskStatus, string> = {
  complete: "#6c5ce7",
  "in-progress": "#f0a83c",
  cancelled: "#ef4d4d",
  pending: "#2f3860",
};

const EventDetailModal: React.FC<{
  event: MelEvent;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ event, onClose, onEdit, onDelete }) => {
  const accent = EVENT_ACCENT_COLOR[event.status];
  const taskDone = event.tasks.filter((t) => t.status === "complete").length;
  return (
    <MilModal
      title={`${event.serial} — Detail`}
      titleIcon={event.type === "Incident" ? "warning-sign" : "timeline-events"}
      size="md"
      onClose={onClose}
      actions={[
        { label: "Close", variant: "ghost", onClick: onClose },
        {
          label: "Edit Event",
          variant: "default",
          icon: "edit",
          onClick: () => {
            onClose();
            onEdit();
          },
        },
        {
          label: "Delete Event",
          variant: "danger",
          icon: "trash",
          onClick: () => {
            onClose();
            onDelete();
          },
        },
      ]}
    >
      <div className="detail-banner" style={{ borderColor: accent }}>
        <span className="detail-banner__class">{event.classification}</span>
        <div className="detail-banner__badges">
          {CLASS_BADGE[event.classification]}
          {STATUS_BADGE[event.status]}
          <span
            className="mil-badge"
            style={{
              background: `${accent}22`,
              color: accent,
              border: `1px solid ${accent}55`,
            }}
          >
            {event.type}
          </span>
        </div>
      </div>
      <div className="detail-title">{event.title}</div>
      <div className="detail-meta-row">
        <div className="detail-meta-item">
          <span className="detail-meta-item__label">Start DTG</span>
          <span className="detail-meta-item__value">
            {fmtTime(event.startTime)} · {fmtDateShort(event.startTime)}
          </span>
        </div>
        <div className="detail-meta-item">
          <span className="detail-meta-item__label">End DTG</span>
          <span className="detail-meta-item__value">
            {fmtTime(event.endTime)} · {fmtDateShort(event.endTime)}
          </span>
        </div>
        <div className="detail-meta-item">
          <span className="detail-meta-item__label">Serial</span>
          <span className="detail-meta-item__value detail-meta-item__value--mono">
            {event.serial}
          </span>
        </div>
      </div>
      {event.description ? (
        <div className="detail-section">
          <div className="detail-section__label">
            <Icon icon="paragraph" size={10} /> Narrative
          </div>
          <div className="detail-section__body detail-section__body--prose">
            {event.description}
          </div>
        </div>
      ) : (
        <div className="detail-section__empty">No narrative recorded.</div>
      )}
      <div className="detail-section">
        <div className="detail-section__label">
          <Icon icon="flows" size={10} /> Tasks ({taskDone}/{event.tasks.length}{" "}
          complete)
        </div>
        {event.tasks.length === 0 ? (
          <div className="detail-section__empty">No tasks assigned.</div>
        ) : (
          <div className="detail-task-list">
            {event.tasks.map((t) => (
              <div key={t.id} className="detail-task-row">
                <div
                  className="detail-task-row__dot"
                  style={{ background: TASK_DOT_COLOR[t.status] }}
                />
                <div className="detail-task-row__body">
                  <span className="detail-task-row__title">{t.title}</span>
                  {t.assignee && (
                    <span className="detail-task-row__meta">
                      <Icon icon="person" size={10} /> {t.assignee} · Due{" "}
                      {fmtTime(t.dueTime)}
                    </span>
                  )}
                  {t.description && (
                    <span className="detail-task-row__notes">
                      {t.description}
                    </span>
                  )}
                </div>
                {TASK_STATUS_BADGE[t.status]}
              </div>
            ))}
          </div>
        )}
      </div>
    </MilModal>
  );
};

interface ConfirmDeleteProps {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}
const ConfirmDelete: React.FC<ConfirmDeleteProps> = ({
  label,
  onConfirm,
  onCancel,
}) => (
  <MilModal
    title="Confirm Delete"
    titleIcon="trash"
    size="sm"
    onClose={onCancel}
    actions={[
      { label: "Cancel", variant: "ghost", onClick: onCancel },
      { label: "Delete", variant: "danger", icon: "trash", onClick: onConfirm },
    ]}
  >
    <p style={{ color: "#e6eaf8", margin: 0 }}>
      Delete <strong style={{ color: "#ef4d4d" }}>{label}</strong>? This cannot
      be undone.
    </p>
  </MilModal>
);

type EventFormData = Omit<MelEvent, "id" | "serial" | "tasks">;
interface EventModalProps {
  title: string;
  form: EventFormData;
  onChange: (p: Partial<EventFormData>) => void;
  onSave: () => void;
  onCancel: () => void;
}
const EventModal: React.FC<EventModalProps> = ({
  title,
  form,
  onChange,
  onSave,
  onCancel,
}) => (
  <MilModal
    title={title}
    titleIcon="timeline-events"
    onClose={onCancel}
    actions={[
      { label: "Cancel", variant: "ghost", onClick: onCancel },
      {
        label: "Save Event",
        variant: "primary",
        icon: "tick",
        disabled: !form.title.trim(),
        onClick: onSave,
      },
    ]}
  >
    <MilFormRow>
      <MilFormGroup label="Type" compact>
        <MilSelect
          value={form.type}
          options={[
            { value: "Event", label: "Event" },
            { value: "Incident", label: "Incident" },
          ]}
          onChange={(v) => onChange({ type: v as EventType })}
        />
      </MilFormGroup>
      <MilFormGroup label="Classification" compact>
        <MilSelect
          value={form.classification}
          options={[
            { value: "UNCLASSIFIED", label: "Unclassified" },
            { value: "RESTRICTED", label: "Restricted" },
            { value: "CONFIDENTIAL", label: "Confidential" },
          ]}
          onChange={(v) => onChange({ classification: v as EventClass })}
        />
      </MilFormGroup>
      <MilFormGroup label="Status" compact>
        <MilSelect
          value={form.status}
          options={[
            { value: "open", label: "Open" },
            { value: "under-review", label: "Under Review" },
            { value: "closed", label: "Closed" },
          ]}
          onChange={(v) => onChange({ status: v as EventStatus })}
        />
      </MilFormGroup>
    </MilFormRow>
    <MilFormRow>
      <MilFormGroup label="Start DTG (UTC)">
        <MilDateTimeInput
          value={form.startTime}
          onChange={(v) => onChange({ startTime: v })}
        />
      </MilFormGroup>
      <MilFormGroup label="End DTG (UTC)">
        <MilDateTimeInput
          value={form.endTime}
          onChange={(v) => onChange({ endTime: v })}
        />
      </MilFormGroup>
    </MilFormRow>
    <MilFormGroup label="Title">
      <MilTextInput
        value={form.title}
        onChange={(v) => onChange({ title: v })}
        placeholder="Enter event title..."
        autoFocus
      />
    </MilFormGroup>
    <MilFormGroup label="Description">
      <MilTextArea
        value={form.description}
        onChange={(v) => onChange({ description: v })}
        placeholder="Enter description / narrative..."
        rows={3}
      />
    </MilFormGroup>
  </MilModal>
);

type TaskFormData = Omit<MelTask, "id">;
interface TaskModalProps {
  title: string;
  form: TaskFormData;
  onChange: (p: Partial<TaskFormData>) => void;
  onSave: () => void;
  onCancel: () => void;
}
const TaskModal: React.FC<TaskModalProps> = ({
  title,
  form,
  onChange,
  onSave,
  onCancel,
}) => (
  <MilModal
    title={title}
    titleIcon="flows"
    onClose={onCancel}
    actions={[
      { label: "Cancel", variant: "ghost", onClick: onCancel },
      {
        label: "Save Task",
        variant: "primary",
        icon: "tick",
        disabled: !form.title.trim(),
        onClick: onSave,
      },
    ]}
  >
    <MilFormRow>
      <MilFormGroup label="Status" compact>
        <MilSelect
          value={form.status}
          options={[
            { value: "pending", label: "Pending" },
            { value: "in-progress", label: "In Progress" },
            { value: "complete", label: "Complete" },
            { value: "cancelled", label: "Cancelled" },
          ]}
          onChange={(v) => onChange({ status: v as TaskStatus })}
        />
      </MilFormGroup>
      <MilFormGroup label="Due DTG (UTC)">
        <MilDateTimeInput
          value={form.dueTime}
          onChange={(v) => onChange({ dueTime: v })}
        />
      </MilFormGroup>
    </MilFormRow>
    <MilFormGroup label="Title">
      <MilTextInput
        value={form.title}
        onChange={(v) => onChange({ title: v })}
        placeholder="Enter task title..."
        autoFocus
      />
    </MilFormGroup>
    <MilFormGroup label="Assignee">
      <MilTextInput
        value={form.assignee}
        onChange={(v) => onChange({ assignee: v })}
        placeholder="Assigned callsign / person..."
      />
    </MilFormGroup>
    <MilFormGroup label="Notes">
      <MilTextArea
        value={form.description}
        onChange={(v) => onChange({ description: v })}
        placeholder="Additional detail..."
        rows={3}
      />
    </MilFormGroup>
  </MilModal>
);

const blankEventForm = (
  dateStr: string
): Omit<MelEvent, "id" | "serial" | "tasks"> => ({
  title: "",
  description: "",
  type: "Event",
  classification: "UNCLASSIFIED",
  status: "open",
  startTime: `${dateStr}T09:00`,
  endTime: `${dateStr}T10:00`,
});

const blankTaskForm = (): Omit<MelTask, "id"> => ({
  title: "",
  description: "",
  status: "pending",
  assignee: "",
  dueTime: new Date().toISOString().slice(0, 16),
});

interface PhaseTabsProps {
  phases: { phaseId: string; phaseName: string }[];
  activePhaseId: string | null;
  injectsByPhase: Map<string, number>;
  totalInjects: number;
  onSelect: (id: string | null) => void;
  loading: boolean;
}

const PhaseTabs: React.FC<PhaseTabsProps> = ({
  phases,
  activePhaseId,
  injectsByPhase,
  totalInjects,
  onSelect,
  loading,
}) => (
  <div className="mel-phase-tabs">
    <button
      className={`mel-phase-tab${
        activePhaseId === null ? " mel-phase-tab--active" : ""
      }`}
      onClick={() => onSelect(null)}
    >
      All phases
      <span className="mel-phase-tab__count">{totalInjects}</span>
    </button>
    {loading && (
      <span style={{ fontSize: 10, color: "#454c68", padding: "0 8px" }}>
        Loading…
      </span>
    )}
    {phases.map((p) => (
      <button
        key={p.phaseId}
        className={`mel-phase-tab${
          activePhaseId === p.phaseId ? " mel-phase-tab--active" : ""
        }`}
        onClick={() => onSelect(p.phaseId)}
      >
        {p.phaseName}
        <span className="mel-phase-tab__count">
          {injectsByPhase.get(p.phaseId) ?? 0}
        </span>
      </button>
    ))}
  </div>
);

interface RowItemProps {
  event: MelEvent;
  phaseName: string | undefined;
  selected: boolean;
  activePhaseId: string | null;
  onSelect: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddTask: () => void;
}

const RowItem: React.FC<RowItemProps> = ({
  event,
  phaseName,
  selected,
  activePhaseId,
  onSelect,
  onOpen,
  onEdit,
  onDelete,
  onAddTask,
}) => {
  const isIncident = event.type === "Incident";
  const dimmed = activePhaseId !== null && event.phaseId !== activePhaseId;
  const accent = EVENT_ACCENT_COLOR[event.status];
  return (
    <div
      className={[
        "mel-row-item",
        isIncident ? "mel-row-item--incident" : "mel-row-item--event",
        selected ? "mel-row-item--selected" : "",
        dimmed ? "mel-row-item--dimmed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ borderLeftColor: accent }}
      onClick={onSelect}
    >
      <div className="mel-row-item__serial">
        <Icon
          icon={isIncident ? "warning-sign" : "timeline-events"}
          size={10}
          style={{ color: accent, marginRight: 4 }}
        />
        {event.serial}
      </div>
      <div className="mel-row-item__body">
        <div className="mel-row-item__title">{event.title}</div>
        {event.description && (
          <div className="mel-row-item__desc">{event.description}</div>
        )}
        <div className="mel-row-item__meta">
          {CLASS_BADGE[event.classification]}
          {STATUS_BADGE[event.status]}
          <span
            className="mil-badge"
            style={{
              background: `${accent}18`,
              color: accent,
              border: `1px solid ${accent}44`,
            }}
          >
            {event.type}
          </span>
          {phaseName && (
            <span className="mel-row-item__phase-chip">
              <Icon icon="layers" size={8} /> {phaseName}
            </span>
          )}
          {event.tasks.length > 0 && (
            <span
              style={{
                fontSize: 10,
                color: "#6a7292",
                display: "flex",
                alignItems: "center",
                gap: 3,
              }}
            >
              <Icon icon="flows" size={9} />
              {event.tasks.filter((t) => t.status === "complete").length}/
              {event.tasks.length} tasks
            </span>
          )}
        </div>
      </div>
      <div className="mel-row-item__right">
        <span className="mel-row-item__day">
          {event.startTime ? isoDateStr(event.startTime).slice(5) : ""}
        </span>
        <button
          className="mil-btn mil-btn--ghost mil-btn--sm mil-btn--icon-only"
          title="Add task"
          onClick={(e) => {
            e.stopPropagation();
            onAddTask();
          }}
        >
          <Icon icon="plus" size={11} />
        </button>
        <button
          className="mil-btn mil-btn--ghost mil-btn--sm mil-btn--icon-only"
          title="Edit"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <Icon icon="edit" size={11} />
        </button>
        <button
          className="mil-btn mil-btn--ghost mil-btn--sm mil-btn--icon-only mil-btn--danger"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Icon icon="trash" size={11} />
        </button>
        <button
          className="mel-row-item__open-btn"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          Open
        </button>
      </div>
    </div>
  );
};

const MilMelBody: React.FC<{ scenarioId: string }> = ({
  scenarioId,
}) => {
  const { parameters, emitEvent } = useWidgetContext();
  // Routed through the mutation hook's onSuccess so every write notifies
  // Workshop, rather than each call site having to remember to.
  const notifyDataChanged = useCallback(
    () => emitEvent("onDataChanged", { parameterUpdates: {} }),
    [emitEvent],
  );
  const resolvedPhaseId = useFirstObjectPropertyValue(
    parameters.values.selectedPhase?.objectSet,
    "phaseId"
  );
  const resolvedInjectId = useFirstObjectPropertyValue(
    parameters.values.selectedInject?.objectSet,
    "injectId"
  );

  const { phases, loading: phasesLoading } = useNxgPhases(scenarioId);
  const [activePhaseTab, setActivePhaseTab] = useState<string | null>(null);

  useEffect(() => {
    if (resolvedPhaseId) setActivePhaseTab(resolvedPhaseId);
  }, [resolvedPhaseId]);

  const [liveEvents, setLiveEvents] = useState<MelEvent[]>([]);
  const [injectsLoading, setInjectsLoading] = useState(false);
  const [injectsError, setInjectsError] = useState<string | null>(null);

  const loadInjects = useCallback(async () => {
    setInjectsLoading(true);
    setInjectsError(null);
    try {
      const page = await client(NxgInject)
        .where({ scenarioId: { $eq: scenarioId } })
        .fetchPage({ $pageSize: 500 });
      const mapped = (
        page.data as unknown as Array<Record<string, unknown>>
      ).map((obj, i) => injectToMelEvent(obj, i));
      setLiveEvents(mapped);
    } catch (e: unknown) {
      setInjectsError(String(e));
    } finally {
      setInjectsLoading(false);
    }
  }, [scenarioId]);

  useEffect(() => {
    void loadInjects();
  }, [loadInjects]);

  const {
    createInject,
    updateInject,
    deleteInject,
    error: writeError,
    clearError: clearWriteError,
  } = useNxgInjectMutations({ onSuccess: notifyDataChanged });

  const [localEvents, setLocalEvents] = useState<MelEvent[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<EventStatus | null>(null);
  const [filterType, setFilterType] = useState<EventType | null>(null);

  const events = useMemo<MelEvent[]>(() => {
    const localIds = new Set(localEvents.map((e) => e.id));
    return [...liveEvents.filter((e) => !localIds.has(e.id)), ...localEvents];
  }, [liveEvents, localEvents]);

  type DetailTarget = { kind: "event"; id: string };
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(
    resolvedInjectId ? { kind: "event", id: resolvedInjectId } : null
  );
  useEffect(() => {
    if (resolvedInjectId)
      setDetailTarget({ kind: "event", id: resolvedInjectId });
  }, [resolvedInjectId]);

  type EventModalMode = { kind: "add" } | { kind: "edit"; id: string };
  type TaskModalMode =
    | { kind: "add"; eventId: string }
    | { kind: "edit"; eventId: string; taskId: string };
  const [eventModal, setEventModal] = useState<EventModalMode | null>(null);
  const [eventForm, setEventForm] = useState<EventFormData>(
    blankEventForm(new Date().toISOString().slice(0, 10))
  );
  const [taskModal, setTaskModal] = useState<TaskModalMode | null>(null);
  const [taskForm, setTaskForm] = useState<TaskFormData>(blankTaskForm());

  type DeleteTarget =
    | { kind: "event"; id: string }
    | { kind: "task"; eventId: string; taskId: string };
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const injectsByPhase = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (const ev of events) {
      if (ev.phaseId) map.set(ev.phaseId, (map.get(ev.phaseId) ?? 0) + 1);
    }
    return map;
  }, [events]);

  const phaseNameById = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const p of phases) m.set(p.phaseId, p.phaseName);
    return m;
  }, [phases]);

  const visibleEvents = useMemo(() => {
    return events
      .filter((e) => activePhaseTab === null || e.phaseId === activePhaseTab)
      .filter((e) => filterStatus == null || e.status === filterStatus)
      .filter((e) => filterType == null || e.type === filterType)
      .filter(
        (e) =>
          !search ||
          e.title.toLowerCase().includes(search.toLowerCase()) ||
          e.serial.toLowerCase().includes(search.toLowerCase())
      )
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [events, activePhaseTab, filterStatus, filterType, search]);

  const openCount = events.filter((e) => e.status === "open").length;
  const reviewCount = events.filter((e) => e.status === "under-review").length;
  const closedCount = events.filter((e) => e.status === "closed").length;
  const milCount = events.filter((e) => e.type === "Incident").length;
  const melCount = events.filter((e) => e.type === "Event").length;

  const openAddEvent = useCallback(() => {
    setEventForm(blankEventForm(new Date().toISOString().slice(0, 10)));
    setEventModal({ kind: "add" });
  }, []);

  const openEditEvent = useCallback(
    (id: string) => {
      const ev = events.find((e) => e.id === id);
      if (!ev) return;
      setEventForm({
        title: ev.title,
        description: ev.description,
        type: ev.type,
        classification: ev.classification,
        status: ev.status,
        startTime: ev.startTime,
        endTime: ev.endTime,
      });
      setEventModal({ kind: "edit", id });
    },
    [events]
  );

  const handleSaveEvent = useCallback(() => {
    if (!eventModal) return;

    if (eventModal.kind === "add") {
      // Persist as an NxgInject and re-read so the row carries the real
      // primary key. Only title, body, category and day offset have an
      // ontology home — classification, status, end time and the task
      // list remain presentation state on the widget.
      void createInject(scenarioId, {
        title: eventForm.title,
        body: eventForm.description,
        category: typeToInjectCategory(eventForm.type, null),
        dayOffset: dateStrToDayOffset(eventForm.startTime),
        phaseId: activePhaseTab ?? undefined,
      })
        .then(() => loadInjects())
        .catch(() => {
          // Keep the user's work visible locally if the write failed.
          setLocalEvents((prev) => [
            ...prev,
            {
              id: genId(),
              serial: genSerial(eventForm.type, events),
              tasks: [],
              ...eventForm,
            },
          ]);
        });
      setEventModal(null);
      return;
    }

    const target = events.find((e) => e.id === eventModal.id);

    setLocalEvents((prev) => {
      const exists = prev.find((e) => e.id === eventModal.id);
      if (exists)
        return prev.map((e) =>
          e.id === eventModal.id ? { ...e, ...eventForm } : e
        );
      const liveEv = liveEvents.find((e) => e.id === eventModal.id);
      if (liveEv) return [...prev, { ...liveEv, ...eventForm }];
      return prev;
    });

    if (target?.isLive) {
      void updateInject(target.id, {
        title: eventForm.title,
        body: eventForm.description,
        category: typeToInjectCategory(eventForm.type, target.injectCategory),
        dayOffset: dateStrToDayOffset(eventForm.startTime),
        phaseId: target.phaseId,
      }).catch(() => loadInjects());
    }

    setEventModal(null);
  }, [
    eventModal,
    eventForm,
    events,
    liveEvents,
    scenarioId,
    activePhaseTab,
    createInject,
    updateInject,
    loadInjects,
  ]);

  const openAddTask = useCallback((eventId: string) => {
    setTaskForm(blankTaskForm());
    setTaskModal({ kind: "add", eventId });
  }, []);

  const _openEditTask = useCallback(
    (eventId: string, taskId: string) => {
      const ev = events.find((e) => e.id === eventId);
      const tk = ev?.tasks.find((t) => t.id === taskId);
      if (!tk) return;
      setTaskForm({
        title: tk.title,
        description: tk.description,
        status: tk.status,
        assignee: tk.assignee,
        dueTime: tk.dueTime,
      });
      setTaskModal({ kind: "edit", eventId, taskId });
    },
    [events]
  );
  void _openEditTask; // retained for future use

  const handleSaveTask = useCallback(() => {
    if (!taskModal) return;
    const applyTaskUpdate = (evs: MelEvent[]) =>
      evs.map((e) => {
        if (e.id !== taskModal.eventId) return e;
        if (taskModal.kind === "add")
          return { ...e, tasks: [...e.tasks, { id: genId(), ...taskForm }] };
        return {
          ...e,
          tasks: e.tasks.map((t) =>
            t.id === taskModal.taskId ? { ...t, ...taskForm } : t
          ),
        };
      });
    setLocalEvents((prev) => {
      const exists = prev.find((e) => e.id === taskModal.eventId);
      if (exists) return applyTaskUpdate(prev);
      const liveEv = liveEvents.find((e) => e.id === taskModal.eventId);
      if (liveEv) return applyTaskUpdate([...prev, liveEv]);
      return prev;
    });
    setTaskModal(null);
  }, [taskModal, taskForm, liveEvents]);

  const handleConfirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    if (deleteTarget.kind === "event") {
      const target = events.find((e) => e.id === deleteTarget.id);
      setLiveEvents((prev) => prev.filter((e) => e.id !== deleteTarget.id));
      setLocalEvents((prev) => prev.filter((e) => e.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) setSelectedId(null);
      // Previously this only dropped the row from local state, so the
      // inject reappeared on the next load. Remove it for real.
      if (target?.isLive) {
        void deleteInject(target.id).catch(() => loadInjects());
      }
    } else {
      setLocalEvents((prev) => {
        const exists = prev.find((e) => e.id === deleteTarget.eventId);
        const base = exists
          ? prev
          : (() => {
              const liveEv = liveEvents.find(
                (e) => e.id === deleteTarget.eventId
              );
              return liveEv ? [...prev, liveEv] : prev;
            })();
        return base.map((e) =>
          e.id === deleteTarget.eventId
            ? {
                ...e,
                tasks: e.tasks.filter((t) => t.id !== deleteTarget.taskId),
              }
            : e
        );
      });
    }
    setDeleteTarget(null);
  }, [deleteTarget, selectedId, liveEvents, events, deleteInject, loadInjects]);

  return (
    <div className="mil-widget bp5-dark">
      {writeError && (
        <div className="mil-banner mil-banner--error" role="alert">
          <Icon icon="warning-sign" size={12} />
          <span>{writeError}</span>
          <button
            className="mil-banner__dismiss"
            onClick={clearWriteError}
            aria-label="Dismiss"
          >
            <Icon icon="cross" size={12} />
          </button>
        </div>
      )}
      {injectsLoading && (
        <div
          style={{
            padding: "5px 16px",
            background: "#141828",
            borderBottom: "1px solid #232a45",
            fontSize: 11,
            color: "#6a7292",
          }}
        >
          Loading injects from Foundry…
        </div>
      )}
      {injectsError && !injectsLoading && (
        <div
          style={{
            padding: "5px 16px",
            background: "rgba(239, 77, 77,0.08)",
            borderBottom: "1px solid #ef4d4d33",
            fontSize: 11,
            color: "#ef4d4d",
          }}
        >
          <Icon icon="warning-sign" size={11} /> Failed to load injects:{" "}
          {injectsError}
        </div>
      )}

      <div className="mil-toolbar">
        <InputGroup
          leftIcon="search"
          placeholder="Search injects..."
          small
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 220 }}
        />
        <div className="mil-toolbar__separator" />
        <span
          style={{
            fontSize: 11,
            color: "#6a7292",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {milCount} MIL · {melCount} MEL
        </span>
        <div style={{ flex: 1 }} />
        <MilButton icon="export" variant="ghost">
          Export
        </MilButton>
        <MilButton icon="add" variant="primary" onClick={openAddEvent}>
          Log Event
        </MilButton>
      </div>

      <PhaseTabs
        phases={phases}
        activePhaseId={activePhaseTab}
        injectsByPhase={injectsByPhase}
        totalInjects={events.length}
        onSelect={setActivePhaseTab}
        loading={phasesLoading}
      />

      <div className="tl-filter-bar">
        <span className="tl-filter-bar__label">Filter:</span>
        {(["open", "under-review", "closed"] as EventStatus[]).map((s) => (
          <button
            key={s}
            className={`tl-filter-chip${
              filterStatus === s ? " tl-filter-chip--active" : ""
            }`}
            style={
              filterStatus === s
                ? {
                    borderColor: EVENT_ACCENT_COLOR[s],
                    color: EVENT_ACCENT_COLOR[s],
                    background: `${EVENT_ACCENT_COLOR[s]}22`,
                  }
                : undefined
            }
            onClick={() => setFilterStatus(filterStatus === s ? null : s)}
          >
            {s === "open"
              ? "Open"
              : s === "under-review"
              ? "Under Review"
              : "Closed"}
          </button>
        ))}
        <div className="tl-filter-bar__divider" />
        {(["Incident", "Event"] as EventType[]).map((t) => (
          <button
            key={t}
            className={`tl-filter-chip${
              filterType === t ? " tl-filter-chip--active" : ""
            }`}
            onClick={() => setFilterType(filterType === t ? null : t)}
          >
            {t}
          </button>
        ))}
        {(filterStatus != null || filterType != null) && (
          <>
            <div className="tl-filter-bar__divider" />
            <button
              className="tl-filter-chip tl-filter-chip--clear"
              onClick={() => {
                setFilterStatus(null);
                setFilterType(null);
              }}
            >
              <Icon icon="cross" size={10} /> Clear
            </button>
          </>
        )}
      </div>

      <div className="mel-list-summary">
        <span>
          <span className="mel-list-summary__count">
            {visibleEvents.length}
          </span>{" "}
          inject{visibleEvents.length !== 1 ? "s" : ""}
        </span>
        <span className="mel-list-summary__sep">·</span>
        <span style={{ color: "#ef4d4d" }}>
          <span
            className="mel-list-summary__count"
            style={{ color: "#ef4d4d" }}
          >
            {openCount}
          </span>{" "}
          open
        </span>
        <span className="mel-list-summary__sep">·</span>
        <span style={{ color: "#f0a83c" }}>
          <span
            className="mel-list-summary__count"
            style={{ color: "#f0a83c" }}
          >
            {reviewCount}
          </span>{" "}
          under review
        </span>
        <span className="mel-list-summary__sep">·</span>
        <span style={{ color: "#6c5ce7" }}>
          <span
            className="mel-list-summary__count"
            style={{ color: "#6c5ce7" }}
          >
            {closedCount}
          </span>{" "}
          closed
        </span>
      </div>

      <div className="tl-scroll">
        {visibleEvents.length === 0 ? (
          <div className="mil-empty" style={{ marginTop: 60 }}>
            <Icon icon="timeline-events" size={32} />
            <div className="mil-empty__text">
              {search || filterStatus != null || filterType != null
                ? "No injects match the active filters"
                : activePhaseTab
                ? "No injects in this phase"
                : "No injects loaded"}
            </div>
            {!search && filterStatus == null && filterType == null && (
              <MilButton icon="add" variant="primary" onClick={openAddEvent}>
                Log First Event
              </MilButton>
            )}
          </div>
        ) : (
          <div className="mel-row-list">
            {visibleEvents.map((ev) => (
              <RowItem
                key={ev.id}
                event={ev}
                phaseName={
                  ev.phaseId ? phaseNameById.get(ev.phaseId) : undefined
                }
                selected={selectedId === ev.id}
                activePhaseId={activePhaseTab}
                onSelect={() =>
                  setSelectedId((prev) => (prev === ev.id ? null : ev.id))
                }
                onOpen={() => setDetailTarget({ kind: "event", id: ev.id })}
                onEdit={() => openEditEvent(ev.id)}
                onDelete={() => setDeleteTarget({ kind: "event", id: ev.id })}
                onAddTask={() => openAddTask(ev.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mil-statusbar">
        <MilLabel variant="status-dot" intent="red">
          {openCount} Open
        </MilLabel>
        <MilLabel variant="status-dot" intent="amber">
          {reviewCount} Under Review
        </MilLabel>
        <MilLabel variant="status-dot" intent="green">
          {closedCount} Closed
        </MilLabel>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "#454c68" }}>
          {events.length} total ·{" "}
          {events.reduce((s, e) => s + e.tasks.length, 0)} tasks
        </span>
      </div>

      {detailTarget?.kind === "event" &&
        (() => {
          const ev = events.find((e) => e.id === detailTarget.id);
          return ev ? (
            <EventDetailModal
              event={ev}
              onClose={() => setDetailTarget(null)}
              onEdit={() => {
                setDetailTarget(null);
                openEditEvent(ev.id);
              }}
              onDelete={() => {
                setDetailTarget(null);
                setDeleteTarget({ kind: "event", id: ev.id });
              }}
            />
          ) : null;
        })()}

      {eventModal && (
        <EventModal
          title={eventModal.kind === "add" ? "Log New Event" : "Edit Event"}
          form={eventForm}
          onChange={(p) => setEventForm((prev) => ({ ...prev, ...p }))}
          onSave={handleSaveEvent}
          onCancel={() => setEventModal(null)}
        />
      )}

      {taskModal && (
        <TaskModal
          title={taskModal.kind === "add" ? "Add Task" : "Edit Task"}
          form={taskForm}
          onChange={(p) => setTaskForm((prev) => ({ ...prev, ...p }))}
          onSave={handleSaveTask}
          onCancel={() => setTaskModal(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDelete
          label={
            deleteTarget.kind === "event"
              ? events.find((e) => e.id === deleteTarget.id)?.serial ?? "event"
              : events
                  .find((e) => e.id === deleteTarget.eventId)
                  ?.tasks.find((t) => t.id === deleteTarget.taskId)?.title ??
                "task"
          }
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
};

// ── Widget entry point ─────────────────────────────────────────────────────
// Resolves the bound scenario before mounting the body, so the body always
// has a real scenario to work with and never silently falls back to a
// default exercise.

export const MilMel: React.FC = () => {
  const { parameters } = useWidgetContext();
  const binding = useScenarioIdFromObjectSet(
    parameters.values.scenario?.objectSet
  );
  return (
    <ScenarioGate binding={binding}>
      {(scenarioId) => <MilMelBody scenarioId={scenarioId} />}
    </ScenarioGate>
  );
};
