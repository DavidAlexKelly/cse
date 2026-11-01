# hla-bridge-streamer
#
# The entity track streamer: polls the bridge sidecar over localhost and publishes
# 1 Hz entity tracks to a Foundry stream. Runs in its own compute module beside a
# monitor-only bridge, so that changes to the stream never redeploy the pod
# holding the federation join that operators task through. See ../STREAMING.md.
#
#   docker build --platform linux/amd64 -t hla-bridge-streamer:<tag> .
#
FROM --platform=linux/amd64 python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Every module streamer.py imports must be listed. An earlier image copied only
# the entry point and died at import with ModuleNotFoundError, taking the whole
# container down. Add new modules here.
COPY tracks.py commands.py streamer.py ./

# Run as non-root (required by Foundry)
RUN adduser --uid 5001 --disabled-password app
USER 5001

ENV BRIDGE_URL=http://localhost:8080/api/v1/bridge

# Exec form so SIGTERM reaches Python rather than being swallowed by a shell —
# without it the handler in streamer.py never runs and an in-flight publish is cut
# mid-request.
CMD ["python", "streamer.py"]
