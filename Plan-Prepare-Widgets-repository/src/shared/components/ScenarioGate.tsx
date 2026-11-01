// ============================================================
// ScenarioGate
//
// Shared gate for the scenario-scoped widgets.
//
// Every one of these widgets is meaningless without a scenario.
// Rather than each rendering its own ad-hoc message — or worse,
// silently loading a default exercise — they all wrap their body
// in this and get one consistent, honest empty state.
//
// The body is supplied as a render function taking a non-null
// scenarioId. That way the widget body cannot be written to cope
// with a missing scenario: the type system guarantees it has one,
// and the body's hooks are never mounted until it does.
// ============================================================

import { Icon } from "@blueprintjs/core";
import React from "react";
import type { ScenarioBinding } from "../hooks/useScenarioIdFromParam.js";
import "../styling/index.css";

interface Props {
  binding: ScenarioBinding;
  /** Name of the parameter to bind, as shown in Workshop. */
  parameterName?: string;
  children: (scenarioId: string) => React.ReactNode;
}

export const ScenarioGate: React.FC<Props> = ({
  binding,
  parameterName = "Scenario",
  children,
}) => {
  if (binding.status === "resolving") {
    return (
      <div className="mil-widget bp5-dark">
        <div className="scn-gate">
          <Icon icon="refresh" size={16} className="scn-gate__icon" />
          <div className="scn-gate__title">Loading scenario…</div>
        </div>
      </div>
    );
  }

  if (binding.status === "unbound" || binding.scenarioId == null) {
    return (
      <div className="mil-widget bp5-dark">
        <div className="scn-gate">
          <Icon icon="disable" size={16} className="scn-gate__icon" />
          <div className="scn-gate__title">No scenario selected</div>
          <div className="scn-gate__body">
            This widget needs an exercise scenario to show anything. In
            Workshop, bind the <strong>{parameterName}</strong> parameter to an
            object set containing a single <strong>[NXG-P] Scenario</strong>.
          </div>
        </div>
      </div>
    );
  }

  return <>{children(binding.scenarioId)}</>;
};
