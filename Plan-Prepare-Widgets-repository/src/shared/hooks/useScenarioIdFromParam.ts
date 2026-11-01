// ============================================================
// useScenarioIdFromObjectSet
//
// Reads a `scenario` objectSet parameter from the widget
// context and resolves the first NxgScenario's scenarioId.
//
// This used to fall back to a hard-coded DEFAULT_SCENARIO_ID
// whenever nothing was bound. That made a misconfigured widget
// look like a working one — it is why two widgets shipped with
// undeclared parameters for so long without anyone noticing,
// and it meant a widget could quietly show (and write to) the
// wrong exercise. It now reports "unbound" instead, and the
// widgets render an explicit empty state.
//
// The objectSet comes from @osdk/widget.client-react's parameter
// system, which may use a different internal @osdk/api build
// than the one our code imports. We avoid type-level coupling
// by accepting `unknown` and calling .fetchPage() via duck typing.
// ============================================================

import { useEffect, useMemo, useState } from "react";

// Duck-typed minimal interface — avoids @osdk/api version conflicts
interface FetchableObjectSet {
  fetchPage(opts: {
    $pageSize: number;
  }): Promise<{ data: Array<Record<string, unknown>> }>;
}

export type ScenarioBindingStatus = "resolving" | "bound" | "unbound";

export interface ScenarioBinding {
  /** "resolving" until the object set has been read once. */
  status: ScenarioBindingStatus;
  /** The resolved scenarioId, or null when resolving or unbound. */
  scenarioId: string | null;
}

const RESOLVING: ScenarioBinding = { status: "resolving", scenarioId: null };
const UNBOUND: ScenarioBinding = { status: "unbound", scenarioId: null };

export function useScenarioIdFromObjectSet(
  objectSet: unknown,
): ScenarioBinding {
  const [status, setStatus] = useState<ScenarioBindingStatus>("resolving");
  const [scenarioId, setScenarioId] = useState<string | null>(null);

  useEffect(() => {
    if (objectSet == null) {
      setStatus("unbound");
      setScenarioId(null);
      return;
    }

    const fetchable = objectSet as FetchableObjectSet;
    if (typeof fetchable.fetchPage !== "function") {
      setStatus("unbound");
      setScenarioId(null);
      return;
    }

    let cancelled = false;
    setStatus("resolving");
    fetchable
      .fetchPage({ $pageSize: 1 })
      .then((page) => {
        if (cancelled) return;
        const id = page.data[0]?.["scenarioId"] as string | undefined;
        if (id) {
          setScenarioId(id);
          setStatus("bound");
        } else {
          // Bound, but the object set resolved to nothing.
          setScenarioId(null);
          setStatus("unbound");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setScenarioId(null);
        setStatus("unbound");
      });

    return () => {
      cancelled = true;
    };
  }, [objectSet]);

  // Stable identity so downstream hooks that depend on this do not refetch
  // on every render.
  return useMemo(() => {
    if (status === "resolving") return RESOLVING;
    if (status === "unbound" || scenarioId == null) return UNBOUND;
    return { status: "bound", scenarioId };
  }, [status, scenarioId]);
}
