import { describe, expect, it } from "vitest";
import {
  detectPhaseGaps,
  durationDaysBetween,
  groupTasksByPhase,
  objectiveCoveragePct,
  parseDayOffset,
  phaseReadinessPct,
  resolveOffsetDate,
} from "./planningMetrics.js";
import {
  normaliseTaskSection,
  normaliseTaskStatus,
} from "../task/taskTaxonomy.js";
import {
  pmesiiStatusToDisplay,
  pmesiiStatusToOntology,
} from "../pmesii/pmesiiStatus.js";
import type { WorkflowTask } from "../../task-manager/task-assignment/types.js";

function task(partial: Partial<WorkflowTask> & { id: string }): WorkflowTask {
  return {
    section: "Planning & Design",
    phaseId: "phase_01",
    title: partial.id,
    description: "",
    approver: null,
    owner: null,
    due: "",
    status: "pending",
    ...partial,
  };
}

describe("parseDayOffset", () => {
  it("parses positive, negative and zero offsets", () => {
    expect(parseDayOffset("D+5")).toBe(5);
    expect(parseDayOffset("D-55")).toBe(-55);
    expect(parseDayOffset("D+0")).toBe(0);
    expect(parseDayOffset("d 3")).toBe(3);
  });

  it("returns null for values that are not offsets", () => {
    // Some scenarios store real ISO dates in these fields.
    expect(parseDayOffset("2026-03-01")).toBeNull();
    expect(parseDayOffset("")).toBeNull();
    expect(parseDayOffset(null)).toBeNull();
    expect(parseDayOffset("Phase 1")).toBeNull();
  });
});

describe("resolveOffsetDate", () => {
  it("resolves an offset against D-Day", () => {
    const d = resolveOffsetDate("2026-03-02", "D+3");
    expect(d?.toISOString().slice(0, 10)).toBe("2026-03-05");
  });

  it("handles negative offsets", () => {
    const d = resolveOffsetDate("2026-03-02", "D-2");
    expect(d?.toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("returns null when D-Day or the offset is missing", () => {
    expect(resolveOffsetDate(null, "D+3")).toBeNull();
    expect(resolveOffsetDate("2026-03-02", null)).toBeNull();
    expect(resolveOffsetDate("2026-03-02", "not-an-offset")).toBeNull();
  });
});

describe("durationDaysBetween", () => {
  it("is inclusive of both ends", () => {
    expect(durationDaysBetween("D+0", "D+2")).toBe(3);
    expect(durationDaysBetween("D+4", "D+4")).toBe(1);
  });

  it("returns null when either bound is not an offset", () => {
    expect(durationDaysBetween("2026-03-01", "D+2")).toBeNull();
  });
});

describe("phaseReadinessPct", () => {
  it("is the share of tasks that are approved", () => {
    expect(
      phaseReadinessPct([
        task({ id: "a", status: "approved" }),
        task({ id: "b", status: "approved" }),
        task({ id: "c", status: "pending" }),
        task({ id: "d", status: "in-review" }),
      ]),
    ).toBe(50);
  });

  it("scores an empty phase 0, not 100", () => {
    // Nothing planned is not the same as everything done.
    expect(phaseReadinessPct([])).toBe(0);
  });
});

describe("detectPhaseGaps", () => {
  it("flags a completely empty phase as critical on objectives and tasks", () => {
    const gaps = detectPhaseGaps({
      phaseId: "p1",
      tasks: [],
      injectCount: 0,
      objectiveCount: 0,
    });
    const ids = gaps.map((g) => g.gapId);
    expect(ids).toContain("p1-no-objectives");
    expect(ids).toContain("p1-no-tasks");
    expect(ids).toContain("p1-no-injects");
    expect(
      gaps.filter((g) => g.severity === "critical").map((g) => g.gapId),
    ).toEqual(["p1-no-objectives", "p1-no-tasks"]);
  });

  it("reports unassigned and unapproved task counts", () => {
    const gaps = detectPhaseGaps({
      phaseId: "p1",
      tasks: [
        task({ id: "a", owner: "someone", approver: "boss" }),
        task({ id: "b", owner: null, approver: null }),
      ],
      injectCount: 2,
      objectiveCount: 1,
    });
    const byId = new Map(gaps.map((g) => [g.gapId, g.description]));
    expect(byId.get("p1-unassigned-tasks")).toBe("1 task without an owner");
    expect(byId.get("p1-unapproved-tasks")).toBe("1 task without an approver");
  });

  it("returns no gaps for a fully planned phase", () => {
    const gaps = detectPhaseGaps({
      phaseId: "p1",
      tasks: [task({ id: "a", owner: "someone", approver: "boss" })],
      injectCount: 1,
      objectiveCount: 1,
    });
    expect(gaps).toEqual([]);
  });
});

describe("objectiveCoveragePct", () => {
  const tasksByPhase = groupTasksByPhase([
    task({ id: "a", phaseId: "p1", status: "approved" }),
    task({ id: "b", phaseId: "p1", status: "pending" }),
    task({ id: "c", phaseId: "p2", status: "approved" }),
    task({ id: "d", phaseId: null }),
  ]);

  it("uses the progress of the objective's phase", () => {
    expect(objectiveCoveragePct("p1", tasksByPhase)).toBe(50);
    expect(objectiveCoveragePct("p2", tasksByPhase)).toBe(100);
  });

  it("is 0 for an objective with no phase or an empty phase", () => {
    expect(objectiveCoveragePct(null, tasksByPhase)).toBe(0);
    expect(objectiveCoveragePct("p3", tasksByPhase)).toBe(0);
  });

  it("ignores tasks that have no phase", () => {
    expect(tasksByPhase.has("")).toBe(false);
    expect([...tasksByPhase.keys()].sort()).toEqual(["p1", "p2"]);
  });
});

describe("task taxonomy normalisation", () => {
  it("keeps every section the ontology actually uses", () => {
    // These all previously collapsed into "Planning & Design".
    expect(normaliseTaskSection("Scenario Development")).toBe(
      "Scenario Development",
    );
    expect(normaliseTaskSection("Exercise Control")).toBe("Exercise Control");
    expect(normaliseTaskSection("Administration")).toBe("Administration");
    expect(normaliseTaskSection("Simulation Integration")).toBe(
      "Simulation Integration",
    );
    expect(normaliseTaskSection("Force Design")).toBe("Force Design");
  });

  it("matches sections case-insensitively and defaults unknowns", () => {
    expect(normaliseTaskSection("exercise control")).toBe("Exercise Control");
    expect(normaliseTaskSection("Something Else")).toBe("Planning & Design");
    expect(normaliseTaskSection(null)).toBe("Planning & Design");
  });

  it("handles the inconsistent status casing in the ontology", () => {
    expect(normaliseTaskStatus("Pending")).toBe("pending");
    expect(normaliseTaskStatus("pending")).toBe("pending");
    expect(normaliseTaskStatus("approved")).toBe("approved");
    expect(normaliseTaskStatus("in_review")).toBe("in-review");
    expect(normaliseTaskStatus("in-review")).toBe("in-review");
    expect(normaliseTaskStatus(null)).toBe("pending");
  });
});

describe("pmesii status mapping", () => {
  it("maps the ontology vocabulary onto the widget's", () => {
    // "Draft" and "complete" both used to display as "pending".
    expect(pmesiiStatusToDisplay("Draft")).toBe("pending");
    expect(pmesiiStatusToDisplay("complete")).toBe("approved");
    expect(pmesiiStatusToDisplay("in_review")).toBe("in-review");
    expect(pmesiiStatusToDisplay("empty")).toBe("pending");
  });

  it("round-trips back to the ontology vocabulary", () => {
    expect(pmesiiStatusToOntology("approved")).toBe("complete");
    expect(pmesiiStatusToOntology("in-review")).toBe("in_review");
    expect(pmesiiStatusToOntology("pending")).toBe("draft");
  });

  it("preserves critical, which has no ontology equivalent", () => {
    expect(pmesiiStatusToOntology("critical")).toBe("critical");
    expect(pmesiiStatusToDisplay("critical")).toBe("critical");
  });
});
