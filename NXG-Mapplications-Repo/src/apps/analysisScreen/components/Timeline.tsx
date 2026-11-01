// ── analysisScreen/components/Timeline.tsx ─────────────────────────────────
// Scrub bar spanning the WHOLE run, with transport controls.
//
// The track always represents the full run duration even though only a few
// chunks are resident — loaded spans are shaded so it is obvious which parts
// of the run can be played immediately and which will trigger a fetch.

import { type FC, useCallback, useEffect, useRef, useState } from "react";
import type { LoadedRange } from "../hooks/useRunPlayback";
import type { KeyEvent, RunSummary } from "../types";
import { formatClock, formatDuration, UI } from "./ui";

const SPEEDS = [1, 2, 5, 10, 30, 60] as const;

/**
 * How each kind of marker reads on the track.
 *
 * The first four are things that happened in the run. The last three come from
 * the plan — a deadline that was set, an arrival that was observed, and the
 * worst deviation from an ordered axis — and are drawn in the plan overlay's
 * own colours so they are not mistaken for events the federation reported.
 */
const EVENT_STYLE: Record<KeyEvent["kind"], { colour: string; glyph: string }> = {
  engagement: { colour: UI.blue, glyph: "!" },
  loss: { colour: UI.red, glyph: "!" },
  detection: { colour: UI.blue, glyph: "!" },
  objective: { colour: UI.green, glyph: "◆" },
  phase: { colour: UI.blue, glyph: "!" },
  plan: { colour: UI.textDim, glyph: "P" },
  arrival: { colour: UI.green, glyph: "A" },
  deviation: { colour: UI.amber, glyph: "~" },
};

/** Resolution options: seconds between playback frames. */
export const STEP_OPTIONS = [
  { seconds: 1, label: "1s" },
  { seconds: 2, label: "2s" },
  { seconds: 5, label: "5s" },
  { seconds: 10, label: "10s" },
  { seconds: 30, label: "30s" },
] as const;

interface Props {
  run: RunSummary;
  currentTs: number;
  playing: boolean;
  speed: number;
  buffering: boolean;
  stepSeconds: number;
  chunkSeconds: number;
  loadedRanges: LoadedRange[];
  loadingRanges: LoadedRange[];
  /** Notable moments, marked on the track. Absent for runs that derive none. */
  keyEvents?: KeyEvent[];
  entityCount: number;
  onTogglePlay: () => void;
  onSeek: (ts: number) => void;
  onSpeedChange: (speed: number) => void;
  onStepChange: (stepSeconds: number) => void;
}

const Timeline: FC<Props> = ({
  run,
  currentTs,
  playing,
  speed,
  buffering,
  stepSeconds,
  chunkSeconds,
  loadedRanges,
  loadingRanges,
  keyEvents,
  entityCount,
  onTogglePlay,
  onSeek,
  onSpeedChange,
  onStepChange,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverTs, setHoverTs] = useState<number | null>(null);

  const duration = Math.max(1, run.endS - run.startS);
  const fraction = (ts: number) => ((ts - run.startS) / duration) * 100;

  const tsFromClientX = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return run.startS;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      return run.startS + ratio * duration;
    },
    [run.startS, duration]
  );

  // Drag-to-scrub. Listeners live on window so the pointer can leave the track
  // mid-drag without the scrub sticking.
  useEffect(() => {
    if (!dragging) return;

    const move = (e: MouseEvent) => onSeek(tsFromClientX(e.clientX));
    const up = () => setDragging(false);

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [dragging, onSeek, tsFromClientX]);

  const buttonStyle = (active: boolean): React.CSSProperties => ({
    background: active ? UI.accent : UI.bg2,
    color: active ? "#0b1017" : UI.textDim,
    border: `1px solid ${active ? UI.accent : UI.border}`,
    fontFamily: UI.fontSans,
    fontSize: 10,
    padding: "3px 7px",
    cursor: "pointer",
    letterSpacing: 0.5,
  });

  return (
    <div
      style={{
        background: UI.bg1,
        borderTop: `1px solid ${UI.border}`,
        padding: "10px 14px 12px",
        fontFamily: UI.fontSans,
        flexShrink: 0,
      }}
    >
      {/* ── Transport row ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 9 }}>
        <button
          onClick={onTogglePlay}
          style={{
            background: playing ? UI.amber : UI.green,
            color: "#0b1017",
            border: "none",
            width: 60,
            height: 26,
            cursor: "pointer",
            fontFamily: UI.fontMono,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
          }}
        >
          {playing ? "PAUSE" : "PLAY"}
        </button>

        <div
          style={{
            fontFamily: UI.fontMono,
            fontSize: 15,
            color: UI.accent,
            minWidth: 78,
            letterSpacing: 1,
          }}
        >
          {formatClock(currentTs)}
        </div>

        <div style={{ fontFamily: UI.fontSans, fontSize: 10, color: UI.textDim }}>
          T+{formatDuration(currentTs - run.startS)} / {formatDuration(duration)}
        </div>

        {buffering && (
          <div style={{ fontFamily: UI.fontSans, fontSize: 10, color: UI.amber, letterSpacing: 1 }}>
            ● LOADING…
          </div>
        )}

        <div style={{ flex: 1 }} />

        <div style={{ fontFamily: UI.fontSans, fontSize: 10, color: UI.textDim }}>
          {entityCount} UNITS
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontFamily: UI.fontSans, fontSize: 10, color: UI.textFaint }}>SPEED</span>
          {SPEEDS.map((s) => (
            <button key={s} onClick={() => onSpeedChange(s)} style={buttonStyle(speed === s)}>
              {s}×
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span
            style={{ fontFamily: UI.fontSans, fontSize: 10, color: UI.textFaint }}
            title="Seconds between playback frames. Coarser resolution loads a longer span of the run per fetch."
          >
            RES
          </span>
          {STEP_OPTIONS.map((option) => (
            <button
              key={option.seconds}
              onClick={() => onStepChange(option.seconds)}
              style={buttonStyle(stepSeconds === option.seconds)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scrub track ── */}
      <div
        ref={trackRef}
        onMouseDown={(e) => {
          setDragging(true);
          onSeek(tsFromClientX(e.clientX));
        }}
        onMouseMove={(e) => setHoverTs(tsFromClientX(e.clientX))}
        onMouseLeave={() => setHoverTs(null)}
        style={{
          position: "relative",
          height: 26,
          background: UI.bg0,
          border: `1px solid ${UI.border}`,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        {/* Spans already fetched */}
        {loadedRanges.map((range) => (
          <div
            key={`loaded-${range.startS}`}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${fraction(range.startS)}%`,
              width: `${((range.endS - range.startS) / duration) * 100}%`,
              background: "rgba(79,195,247,0.20)",
              borderLeft: `1px solid rgba(79,195,247,0.45)`,
              pointerEvents: "none",
            }}
          />
        ))}

        {/* Spans in flight */}
        {loadingRanges.map((range) => (
          <div
            key={`loading-${range.startS}`}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${fraction(range.startS)}%`,
              width: `${((range.endS - range.startS) / duration) * 100}%`,
              background:
                "repeating-linear-gradient(45deg, rgba(201,148,58,0.30) 0 6px, transparent 6px 12px)",
              pointerEvents: "none",
            }}
          />
        ))}

        {/* Key events — click to jump to the moment */}
        {(keyEvents ?? []).map((event) => (
          <button
            key={event.id}
            type="button"
            title={`${formatClock(event.ts)} — ${event.label}`}
            aria-label={event.label}
            onClick={(e) => {
              // The track itself seeks on click; without this the marker would
              // seek twice, once to the marker and once to the click position.
              e.stopPropagation();
              onSeek(event.ts);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              bottom: "calc(100% + 2px)",
              left: `${fraction(event.ts)}%`,
              transform: "translateX(-50%)",
              width: 14,
              height: 14,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 2,
              border: `1px solid ${EVENT_STYLE[event.kind].colour}`,
              background: UI.bg1,
              color: EVENT_STYLE[event.kind].colour,
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            {EVENT_STYLE[event.kind].glyph}
          </button>
        ))}

        {/* Playhead */}
        <div
          style={{
            position: "absolute",
            top: -2,
            bottom: -2,
            left: `${fraction(currentTs)}%`,
            width: 2,
            background: UI.accent,
            boxShadow: `0 0 6px ${UI.accent}`,
            pointerEvents: "none",
          }}
        />

        {/* Hover readout */}
        {hoverTs != null && !dragging && (
          <div
            style={{
              position: "absolute",
              bottom: "calc(100% + 4px)",
              left: `${fraction(hoverTs)}%`,
              transform: "translateX(-50%)",
              background: UI.bg2,
              border: `1px solid ${UI.border}`,
              color: UI.text,
              fontFamily: UI.fontMono,
              fontSize: 10,
              padding: "2px 6px",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              zIndex: 5,
            }}
          >
            {formatClock(hoverTs)}
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 4,
          fontFamily: UI.fontMono,
          fontSize: 9,
          color: UI.textFaint,
        }}
      >
        <span>{formatClock(run.startS)}</span>
        <span>
          shaded = loaded · chunk {formatDuration(chunkSeconds)} @ {stepSeconds}s
        </span>
        <span>{formatClock(run.endS)}</span>
      </div>
    </div>
  );
};

export default Timeline;
