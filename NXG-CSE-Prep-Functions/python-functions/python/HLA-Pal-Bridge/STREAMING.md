# Entity track streaming

The bridge's REST API is bound to localhost inside the compute module pod, so
nothing in Foundry can poll it; and Foundry schedules are minute-granularity, so
1 Hz cannot be driven from the platform side. The poller therefore runs as a
background thread in the `hla-bridge-functions` container and pushes to a stream.
See `tracks.py`.

## Two modules, two federates, three images

Tasking and streaming are separate compute modules:

| | Module A — functions | Module B — streaming |
|---|---|---|
| Purpose | Operators task and query the federation | Feed the entity track stream |
| Containers | `hla-bridge` + `hla-bridge-functions` | `hla-bridge` + `hla-bridge-streamer` |
| `FEDERATE_NAME` | `CSE-HLA-Bridge` | `CSE-HLA-Tracks` |
| `BRIDGE_MODE` | unset → `full` | `monitor` |
| `TRACK_STREAM_DATASET_RID` | **must not be set** | the stream RID |
| Foundry functions | registered | none |
| Diagnostics | function endpoints | container logs and the stream itself |

Three images, one directory each:

```
cse-hla-bridge/         → hla-bridge            (both modules, Java)
hla-bridge-functions/   → hla-bridge-functions  (Module A: app.py)
hla-bridge-streamer/    → hla-bridge-streamer   (Module B: tracks.py + streamer.py)
```

```
cd cse-hla-bridge       && docker build --platform linux/amd64 -t hla-bridge:<tag> .
cd hla-bridge-functions && docker build --platform linux/amd64 -t hla-bridge-functions:<tag> .
cd hla-bridge-streamer  && docker build --platform linux/amd64 -t hla-bridge-streamer:<tag> .
```

The two Python images share no code — `app.py` in one, `tracks.py` and
`streamer.py` in the other — so they get a directory each. Separate images also
mean the streaming module cannot accidentally register a second set of tasking
functions against a bridge that cannot task, which is exactly what a forgotten
command override on a shared image would have done.

Because the images differ per module, image tags are pinned per module: Module B
can move to a new streamer tag without redeploying Module A.

Why split them: shipping a change to the publisher redeploys the pod, and when
the publisher sat beside the tasking federate every publisher tweak tore down a
live federation join. A stale `CSE-HLA-Bridge` registration then blocked the next
start — the RTI holds an unresigned name for `FED_TIMEOUT_RECONNECT`, ten minutes
here. Now the stream can be iterated on without disturbing the federate
operators are tasking through.

Two things this costs, both worth knowing before standing Module B up:

* **A second federate** in the federation — a second FedPro session and LRC port,
  and possibly a Pitch licence slot, since Pitch licences are commonly capped by
  federate count.
* **Distinct federate names are mandatory.** Two instances joining as the same
  name is refused with `Federate name ... already in use`; a pod-derived suffix is
  appended automatically as a safety net, but set `FEDERATE_NAME` deliberately so
  the RTI's federate list is readable.

`TRACK_STREAM_DATASET_RID` must be removed from Module A, or both modules publish
the same tracks and every tick is duplicated.

Why not a single container in Module B: the publisher needs entity state, entity
state comes from HLA, and Pitch ships Java and C++ bindings rather than Python.
The reader has to be the Java bridge, so the Python publisher talks to it over
localhost exactly as before. Collapsing to one container would mean porting the
publisher to Java for no runtime gain.

## The stream

| | |
|---|---|
| Name | HLA Entity Tracks (1 Hz stream) |
| RID | `ri.foundry.main.dataset.6e22a37b-e083-4977-be80-f407c8bd952b` |
| Branch | `master` |
| Location | `/[NEXGEN] Common Simulation Platform/CSP/5. Connections` |
| Columns | 27 — 17 String, 3 Timestamp, 5 Double, 1 Integer, 1 Boolean |

Same project as the compute module, so no project import is needed.

## Module B runs in pipeline mode

Pipeline mode is the execution mode that reads Foundry inputs and writes Foundry
outputs, and it is what the streaming module uses. It hands the container
everything it needs, which is why almost nothing about the write path is
configured in code:

* Inputs and outputs are declared in the module configuration, each with a
  **unique identifier**. Datasets, **streaming datasets** and media sets are
  supported, and they must live in the same Project as the compute module — this
  stream does.
* `RESOURCE_ALIAS_MAP` names a JSON file mapping each identifier to
  `{"rid": ..., "branch": ...}`. `TRACK_STREAM_ALIAS` tells `tracks.py` which
  identifier is the stream. A null branch means `master`.
* `BUILD2_TOKEN` names a file holding a bearer token scoped to exactly those
  inputs and outputs. It is the only way to reach them — and it removes the OAuth
  exchange, the client id and secret, and the scope names that differ between
  enrollments.
* `DEFAULT_CA_PATH` names a mounted CA PEM. It is documented as the certificate
  for talking to the *compute module service*, while the functions mode example
  passes it as the trust store for enrollment-URL calls. `tracks.py` loads it **in
  addition to** the system trust store, so it works whether Foundry's certificate
  is signed publicly or by that CA — passing the PEM alone would fail verification
  in the first case, and look like a new bug rather than a misused variable.

**The one thing the platform does not give you is egress.** Compute modules run
under a zero-trust model with *no* external network access — including to other
Foundry services. A module cannot reach the Foundry URL until a **source with a
network policy for that URL** is attached to it. Until then DNS resolution fails
inside the container and every publish dies with

```
ConnectError: [Errno -2] Name or service not known
```

while fetching a token — which reads as an authentication failure and is not one.
This cost an afternoon, so `start()` now checks whether the host resolves and, if
it does not, logs the fix rather than the symptom.

Four requirements on that source, each of which fails silently in a different
way:

1. It must be in the **same Project** as the compute module.
2. **Allow this source to be imported into compute modules** must be enabled on
   its Code import configuration tab. (`REST API - PMESII MCP` in this project has
   it disabled, for contrast.)
3. It needs an **API name**.
4. Its network policy address must be the **Foundry enrollment URL** —
   `accenture.palantirfoundry.com:443`. A policy for `4.165.4.53` does not help;
   every other policy in this project is CSE-shaped, which is easy to copy by
   mistake.

And the part that makes a correct configuration look broken:

> Sources can only be added or removed while the compute module is **stopped**,
> and changes to a source's **network policies require a full restart** of the
> module to take effect.

So a source attached or edited under a running module changes nothing until the
next full stop and start. If the streamer still logs the DNS error after you are
sure the source is right, that is the first thing to check.

Note also that a pipeline mode module receives no queries, so **minimum replicas
must be set to at least 1** or the autoscaler will take it to zero and the stream
will simply stop.

### Publish endpoint

The job token is documented as being for "calling the API gateway", so the gateway
is tried first regardless of credential mode, with stream-proxy kept as a fallback
because the pipeline mode example does read stream records from it with the same
token:

1. `{foundry}/api/v2/highScale/streams/datasets/{rid}/streams/{branch}/publishRecords`
   — the API gateway. Note the `highScale` segment; the path without it 404s.
2. `{foundry}/api/v2/streams/datasets/{rid}/streams/{branch}/publishRecords` —
   the same without `highScale`, for older stacks.
3. `{foundry}/stream-proxy/api/streams/{rid}/branches/{branch}/records` —
   stream-proxy, the service the pipeline mode documentation reads records from.

A 404 or 405 moves permanently to the next candidate; a 400, 415 or 422 switches
the record envelope from `{"records": [...]}` to a bare array once. Both
transitions are logged, and `publish_urls_tried` and `body_shape` record where it
ended up.

## Compute module configuration

Module B, pipeline mode:

| Setting | Value |
|---|---|
| Execution mode | **Pipeline** |
| Output | the stream, with identifier `entity_tracks` |
| Minimum replicas | **1** (no queries arrive, so the autoscaler would scale to zero) |
| Source | one with a network policy allowing the Foundry enrollment URL |

Environment variables on the `hla-bridge-streamer` container:

```
TRACK_STREAM_ALIAS=entity_tracks
FOUNDRY_URL=accenture.palantirfoundry.com
TRACK_POLL_SECONDS=1.0
```

`BUILD2_TOKEN`, `RESOURCE_ALIAS_MAP` and `DEFAULT_CA_PATH` are set by the platform.

Functions mode still works if the module is ever reconfigured: set
`TRACK_STREAM_DATASET_RID` instead of the alias, run with **Application's
permissions**, and the container exchanges `CLIENT_ID`/`CLIENT_SECRET` for a token,
trying scope `api:streams-write` then `api:use-streams-write` then the application
default and caching whichever is accepted.

Escape hatches, none needed in normal operation:

| Variable | Use |
|---|---|
| `TRACK_STREAM_DATASET_RID` | Publish to this RID instead of resolving an alias |
| `TRACK_STREAM_BRANCH` | Override the branch from the alias map |
| `TRACK_FOUNDRY_BASE_URL` | Force the Foundry URL |
| `TRACK_PUBLISH_URL` | Force the full publish URL |
| `TRACK_OAUTH_TOKEN_URL` | Force the token endpoint (functions mode) |
| `TRACK_OAUTH_SCOPE` | Try this scope first (functions mode) |
| `TRACK_STREAM_VIEW_RID` | Publish to a specific stream view |
| `TRACK_TOKEN_RETRY_SECONDS` | Token retry floor, default 15s |
| `TRACK_STATUS_LOG_SECONDS` | Streamer summary line interval, default 60s |

Unconfigured, the publisher logs why — including the resolved alias map and every
credential location checked — and does nothing. The container stays up so the
configuration can be read, rather than crash-looping.

## Verifying

The streaming module registers no functions, so its logs are the diagnostic
channel. At startup it names the resolved base URL and where it came from, every
rejected candidate with its DNS error, the credential source and the publish URL.
Then one summary line a minute — counters, last publish time, last error — at WARN
when there is an error and INFO otherwise, and a full snapshot on SIGTERM.

A healthy module logs `running: true`, `records_published` rising by roughly one
per entity per second, and `last_error: null`. Confirm on the platform side with

```sql
SELECT count(*), max(observed_at) FROM `ri.foundry.main.dataset.6e22a37b-e083-4977-be80-f407c8bd952b`
```

Counters rather than log lines on purpose: at 1 Hz, one log per publish is 86,400
lines a day.

## Testing without a federation

`local_test_tracks.py` runs the publisher against a stub that impersonates both
the bridge and Foundry, and asserts on the parts that used to be guesswork:

```
cd python-functions/python/HLA-Bridge/hla-bridge-streamer
python local_test_tracks.py pipeline    # alias map + mounted job token
python local_test_tracks.py functions   # OAuth client credentials
python local_test_tracks.py fallback    # endpoint 404 + envelope rejected
```

It covers alias resolution from a stubbed `RESOURCE_ALIAS_MAP`, use of a mounted
`BUILD2_TOKEN` in preference to any OAuth exchange, endpoint and envelope
fallback, token caching in functions mode, and the record coercion below. It is
not copied into the image.

## Record shaping

`publishRecords` validates every record against the schema and rejects the **whole
batch** if any one record is invalid, so one entity reporting a string where a
double belongs would cost every other entity in that tick. Values are therefore
coerced to the column type before sending — `"51.5074"` to a double, `"80"` to an
integer, `"false"` to a boolean — and anything uncoercible, including NaN and
infinities, is sent as null.

**Nullability.** Only `track_point_id` and `observed_at` are always present.
Everything else comes from the bridge, which legitimately omits fields — an entity
discovered without a NETN UniqueId, or one whose first position has not arrived.
If the schema was inferred from example rows it may have been marked entirely
non-nullable, which would reject most real records. Everything except those two
should be nullable.

**Timestamps.** The three Timestamp columns receive ISO-8601 UTC strings
(`2026-08-17T11:20:00.000Z`). If ingestion rejects them, change `_iso()` in
`tracks.py` to return epoch milliseconds and the three columns to `Long`.

## Downstream

`track_point_id` is deterministic (`unique_id@epoch_millis`), so it works as an
object type primary key directly, and a retried publish overwrites rather than
duplicating a track point. Keyed on the NETN UniqueId rather than the HLA
instance handle, because the handle only survives one federation execution — a
restart would otherwise begin a new track for the same aircraft. Note also that
the drone mockup draws a fresh random UniqueId on restart unless `DRONE_UUID` is
pinned, which starts a new track for genuinely unrelated reasons.

No object type is backed by this stream yet, and it has no downstream lineage —
that is the next piece of work once rows are landing.
