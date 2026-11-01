# streamer.py
"""
Entry point for the hla-bridge-streamer image: entity tracks out, commands in.

There are two compute modules; see ARCHITECTURE.md for the full picture.
This image, the HLA streamer, pairs cse-hla-bridge - the Java federate that
joins the federation and serves REST on :8080 - with this file, which runs
tracks.py and commands.py. It is the only module that speaks HLA. The other
module, the commander, is hla-command-poster alone, backing the Foundry
functions that validate commands and write them to a stream; it never
touches HLA and never joins the federation.

Both directions run from this one container, in separate daemon threads:
tracks.py polls GET /entities at 1 Hz and publishes rows, while commands.py
tails the command stream and posts to the same bridge. Separate threads so a
slow bridge call on the command path never stalls situational-awareness
publishing.

The bridge runs as a sidecar rather than in the same process because entity
state comes from HLA, and Pitch ships Java and C++ bindings, not Python, so
the reader has to be the Java bridge and this container reaches it over
localhost. That co-location also guarantees the read path and the write path
reach the same federate, since task history is kept per-process - a command
posted to a different pod would be tasking a different federate with its own
view of the federation.

This module registers no Foundry functions, so its logs and its streams are
the whole diagnostic channel: startup lines naming the resolved Foundry base
URL, the credential source and the publish URL, plus every rejected base-URL
candidate; a summary line every TRACK_STATUS_LOG_SECONDS (60 by default) with
the counters and the last error; a per-minute acknowledgement line from
commands.py showing sent, acknowledged and unacknowledged counts, which is
what distinguishes a task the bridge accepted from one a federate actually
executed; and a final snapshot on SIGTERM. Deliberately not one line per
publish, since at 1 Hz that would be 86,400 lines a day and would bury the
bridge's own logging.
"""

import json
import logging
import os
import signal
import threading

import commands
import tracks

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

BRIDGE_URL = os.environ.get("BRIDGE_URL", "http://localhost:8080/api/v1/bridge")
STATUS_LOG_SECONDS = float(os.environ.get("TRACK_STATUS_LOG_SECONDS", "60"))

# Set by SIGTERM. The publisher thread is a daemon and this process holds no
# federation state — the bridge container owns the RTI session and resigns on its
# own SIGTERM — so shutdown only has to stop cleanly, not unwind anything.
_stop = threading.Event()


def _handle_signal(signum, _frame) -> None:
    """
    Stop waiting and let the process exit.

    Kubernetes sends SIGTERM and SIGKILLs after the grace period. Without a
    handler the default disposition kills the process immediately, cutting any
    in-flight publish mid-request; catching it lets the current tick finish. The
    image uses exec-form CMD, so the signal reaches Python rather than a shell.
    """
    log.info("Signal %s received, stopping the entity track streamer.", signum)
    _stop.set()


def _summary(state: dict) -> str:
    """The few fields worth a periodic line, rather than the whole payload."""
    return json.dumps(
        {
            "running": state.get("running"),
            "polls": state.get("polls"),
            "records_published": state.get("records_published"),
            "last_record_count": state.get("last_record_count"),
            "publish_failures": state.get("publish_failures"),
            "poll_failures": state.get("poll_failures"),
            "last_published_at": state.get("last_published_at"),
            "last_error": state.get("last_error"),
        }
    )


def main() -> None:
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    log.info("Entity track streamer starting, reading entities from %s", BRIDGE_URL)

    # Never fatal when unconfigured: start() logs why and returns. Exiting would
    # put the container in a restart loop, which loses the startup diagnostics
    # that say exactly what is missing.
    tracks.start()

    # The command consumer is a sibling daemon, not part of the publish path: a
    # slow or refusing bridge must never stall situational-awareness updates.
    # Same not-fatal-when-unconfigured contract as tracks.start().
    commands.start()

    configured, reason = tracks.is_configured()
    if not configured:
        log.error(
            "The track publisher is off: %s. The container stays up so the "
            "configuration can be inspected rather than crash-looping. "
            "Full search: %s",
            reason,
            json.dumps(tracks.status()),
        )

    commands_configured, commands_reason = commands.is_configured()
    if not commands_configured:
        log.error(
            "The command consumer is off: %s. Tracks may still publish; "
            "commands queued by the gateway will accumulate unexecuted. "
            "Full status: %s",
            commands_reason,
            json.dumps(commands.status()),
        )

    # Heartbeat. With no status function to call, an operator's only questions are
    # "is it publishing?" and "what broke?" — both answerable from one line a
    # minute, and a gap in these lines is itself a signal.
    while not _stop.wait(STATUS_LOG_SECONDS):
        state = tracks.status()
        if state.get("last_error"):
            log.warning("Track streamer: %s", _summary(state))
        else:
            log.info("Track streamer: %s", _summary(state))

        # Reported separately: the two paths fail independently, and "commands
        # are not executing" is invisible in the track summary.
        command_state = commands.status()
        if command_state.get("last_error") or command_state.get("refused"):
            log.warning("Command consumer: %s", json.dumps(command_state))
        elif command_state.get("running"):
            log.info("Command consumer: %s", json.dumps(command_state))

    commands.stop()
    log.info(
        "Stopping. Final status: tracks=%s commands=%s", json.dumps(tracks.status()), json.dumps(commands.status())
    )


if __name__ == "__main__":
    main()
