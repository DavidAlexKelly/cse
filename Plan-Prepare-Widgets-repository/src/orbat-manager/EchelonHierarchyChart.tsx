// ============================================================
//  Echelon Hierarchy Reference Chart
// ============================================================

import React from "react";
import { ECHELON_ORDER, ECHELON_LABELS } from "./types.js";
import { NatoSymbol } from "./NatoSymbol.js";

const ECHELON_PAX: Record<string, string> = {
  team:      "2–6",
  squad:     "6–14",
  section:   "8–14",
  platoon:   "28–56",
  company:   "80–250",
  battalion: "300–1,200",
  regiment:  "1,000–3,000",
  brigade:   "3,000–8,000",
  division:  "10,000–25,000",
  corps:     "20,000–80,000",
  army:      "80,000–400,000",
  armyGroup: "400,000–1,000,000",
  theatre:   "1,000,000+",
};

const ECHELON_MARK_LABEL: Record<string, string> = {
  team:      "•",
  squad:     "••",
  section:   "•••",
  platoon:   "┃",
  company:   "┃┃",
  battalion: "┃┃┃",
  regiment:  "┃┃┃",
  brigade:   "✕",
  division:  "✕✕",
  corps:     "✕✕✕",
  army:      "A",
  armyGroup: "AG",
  theatre:   "T",
};

export const EchelonHierarchyChart: React.FC = () => {
  const reversed = [...ECHELON_ORDER].reverse();

  return (
    <div className="orbat-panel">
      <div className="orbat-panel__header">
        <span className="orbat-panel__title" style={{ flex: 1 }}>
          NATO Echelon Reference
        </span>
      </div>
      <div className="orbat-panel__content">
        <div style={{ marginBottom: 12, fontSize: 11, color: "var(--mil-text-2)", lineHeight: 1.6 }}>
          NATO APP-6D standard echelon hierarchy, from largest to smallest.
          Marks shown above the symbol frame.
        </div>
        {reversed.map((echelon, i) => (
          <div key={echelon} className="echelon-ref-row"
            style={{ background: i % 2 === 0 ? "var(--mil-surface)" : "transparent" }}
          >
            <NatoSymbol
              standardIdentity="friend"
              echelon={echelon}
              icon="infantry"
              size={32}
            />
            <div className="echelon-ref-mark">{ECHELON_MARK_LABEL[echelon]}</div>
            <div>
              <div className="echelon-ref-label">{ECHELON_LABELS[echelon]}</div>
              <div style={{ fontSize: 10, color: "var(--mil-text-2)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {echelon}
              </div>
            </div>
            <div className="echelon-ref-pax">{ECHELON_PAX[echelon]} personnel</div>
          </div>
        ))}
      </div>
    </div>
  );
};
