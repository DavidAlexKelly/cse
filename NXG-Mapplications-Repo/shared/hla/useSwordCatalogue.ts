// ── shared/hla/useSwordCatalogue.ts ──────────────────────────────────────
// The SWORD asset catalogue, keyed for symbol lookup.
//
// [NXG-O] Sword Asset Catalogue holds one row per SWORD asset type with its
// APP-6 nature path and echelon — the authoritative source for what a unit *is*,
// which the HLA stream does not carry (symbol_id is empty on every row, and
// SWORD's DIS codes are non-standard; see symbology/app6.ts).
//
// 81 rows, static for the life of a session, so this fetches once and holds it.
// Loaded from the ontology rather than hard-coded so that catalogue edits show
// up in the map without a rebuild.

import { useEffect, useState } from "react";
import { NxgOSwordAssetCatalogue } from "@nxg-simulation-execution-testing/sdk";
import { client } from "@/client";
import { buildCatalogueIndex, type CatalogueIndex } from "./symbology/app6";

export type SwordCatalogue = CatalogueIndex;

export interface SwordCatalogueState {
  catalogue: SwordCatalogue;
  loading: boolean;
  error: string | null;
}

const EMPTY: SwordCatalogue = { byName: new Map(), byBase: new Map() };

export function useSwordCatalogue(): SwordCatalogueState {
  const [catalogue, setCatalogue] = useState<SwordCatalogue>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // 81 rows today; a single page with room to spare, and the map degrades
        // to DIS-derived frames if this ever silently truncates.
        const page = await client(NxgOSwordAssetCatalogue).fetchPage({ $pageSize: 500 });
        if (cancelled) return;

        // Indexed by exact name and by base type: the catalogue lists parent
        // types ("Rifle company") while the federation publishes subordinate
        // echelons ("INF.Rifle platoon"), so both keys are needed.
        const next = buildCatalogueIndex(
          page.data.map((asset) => ({
            name: asset.name,
            displayName: asset.displayName,
            natureApp6: asset.natureApp6,
            echelonLevel: asset.echelonLevel,
          }))
        );
        setCatalogue(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error("[useSwordCatalogue] could not load the asset catalogue:", err);
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { catalogue, loading, error };
}

export default useSwordCatalogue;
