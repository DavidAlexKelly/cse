import { Button, InputGroup, HTMLSelect } from "@blueprintjs/core";
import React from "react";
import type { FilterState } from "./filterUtils.js";
import { DEFAULT_FILTERS } from "./filterUtils.js";
import { ECHELON_ORDER, ECHELON_LABELS } from "./types.js";

interface FilterBarProps {
  filters: FilterState;
  onChange: (f: FilterState) => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({ filters, onChange }) => {
  const set = (partial: Partial<FilterState>) => onChange({ ...filters, ...partial });
  const isActive = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);

  return (
    <div className="filter-bar">
      <InputGroup
        small
        leftIcon="search"
        placeholder="Filter units…"
        value={filters.text}
        onChange={e => set({ text: e.target.value })}
        style={{ width: 160 }}
      />
      <HTMLSelect
        minimal
        value={filters.echelon}
        onChange={e => set({ echelon: e.target.value as FilterState["echelon"] })}
        style={{ fontSize: 11 }}
      >
        <option value="">All Echelons</option>
        {ECHELON_ORDER.map(e => (
          <option key={e} value={e}>{ECHELON_LABELS[e]}</option>
        ))}
      </HTMLSelect>
      <HTMLSelect
        minimal
        value={filters.status}
        onChange={e => set({ status: e.target.value as FilterState["status"] })}
        style={{ fontSize: 11 }}
      >
        <option value="">All Status</option>
        <option value="active">Active</option>
        <option value="reserve">Reserve</option>
        <option value="destroyed">Destroyed</option>
        <option value="unknown">Unknown</option>
      </HTMLSelect>
      {isActive && (
        <Button small minimal icon="cross" intent="danger" onClick={() => onChange({ ...DEFAULT_FILTERS })}>
          Clear
        </Button>
      )}
    </div>
  );
};
