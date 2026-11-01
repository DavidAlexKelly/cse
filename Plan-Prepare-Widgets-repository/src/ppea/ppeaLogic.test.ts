import { describe, expect, it } from "vitest";
import type {
  OperationOverlay,
  PpeaRole,
  PpeaTask,
  TaskStatus,
} from "./ppeaData.js";
import {
  addRole,
  addTask,
  appendTaskEvent,
  canAddTask,
  canApprove,
  canDeleteTask,
  canEditContent,
  canEditTaskDefinition,
  canManageRoles,
  canReopen,
  canReturn,
  canStart,
  canSubmitForReview,
  computeBlueprint,
  deleteRole,
  deleteTask,
  eventRequiresComment,
  getDirectDownstream,
  getTaskActions,
  getTaskContent,
  getTaskHistory,
  getTaskStatus,
  getUpstream,
  setTaskOverlay,
  statusTransitionToEvent,
  updateRole,
  updateTask,
} from "./ppeaLogic.js";

// ── Test fixtures ──────────────────────────────────────────────────────────

const role = (id: string, abbr = id.toUpperCase()): PpeaRole => ({
  id,
  abbr,
  name: `${abbr} role`,
  sub: "test",
  desc: "test role",
});

const task = (id: string, overrides: Partial<PpeaTask> = {}): PpeaTask => ({
  id,
  phase: "plan",
  name: id,
  desc: "",
  owner: [],
  approver: [],
  involved: [],
  deps: [],
  ...overrides,
});

// ── Roles ──────────────────────────────────────────────────────────────────

describe("addRole / updateRole / deleteRole", () => {
  it("adds a new role", () => {
    const roles = [role("ose")];
    const out = addRole(roles, role("ode"));
    expect(out.map((r) => r.id)).toEqual(["ose", "ode"]);
  });

  it("addRole replaces if same id exists", () => {
    const roles = [role("ose", "OSE")];
    const out = addRole(roles, { ...role("ose"), abbr: "OSE2" });
    expect(out).toHaveLength(1);
    expect(out[0].abbr).toBe("OSE2");
  });

  it("updateRole patches matching role", () => {
    const roles = [role("ose"), role("ode")];
    const out = updateRole(roles, "ose", { name: "Updated" });
    expect(out[0].name).toBe("Updated");
    expect(out[1].name).toBe("ODE role");
  });

  it("deleteRole removes role and scrubs references", () => {
    const roles = [role("ose"), role("ode")];
    const tasks = [
      task("t1", { owner: ["ose"], approver: ["ode"], involved: ["ose"] }),
      task("t2", { owner: ["ode"] }),
    ];
    const out = deleteRole(roles, tasks, "ose");
    expect(out.roles.map((r) => r.id)).toEqual(["ode"]);
    expect(out.tasks[0].owner).toEqual([]);
    expect(out.tasks[0].involved).toEqual([]);
    expect(out.tasks[0].approver).toEqual(["ode"]);
    expect(out.tasks[1].owner).toEqual(["ode"]);
  });
});

// ── Tasks ──────────────────────────────────────────────────────────────────

describe("addTask / updateTask / deleteTask", () => {
  it("adds a new task", () => {
    const out = addTask([], task("t1"));
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("t1");
  });

  it("addTask replaces if same id exists", () => {
    const out = addTask(
      [task("t1", { name: "old" })],
      task("t1", { name: "new" })
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("new");
  });

  it("updateTask patches matching task", () => {
    const out = updateTask([task("t1"), task("t2")], "t1", { name: "renamed" });
    expect(out[0].name).toBe("renamed");
    expect(out[1].name).toBe("t2");
  });

  it("deleteTask removes the task and scrubs deps", () => {
    const tasks = [
      task("t1"),
      task("t2", { deps: ["t1"] }),
      task("t3", { deps: ["t1", "t2"] }),
    ];
    const out = deleteTask(tasks, "t1");
    expect(out.map((t) => t.id)).toEqual(["t2", "t3"]);
    expect(out[0].deps).toEqual([]);
    expect(out[1].deps).toEqual(["t2"]);
  });
});

// ── Overlay ────────────────────────────────────────────────────────────────

describe("overlay helpers", () => {
  it("returns defaults when no overlay entry exists", () => {
    expect(getTaskStatus(undefined, "x")).toBe("not_started");
    expect(getTaskContent({}, "x")).toBe("");
  });

  it("setTaskOverlay preserves untouched fields", () => {
    const ov: OperationOverlay = {
      t1: { content: "hello", status: "in_progress" },
    };
    const out = setTaskOverlay(ov, "t1", { status: "ready_for_review" });
    expect(out.t1.content).toBe("hello");
    expect(out.t1.status).toBe("ready_for_review");
  });

  it("setTaskOverlay creates entry for new task", () => {
    const out = setTaskOverlay({}, "t1", { content: "draft" });
    expect(out.t1.content).toBe("draft");
    expect(out.t1.status).toBe("not_started");
  });
});

// ── Approval permission logic ──────────────────────────────────────────────

describe("permission checks", () => {
  const t = task("t1", { owner: ["alice"], approver: ["bob"] });

  it("only approver can approve a ready_for_review task", () => {
    expect(canApprove(t, "bob", "ready_for_review")).toBe(true);
    expect(canApprove(t, "alice", "ready_for_review")).toBe(false);
    expect(canApprove(t, "bob", "in_progress")).toBe(false);
    expect(canApprove(t, null, "ready_for_review")).toBe(false);
  });

  it("only owner can start a not_started task", () => {
    expect(canStart(t, "alice", "not_started")).toBe(true);
    expect(canStart(t, "bob", "not_started")).toBe(false);
    expect(canStart(t, "alice", "in_progress")).toBe(false);
  });

  it("only owner can submit an in_progress task", () => {
    expect(canSubmitForReview(t, "alice", "in_progress")).toBe(true);
    expect(canSubmitForReview(t, "bob", "in_progress")).toBe(false);
  });

  it("only approver can return a ready_for_review task", () => {
    expect(canReturn(t, "bob", "ready_for_review")).toBe(true);
    expect(canReturn(t, "alice", "ready_for_review")).toBe(false);
  });

  const statuses: TaskStatus[] = [
    "not_started",
    "in_progress",
    "ready_for_review",
    "approved",
  ];

  it("approved tasks cannot be approved again", () => {
    for (const s of statuses) {
      if (s !== "ready_for_review") expect(canApprove(t, "bob", s)).toBe(false);
    }
  });

  it("only approver can re-open an approved task", () => {
    expect(canReopen(t, "bob", "approved")).toBe(true);
    expect(canReopen(t, "alice", "approved")).toBe(false);
    expect(canReopen(t, "bob", "ready_for_review")).toBe(false);
    expect(canReopen(t, "bob", "in_progress")).toBe(false);
    expect(canReopen(t, null, "approved")).toBe(false);
  });
});

describe("canEditContent", () => {
  const t = task("t1", {
    owner: ["alice"],
    approver: ["bob"],
    involved: ["carol"],
  });

  it("owners can edit in not_started and in_progress", () => {
    expect(canEditContent(t, "alice", "not_started")).toBe(true);
    expect(canEditContent(t, "alice", "in_progress")).toBe(true);
  });

  it("owners cannot edit once submitted or approved", () => {
    expect(canEditContent(t, "alice", "ready_for_review")).toBe(false);
    expect(canEditContent(t, "alice", "approved")).toBe(false);
  });

  it("involved can edit only while in_progress", () => {
    expect(canEditContent(t, "carol", "in_progress")).toBe(true);
    expect(canEditContent(t, "carol", "not_started")).toBe(false);
    expect(canEditContent(t, "carol", "ready_for_review")).toBe(false);
    expect(canEditContent(t, "carol", "approved")).toBe(false);
  });

  it("approvers can never edit content directly", () => {
    for (const s of [
      "not_started",
      "in_progress",
      "ready_for_review",
      "approved",
    ] as TaskStatus[]) {
      expect(canEditContent(t, "bob", s)).toBe(false);
    }
  });

  it("unrelated roles cannot edit", () => {
    expect(canEditContent(t, "dave", "in_progress")).toBe(false);
  });

  it("Observer (no role) cannot edit content", () => {
    expect(canEditContent(t, null, "in_progress")).toBe(false);
  });
});

describe("structural-edit permissions (Observer-only)", () => {
  it("Observer can manage roles, add/edit/delete tasks", () => {
    expect(canManageRoles(null)).toBe(true);
    expect(canAddTask(null)).toBe(true);
    expect(canEditTaskDefinition(null)).toBe(true);
    expect(canDeleteTask(null)).toBe(true);
  });

  it("any role-bearer is blocked from structural edits", () => {
    expect(canManageRoles("alice")).toBe(false);
    expect(canAddTask("alice")).toBe(false);
    expect(canEditTaskDefinition("alice")).toBe(false);
    expect(canDeleteTask("alice")).toBe(false);
  });
});

describe("getTaskActions summary", () => {
  const t = task("t1", { owner: ["alice"], approver: ["bob"] });

  it("hasActionableTransition includes re-open capability", () => {
    expect(
      getTaskActions(t, "alice", "not_started").hasActionableTransition
    ).toBe(true);
    expect(
      getTaskActions(t, "alice", "in_progress").hasActionableTransition
    ).toBe(true);
    expect(
      getTaskActions(t, "alice", "ready_for_review").hasActionableTransition
    ).toBe(false);
    expect(
      getTaskActions(t, "bob", "ready_for_review").hasActionableTransition
    ).toBe(true);
    expect(getTaskActions(t, "bob", "approved").hasActionableTransition).toBe(
      true
    ); // reopen
    expect(getTaskActions(t, null, "in_progress").hasActionableTransition).toBe(
      false
    );
  });

  it("hasPendingAction excludes re-open (approved tasks are at rest)", () => {
    // Owner is "pending" on not_started/in_progress.
    expect(getTaskActions(t, "alice", "not_started").hasPendingAction).toBe(
      true
    );
    expect(getTaskActions(t, "alice", "in_progress").hasPendingAction).toBe(
      true
    );
    expect(
      getTaskActions(t, "alice", "ready_for_review").hasPendingAction
    ).toBe(false);
    expect(getTaskActions(t, "alice", "approved").hasPendingAction).toBe(false);

    // Approver is "pending" only when ready_for_review.
    expect(getTaskActions(t, "bob", "not_started").hasPendingAction).toBe(
      false
    );
    expect(getTaskActions(t, "bob", "in_progress").hasPendingAction).toBe(
      false
    );
    expect(getTaskActions(t, "bob", "ready_for_review").hasPendingAction).toBe(
      true
    );

    // Crucially: an approver of an already-approved task is NOT pending.
    // Re-open is a capability, not a pending action.
    expect(getTaskActions(t, "bob", "approved").hasPendingAction).toBe(false);
  });
});

// ── Task history / audit ───────────────────────────────────────────────────

describe("appendTaskEvent / getTaskHistory", () => {
  it("appends events in order and preserves content / status", () => {
    let ov: OperationOverlay = {
      t1: { content: "draft", status: "in_progress" },
    };
    ov = appendTaskEvent(ov, "t1", {
      kind: "submit",
      roleId: "alice",
      timestamp: "2026-01-01T10:00:00Z",
    });
    ov = appendTaskEvent(ov, "t1", {
      kind: "return",
      roleId: "bob",
      comment: "Needs more detail.",
      timestamp: "2026-01-02T10:00:00Z",
    });
    const hist = getTaskHistory(ov, "t1");
    expect(hist).toHaveLength(2);
    expect(hist[0].kind).toBe("submit");
    expect(hist[0].comment).toBeUndefined();
    expect(hist[1].kind).toBe("return");
    expect(hist[1].comment).toBe("Needs more detail.");
    // Content / status unchanged
    expect(ov.t1.content).toBe("draft");
    expect(ov.t1.status).toBe("in_progress");
  });

  it("strips empty / whitespace-only comments", () => {
    let ov: OperationOverlay = {};
    ov = appendTaskEvent(ov, "t1", {
      kind: "approve",
      roleId: "bob",
      comment: "   ",
    });
    expect(ov.t1.history?.[0].comment).toBeUndefined();
  });

  it("returns empty history for tasks with no events", () => {
    expect(getTaskHistory({}, "x")).toEqual([]);
    expect(getTaskHistory(undefined, "x")).toEqual([]);
  });
});

describe("statusTransitionToEvent", () => {
  it("maps valid workflow transitions", () => {
    expect(statusTransitionToEvent("not_started", "in_progress")).toBe("start");
    expect(statusTransitionToEvent("in_progress", "ready_for_review")).toBe(
      "submit"
    );
    expect(statusTransitionToEvent("ready_for_review", "approved")).toBe(
      "approve"
    );
    expect(statusTransitionToEvent("ready_for_review", "in_progress")).toBe(
      "return"
    );
    expect(statusTransitionToEvent("approved", "in_progress")).toBe("reopen");
  });

  it("returns null for no-op or designer-style multi-step transitions", () => {
    expect(statusTransitionToEvent("in_progress", "in_progress")).toBeNull();
    expect(statusTransitionToEvent("not_started", "approved")).toBeNull();
    expect(statusTransitionToEvent("approved", "not_started")).toBeNull();
  });
});

describe("eventRequiresComment", () => {
  it("requires comment only for return and reopen", () => {
    expect(eventRequiresComment("return")).toBe(true);
    expect(eventRequiresComment("reopen")).toBe(true);
    expect(eventRequiresComment("start")).toBe(false);
    expect(eventRequiresComment("submit")).toBe(false);
    expect(eventRequiresComment("approve")).toBe(false);
  });
});

// ── Dependency graph helpers ───────────────────────────────────────────────

describe("getDirectDownstream / getUpstream", () => {
  const tasks: PpeaTask[] = [
    task("a"),
    task("b", { deps: ["a"] }),
    task("c", { deps: ["b"] }),
    task("d", { deps: ["a"] }),
  ];

  it("returns direct downstream tasks only", () => {
    const out = getDirectDownstream(tasks, "a");
    expect(out.map((t) => t.id).sort()).toEqual(["b", "d"]);
  });

  it("transitively gathers all upstream tasks", () => {
    const out = getUpstream(tasks, "c");
    expect(out.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("returns empty for a root", () => {
    expect(getUpstream(tasks, "a")).toEqual([]);
  });
});

// ── Blueprint layout ───────────────────────────────────────────────────────

describe("computeBlueprint", () => {
  it("places seed task at its seed coordinate", () => {
    const t = task("P1");
    const out = computeBlueprint([t]);
    expect(out[0].col).toBe(0);
    expect(out[0].row).toBe(0);
  });

  it("auto-places new tasks within their phase band", () => {
    const tasks: PpeaTask[] = [
      task("custom1", { phase: "plan", deps: [] }),
      task("custom2", { phase: "prepare", deps: ["custom1"] }),
      task("custom3", { phase: "execute", deps: ["custom2"] }),
    ];
    const out = computeBlueprint(tasks);
    const byId = Object.fromEntries(out.map((n) => [n.id, n]));
    // Plan band: col 0-1, Prepare 2-4, Execute 5-7, Assess 8.
    expect(byId.custom1.col).toBeGreaterThanOrEqual(0);
    expect(byId.custom1.col).toBeLessThanOrEqual(1);
    expect(byId.custom2.col).toBeGreaterThanOrEqual(2);
    expect(byId.custom2.col).toBeLessThanOrEqual(4);
    expect(byId.custom3.col).toBeGreaterThanOrEqual(5);
    expect(byId.custom3.col).toBeLessThanOrEqual(7);
  });

  it("does not collide rows within a column", () => {
    const tasks: PpeaTask[] = [
      task("a", { phase: "plan" }),
      task("b", { phase: "plan" }),
      task("c", { phase: "plan" }),
    ];
    const out = computeBlueprint(tasks);
    const sameCol = out.filter((n) => n.col === out[0].col);
    const rows = sameCol.map((n) => n.row);
    expect(new Set(rows).size).toBe(rows.length);
  });

  it("recomputes layout when a task is deleted", () => {
    const tasks: PpeaTask[] = [
      task("a", { phase: "plan" }),
      task("b", { phase: "plan", deps: ["a"] }),
    ];
    const before = computeBlueprint(tasks);
    const after = computeBlueprint(deleteTask(tasks, "a"));
    expect(before).toHaveLength(2);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe("b");
    expect(after[0].deps).toEqual([]);
  });
});
