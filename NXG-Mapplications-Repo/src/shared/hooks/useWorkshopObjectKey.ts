// src/shared/hooks/useWorkshopObjectKey.ts
//
// Resolve a Workshop object-set input down to the primary key of the ONE
// object it identifies.
//
// Why this exists
// ───────────────
// A Workshop iframe field can arrive in two shapes, depending on how the field
// is declared in the widget config:
//
//   • type "objectSet"             → ObjectSetLocators ({ type, primaryKeys })
//   • type "temporaryObjectSetRid" → a plain string RID
//                                    ("ri.object-set.main.temporary-object-set.…")
//
// The Scenario Planner declares `scenario` and `selectedPhase` as
// temporaryObjectSetRid (see scenarioConfig.ts), but the readers only handled
// the ObjectSetLocators shape. Every RID Workshop sent was therefore silently
// discarded, and the widget always fell back to the default scenario no matter
// which one the module had selected. This hook accepts both shapes.
//
// Single-object rule
// ──────────────────
// The value only counts as a selection when it identifies EXACTLY ONE object.
// A Workshop variable left on its default is often the type's whole base
// object set — taking "the first one" of that would open an arbitrary object,
// usually one with no data, which is worse than the caller's own default. In
// that case (and when empty, unset or unresolvable) the hook returns null.

import { useEffect, useState } from "react";
import type { ObjectSetLocators } from "@osdk/workshop-iframe-custom-widget";
import type { ObjectTypeDefinition } from "@osdk/client";
import { hydrateObjectSetFromRid } from "@osdk/client/internal";
import { client } from "../../client";

/** Raw value of a Workshop object-set field, in either delivery shape. */
export type WorkshopObjectSetValue = ObjectSetLocators | string | null | undefined;

export interface WorkshopObjectKey {
  /** Primary key of the single object selected, or null when there isn't one. */
  primaryKey: string | null;
  /** True while a temporary object-set RID is being resolved. */
  resolving: boolean;
}

function isObjectSetRid(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("ri.");
}

/** Synchronous path: a locator already carries its primary keys. */
function keyFromLocator(value: WorkshopObjectSetValue): string | null {
  if (!value || typeof value === "string") return null;
  if (value.primaryKeys.length !== 1) {
    if (value.primaryKeys.length > 1) {
      console.warn(
        `[useWorkshopObjectKey] Object set holds ${value.primaryKeys.length} objects — expected one. Ignoring it.`,
      );
    }
    return null;
  }
  return String(value.primaryKeys[0]);
}

export function useWorkshopObjectKey(
  value: WorkshopObjectSetValue,
  objectType: ObjectTypeDefinition,
): WorkshopObjectKey {
  const rid = isObjectSetRid(value) ? value : null;
  const locatorKey = keyFromLocator(value);

  const [resolved, setResolved] = useState<{ rid: string; key: string | null } | null>(null);

  useEffect(() => {
    if (!rid) return;
    let cancelled = false;
    (async () => {
      let key: string | null = null;
      try {
        // Page of two: enough to tell "exactly one" from "more than one"
        // without pulling a whole base object set.
        const page = await hydrateObjectSetFromRid(client, objectType, rid).fetchPage({
          $pageSize: 2,
        });
        if (page.data.length === 1) {
          key = String(page.data[0].$primaryKey);
        } else if (page.data.length > 1) {
          console.warn(
            `[useWorkshopObjectKey] ${objectType.apiName} object set ${rid} holds more than one object — expected one. Ignoring it.`,
          );
        }
      } catch (err) {
        console.warn(
          `[useWorkshopObjectKey] Could not resolve ${objectType.apiName} object set ${rid}:`,
          err,
        );
      }
      if (!cancelled) setResolved({ rid, key });
    })();
    return () => {
      cancelled = true;
    };
  }, [rid, objectType]);

  if (rid) {
    const done = resolved?.rid === rid;
    return { primaryKey: done ? resolved.key : null, resolving: !done };
  }
  return { primaryKey: locatorKey, resolving: false };
}
