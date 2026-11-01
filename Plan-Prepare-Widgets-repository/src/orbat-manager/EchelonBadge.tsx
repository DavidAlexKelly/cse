import React from "react";
import { ECHELON_LABELS } from "./types.js";
import type { EchelonLevel } from "./types.js";

interface EchelonBadgeProps {
  echelon: EchelonLevel;
  className?: string;
}

export const EchelonBadge: React.FC<EchelonBadgeProps> = ({ echelon, className }) => (
  <span
    className={`unit-card__echelon ${className ?? ""}`}
    title={ECHELON_LABELS[echelon]}
  >
    {ECHELON_LABELS[echelon]}
  </span>
);
