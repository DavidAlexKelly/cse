// ── analysisScreen/components/ui.ts ────────────────────────────────────────
// Theme tokens plus the time formatting this screen needs.
//
// The palette itself comes from shared/hla/ui, the same one the live map uses.
// The branch-colour table that used to live here is gone: units are drawn as
// APP-6 symbols now, so affiliation and role are carried by the symbol rather
// than by a colour this app invented.

export { UI, forceColor } from "@/shared/hla/ui";

/** Format epoch seconds as an absolute UTC clock time. */
export function formatClock(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(11, 19);
}

/** Format epoch seconds as a full UTC date-time. */
export function formatDateTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 19).replace("T", " ") + "Z";
}

/** Format a duration in seconds as `H:MM:SS`. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
