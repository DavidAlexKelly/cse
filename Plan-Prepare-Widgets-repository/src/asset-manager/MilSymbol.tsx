// ============================================================
//  MilSymbol — thin React wrapper around the milsymbol library
// ============================================================
//
//  Renders a NATO APP-6 / MIL-STD-2525 symbol from a SIDC string
//  using the `milsymbol` npm package. Configured for the LETTER-
//  based SIDC standard (APP-6D / 2525C).
//
//  The underlying library returns an SVG string. Rather than using
//  dangerouslySetInnerHTML we parse the SVG with DOMParser (so the
//  browser performs its own structural parse in a safe, detached
//  document) and then adopt the resulting <svg> node into the live
//  DOM via a React ref. DOMPurify still sanitizes the string first
//  as an extra defence-in-depth layer.

import React, { useRef, useEffect } from "react";
import ms from "milsymbol";
import DOMPurify from "dompurify";

interface MilSymbolProps {
  /** A letter-based (15-character) or number-based (20/30-digit) SIDC. */
  sidc: string;
  /** Overall pixel size (roughly = octagon height). Defaults to 40. */
  size?: number;
  /** Standard to render against — kept as APP6 for NATO letter SIDCs. */
  standard?: "APP6" | "2525";
  /**
   * Additional milsymbol options (labels, colors, etc.). See
   *   https://spatialillusions.com/milsymbol/docs/api-2525-metadata.html
   * for the full list.
   */
  options?: Record<string, unknown>;
  className?: string;
  style?: React.CSSProperties;
  /** Tooltip on hover. Defaults to the SIDC. */
  title?: string;
}

/**
 * Build a safe SVG DOM node from a raw SVG string:
 *  1. DOMPurify strips any non-SVG or dangerous content.
 *  2. DOMParser deserialises the result in a detached SVG document —
 *     no script execution, no live DOM attachment.
 * Returns null if the input is empty or unparseable.
 */
function parseSvgNode(rawSvg: string): SVGSVGElement | null {
  if (!rawSvg) return null;
  const clean = DOMPurify.sanitize(rawSvg, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
  const doc = new DOMParser().parseFromString(clean, "image/svg+xml");
  const svgEl = doc.querySelector("svg");
  return svgEl ?? null;
}

/**
 * Render a NATO symbol from a SIDC string using milsymbol.
 *
 * milsymbol auto-detects letter vs number based SIDCs from the input
 * (numeric first two characters ⇒ number-based). We force APP-6 as the
 * standard so letter SIDCs render as APP-6D symbols.
 */
export const MilSymbol: React.FC<MilSymbolProps> = ({
  sidc,
  size = 40,
  standard = "APP6",
  options,
  className,
  style,
  title,
}) => {
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear any previously mounted SVG node.
    container.replaceChildren();

    try {
      ms.setStandard(standard);
      const symbol = new ms.Symbol(sidc, {
        size,
        standard,
        ...(options ?? {}),
      });
      const svgNode = parseSvgNode(symbol.asSVG());
      if (svgNode) {
        // adoptNode moves the element from the detached document to the live
        // document without innerHTML, so no XSS vector is introduced.
        container.appendChild(document.adoptNode(svgNode));
      }
    } catch (err) {
      console.warn("MilSymbol: failed to render SIDC", sidc, err);
    }
  }, [sidc, size, standard, options]);

  return (
    <span
      ref={containerRef}
      className={className}
      style={{ display: "inline-block", lineHeight: 0, ...style }}
      title={title ?? `SIDC: ${sidc}`}
    />
  );
};
