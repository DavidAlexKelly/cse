// ── analysisScreen/lib/debriefNarrative.test.ts ────────────────────────────
// The write-up says what the data says, and nothing it does not.
//
// These are prose tests, which are usually a bad idea — asserting on wording
// makes every copy edit a test failure. What is asserted here is narrower and
// worth pinning: that numbers reach the page intact, that the caveat about
// scripted attrition is present whenever the attrition is scripted, and that
// the two grammar traps in generated prose (pluralisation, and lower-casing
// text full of unit designations) stay fixed.

import { describe, expect, it } from "vitest";
import { ADVANCE_DURATION_S, BALTIC_SHIELD_ENTITIES } from "@/shared/hla/balticShield";
import { balticShieldRunEvents } from "@/shared/hla/balticShieldEvents";
import { BALTIC_SHIELD_PLAN } from "@/shared/hla/balticShieldPlan";
import { assessPlanCompliance } from "./compliance";
import { generateDebrief } from "./debriefNarrative";
import { computeRunStatistics, type Roster } from "./runStatistics";
import { sampleMockTrack } from "./sampleMockTrack";

const RUN_START_S = 1_700_000_000;

const roster: Roster = new Map(
  BALTIC_SHIELD_ENTITIES.map((entity) => [
    entity.id,
    { label: entity.unit || entity.callsign, force: entity.force },
  ]),
);

function buildDebrief() {
  const track = sampleMockTrack(ADVANCE_DURATION_S);
  const events = balticShieldRunEvents(RUN_START_S, ADVANCE_DURATION_S);
  const compliance = assessPlanCompliance(BALTIC_SHIELD_PLAN, track, ADVANCE_DURATION_S);
  const statistics = computeRunStatistics({
    track,
    roster,
    runDurationSec: ADVANCE_DURATION_S,
    events,
    compliance,
  });

  return {
    statistics,
    events,
    compliance,
    debrief: generateDebrief({
      phaseName: BALTIC_SHIELD_PLAN.phaseName,
      statistics,
      events,
      compliance,
    }),
  };
}

function allText(): string {
  const { debrief } = buildDebrief();
  return [
    debrief.headline,
    ...debrief.sections.flatMap((section) => section.paragraphs),
    ...debrief.findings,
  ].join("\n");
}

describe("generateDebrief", () => {
  it("declares that it was not written by a model", () => {
    expect(buildDebrief().debrief.source).toBe("local-template");
  });

  it("is deterministic — the same run always writes the same debrief", () => {
    expect(buildDebrief().debrief).toEqual(buildDebrief().debrief);
  });

  it("carries the loss figures through from the statistics unchanged", () => {
    const { debrief, statistics } = buildDebrief();
    const text = [debrief.headline, ...debrief.sections.flatMap((s) => s.paragraphs)].join("\n");

    expect(text).toContain(`${statistics.attrition!.blueLosses} friendly platforms`);
    expect(text).toContain(`${statistics.attrition!.redLosses} adversary platforms`);
  });

  it("says plainly that the attrition is scripted, not measured", () => {
    // The single most important sentence in the whole view: this feed publishes
    // no damage state, so an unqualified casualty figure would be a fabrication
    // presented as a finding.
    const text = allText();
    expect(text).toContain("scripted scenario content");
    expect(text).toContain("damage state is never populated");
  });

  it("separates what was measured from what was authored", () => {
    expect(allText()).toContain("measured from the track");
  });

  it("agrees with the plan statistics about how many orders arrived", () => {
    const { debrief, statistics } = buildDebrief();
    const planSection = debrief.sections.find((section) => section.heading === "Plan execution");
    expect(planSection).toBeDefined();
    expect(planSection!.paragraphs.join(" ")).toContain(
      `${statistics.plan!.arrived} reached the position they were given`,
    );
  });

  it("does not lower-case text full of unit designations", () => {
    // "2 mech bn destroys 22nd ac forward detachment" reads like a typo.
    const text = allText();
    expect(text).not.toContain("mech bn");
    expect(text).not.toContain("22nd ac");
  });

  it("does not write a plural noun with a singular verb", () => {
    expect(allText()).not.toMatch(/\b\d+ objectives was\b/);
  });

  it("names the order that was actually carried out, not the first one listed", () => {
    // 1 Mech Bn (West) holds a Screen and an Attack. The advance follows the
    // Screen; saying "only the Attack was carried out" would be exactly wrong.
    const { debrief } = buildDebrief();
    const conflict = debrief.findings.find((finding) => finding.includes("for the same phase"));

    expect(conflict).toBeDefined();
    expect(conflict).toContain("Only the Screen was carried out.");
  });

  it("leads with the run's outcome and the plan's timing together", () => {
    const { debrief, statistics } = buildDebrief();
    expect(debrief.headline).toContain(BALTIC_SHIELD_PLAN.phaseName);
    expect(debrief.headline).toContain(`all ${statistics.plan!.arrived} arrivals were late`);
  });

  it("offers a handful of findings rather than a list of everything", () => {
    const { debrief } = buildDebrief();
    expect(debrief.findings.length).toBeGreaterThan(2);
    expect(debrief.findings.length).toBeLessThanOrEqual(8);
  });
});
