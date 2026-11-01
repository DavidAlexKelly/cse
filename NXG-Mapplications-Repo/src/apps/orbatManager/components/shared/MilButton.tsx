/**
 * MilButton.tsx — lightweight button replacing the widget-set's shared MilButton.
 * Matches the variant API used by GroupBuilderPanel / TemplatesPanel.
 */

import React from "react";
import { C } from "./milStyles";

type Variant = "primary" | "default" | "danger" | "ghost";

interface MilButtonProps {
  variant?: Variant;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  title?: string;
  fill?: boolean;
  /** Render only the icon (square button) */
  iconOnly?: boolean;
  /** Not used for rendering — kept for API compat with widget-set */
  icon?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

const VARIANT_STYLES: Record<Variant, React.CSSProperties> = {
  primary: {
    background: "#1565C0",
    color: "#fff",
    border: "none",
  },
  default: {
    background: C.surface,
    color: C.text2,
    border: `1px solid ${C.borderLt}`,
  },
  danger: {
    background: "rgba(176,58,46,0.18)",
    color: "#ef9a9a",
    border: "1px solid rgba(176,58,46,0.45)",
  },
  ghost: {
    background: "none",
    color: C.text2,
    border: `1px solid ${C.border}`,
  },
};

export const MilButton: React.FC<MilButtonProps> = ({
  variant = "default",
  onClick,
  disabled,
  title,
  fill,
  iconOnly,
  children,
  style,
}) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: iconOnly ? "4px 7px" : "4px 12px",
        borderRadius: 3,
        fontSize: 11,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        whiteSpace: "nowrap",
        opacity: disabled ? 0.45 : 1,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        width: fill ? "100%" : undefined,
        justifyContent: fill ? "center" : undefined,
        flexShrink: 0,
        ...VARIANT_STYLES[variant],
        ...style,
      }}
    >
      {children}
    </button>
  );
};
