// apps/execute/lib/runner.ts
//
// What the Execute screen calls: one interface, two implementations.
//
//   liveRunner  the Translator's phase functions and the CSE-Prep functions,
//               via the SDK or the Queries REST API (shared/lib/platformFunctions)
//   demoRunner  the same steps, simulated — for a room with no simulator.
//               It says so in every answer; nothing it returns pretends to be
//               a CSE verdict.
import { executeQuery } from "@/shared/lib/platformFunctions";
import { bridge } from "../../hlamap/bridgeClient";
import {
  type LaunchStepId,
  type PreflightReport,
  cseValidationErrors,
  extractNames,
  isAlreadyExists,
  parseCseResult,
  parsePreflight,
} from "./executePlan";

export interface ExecuteTarget {
  operationKey: string;
  phaseId: string;
  projectName: string;
  composition: string;
}

export interface CseCheck {
  passed: boolean;
  errors: string[];
  note: string;
}

export interface Runner {
  readonly demo: boolean;
  preflight(target: ExecuteTarget): Promise<PreflightReport>;
  compositions(): Promise<string[]>;
  validateWithCse(target: ExecuteTarget): Promise<CseCheck>;
  /** Runs one launch step; resolves with a line for the log. */
  launchStep(step: LaunchStepId, target: ExecuteTarget): Promise<string>;
}

const Q = {
  preflight: ["nxgPreflightOrbatFromPhase", "preflightOrbatFromPhase"],
  translate: ["nxgTranslateOrbatToXmlFromPhase", "translateOrbatToXmlFromPhase"],
  compositions: ["nxgCseGetCompositions", "cseGetCompositions"],
  addProject: ["cseAddProject", "nxgCseAddProject"],
  validateOrbat: ["cseValidateOrbat", "nxgCseValidateOrbat"],
  addOrbat: ["nxgCseAddOrbatToProject", "cseAddOrbatToProject"],
  publish: ["nxgCsePublishProject", "csePublishProject"],
};

function cse(raw: unknown, what: string): unknown {
  const result = parseCseResult(raw);
  if (!result.ok) throw new Error(`${what}: ${result.error}`);
  return result.data;
}

/** A live runner. The exported ORBAT is cached per phase for the launch. */
export function liveRunner(): Runner {
  const xmlByPhase = new Map<string, string>();

  const exportXml = async (t: ExecuteTarget): Promise<string> => {
    const xml = await executeQuery<string>(Q.translate, {
      operation_key: t.operationKey,
      phase_key: t.phaseId,
    });
    if (typeof xml !== "string" || !xml.trim())
      throw new Error("The ORBAT export came back empty.");
    xmlByPhase.set(t.phaseId, xml);
    return xml;
  };

  const ensureProject = async (t: ExecuteTarget): Promise<string> => {
    if (!t.composition) throw new Error("Choose a CSE composition first.");
    const result = parseCseResult(
      await executeQuery(Q.addProject, { project_name: t.projectName, composition: t.composition }),
    );
    if (result.ok) return `Created CSE project ${t.projectName} (${t.composition}).`;
    if (isAlreadyExists(result.error)) return `Using CSE project ${t.projectName}.`;
    throw new Error(`Could not create CSE project ${t.projectName}: ${result.error}`);
  };

  return {
    demo: false,
    async preflight(t) {
      const raw = await executeQuery(Q.preflight, {
        operation_key: t.operationKey,
        phase_key: t.phaseId,
      });
      const report = parsePreflight(raw);
      if (!report) throw new Error("Preflight returned a report that could not be read.");
      return report;
    },
    async compositions() {
      return extractNames(cse(await executeQuery(Q.compositions, {}), "Listing compositions"));
    },
    async validateWithCse(t) {
      const xml = await exportXml(t);
      const note = await ensureProject(t);
      const result = parseCseResult(
        await executeQuery(Q.validateOrbat, { project_name: t.projectName, orbat_content: xml }),
      );
      if (!result.ok) throw new Error(`CSE could not validate the ORBAT: ${result.error}`);
      const errors = cseValidationErrors(result);
      return {
        passed: errors.length === 0,
        errors,
        note: `${note} ${errors.length === 0 ? "CSE accepted the ORBAT" : "CSE rejected the ORBAT"} (${xml.length.toLocaleString()} characters of XML).`,
      };
    },
    async launchStep(step, t) {
      switch (step) {
        case "export": {
          const xml = await exportXml(t);
          return `Exported the phase ORBAT — ${xml.length.toLocaleString()} characters of XML.`;
        }
        case "project":
          return ensureProject(t);
        case "load": {
          const xml = xmlByPhase.get(t.phaseId) ?? (await exportXml(t));
          cse(
            await executeQuery(Q.addOrbat, { project: t.projectName, orbat_content: xml }),
            "Loading the ORBAT",
          );
          return `Loaded the ORBAT into ${t.projectName}.`;
        }
        case "publish":
          cse(await executeQuery(Q.publish, { project_name: t.projectName }), "Publishing");
          return `Published ${t.projectName} — CSE is bringing the federation up.`;
        case "start": {
          const result = await bridge.startScenario();
          if (!result.ok) throw new Error(`Starting the simulation: ${result.error ?? "refused"}`);
          return "Simulation start requested — it shows as running once the federation answers.";
        }
      }
    },
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A simulated runner for demo mode. Counts come from the real phase ORBAT when known. */
export function demoRunner(unitCount: () => number): Runner {
  return {
    demo: true,
    async preflight() {
      await wait(900);
      return {
        summary: "Demo mode — preflight simulated: no errors, no warnings.",
        errors: 0,
        warnings: 0,
        issues: [],
      };
    },
    async compositions() {
      await wait(300);
      return ["CSP-SWORD-VBS4 (demo)"];
    },
    async validateWithCse(t) {
      await wait(1400);
      return {
        passed: true,
        errors: [],
        note: `Demo mode — CSE validation of ${t.projectName} simulated.`,
      };
    },
    async launchStep(step, t) {
      await wait(step === "publish" ? 1800 : 900);
      const n = unitCount();
      switch (step) {
        case "export":
          return `Exported the phase ORBAT${n ? ` — ${n} units` : ""} (demo).`;
        case "project":
          return `Using CSE project ${t.projectName} (demo).`;
        case "load":
          return `Loaded the ORBAT into ${t.projectName} (demo).`;
        case "publish":
          return "Published — federation up (demo).";
        case "start":
          return "Simulation running (demo) — the live map replays the demo federation.";
      }
    },
  };
}
