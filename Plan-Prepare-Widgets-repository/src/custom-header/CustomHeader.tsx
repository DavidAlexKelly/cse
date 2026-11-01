import { Icon } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import { useFoundryWidgetContext } from "@osdk/widget.client-react";
import React, { useCallback } from "react";
import { MilButton } from "../shared/components/Button.js";
import type { MilButtonVariant } from "../shared/components/Button.js";
import "../shared/styling/index.css";
import "./customHeader.css";
import type CustomHeaderConfig from "./customHeader.config.js";

// ── Types ────────────────────────────────────────────────────────────────────

const useWidgetContext =
  useFoundryWidgetContext.withTypes<typeof CustomHeaderConfig>();

const VALID_VARIANTS: MilButtonVariant[] = [
  "default",
  "primary",
  "danger",
  "ghost",
];

function toVariant(raw: string | undefined): MilButtonVariant {
  if (raw && (VALID_VARIANTS as string[]).includes(raw)) {
    return raw as MilButtonVariant;
  }
  return "default";
}

// ── Component ─────────────────────────────────────────────────────────────────

export const CustomHeader: React.FC = () => {
  const { parameters, emitEvent } = useWidgetContext();

  const title        = parameters.values.title ?? "HEADER";
  const subtitle     = parameters.values.subtitle ?? "";
  const iconName     = (parameters.values.iconName ?? "") as IconName | "";
  const buttonLabels = parameters.values.buttonLabels ?? [];
  const buttonVariants  = parameters.values.buttonVariants ?? [];
  const buttonIcons  = parameters.values.buttonIcons ?? [];
  const backgroundColor = parameters.values.backgroundColor ?? "";
  const accentColor  = parameters.values.accentColor ?? "";
  const showBorderBottom = parameters.values.showBorderBottom ?? true;

  const handleButtonClick = useCallback(
    (label: string) => {
      emitEvent("buttonClicked", {
        parameterUpdates: { clickedButton: label },
      });
    },
    [emitEvent],
  );

  // ── Inline style overrides ─────────────────────────────────────────────────
  // Only applied when the Workshop config explicitly sets a value.

  const barStyle: React.CSSProperties = {
    ...(backgroundColor ? { backgroundColor } : {}),
  };

  const iconStyle: React.CSSProperties = {
    ...(accentColor ? { color: accentColor } : {}),
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  //
  // Structure mirrors the reference CSS:
  //   .ch-root                      flex column, flex: 1 1 auto, min-height: 0
  //     .ch-bar                     flex row, flex-shrink: 0
  //       .ch-zone--left            flex: 1 1 0, justify flex-start
  //       .ch-zone--centre          flex: 0 0 auto, justify centre
  //       .ch-zone--right           flex: 1 1 0, justify flex-end
  //
  // This keeps the centre zone perfectly centred at any container width.

  return (
    <div className="ch-root bp5-dark">
      <div
        className={[
          "ch-bar",
          showBorderBottom === false ? "ch-bar--no-border" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={barStyle}
      >
        {/* ── Left zone: icon + title + subtitle ── */}
        <div className="ch-zone ch-zone--left">
          <div className="ch-title-block">
            {iconName && (
              <Icon
                icon={iconName}
                size={14}
                className="ch-icon"
                style={iconStyle}
              />
            )}
            <span className="ch-title">{title}</span>
            {subtitle && (
              <span className="ch-subtitle">{subtitle}</span>
            )}
          </div>
        </div>

        {/* ── Centre zone: empty by default, ready for future use ── */}
        <div className="ch-zone ch-zone--centre" />

        {/* ── Right zone: action buttons ── */}
        <div className="ch-zone ch-zone--right">
          {buttonLabels.length > 0 && (
            <div className="ch-actions">
              {buttonLabels.map((label, i) => {
                const variant = toVariant(buttonVariants[i]);
                const iconRaw = buttonIcons[i] ?? "";
                const btnIcon =
                  iconRaw !== "" ? (iconRaw as IconName) : undefined;

                return (
                  <MilButton
                    key={`${label}-${i}`}
                    variant={variant}
                    icon={btnIcon}
                    onClick={() => handleButtonClick(label)}
                  >
                    <span className="ch-btn-label">{label}</span>
                  </MilButton>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
