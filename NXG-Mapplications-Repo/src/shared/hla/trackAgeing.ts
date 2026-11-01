// ── shared/hla/trackAgeing.ts ──────────────────────────────────────────────
// When a track stops counting as present.
//
// A stream is an append-only log, so nothing is ever removed from it. The live
// map therefore has to decide for itself when an entity has left the
// federation, and that decision is the whole of this module — extracted from
// useEntityTrackStream because it is pure, because it is the part that was
// wrong, and because inside a useEffect it could not be tested.
//
// The rule, and the one that was not
// ----------------------------------
// Presence keys on `observed_at` — when the streamer last *looked* at this
// entity — and on nothing else. It used to key on `bridge_last_updated`, which
// is when the entity's state last *changed*, and the two are not the same
// question. A parked unit reflects no attributes, so its bridge clock freezes
// while it is still published in every 1 Hz tick; measured against a
// high-water mark driven by the aircraft it read as tens of minutes stale and
// was evicted in the same poll that merged it, so it never reached the map.
// Eight of twenty-eight entities vanished that way, silently.
//
// `observed_at` has the property the decision actually needs: an entity that
// genuinely leaves stops appearing in new rows, so its timestamp stops
// advancing; one that is merely sitting still keeps arriving and stays.

import type { TrackRow } from "./trackRow";

/**
 * Drop an entity after this much *stream* time with no new row, while other
 * entities are still reporting.
 */
export const ENTITY_TTL_MS = 10_000;

/**
 * Hard upper bound: drop any entity whose last row is more than this far
 * behind the newest row in the stream, measured entirely in server time.
 *
 * Note that with both rules measured against the same high-water mark this is
 * strictly weaker than ENTITY_TTL_MS and cannot fire on its own. It is kept as
 * the documented backstop, and applied by itself on the failed-read path in
 * useEntityTrackStream, where the tighter rule would be too eager. A feed that
 * stops entirely is handled by neither: the high-water mark stops advancing
 * with it, so nothing ages out and the wall-clock RTI-offline check clears the
 * map instead.
 */
export const ENTITY_MAX_AGE_MS = 60_000;

/**
 * The server timestamp to age a row by: `observed_at`, and only `observed_at`.
 *
 * Deliberately does not consult `bridge_last_updated` — see the header. If you
 * are tempted to add it back as a fallback, the test in trackAgeing.test.ts
 * says why you should not.
 */
export function rowObservedAt(row: TrackRow): number | null {
  const raw = row.observed_at;
  if (raw == null || raw === "") return null;
  const iso = Date.parse(String(raw));
  if (Number.isFinite(iso)) return iso;
  // Tolerate an epoch number, in case the publisher's format ever changes.
  const epoch = Number(raw);
  return Number.isFinite(epoch) ? epoch : null;
}

/**
 * Whether an entity last seen at `lastSeenAt` has aged out, given the newest
 * timestamp anywhere in the stream.
 *
 * Both arguments are server time in epoch millis. Never mix in `Date.now()`:
 * comparing a browser clock against publisher timestamps reintroduces skew as
 * spurious eviction.
 */
export function isExpired(lastSeenAt: number, newest: number): boolean {
  if (newest <= 0) return false;
  const age = newest - lastSeenAt;
  return age > ENTITY_TTL_MS || age > ENTITY_MAX_AGE_MS;
}
