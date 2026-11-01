// ── shared/hla/balticShieldPlan.test.ts ────────────────────────────────────
// Guards the join between the plan and the run it is measured against.
//
// balticShieldPlan.ts (what was ordered) and balticShield.ts (what happened)
// are two hand-maintained files that only work together because their ids
// agree. Nothing in the type system enforces that, and an edit to either —
// renaming an entity, retiming a leg — would quietly turn the plan-vs-execution
// overlay into nonsense rather than breaking anything visible.
//
// The second half of this file pins the findings the demo is built around, so
// that a change which invalidates the narrative fails here rather than in front
// of an audience.

import { describe, expect, it } from "vitest";
import { assessPlanCompliance } from "@/apps/analysisScreen/lib/compliance";
import { sampleMockTrack } from "@/apps/analysisScreen/lib/sampleMockTrack";
import { ADVANCE_DURATION_S, BALTIC_SHIELD_ENTITIES } from "./balticShield";
import { BALTIC_SHIELD_PLAN, PLANNED_CATEGORY } from "./balticShieldPlan";

const ENTITY_IDS = new Set(BALTIC_SHIELD_ENTITIES.map((entity) => entity.id));

describe("BALTIC_SHIELD_PLAN — integrity", () => {
  it("only claims entity links that the federation actually publishes", () => {
    for (const unit of BALTIC_SHIELD_PLAN.units) {
      if (unit.entityId) expect(ENTITY_IDS.has(unit.entityId)).toBe(true);
    }
    for (const order of BALTIC_SHIELD_PLAN.orders) {
      if (order.entityId) expect(ENTITY_IDS.has(order.entityId)).toBe(true);
    }
  });

  it("assigns every order to a unit the plan knows about", () => {
    const unitIds = new Set(BALTIC_SHIELD_PLAN.units.map((unit) => unit.id));
    for (const order of BALTIC_SHIELD_PLAN.orders) {
      expect(unitIds.has(order.unitId)).toBe(true);
    }
  });

  it("gives an order the same category and entity as the unit it is assigned to", () => {
    const unitsById = new Map(BALTIC_SHIELD_PLAN.units.map((unit) => [unit.id, unit]));
    for (const order of BALTIC_SHIELD_PLAN.orders) {
      const unit = unitsById.get(order.unitId);
      expect(unit).toBeDefined();
      expect(order.category).toBe(unit!.category);
      expect(order.entityId).toBe(unit!.entityId);
    }
  });

  it("derives every unit's category from its template", () => {
    for (const unit of BALTIC_SHIELD_PLAN.units) {
      if (!unit.templateId) continue;
      expect(PLANNED_CATEGORY[unit.templateId]).toBe(unit.category);
    }
  });

  it("gives every order at least two points to describe an axis", () => {
    for (const order of BALTIC_SHIELD_PLAN.orders) {
      expect(order.route.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("BALTIC_SHIELD_PLAN — the findings the demo rests on", () => {
  const result = assessPlanCompliance(
    BALTIC_SHIELD_PLAN,
    sampleMockTrack(ADVANCE_DURATION_S),
    ADVANCE_DURATION_S,
  );
  const byOrderId = new Map(result.orders.map((order) => [order.orderId, order]));

  it("measures every order in the plan", () => {
    expect(result.orders).toHaveLength(BALTIC_SHIELD_PLAN.orders.length);
    expect(result.phaseDurationHours).toBe(48);
  });

  it("finds that 3 Armd Bn reached its assembly area and did not hold it", () => {
    const armour = byOrderId.get("bs-p1-armour")!;

    expect(armour.unitLabel).toBe("3 Armd Bn (Reserve)");
    expect(armour.actualArrivalSec).not.toBeNull();
    expect(armour.withdrewAfterArrival).toBe(true);
    // Reached the objective, then carried on west on its later legs.
    expect(armour.maxProgressPct).toBeCloseTo(100, 0);
    expect(armour.finalDistanceToDestinationKm!).toBeGreaterThan(20);
  });

  it("finds the four divisions that were ordered to attack but never published", () => {
    const ghostOrders = [
      "e310d1ad-778f-4b1d-a976-eff2e3d835f0",
      "d7115d7a-c24a-40e5-9dc7-eb8bff7bcfce",
      "1e9db857-2cd4-4f2a-ab41-11aba429b2d9",
      "34cf984c-e2fb-41f4-85df-ad784a26c404",
    ];

    for (const orderId of ghostOrders) {
      expect(byOrderId.get(orderId)!.status).toBe("NOT_OBSERVED");
    }
    expect(result.notObservedCount).toBe(ghostOrders.length);
  });

  it("finds the two contradictory orders held against 1 Mech Bn (West)", () => {
    const screen = byOrderId.get("bs-p1-bg-west")!;
    const attack = byOrderId.get("2f8dbbc6-0037-426b-a7bb-336a8e042251")!;

    expect(screen.conflictingOrderIds).toEqual([attack.orderId]);
    expect(attack.conflictingOrderIds).toEqual([screen.orderId]);

    // The advance follows the screen; the attack is never begun.
    expect(screen.actualArrivalSec).not.toBeNull();
    expect(attack.actualArrivalSec).toBeNull();
  });

  it("finds the Defend order that was drawn with no axis to measure", () => {
    expect(byOrderId.get("2c2bf489-c29d-4498-a6f7-21ec84c79fe4")!.status).toBe(
      "NO_PLANNED_ROUTE",
    );
  });

  it("credits 22nd AC with an arrival it only completes as the run ends", () => {
    // Its final leg finishes on the ordered objective, so the arrival is only
    // established by the last sample — the case the dwell rule has to forgive.
    const advance = byOrderId.get("bs-p1-22ac")!;
    expect(advance.actualArrivalSec).not.toBeNull();
    expect(advance.actualArrivalSec!).toBeGreaterThan(ADVANCE_DURATION_S * 0.8);
  });

  it("reports the plan as optimistic about timing across the board", () => {
    // Every planned duration comes from the planner's cross-country rate table
    // and the scripted advance walks its legs in equal time regardless, so the
    // two disagree about when — which is the whole point of the screen.
    const arrived = result.orders.filter((order) => order.actualArrivalSec != null);
    expect(arrived.length).toBeGreaterThan(5);
    expect(arrived.every((order) => order.deltaPhaseHours != null)).toBe(true);
    expect(arrived.some((order) => order.status === "ACHIEVED_LATE")).toBe(true);
  });
});
