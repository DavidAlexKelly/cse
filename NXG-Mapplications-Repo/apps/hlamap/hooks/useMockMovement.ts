// ── hlamap/hooks/useMockMovement.ts ───────────────────────────────────────
// Client-side-only tween that visually moves mock units when a move/patrol
// command is issued. This does NOT talk to the bridge — bridgeClient.ts
// issues the real bridge_* call in parallel; this hook just keeps the map
// "alive" while the real federate (which may not be connected) catches up.

import { useCallback, useEffect, useRef } from "react";
import type { HlaEntity, LatLon, PatrolType } from "../types";

const SPEED_MPS = 12; // arbitrary constant used only to time the tween

interface MoveJob {
  kind: "move" | "patrol";
  waypoints: LatLon[];
  index: number;
  direction: 1 | -1;
  patrolType?: PatrolType;
  segStart: LatLon;
  segStartTime: number;
  segDurationMs: number;
}

function haversineMeters(a: LatLon, b: LatLon): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function bearingDegrees(a: LatLon, b: LatLon): number {
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const dLambda = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function segmentDurationMs(from: LatLon, to: LatLon): number {
  return Math.max(600, (haversineMeters(from, to) / SPEED_MPS) * 1000);
}

export function useMockMovement(
  setEntities: React.Dispatch<React.SetStateAction<HlaEntity[]>>
) {
  const jobsRef = useRef<Map<string, MoveJob>>(new Map());
  const rafRef = useRef<number | null>(null);

  const tick = useCallback(() => {
    const now = performance.now();
    const jobs = jobsRef.current;
    if (jobs.size > 0) {
      setEntities((prev) =>
        prev.map((entity) => {
          const job = jobs.get(entity.id);
          if (!job) return entity;

          const t = Math.min(1, (now - job.segStartTime) / job.segDurationMs);
          const target = job.waypoints[job.index];
          const heading = bearingDegrees(job.segStart, target);

          if (t < 1) {
            const lat = job.segStart.lat + (target.lat - job.segStart.lat) * t;
            const lon = job.segStart.lon + (target.lon - job.segStart.lon) * t;
            return { ...entity, lat, lon, heading, speed: 30 };
          }

          // Arrived at this segment's target — decide what's next.
          if (job.kind === "move") {
            jobs.delete(entity.id);
            return { ...entity, lat: target.lat, lon: target.lon, heading, speed: 0 };
          }

          // Patrol — advance to the next waypoint per patrolType.
          const nextIndex = job.index + job.direction;
          const atEnd = nextIndex < 0 || nextIndex >= job.waypoints.length;

          if (job.patrolType === "once" && atEnd) {
            jobs.delete(entity.id);
            return { ...entity, lat: target.lat, lon: target.lon, heading, speed: 0 };
          }

          let newIndex = nextIndex;
          let newDirection = job.direction;
          if (atEnd) {
            if (job.patrolType === "pingpong") {
              newDirection = (job.direction * -1) as 1 | -1;
              newIndex = job.index + newDirection;
            } else {
              // loop
              newIndex = job.direction === 1 ? 0 : job.waypoints.length - 1;
            }
          }

          jobs.set(entity.id, {
            ...job,
            index: newIndex,
            direction: newDirection,
            segStart: target,
            segStartTime: now,
            segDurationMs: segmentDurationMs(target, job.waypoints[newIndex]),
          });
          return { ...entity, lat: target.lat, lon: target.lon, heading, speed: 30 };
        })
      );
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [setEntities]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [tick]);

  const moveTo = useCallback((id: string, from: LatLon, to: LatLon) => {
    jobsRef.current.set(id, {
      kind: "move",
      waypoints: [to],
      index: 0,
      direction: 1,
      segStart: from,
      segStartTime: performance.now(),
      segDurationMs: segmentDurationMs(from, to),
    });
  }, []);

  const patrol = useCallback(
    (id: string, from: LatLon, waypoints: LatLon[], patrolType: PatrolType) => {
      if (waypoints.length === 0) return;
      jobsRef.current.set(id, {
        kind: "patrol",
        waypoints,
        index: 0,
        direction: 1,
        patrolType,
        segStart: from,
        segStartTime: performance.now(),
        segDurationMs: segmentDurationMs(from, waypoints[0]),
      });
    },
    []
  );

  const stop = useCallback((id: string) => {
    jobsRef.current.delete(id);
  }, []);

  return { moveTo, patrol, stop };
}
