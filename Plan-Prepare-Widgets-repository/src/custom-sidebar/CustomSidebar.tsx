import { Icon } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import { useFoundryWidgetContext } from "@osdk/widget.client-react";
import React, { useCallback } from "react";
import { MilLabel } from "../shared/components/Label.js";
import type { MilLabelIntent } from "../shared/components/Label.js";
import "../shared/styling/index.css";
import "./customSidebar.css";
import type CustomSidebarConfig from "./customSidebar.config.js";

// ── Context ───────────────────────────────────────────────────────────────────

const useWidgetContext =
  useFoundryWidgetContext.withTypes<typeof CustomSidebarConfig>();

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_INTENTS: MilLabelIntent[] = [
  "green",
  "amber",
  "red",
  "blue",
  "grey",
];

function toIntent(raw: string | undefined): MilLabelIntent {
  if (raw && (VALID_INTENTS as string[]).includes(raw)) {
    return raw as MilLabelIntent;
  }
  return "grey";
}

// ── Component ─────────────────────────────────────────────────────────────────

export const CustomSidebar: React.FC = () => {
  const { parameters, emitEvent } = useWidgetContext();

  // ── Read parameters ──────────────────────────────────────────────────────

  const itemLabels       = parameters.values.itemLabels       ?? [];
  const itemIcons        = parameters.values.itemIcons        ?? [];
  const itemBadges       = parameters.values.itemBadges       ?? [];
  const itemBadgeIntents = parameters.values.itemBadgeIntents ?? [];
  const sectionAfterItems = parameters.values.sectionAfterItems ?? [];

  const selectedItem    = parameters.values.selectedItem    ?? "";
  const sidebarTitle    = parameters.values.sidebarTitle    ?? "";
  const sidebarIcon     = (parameters.values.sidebarIcon ?? "") as IconName | "";
  const collapsed       = parameters.values.collapsed       ?? false;
  const showCollapseToggle = parameters.values.showCollapseToggle ?? true;

  const backgroundColor = parameters.values.backgroundColor ?? "";
  const accentColor     = parameters.values.accentColor     ?? "";
  const showBorderRight = parameters.values.showBorderRight ?? true;

  const expandedWidth  = parameters.values.expandedWidth  ?? 200;
  const collapsedWidth = parameters.values.collapsedWidth ?? 48;

  // ── Events ───────────────────────────────────────────────────────────────

  const handleItemClick = useCallback(
    (label: string) => {
      emitEvent("itemSelected", {
        parameterUpdates: { selectedItem: label },
      });
    },
    [emitEvent],
  );

  const handleCollapseToggle = useCallback(() => {
    emitEvent("collapseToggled", {
      parameterUpdates: { collapsed: !collapsed },
    });
  }, [emitEvent, collapsed]);

  // ── Derived styles ────────────────────────────────────────────────────────

  const currentWidth = collapsed ? collapsedWidth : expandedWidth;

  const railStyle: React.CSSProperties = {
    width: currentWidth,
    minWidth: currentWidth,
    maxWidth: currentWidth,
    ...(backgroundColor ? { backgroundColor } : {}),
  };

  // The shared design system already styles the active state (indigo gradient
  // + border). Inline styles are only applied when a bespoke accent colour is
  // configured in Workshop, so the default look stays consistent across widgets.
  const activeItemStyle: React.CSSProperties | undefined = accentColor
    ? {
        borderColor: `${accentColor}66`, /* ~40% opacity */
        background: `linear-gradient(100deg, ${accentColor}33 0%, ${accentColor}0d 100%)`,
      }
    : undefined;

  const activeIconStyle: React.CSSProperties | undefined = accentColor
    ? {
        color: accentColor,
        background: `${accentColor}29`,
        borderColor: `${accentColor}73`,
      }
    : undefined;

  const headerIconStyle: React.CSSProperties | undefined = accentColor
    ? { color: accentColor }
    : undefined;

  // ── Render ────────────────────────────────────────────────────────────────
  //
  // Layout contract (mirrors customHeader.css philosophy):
  //
  //   .csb-root             flex column, flex: 1 1 auto, min-height: 0
  //     .csb-rail           flex column, fills root, width transitions
  //       .csb-header       flex-shrink: 0  — always visible
  //       .csb-nav          flex: 1 1 auto, min-height: 0, overflow-y: auto
  //         .csb-item × N   each item fixed min-height
  //         .csb-divider    1px rule between sections
  //       .csb-footer       flex-shrink: 0  — pinned at bottom

  return (
    <div className="csb-root bp5-dark">
      <div
        className={[
          "csb-rail",
          !showBorderRight ? "csb-rail--no-border" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={railStyle}
      >
        {/* ── Branding header ── */}
        {(sidebarTitle || sidebarIcon) && (
          <div className="csb-header">
            {sidebarIcon && (
              <Icon
                icon={sidebarIcon}
                size={14}
                className="csb-header__icon"
                style={headerIconStyle}
              />
            )}
            <span
              className={[
                "csb-header__title",
                collapsed ? "csb-header__title--hidden" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {sidebarTitle}
            </span>
          </div>
        )}

        {/* ── Nav list ── */}
        <nav className="csb-nav" aria-label="Sidebar navigation">
          {itemLabels.map((label, i) => {
            const isActive   = label === selectedItem;
            const iconRaw    = itemIcons[i] ?? "";
            const icon       = iconRaw !== "" ? (iconRaw as IconName) : undefined;
            const badge      = itemBadges[i] ?? "";
            const intent     = toIntent(itemBadgeIntents[i]);
            const hasDivider = sectionAfterItems[i] === true;

            return (
              <React.Fragment key={`${label}-${i}`}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-current={isActive ? "page" : undefined}
                  data-label={label}
                  className={[
                    "csb-item",
                    isActive ? "csb-item--active" : "",
                    collapsed ? "csb-item--collapsed" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={isActive ? activeItemStyle : undefined}
                  onClick={() => handleItemClick(label)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleItemClick(label);
                    }
                  }}
                >
                  {/* Icon */}
                  <span
                    className="csb-item__icon"
                    style={isActive ? activeIconStyle : undefined}
                  >
                    {icon ? (
                      <Icon icon={icon} size={14} />
                    ) : (
                      /* Fallback: first letter as a small monogram */
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          fontFamily: "monospace",
                          lineHeight: 1,
                        }}
                      >
                        {label.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </span>

                  {/* Label */}
                  <span
                    className={[
                      "csb-item__label",
                      collapsed ? "csb-item__label--hidden" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {label}
                  </span>

                  {/* Badge */}
                  {badge && (
                    <span
                      className={[
                        "csb-item__badge",
                        collapsed ? "csb-item__badge--hidden" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <MilLabel intent={intent}>{badge}</MilLabel>
                    </span>
                  )}
                </div>

                {/* Section divider */}
                {hasDivider && <div className="csb-divider" />}
              </React.Fragment>
            );
          })}
        </nav>

        {/* ── Footer: collapse toggle ── */}
        {showCollapseToggle && (
          <div className="csb-footer">
            <button
              className={[
                "csb-collapse-btn",
                collapsed ? "csb-collapse-btn--collapsed" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={handleCollapseToggle}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <span
                className={[
                  "csb-collapse-btn__icon",
                  collapsed ? "csb-collapse-btn__icon--flipped" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {/* Double-chevron left/right to signal collapse direction */}
                <Icon icon="double-chevron-left" size={12} />
              </span>
              <span
                className={[
                  "csb-collapse-btn__label",
                  collapsed ? "csb-collapse-btn__label--hidden" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                Collapse
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
