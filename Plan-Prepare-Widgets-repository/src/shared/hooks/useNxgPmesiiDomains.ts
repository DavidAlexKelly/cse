// ============================================================
// useNxgPmesiiDomains
//
// Loads NxgPmesiiDomain objects from the ontology, filtered
// by scenarioId, mapped to the PmesiiVariable shape used by
// PmesiiAnalysis.tsx.
//
// Falls back to the static MOCK_PMESII_VARIABLES when the
// scenario has no domains or the fetch fails; `source` says
// which of the two the caller is looking at.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { NxgPmesiiDomain } from "@custom-widget/sdk";
import type { Osdk } from "@osdk/client";
import { client } from "../../client.js";
import { MOCK_PMESII_VARIABLES } from "../../pmesii-analysis/mockData.js";
import { pmesiiStatusToDisplay } from "../pmesii/pmesiiStatus.js";
import type { DataSource } from "./dataSource.js";
import type {
  PmesiiVariable,
  PmesiiDomain,
} from "../../pmesii-analysis/types.js";

// Canonical PMESII-PT domain order
const DOMAIN_ORDER: PmesiiDomain[] = [
  "Political",
  "Military",
  "Economic",
  "Social",
  "Infrastructure",
  "Information",
  "Physical Environment",
  "Time",
];

function normaliseDomain(key: string | null | undefined): PmesiiDomain {
  const match = DOMAIN_ORDER.find(
    (d) => d.toLowerCase() === (key ?? "").toLowerCase(),
  );
  return match ?? "Political";
}

function osdkToVariable(obj: Osdk.Instance<NxgPmesiiDomain>): PmesiiVariable {
  return {
    id: obj.domainId,
    domain: normaliseDomain(obj.domainKey),
    status: pmesiiStatusToDisplay(obj.domainStatus),
    summary: obj.domainValue ?? "",
    reviewer: obj.reviewerPersonId ?? null,
  };
}

export interface UseNxgPmesiiDomainsResult {
  variables: PmesiiVariable[];
  loading: boolean;
  error: string | null;
  /** Whether `variables` came from the ontology or from local seed data. */
  source: DataSource;
  refresh: () => void;
}

export function useNxgPmesiiDomains(
  scenarioId: string | null | undefined,
): UseNxgPmesiiDomainsResult {
  const [variables, setVariables] = useState<PmesiiVariable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<DataSource>("unbound");

  const load = useCallback(async () => {
    // No scenario bound — show nothing rather than quietly loading a
    // default exercise. The widget renders an explicit empty state.
    if (scenarioId == null) {
      setVariables([]);
      setSource("unbound");
      setLoading(false);
      setError(null);
      return;
    }
    const resolvedId = scenarioId;

    setLoading(true);
    setError(null);
    try {
      const results: PmesiiVariable[] = [];
      for await (const obj of client(NxgPmesiiDomain)
        .where({ scenarioId: { $eq: resolvedId } })
        .asyncIter()) {
        results.push(osdkToVariable(obj));
      }
      if (results.length > 0) {
        // Sort into canonical PMESII-PT domain order
        results.sort(
          (a, b) =>
            DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain),
        );
        setVariables(results);
        setSource("ontology");
      } else {
        setVariables(MOCK_PMESII_VARIABLES);
        setSource("seed");
      }
    } catch (e) {
      setError(String(e));
      setVariables(MOCK_PMESII_VARIABLES);
      setSource("seed");
    } finally {
      setLoading(false);
    }
  }, [scenarioId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { variables, loading, error, source, refresh: load };
}
