// ============================================================
//  Equipment Type Context
//
//  Shares the ontology-loaded NxgEquipmentType catalogue with
//  descendant components (UnitFormDialog, UnitDetailPanel) so
//  they can offer a picker without individually calling OSDK.
//
//  The provider is populated by useOsdkData (in the widget root)
//  and stays in sync with imports that back-fill new types.
// ============================================================

import { createContext, useContext } from "react";
import type { EquipmentTypeRef } from "./types.js";

export interface EquipmentTypeCatalogue {
  /** All equipment types known so far, sorted by nomenclature */
  types: EquipmentTypeRef[];
  /** True while the first fetch is running */
  loading: boolean;
  /** Fetch error message if the initial load failed */
  error: string | null;
}

export const EquipmentTypeContext = createContext<EquipmentTypeCatalogue>({
  types: [],
  loading: false,
  error: null,
});

/** Read the ambient equipment-type catalogue. */
export function useEquipmentTypes(): EquipmentTypeCatalogue {
  return useContext(EquipmentTypeContext);
}
