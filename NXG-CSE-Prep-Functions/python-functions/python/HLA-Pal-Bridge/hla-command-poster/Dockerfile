# hla-command-gateway
#
# Exposes the bridge's write surface as Foundry functions that append a command
# record to a stream, rather than calling the bridge directly. The streaming
# compute module — which holds the single pRTI federate seat — consumes that
# stream and executes each command against its own local bridge.
#
# This image is NOT an HLA federate and joins no federation, so it consumes no
# pRTI licence seat. It never talks to the bridge, only to the Foundry API, so
# there is deliberately no BRIDGE_URL here.
#
#   docker build --platform linux/amd64 -t hla-command-gateway:<tag> .
#
FROM --platform=linux/amd64 python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Every module app.py imports must be copied. Copying only the entry point has
# twice produced a container that died at import with ModuleNotFoundError,
# taking every function with it. Add new modules here.
COPY app.py ./

# Run as non-root (required by Foundry)
RUN adduser --uid 5001 --disabled-password app
USER 5001

# FOUNDRY_URL, DEFAULT_CA_PATH and the OAuth client are injected by the platform.
# COMMAND_STREAM_RID must be set on the compute module — there is no sensible
# default and failing fast at import beats publishing into the wrong stream.
#
# Optional overrides:
#   COMMAND_STREAM_BRANCH   default master
#   COMMAND_PUBLISH_PATH    stream publish path, if it differs on your stack
#   COMMAND_TTL_SECONDS     default 120, entity commands
#   CONTROL_TTL_SECONDS     default 15, disconnect/reconnect
#   PUBLISH_TIMEOUT_SECONDS default 10

# Exec form so SIGTERM reaches Python rather than being swallowed by a shell,
# matching hla-bridge-streamer — otherwise an in-flight publish is cut mid-request.
CMD ["python", "app.py"]
