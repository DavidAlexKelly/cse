import { describe, expect, it } from "vitest";
import type { NxgInject, NxgTrainingObjective } from "../../scenarioPlanner/shared/types";
import type { ComplianceStatus, OrderCompliance } from "./compliance";
import {
  type MeasuredOrder,
  areasFor,
  assessObjectives,
  objectivesAsText,
  suggestRating,
  summariseObjectives,
} from "./objectiveAssessment";

function objective(
  ref: string,
  text: string,
  area: string,
  priority: NxgTrainingObjective["priority"] = "Medium",
): NxgTrainingObjective {
  return { objectiveId: ref, ref, objective: text, functionalArea: area, priority };
}

function order(
  id: string,
  unitLabel: string,
  taskLabel: string,
  status: ComplianceStatus,
  category: MeasuredOrder["category"],
  force: "blue" | "red" = "blue",
): MeasuredOrder {
  return {
    compliance: { orderId: id, unitLabel, taskLabel, status, force } as OrderCompliance,
    category,
  };
}

function inject(id: string, title: string, category: string): NxgInject {
  return {
    injectId: id,
    injectTitle: title,
    injectBody: "",
    expectedResponse: "Report",
    injectCategory: category,
    dayOffset: "D+1",
  };
}

const ORDERS: MeasuredOrder[] = [
  order("o1", "1 Mech Bn (West)", "Advance to Contact", "ACHIEVED_ON_TIME", "Infantry"),
  order("o2", "2 Mech Bn (Centre)", "Advance to Contact", "ACHIEVED_LATE", "Infantry"),
  order("o3", "Long-Range Artillery", "Support by Fire", "NEVER_MOVED", "Artillery"),
  order("o4", "AD Bty (Corridor Cover)", "Cover", "ACHIEVED_ON_TIME", "Air Defence"),
  order("o5", "CSS Logistics Hub", "Move", "NOT_OBSERVED", "Logistics"),
];

describe("assessObjectives", () => {
  const assessed = assessObjectives(
    [
      objective("TO-03", "Synchronise fires to interdict enemy long-range systems", "Fires"),
      objective(
        "TO-01",
        "Conduct a coordinated advance to secure the corridor",
        "Manoeuvre",
        "High",
      ),
      objective("TO-04", "Provide air defence cover for the corridor", "Protection", "High"),
      objective("TO-05", "Sustain the force through reception and staging", "Sustainment / J4"),
      objective("TO-06", "Exercise the JOC battle rhythm and reporting", "C2"),
    ],
    ORDERS,
    [
      inject("i1", "Port congestion delays offload", "LOG"),
      inject("i2", "Hostile UAS sighting", "INTEL"),
    ],
  );
  const byRef = Object.fromEntries(assessed.map((a) => [a.ref, a]));

  it("puts high priority first", () => {
    expect(assessed.map((a) => a.ref)).toEqual(["TO-01", "TO-04", "TO-03", "TO-05", "TO-06"]);
  });

  it("links orders by functional area and says why", () => {
    expect(byRef["TO-01"].orders.map((o) => o.orderId)).toEqual(["o1", "o2"]);
    expect(byRef["TO-01"].orders[0].reason).toMatch(/Manoeuvre/);
    expect(byRef["TO-03"].orders.map((o) => o.orderId)).toEqual(["o3"]);
    expect(byRef["TO-04"].orders.map((o) => o.orderId)).toEqual(["o4"]);
  });

  it("does not link a unit by generic task wording when another area owns it", () => {
    // The logistics hub's "Move" is sustainment evidence, not manoeuvre.
    expect(byRef["TO-05"].orders.map((o) => o.orderId)).toEqual(["o5"]);
  });

  it("uses shared wording only when the area is unrecognised", () => {
    const [a] = assessObjectives(
      [objective("TO-9", "Secure the corridor crossing", "")],
      ORDERS,
      [],
    );
    expect(a.orders.map((o) => o.reason)).toContain('both mention "corridor"');
  });

  it("suggests a rating from the measured orders", () => {
    expect(byRef["TO-01"].suggested).toBe("PARTIALLY_DEMONSTRATED");
    expect(byRef["TO-03"].suggested).toBe("NOT_DEMONSTRATED");
    expect(byRef["TO-05"].suggested).toBe("NOT_OBSERVED");
    // Staff process: nothing on the map exercises it.
    expect(byRef["TO-06"].suggested).toBe("NEEDS_JUDGEMENT");
  });

  it("links MEL/MIL injects by category", () => {
    expect(byRef["TO-05"].injects.map((i) => i.injectId)).toEqual(["i1"]);
    expect(byRef["TO-05"].injects[0].reason).toMatch(/LOG inject/);
  });
});

describe("training audience", () => {
  it("ignores the opposing force's orders", () => {
    const [a] = assessObjectives(
      [objective("TO-F", "Interdict enemy strike systems", "Fires")],
      [order("r1", "ISKANDER-M", "Interdict", "ACHIEVED_ON_TIME", "Artillery", "red")],
      [],
    );
    expect(a.orders).toEqual([]);
    expect(a.suggested).toBe("NEEDS_JUDGEMENT");
  });

  it("can assess the red side when red is the audience", () => {
    const [a] = assessObjectives(
      [objective("TO-F", "Interdict enemy strike systems", "Fires")],
      [order("r1", "ISKANDER-M", "Interdict", "ACHIEVED_ON_TIME", "Artillery", "red")],
      [],
      { audience: "red" },
    );
    expect(a.suggested).toBe("DEMONSTRATED");
  });
});

describe("areasFor", () => {
  it("reads free-text functional areas", () => {
    expect(
      areasFor({ functionalArea: "J3 Joint Fires & Targeting", objective: "" }).map((a) => a.id),
    ).toContain("fires");
  });
  it("falls back to the objective's wording", () => {
    expect(
      areasFor({ functionalArea: "", objective: "Conduct reconnaissance of the corridor" }).map(
        (a) => a.id,
      ),
    ).toContain("intelligence");
  });
});

describe("suggestRating", () => {
  const ev = (status: ComplianceStatus) => ({
    orderId: status,
    unitLabel: "",
    taskLabel: "",
    status,
    reason: "",
  });
  it("needs everything on time to say demonstrated", () => {
    expect(suggestRating([ev("ACHIEVED_ON_TIME"), ev("ACHIEVED_ON_TIME")]).rating).toBe(
      "DEMONSTRATED",
    );
    expect(suggestRating([ev("ACHIEVED_ON_TIME"), ev("ACHIEVED_LATE")]).rating).toBe(
      "PARTIALLY_DEMONSTRATED",
    );
    expect(suggestRating([ev("OFF_ROUTE"), ev("ACHIEVED_LATE")]).rating).toBe(
      "PARTIALLY_DEMONSTRATED",
    );
    expect(suggestRating([ev("OFF_ROUTE"), ev("NEVER_MOVED"), ev("ACHIEVED_LATE")]).rating).toBe(
      "NOT_DEMONSTRATED",
    );
  });
  it("does not count unmeasurable orders against the audience", () => {
    expect(suggestRating([ev("ACHIEVED_ON_TIME"), ev("NOT_OBSERVED")]).rating).toBe("DEMONSTRATED");
  });
});

describe("summaries", () => {
  const assessed = assessObjectives(
    [
      objective("TO-1", "Advance to secure the corridor", "Manoeuvre"),
      objective("TO-2", "Battle rhythm", "C2"),
    ],
    ORDERS,
    [],
  );

  it("counts final ratings, with the analyst's call winning", () => {
    expect(summariseObjectives(assessed, {})).toBe(
      "0 of 2 training objectives demonstrated, 1 partially, 1 needs observer judgement.",
    );
    expect(summariseObjectives(assessed, { "TO-2": { rating: "DEMONSTRATED" } })).toBe(
      "1 of 2 training objectives demonstrated, 1 partially.",
    );
  });

  it("writes plain text for a slide, marking whose call each rating is", () => {
    const text = objectivesAsText("Phase 1", assessed, {
      "TO-2": { rating: "DEMONSTRATED", note: "Observed in the JOC." },
    });
    expect(text).toContain("Training objectives — Phase 1");
    expect(text).toContain("Demonstrated (analyst)");
    expect(text).toContain("Partially demonstrated (suggested)");
    expect(text).toContain("Note: Observed in the JOC.");
  });

  it("says when there is nothing to assess", () => {
    expect(summariseObjectives([], {})).toBe("No training objectives are recorded for this phase.");
  });
});
