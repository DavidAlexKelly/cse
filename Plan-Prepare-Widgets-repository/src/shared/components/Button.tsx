import { Icon } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import React from "react";
import "../styling/components.css";

// ── Variant → CSS modifier map ─────────────────────────────────────────────
const VARIANT_CLASS: Record<MilButtonVariant, string> = {
  default: "mil-btn--default",
  primary: "mil-btn--primary",
  danger:  "mil-btn--danger",
  ghost:   "mil-btn--ghost",
};

const SIZE_CLASS: Record<MilButtonSize, string> = {
  sm: "mil-btn--sm",
  md: "mil-btn--md",
};

// ── Public types ───────────────────────────────────────────────────────────
export type MilButtonVariant = "default" | "primary" | "danger" | "ghost";
export type MilButtonSize    = "sm" | "md";

export interface MilButtonProps {
  /** Button label text */
  children?: React.ReactNode;
  /** BlueprintJS icon to show on the left */
  icon?: IconName;
  /** BlueprintJS icon to show on the right */
  rightIcon?: IconName;
  variant?: MilButtonVariant;
  size?: MilButtonSize;
  /** Render without label — icon only, square aspect */
  iconOnly?: boolean;
  disabled?: boolean;
  /** Fill 100% of the container width */
  fill?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  title?: string;
  type?: "button" | "submit" | "reset";
}

// ── Component ──────────────────────────────────────────────────────────────
export const MilButton: React.FC<MilButtonProps> = ({
  children,
  icon,
  rightIcon,
  variant = "default",
  size = "sm",
  iconOnly = false,
  disabled = false,
  fill = false,
  onClick,
  className = "",
  title,
  type = "button",
}) => {
  const classes = [
    "mil-btn",
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    iconOnly ? "mil-btn--icon-only" : "",
    fill      ? "mil-btn--fill"      : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {icon      && <Icon icon={icon}      size={size === "sm" ? 12 : 14} className="mil-btn__icon mil-btn__icon--left"  />}
      {!iconOnly && children && <span className="mil-btn__label">{children}</span>}
      {rightIcon && <Icon icon={rightIcon} size={size === "sm" ? 12 : 14} className="mil-btn__icon mil-btn__icon--right" />}
    </button>
  );
};
