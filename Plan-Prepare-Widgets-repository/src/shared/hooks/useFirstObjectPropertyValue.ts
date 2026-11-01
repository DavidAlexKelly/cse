// ============================================================
// useFirstObjectPropertyValue
//
// Reads one string property off the first object in a widget
// objectSet parameter. Used for the optional "selected X"
// parameters that let one widget follow another's selection.
//
// Extracted from MilMel, which had this inline, so the Task
// Graph could reuse it rather than growing a second copy.
//
// The objectSet comes from @osdk/widget.client-react's parameter
// system, which may use a different internal @osdk/api build
// than the one our code imports, so it is duck-typed here.
// ============================================================

import { useEffect, useState } from "react";

interface FetchableObjectSet {
  fetchPage(opts: {
    $pageSize: number;
  }): Promise<{ data: Array<Record<string, unknown>> }>;
}

/**
 * Returns the property value from the first object in the set, or null
 * when nothing is bound, the set is empty, or the fetch fails.
 */
export function useFirstObjectPropertyValue(
  objectSet: unknown,
  propertyKey: string,
): string | null {
  const [value, setValue] = useState<string | null>(null);

  useEffect(() => {
    if (objectSet == null) {
      setValue(null);
      return;
    }
    const fetchable = objectSet as FetchableObjectSet;
    if (typeof fetchable.fetchPage !== "function") {
      setValue(null);
      return;
    }
    let cancelled = false;
    fetchable
      .fetchPage({ $pageSize: 1 })
      .then((page) => {
        if (cancelled) return;
        setValue((page.data[0]?.[propertyKey] as string | undefined) ?? null);
      })
      .catch(() => {
        if (!cancelled) setValue(null);
      });
    return () => {
      cancelled = true;
    };
  }, [objectSet, propertyKey]);

  return value;
}
