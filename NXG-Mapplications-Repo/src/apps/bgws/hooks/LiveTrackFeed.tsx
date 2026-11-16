// ── bgws/hooks/LiveTrackFeed.tsx ───────────────────────────────────────────
// hlamap's useEntityTrackStream, mounted only when it is wanted.
//
// That hook has no `enabled` flag, so an app that calls it unconditionally
// polls the track stream even in mock mode (hlamap accepts that). Rendering it
// inside a component that the shell mounts only for live data gives the same
// effect without changing hlamap: unmounting stops the poll.

import { type FC, useEffect } from "react";
import { useEntityTrackStream, type EntityTrackStream } from "@/apps/hlamap/hooks/useEntityTrackStream";

const LiveTrackFeed: FC<{ onChange: (stream: EntityTrackStream) => void }> = ({ onChange }) => {
  const stream = useEntityTrackStream();
  useEffect(() => onChange(stream), [stream.entities, stream.status, stream.connState, stream.error]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
};

export default LiveTrackFeed;
