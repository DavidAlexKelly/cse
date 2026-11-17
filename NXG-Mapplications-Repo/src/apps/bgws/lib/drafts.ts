// ── bgws/lib/drafts.ts ─────────────────────────────────────────────────────
// Scenario drafts kept in the browser, by name.
//
// localStorage, not Foundry: a draft is one planner's scratch work, and BGWS
// only ever sees what is loaded. Inside a Workshop iframe storage can be
// partitioned, blocked or cleared, and every access can throw, so every access
// is wrapped and a failure degrades to "no drafts" rather than a broken screen.
// Export/import JSON is the durable way to keep or share a scenario.

import type { ScenarioDraft } from "../types";
import { draftFromScenario } from "./scenario";

export const DRAFTS_KEY = "bgws.scenarioDrafts.v1";
/** The working copy, autosaved so a reload does not lose an unsaved draft. */
export const WORKING_KEY = "bgws.workingDraft.v1";

export interface SavedDraft {
  name: string;
  savedAt: string;
  draft: ScenarioDraft;
}

/** The storage to use, or null when the browser will not give us one. */
export function browserStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readJson(storage: Storage | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: Storage | null, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota, private mode, or blocked third-party storage in an iframe.
    return false;
  }
}

/**
 * Re-read a stored draft through the importer rather than trusting its shape:
 * a draft saved by an older build may lack fields this one expects.
 */
function revive(value: unknown): ScenarioDraft | null {
  if (!value || typeof value !== "object") return null;
  try {
    return draftFromScenario(value as Record<string, unknown>);
  } catch {
    return null;
  }
}

export function listDrafts(storage: Storage | null): SavedDraft[] {
  const raw = readJson(storage, DRAFTS_KEY);
  if (!raw || typeof raw !== "object") return [];
  const out: SavedDraft[] = [];
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    const e = entry as { savedAt?: unknown; draft?: unknown };
    const draft = revive(e?.draft);
    if (draft) out.push({ name, savedAt: typeof e.savedAt === "string" ? e.savedAt : "", draft });
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function saveDraft(storage: Storage | null, draft: ScenarioDraft, now: Date = new Date()): boolean {
  const name = draft.name.trim() || "Untitled";
  const raw = readJson(storage, DRAFTS_KEY);
  const all = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
  all[name] = { savedAt: now.toISOString(), draft };
  return writeJson(storage, DRAFTS_KEY, all);
}

export function deleteDraft(storage: Storage | null, name: string): boolean {
  const raw = readJson(storage, DRAFTS_KEY);
  if (!raw || typeof raw !== "object") return false;
  const all = { ...(raw as Record<string, unknown>) };
  delete all[name];
  return writeJson(storage, DRAFTS_KEY, all);
}

export function loadWorkingDraft(storage: Storage | null): ScenarioDraft | null {
  return revive(readJson(storage, WORKING_KEY));
}

export function saveWorkingDraft(storage: Storage | null, draft: ScenarioDraft): boolean {
  return writeJson(storage, WORKING_KEY, draft);
}
