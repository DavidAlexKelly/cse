import { describe, expect, it } from "vitest";
import { DRAFTS_KEY, deleteDraft, listDrafts, loadWorkingDraft, saveDraft, saveWorkingDraft } from "./drafts";
import { defaultDraft } from "./scenario";

/** A Storage double; `broken` throws on every call, as a blocked iframe storage does. */
function memoryStorage(broken = false): Storage {
  const data = new Map<string, string>();
  const guard = () => {
    if (broken) throw new DOMException("blocked", "SecurityError");
  };
  return {
    get length() {
      return data.size;
    },
    clear: () => (guard(), data.clear()),
    getItem: (k) => (guard(), data.get(k) ?? null),
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => (guard(), void data.delete(k)),
    setItem: (k, v) => (guard(), void data.set(k, v)),
  };
}

describe("drafts", () => {
  it("saves, lists newest first, and deletes by name", () => {
    const s = memoryStorage();
    saveDraft(s, { ...defaultDraft(), name: "Alpha" }, new Date("2026-01-01T00:00:00Z"));
    saveDraft(s, { ...defaultDraft(), name: "Bravo" }, new Date("2026-01-02T00:00:00Z"));
    expect(listDrafts(s).map((d) => d.name)).toEqual(["Bravo", "Alpha"]);
    deleteDraft(s, "Bravo");
    expect(listDrafts(s).map((d) => d.name)).toEqual(["Alpha"]);
  });

  it("overwrites a draft saved under the same name", () => {
    const s = memoryStorage();
    saveDraft(s, { ...defaultDraft(), name: "Alpha", seed: 1 });
    saveDraft(s, { ...defaultDraft(), name: "Alpha", seed: 2 });
    expect(listDrafts(s)).toHaveLength(1);
    expect(listDrafts(s)[0].draft.seed).toBe(2);
  });

  it("keeps a working copy", () => {
    const s = memoryStorage();
    expect(loadWorkingDraft(s)).toBeNull();
    saveWorkingDraft(s, { ...defaultDraft(), name: "WIP" });
    expect(loadWorkingDraft(s)?.name).toBe("WIP");
  });

  it("degrades to nothing when storage throws or is missing", () => {
    const broken = memoryStorage(true);
    expect(saveDraft(broken, defaultDraft())).toBe(false);
    expect(listDrafts(broken)).toEqual([]);
    expect(loadWorkingDraft(null)).toBeNull();
    expect(saveWorkingDraft(null, defaultDraft())).toBe(false);
  });

  it("ignores corrupt stored JSON", () => {
    const s = memoryStorage();
    s.setItem(DRAFTS_KEY, "{not json");
    expect(listDrafts(s)).toEqual([]);
  });
});
