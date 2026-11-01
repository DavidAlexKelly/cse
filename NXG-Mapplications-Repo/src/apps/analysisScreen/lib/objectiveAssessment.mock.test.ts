import { describe, expect, it } from "vitest";
import { ADVANCE_DURATION_S } from "@/shared/hla/balticShield";
import { BALTIC_SHIELD_PLAN } from "@/shared/hla/balticShieldPlan";
import { assessPlanCompliance } from "./compliance";
import { DEMO_OBJECTIVES } from "./demoObjectives";
import { assessObjectives, objectivesAsText } from "./objectiveAssessment";
import { sampleMockTrack } from "./sampleMockTrack";

// The demo path end to end: the checked-in plan, the synthetic run, the demo
// objectives. Guards against a demo debrief that says nothing useful.
describe("training objectives on the mock Baltic Shield run", () => {
  const compliance = assessPlanCompliance(
    BALTIC_SHIELD_PLAN,
    sampleMockTrack(),
    ADVANCE_DURATION_S,
  );
  const category = new Map(BALTIC_SHIELD_PLAN.orders.map((o) => [o.id, o.category]));
  const assessed = assessObjectives(
    DEMO_OBJECTIVES,
    compliance.orders.map((c) => ({ compliance: c, category: category.get(c.orderId)! })),
    [],
  );

  it("finds evidence for every objective the map can see, and none for the staff one", () => {
    const byRef = Object.fromEntries(assessed.map((a) => [a.ref, a]));
    for (const ref of ["TO-01", "TO-02", "TO-03"]) {
      expect(byRef[ref].orders.length, ref).toBeGreaterThan(0);
    }
    expect(byRef["TO-04"].suggested).toBe("NEEDS_JUDGEMENT");
  });

  it("counts only the training audience's orders", () => {
    for (const a of assessed) {
      for (const o of a.orders) {
        const order = compliance.orders.find((c) => c.orderId === o.orderId)!;
        expect(order.force).toBe("blue");
      }
    }
  });

  it("reads as a debrief", () => {
    const text = objectivesAsText(BALTIC_SHIELD_PLAN.phaseName, assessed, {});
    // Printed so the demo wording can be reviewed in the test log.
    console.log(text);
    expect(text.split("\n").length).toBeGreaterThan(8);
  });
});
