// ============================================================
//  Interactive GraphQL Console
// ============================================================

import { Button } from "@blueprintjs/core";
import React, { useState } from "react";

const DEFAULT_QUERY = `# Query all sides with their groups
{
  sides {
    id
    name
    standardIdentity
    totalPersonnel
    groups {
      id
      name
      branch
      totalPersonnel
      totalUnits
    }
  }
}`;

interface GraphQLConsoleProps {
  onQuery: (query: string, variables?: Record<string, unknown>) => Promise<unknown>;
}

export const GraphQLConsole: React.FC<GraphQLConsoleProps> = ({ onQuery }) => {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [variables, setVariables] = useState("{}");
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    try {
      let vars: Record<string, unknown> = {};
      try { vars = JSON.parse(variables); } catch { /* ignore */ }
      const res = await onQuery(query, vars);
      setResult(JSON.stringify(res, null, 2));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="orbat-panel">
      <div className="orbat-panel__header" style={{ gap: 6 }}>
        <span className="orbat-panel__title" style={{ flex: 1 }}>GraphQL Console</span>
        <span style={{ fontSize: 10, color: "var(--mil-text-2)" }}>In-memory · No network</span>
        <Button
          small intent="primary" icon="play"
          loading={loading}
          onClick={handleRun}
        >
          Run
        </Button>
      </div>

      <div className="gql-console">
        {/* Query editor */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ fontSize: 10, padding: "4px 8px", background: "var(--mil-bg-2)", color: "var(--mil-text-2)", borderBottom: "1px solid var(--mil-border)" }}>
            QUERY
          </div>
          <textarea
            className="gql-editor"
            style={{ flex: 1, minHeight: 200 }}
            value={query}
            onChange={e => setQuery(e.target.value)}
            spellCheck={false}
          />
        </div>

        {/* Variables */}
        <div>
          <div style={{ fontSize: 10, padding: "4px 8px", background: "var(--mil-bg-2)", color: "var(--mil-text-2)", borderBottom: "1px solid var(--mil-border)", borderTop: "1px solid var(--mil-border)" }}>
            VARIABLES (JSON)
          </div>
          <textarea
            className="gql-editor"
            style={{ height: 60 }}
            value={variables}
            onChange={e => setVariables(e.target.value)}
            spellCheck={false}
          />
        </div>

        {/* Result */}
        <div>
          <div style={{ fontSize: 10, padding: "4px 8px", background: "var(--mil-bg-2)", color: "var(--mil-text-2)", borderBottom: "1px solid var(--mil-border)", borderTop: "1px solid var(--mil-border)" }}>
            RESULT
          </div>
          <pre className="gql-result" style={{ color: error ? "#e06050" : "var(--mil-text-2)" }}>
            {error ? `Error: ${error}` : (result || "— Run a query to see results —")}
          </pre>
        </div>
      </div>
    </div>
  );
};
