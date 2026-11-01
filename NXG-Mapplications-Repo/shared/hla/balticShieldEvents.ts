// ── shared/hla/balticShieldEvents.ts ───────────────────────────────────────
// The scripted engagement log for the OP-BALTIC-SHIELD-2026 mock run.
//
// Every event here is authored, and every one is stamped `provenance:
// "scripted"`. None of it is derived from the HLA feed and none of it could be:
// the feed publishes no attrition and no activity, so contact, losses and
// effects simply are not in it. The debrief labels this accordingly. Inventing
// numbers is fine for a demo; letting them be mistaken for measurements is not.
//
// Positions are NOT authored. Each event names the unit that acted, and the
// location is looked up from laydownAt() at that point in the run — so an event
// is always where its unit actually was, and editing a unit's legs moves its
// events with it instead of leaving them stranded.
//
// The six beats the mock timeline used to carry are all still here, with the
// same wording, so the narrative an audience may already have seen is unchanged
// — they have simply gained participants, means and a cost.

import { laydownAt } from "./balticShield";
import type { RunEvent, RunEventKind, RunEventLosses, RunEventParty } from "./runEvents";

interface ScriptedEvent {
  id: string;
  /** Fraction through the phase, 0–1. */
  at: number;
  kind: RunEventKind;
  /** The side that acted. */
  force: "BLUE" | "RED";
  /** Entity whose position the event is placed at, and who is credited with it. */
  actorId?: string;
  targetId?: string;
  label: string;
  detail: string;
  means?: string;
  losses?: RunEventLosses;
}

const SCRIPT: ScriptedEvent[] = [
  {
    id: "h-hour",
    at: 0.01,
    kind: "phase",
    force: "BLUE",
    label: "H-Hour — Phase 1 begins",
    detail:
      "Phase 1, Secure the Reinforcement Corridor, opens. Reinforcements are ashore at the " +
      "port of entry and the corridor east along ROUTE BLUE is open but unscreened. Adversary " +
      "ISR is assessed active from this moment.",
  },
  {
    id: "isr-detect-1gmrd",
    at: 0.08,
    kind: "detection",
    force: "BLUE",
    actorId: "bs-port-isr",
    targetId: "bs-1gmrd",
    means: "Ground surveillance radar",
    label: "ISR detects 1st GMRD crossing the line of departure",
    detail:
      "Port ISR squadron reports a brigade-sized column crossing the oblast boundary on a " +
      "south-westerly axis, correlated as 1st GMRD. First confirmation that the adversary " +
      "advance has begun; the corridor screen is ordered forward in response.",
  },
  {
    id: "sat-image-hub",
    at: 0.13,
    kind: "detection",
    force: "RED",
    actorId: "bs-sat-isr",
    targetId: "bs-css-hub",
    means: "Overhead imagery",
    label: "Adversary ISR satellite images the CSS logistics hub",
    detail:
      "An overhead pass images the logistics hub at OBJ GATE while it is still concentrated. " +
      "The hub does not disperse before the pass completes, and the long-range fires that " +
      "follow are consistent with targeting derived from it.",
  },
  {
    id: "west-screen-set",
    at: 0.19,
    kind: "objective",
    force: "BLUE",
    actorId: "bs-bg-west",
    label: "1 Mech Bn establishes the western screen",
    detail:
      "1 Mech Bn (West) reports its screen established north of ROUTE BLUE, completing the " +
      "task it was given in the phase order. It is the first ordered objective reached in the " +
      "phase, though later than the plan assumed.",
  },
  {
    id: "arty-engages-centre",
    at: 0.22,
    kind: "engagement",
    force: "RED",
    actorId: "bs-lr-arty",
    targetId: "bs-bg-centre",
    means: "BM-30 Smerch",
    losses: { blue: 3, red: 0 },
    label: "Long-range artillery engages 2 Mech Bn screen",
    detail:
      "A rocket artillery brigade fires on the centre screen as it moves onto its blocking " +
      "positions, destroying three vehicles. The battalion continues the move; the fires " +
      "arrive from beyond the range at which it can reply.",
  },
  {
    id: "22ac-destroys-west-recce",
    at: 0.35,
    kind: "loss",
    force: "RED",
    actorId: "bs-22ac",
    targetId: "bs-bg-west",
    means: "Direct fire",
    losses: { blue: 6, red: 1 },
    label: "22nd AC destroys 1 Mech Bn recce screen (WEST-01)",
    detail:
      "22nd AC MRBDE's lead battalion overruns the recce element screening the western " +
      "approach. Six vehicles are lost for one of the adversary's; the screen is no longer " +
      "combat-effective and the western approach to the corridor is uncovered for the rest " +
      "of the phase.",
  },
  {
    id: "ew-jams-corridor",
    at: 0.51,
    kind: "ew",
    force: "RED",
    actorId: "bs-ew-bn",
    targetId: "bs-bg-centre",
    means: "Ground-based jamming",
    label: "EW Battalion jams the corridor command net",
    detail:
      "The adversary EW battalion suppresses the corridor command net. Battalion-to-brigade " +
      "traffic is degraded for the middle third of the phase, which is the period in which " +
      "the centre screen's reporting thins out.",
  },
  {
    id: "armour-counterattacks",
    at: 0.57,
    kind: "engagement",
    force: "BLUE",
    actorId: "bs-armour",
    targetId: "bs-22ac",
    means: "Direct fire",
    losses: { blue: 1, red: 4 },
    label: "3 Armd Bn engages 22nd AC on the move",
    detail:
      "The armoured reserve, moving west out of its assembly area, makes contact with 22nd " +
      "AC's flank and destroys four vehicles for one of its own. The engagement is " +
      "unplanned — the battalion was tasked only to occupy the assembly area — and it is the " +
      "point at which it leaves the objective it had just reached.",
  },
  {
    id: "iskander-strikes-fsa",
    at: 0.63,
    kind: "engagement",
    force: "RED",
    actorId: "bs-iskander",
    targetId: "bs-css-fsa",
    means: "Iskander-M",
    losses: { blue: 4, red: 0 },
    label: "SRBM strike on the forward staging area",
    detail:
      "A short-range ballistic missile strike lands on the forward staging area at the " +
      "eastern end of the corridor. Four vehicles are destroyed. The staging area is inside " +
      "the adversary's declared engagement envelope for the whole phase and was not " +
      "dispersed.",
  },
  {
    id: "gbad-engages-rotary",
    at: 0.68,
    kind: "engagement",
    force: "BLUE",
    actorId: "bs-gbad",
    means: "IRIS-T SLM",
    losses: { blue: 0, red: 2 },
    label: "AD Bty engages adversary rotary-wing over ROUTE BLUE",
    detail:
      "The corridor air defence battery engages a rotary-wing pair attempting to attack " +
      "transport on ROUTE BLUE, destroying both. The corridor's air defence is the one part " +
      "of the plan that works as intended and on time.",
  },
  {
    id: "dd-detects-bastion",
    at: 0.74,
    kind: "detection",
    force: "BLUE",
    actorId: "bs-dd-north",
    targetId: "bs-bastion",
    means: "ESM",
    label: "DD Escort detects BASTION-P coastal battery radar",
    detail:
      "The northern escort's ESM suite picks up the coastal defence battery's target " +
      "acquisition radar. The amphibious group holds its stand-off distance rather than " +
      "closing, which keeps it outside the battery's engagement envelope for the remainder " +
      "of the phase.",
  },
  {
    id: "centre-destroys-22ac-det",
    at: 0.84,
    kind: "loss",
    force: "BLUE",
    actorId: "bs-bg-centre",
    targetId: "bs-22ac",
    means: "Direct fire and indirect support",
    losses: { blue: 2, red: 7 },
    label: "2 Mech Bn destroys 22nd AC forward detachment",
    detail:
      "The centre screen halts and destroys 22nd AC's forward detachment, seven vehicles for " +
      "two. It is the heaviest single exchange of the phase and the point at which the " +
      "adversary advance in the centre stops short of the corridor.",
  },
  {
    id: "harbour-offload",
    at: 0.91,
    kind: "objective",
    force: "BLUE",
    actorId: "bs-port-css",
    label: "Reception Bn completes offload at OBJ HARBOUR",
    detail:
      "The port of entry reception battalion completes its offload. Corridor throughput is " +
      "sustained for the phase despite the loss of vehicles at the forward staging area.",
  },
  {
    id: "phase-end",
    at: 0.985,
    kind: "phase",
    force: "BLUE",
    label: "Phase 1 ends — corridor held",
    detail:
      "The phase closes with ROUTE BLUE open and the adversary advance halted short of it in " +
      "the centre, but with the western approach uncovered and the armoured reserve out of " +
      "position. Both are carried into Phase 2.",
  },
];

/** Display name and side for each entity the script refers to. */
function partyFor(entityId: string | undefined, progress: number): RunEventParty | undefined {
  if (!entityId) return undefined;
  const entity = laydownAt(progress).find((candidate) => candidate.id === entityId);
  if (!entity) return undefined;
  return {
    entityId,
    label: entity.unit || entity.callsign,
    force: entity.force,
  };
}

/**
 * The scripted log, placed on a run's clock.
 *
 * Positions and unit names are resolved from the laydown at the moment of the
 * event rather than authored, so the log cannot drift away from the movement it
 * describes.
 */
export function balticShieldRunEvents(runStartS: number, runDurationSec: number): RunEvent[] {
  return SCRIPT.map((scripted): RunEvent => {
    const tSec = Math.round(scripted.at * runDurationSec);
    const actor = partyFor(scripted.actorId, scripted.at);
    const target = partyFor(scripted.targetId, scripted.at);

    const positioned = scripted.actorId
      ? laydownAt(scripted.at).find((entity) => entity.id === scripted.actorId)
      : undefined;

    return {
      id: `bs-event-${scripted.id}`,
      ts: runStartS + tSec,
      tSec,
      kind: scripted.kind,
      provenance: "scripted",
      force: scripted.force,
      label: scripted.label,
      detail: scripted.detail,
      actor,
      target,
      means: scripted.means,
      losses: scripted.losses,
      location:
        positioned && Number.isFinite(positioned.lat) && Number.isFinite(positioned.lon)
          ? { lat: positioned.lat, lon: positioned.lon }
          : undefined,
    };
  });
}

export default balticShieldRunEvents;
