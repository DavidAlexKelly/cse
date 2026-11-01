// The shared rule cases (./__fixtures__/rules.json), run against the
// TypeScript implementations. The same file is run by the Translator's Python
// suite (tests/test_shared_rules.py), so the two cannot drift without a test
// failing on one side. Canonical copy: NXG-Translator
// python-functions/python/tests/shared/rules_fixture.json — edit there, copy here.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SIM_TARGETS } from "@/shared/types";
import rules from "./__fixtures__/rules.json";
import { normaliseSimTarget } from "./assetEligibility";
import { PLACEHOLDER_DIS } from "./model";
import { parseConstituents } from "./swordFormations";

const CANONICAL = resolve(
  __dirname,
  "../../../../NXG-Translator/python-functions/python/tests/shared/rules_fixture.json",
);

describe("shared rules", () => {
  it("uses the same placeholder DIS", () => {
    expect(PLACEHOLDER_DIS).toBe(rules.placeholderDis);
  });

  for (const c of rules.constituents) {
    it(`parses constituents: ${c.name}`, () => {
      expect(parseConstituents(c.raw)).toEqual(c.expected);
    });
  }

  for (const c of rules.simulatorNames) {
    it(`normalises simulator ${JSON.stringify(c.raw)}`, () => {
      // The app models only the simulators with asset catalogues; the rest
      // (ascot7, jtls-go, mace) are "no catalogue target" here.
      const expected =
        c.expected && (SIM_TARGETS as readonly string[]).includes(c.expected) ? c.expected : null;
      expect(normaliseSimTarget(c.raw)).toBe(expected);
    });
  }

  it.skipIf(!existsSync(CANONICAL))("is the same table the Translator runs", () => {
    expect(rules).toEqual(JSON.parse(readFileSync(CANONICAL, "utf8")));
  });
});
