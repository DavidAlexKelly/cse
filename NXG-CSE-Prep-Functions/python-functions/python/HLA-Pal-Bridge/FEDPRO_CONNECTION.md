# HLA Bridge — FedPro / CRC Connection Notes

This document captures everything currently known about how the CSE HLA
Bridge (`cse-hla-bridge`, the Java/Spring Boot service) connects to the
CSE-Prep HLA/RTI federation via Pitch FedPro, including a couple of
non-obvious gotchas discovered while debugging live connection failures on
2026-08-12. It's meant to be a standing reference so this knowledge doesn't
live only in chat threads and commit messages.

**Update 2026-08-12 (later same day):** the main open question below (section
4) has since been confirmed against the official
[Pitch-Technologies/FedProClient](https://github.com/Pitch-Technologies/FedProClient)
README — this doc has been updated accordingly. If anything here still turns
out to be wrong or incomplete once we get a chance to talk to infra
(Vilho/Peter/Janne/Juho) directly, please update this file further.

---

## 1. Why this is confusing: three different addresses, one federation

HLA simulations run against an **RTI** (Run-Time Infrastructure). In this
deployment the RTI is a Pitch pRTI, and there are three logically distinct
pieces in play:

```
┌─────────────────────┐        ┌──────────────────────┐        ┌───────────────────┐
│   cse-hla-bridge     │        │     FedPro server     │        │    CRC (pRTI)      │
│   (this service —    │  ───▶  │  (gateway/proxy for   │  ───▶  │  actual RTI kernel  │
│   the "LRC" client)  │        │   the FedPro protocol) │        │  federation state   │
└─────────────────────┘        └──────────────────────┘        └───────────────────┘
   runs as a Foundry            reachable from outside            "pitch-rti" — only
   compute-module pod           the OpenShift cluster via         resolvable/reachable
                                 a NodePort/route through          from *inside* the
                                 the Azure Firewall                OpenShift cluster
```

- **LRC** (Local RTI Component) — the thin client library embedded in
  `cse-hla-bridge` (via the `se.pitch.oss.fedpro:fedpro-client-hla-evolved`
  Maven dependency, currently `2.1.0`). This is *us*.
- **FedPro server** — Pitch's "Federate Protocol" gateway. It's the only
  thing our LRC ever talks to directly. It's what's exposed externally
  (through the cluster's NodePort/Route and then the Azure Firewall).
- **CRC** (Central RTI Component) — the actual RTI kernel that owns
  federation state, object/interaction routing, time management, etc. It
  lives inside the OpenShift cluster behind the internal service name
  `pitch-rti`, and is **not reachable from outside the cluster network at
  all**. The FedPro server is what bridges to it internally — our bridge
  never talks to the CRC directly.

**The critical thing to remember:** this bridge (and `cse_prep_functions.py`'s
gRPC client, which reaches the same host via the Azure Firewall) can only
ever reach the **FedPro address**. The CRC address (`pitch-rti:...`) is
infra/ops-team-internal information — useful for *them* to verify the
FedPro↔CRC link inside the cluster, but not something our client can dial
itself.

---

## 2. Known environments

Per Vilho's confirmation in the infra chat (2026-08-12), after successfully
connecting to the FedPro service in `cse-prep-simulation-04`:

| | CRC (internal only — not reachable by us) | FedPro (what we actually connect to) | Status |
|---|---|---|---|
| **Environment 1** | `pitch-rti:30210` | `4.165.4.53:30121` | ✅ available now |
| **Environment 5** (Juho's always-on test federation) | `pitch-rti:30510` | `4.165.4.53:30521` | ⏳ not yet available — pending Janne/Juho opening the firewall ports |

`4.165.4.53` is the same Azure Firewall address `cse_prep_functions.py` uses
for its gRPC calls (`_CSE_HOST` in that file), just on a different port and
protocol — the gRPC management API and the FedPro RTI protocol are separate
services on the same firewall/host.

---

## 3. The gotcha: `crcAddress` in the RTI connect-settings string is *not* the CRC address

The HLA 1516e standard's `RTIambassador.connect(FederateAmbassador,
CallbackModel, String localSettingsDesignator)` overload accepts a
vendor-specific settings string (newline-separated `key=value` pairs) that
lets you configure the connection without a settings file.

Our first attempt at handling the CRC/FedPro split (merged, then partially
reverted the same day) assumed `crcAddress=` in that string should be set to
the *real* CRC address. That broke the connection. The actual runtime logs
told the story clearly:

```
Connecting with settings: crcAddress=pitch-rti:30210, FEDPRO_SERVER_ADDRESS=4.165.4.53:30121, connectAddress=4.165.4.53:30121
Connect with settings failed (Failed to start FedPro session: pitch-rti), trying without settings...
Attempt 1/60 failed: Failed to start FedPro session: Failed to connect to FedPro server at localhost:15164 (Connection refused). Retrying in 10s...
```

**CONFIRMED** (2026-08-12, against the official
[Pitch-Technologies/FedProClient](https://github.com/Pitch-Technologies/FedProClient)
README): `crcAddress`/`crcHost` in the local-settings-designator string is
explicitly documented as being **reinterpreted as the FedPro server address**
for HLA-Evolved compatibility mode — direct quote from the README's
"HLA Evolved Compatibility" section:

> "If you have an existing HLA Evolved federate: Use the
> `fedpro-client-hla-evolved` artifact. You can usually keep most of your
> code; just change how the RTIambassador is obtained and how the server
> address is supplied (via the local settings designator string, where
> `crcAddress`/`crcHost` is reinterpreted as the FedPro server)."

So this was never really a "CRC vs FedPro" naming clash to begin with — for
this compatibility mode, `crcAddress` *is* the correct key, it's just that
its value must always be the FedPro address, never the real CRC.

### Correction (2026-08-13): only `crcAddress` is special-cased, not `crcHost`

The README paraphrase above overstated it. With the client source now cloned
into `FedProClient-main/`, the authoritative answer is in
`FedProClient-main/doc/Settings.md`:

> * All Federate Protocol client setting names must be prefixed with `FedPro.`.
> * Exception: The setting `crcAddress` is interpreted as the address of the
>   FedPro server, not as an LRC setting.

and in the implementation,
`client_common/.../RTIambassadorClientGenericBase.extractAndRemoveClientSettings()`,
which special-cases exactly one key — `crcAddress` — splitting it into
`connect.hostname`/`connect.port` and *removing* it from the list. Everything
else that is not prefixed with `FedPro.` is passed through **to the RTI as a
plain LRC setting**.

So the previous settings string:

```
crcAddress=4.165.4.53:30120
crcHost=4.165.4.53
crcPort=30120
```

was sending `crcHost`/`crcPort` onward to the CRC as LRC settings pointing at
the FedPro server. They are only honoured if the FedPro server is configured
to trust forwarded LRC settings, so they were most likely ignored — but if
they ever were honoured they would have pointed the RTI-side LRC at the wrong
endpoint. Harmless-looking, wrong, and worth not leaving in place.

**Current (fixed) behavior:** the settings string is exactly
`crcAddress=<fedproAddress>` and nothing else — matching the FedPro sample
federate (`java/sample_evolved/.../Chat.java`), which does
`"crcAddress=" + rtiHost`. The real CRC address is still tracked separately in
code (`crcAddress` field in `BridgeFederate`) purely for logging/ops
correlation; it is **not** used as a connection target anywhere.

---

## 4. Resolved: the real settings mechanism (was: "unconfirmed guesses")

`BridgeFederate.connect()` used to set a pile of JVM system properties
before creating the RTI Ambassador, covering several plausible naming
conventions added across prior commits by trial and error (see `git log` for
`BridgeFederate.java` — commit messages literally named "Fix: set ALL known
FedPro system properties BEFORE RTI factory init"):

```java
System.setProperty("se.pitch.oss.fedpro.connectAddress", fedproAddress);
System.setProperty("se.pitch.oss.fedpro.address", fedproAddress);
System.setProperty("FEDPRO_SERVER_ADDRESS", fedproAddress);
System.setProperty("FED_PRO_HOST", fedProHost);
System.setProperty("FED_PRO_PORT", fedProPort);
System.setProperty("CRC_HOST", crcHost);
System.setProperty("CRC_PORT", crcPort);
System.setProperty("LRC_HOST", crcHost);
System.setProperty("LRC_PORT", crcPort);
```

The 2026-08-12 logs showed none of these were actually read by
`fedpro-client-hla-evolved:2.1.0` — the fallback `connect()` call (used when
the settings-string attempt throws) always defaulted to `localhost:15164`
regardless of what these properties were set to.

**Now confirmed** — the FedProClient README documents the real settings
mechanism and priority order (highest to lowest):

1. System property `FedProOverrides.*`
2. Environment variable `FEDPRO_CLIENT_OVERRIDES`
3. `RtiConfiguration` / `connect()` parameter (the local-settings-designator
   string, for our HLA-Evolved compatibility case — see section 3)
4. System property `FedPro.*`
5. Environment variable `FEDPRO_CLIENT_SETTINGS`
6. Built-in defaults — **`connect.hostname=localhost`,
   `connect.port=15164`** — this is exactly the fallback we were hitting.

None of the old guessed property names matched this scheme at all. The code
now sets the two real ones instead:

```java
System.setProperty("FedPro.connect.hostname", fedProHost);
System.setProperty("FedPro.connect.port", fedProPort);
```

This gives the no-settings fallback path a real chance of working too (tier
4 above), not just the settings-string path (tier 3). See
:resource[ri.pull-request.main.pull-request.a62e4ec7-f6bc-46a3-9c05-994420a6675a]
for the actual code change.

Other settings documented by the README that may be worth tuning later if
connectivity is flaky (all take a `FedPro.` prefix as a system property, or
go in the settings-designator/`additionalSettings` string without it):

| Setting | Default | Meaning |
|---|---|---|
| `connect.protocol` | `tcp` | `tcp`, `tls`, `websocket`, `websocketsecure` |
| `connect.timeout` | 5s | Connection timeout |
| `FED_INT_HEART` | 60s | Heartbeat interval |
| `FED_TIMEOUT_HEART` | 180s | Missing-message timeout |
| `FED_TIMEOUT_RECONNECT` | 600s | Reconnect timeout |
| `asyncUpdates` | `false` | Non-blocking attribute/interaction updates |
| `messageQueue.size` | 2000 | Outgoing message history size |

---

## 5. Where this logic lives

| File | Role |
|---|---|
| `cse-hla-bridge/src/main/java/com/decho/cse/bridge/BridgeApplication.java` | Spring Boot entry point; reads `bridge.crc-address` / `bridge.fedpro-address` / `bridge.federation-name` / `bridge.fom-path` / retry config via `@Value`, builds the `BridgeFederate` bean, kicks off connection in a background virtual thread. |
| `cse-hla-bridge/src/main/java/com/decho/cse/bridge/BridgeFederate.java` | All RTI connection logic — `connect()` (see sections 3–4 above), federation create/join, FOM handle resolution, pub/sub, time management, `sendInteraction`. |
| `cse-hla-bridge/src/main/resources/application.properties` | Default values (see table below) — all overridable via env vars. |
| `cse-hla-bridge/Dockerfile` | Container `ENV` defaults matching Environment 1; builds the Spring Boot jar via Maven. |
| `hla-bridge-functions/app.py` | The Python compute-module sidecar — thin `httpx` wrappers over `cse-hla-bridge`'s REST API (`http://localhost:8080/api/v1/bridge/...`), published as the `bridge_*` Foundry Functions. Doesn't touch RTI/FedPro directly at all. |

## 6. Configuration reference

| Env var | Default (`application.properties` / `Dockerfile`) | Meaning |
|---|---|---|
| `CRC_ADDRESS` | `pitch-rti:30210` | The real CRC address — kept only for potential future logging/ops-correlation value (see section 3), **not** used by any connection logic. |
| `FIREWALL_HOST` | `4.223.210.7` | The Azure Firewall public IP that fronts every environment. Set this (and leave `CRC_ADDRESS`/`FEDPRO_ADDRESS` unset) to repoint the bridge after a firewall migration, so ports stay derived from `CSE_ENVIRONMENT`. |
| `FEDPRO_ADDRESS` | derived, e.g. `4.223.210.7:30520` | The actual address the bridge connects to. This is what matters for connectivity. **Must include the port.** A host-only value now has the environment's port appended automatically (see section 10); older builds passed it through and silently fell back to `15164`. |
| `FEDERATION_NAME` | `CSE-Exercise` (Dockerfile default) — currently deployed as `CSE-Prep` | Federation execution name to create/join. |
| `FOM_PATH` | `/foms` | Directory of FOM XML files baked into the image (`SWORD_FOM.xml`, `NETN-BASE/MRM/CBRN/ENTITY.xml`), loaded on `createFederationExecution`. |
| `BRIDGE_RETRY_ATTEMPTS` | `60` | Number of connection attempts before giving up. |
| `BRIDGE_RETRY_DELAY` | `10` (seconds) | Delay between attempts — 60×10s ≈ 10 minutes total before the bridge gives up entirely (`store.setConnected(false)` and no further retries; would need a pod restart to try again). |

**To switch environments**, no code change is needed — set `CSE_ENVIRONMENT`
and let the ports be derived:

```
CSE_ENVIRONMENT=5
FEDPRO_PROTOCOL=tcp
```

That yields `4.223.210.7:30520` (TCP) or `4.223.210.7:30521` (TLS). Only set
`FEDPRO_ADDRESS`/`CRC_ADDRESS` for one-off testing, and always include the
port:

```
FEDPRO_ADDRESS=4.223.210.7:30520
CRC_ADDRESS=pitch-rti:30510
```

## 7. Current deployment status (as of 2026-08-12)

The live compute module (:resource[ri.foundry.main.deployed-app.214954cb-98ad-4488-ba18-d0a1f862de96])
is running with `FEDERATION_NAME=CSE-Prep` and `FEDPRO_ADDRESS=4.165.4.53:30121`
(Environment 1's FedPro address — already correct). `CRC_ADDRESS` had not
been added as a deployed env var as of this writing; per section 3 it isn't
actually required for connectivity, but it's harmless to add for
completeness/logging (`pitch-rti:30210`).

As of the last log check (before the section 3/4 fixes below), the bridge
was retrying continuously with `Failed to start FedPro session: pitch-rti`
(fixed in :resource[ri.pull-request.main.pull-request.513cad32-c910-4c66-a657-a9f8295df24e])
and, on fallback, `Connection refused` to `localhost:15164` (fixed in
:resource[ri.pull-request.main.pull-request.a62e4ec7-f6bc-46a3-9c05-994420a6675a],
once the real `FedPro.connect.*` settings keys were confirmed against the
official docs — see section 4). **Next step once that PR is merged and
redeployed:** capture fresh logs and check whether the bridge gets past
"Failed to start FedPro session" and successfully joins the federation. If
it still doesn't, the settings/tuning table at the end of section 4 (e.g.
`connect.timeout`, `FED_TIMEOUT_HEART`) is the next thing to check, along
with plain network reachability of `4.165.4.53:30121` from the pod's
network position (independent of any config-key question).

## 8. Who to ask

- **Vilho** — confirmed reachability of the FedPro service directly, and
  originally shared the `crcHost`/`crcPort`/`fedProHost`/`fedProPort`
  breakdown that started this investigation. Still worth asking which
  client/tool they used to connect (this same `fedpro-client-hla-evolved`
  OSS library vs. a different/commercial Pitch client), and whether they hit
  any of the same connect-settings quirks described above.
- **Peter / Janne** — general infra/OpenShift capacity and firewall/ports.
- **Juho** — building "Environment 5", the always-on test federation.

---

## 9. What the cloned FedPro client source settled (2026-08-13)

`FedProClient-main/` is the source of the client library the bridge depends on
(`se.pitch.oss.fedpro:fedpro-client-hla-evolved`). Reading it replaced several
guesses with facts. The HLA Evolved API and its implementation live under
`java/client_evolved/src` — that is the code actually running in the bridge.

### Settings are fully documented, with a defined precedence order

`FedProClient-main/doc/Settings.md` lists every setting and its default. The
precedence order (highest first) is:

1. system property `FedProOverrides.*`
2. env var `FEDPRO_CLIENT_OVERRIDES`
3. the `connect()` local settings designator
4. system property `FedPro.*`
5. env var `FEDPRO_CLIENT_SETTINGS`
6. defaults

The bridge uses tiers 3 and 4, which is fine — but note tier 3 (the designator)
*outranks* the `FedPro.connect.*` system properties the bridge also sets, so
`crcAddress` in the designator wins for host/port. Settings are case-sensitive.

Knobs that may matter for a long-lived bridge, none of which are set today:

| Setting | Default | Why it might matter |
|---|---|---|
| `FED_INT_HEART` | 60 s | Heartbeat interval on an otherwise idle session. |
| `FED_TIMEOUT_HEART` | 180 s | How long without an RTI message before the session is considered dead. |
| `FED_TIMEOUT_RECONNECT` | 600 s | Reconnect window after a network blip. |
| `connect.maxRetryAttempts` | 0 | Client-side connect retries (the bridge does its own retry loop instead). |
| `connect.protocol` | tcp | `tcp`, `tls`, `websocket`, `websocketsecure`. |
| `tls.mode` | SERVER_AUTH | `SERVER_AUTH` or `ENCRYPTED`. |
| `tls.sniHostname` | none | Confirms the key the bridge already sets is real and correctly spelled. |
| `keystore.path` / `keystore.password.path` / `keystore.type` | none / JKS | Needed if the TLS port (…21) is ever used with a private CA. |

### The callback overloads FedPro chooses at runtime

`FederateAmbassadorClientAdapter.discoverObjectInstanceWithProducer()`:

```java
if (producingFederate != null) {
   _federateAmbassador.discoverObjectInstance(theObject, theObjectClass, objectName, producingFederate);
} else {
   _federateAmbassador.discoverObjectInstance(theObject, theObjectClass, objectName);
}
```

`producingFederate` is only populated when the RTI's `conveyProducingFederate`
switch is enabled, and that switch is **off by default**. The bridge previously
overrode only the 4-argument form (with a comment claiming "FedPro adds this
4th arg"), so in the default configuration discovery would have fallen through
to `NullFederateAmbassador`'s no-op and **no entity would ever have been seen**.
Both overloads are now implemented.

The same pattern applies to `reflectAttributeValues`, `receiveInteraction` and
`removeObjectInstance`, which each have plain / with-time / with-time-and-
retraction forms (dispatcher cases `RECEIVEINTERACTION` vs
`RECEIVEINTERACTIONWITHTIME`, etc.). Only the plain forms can arrive while the
bridge is not time-constrained, but all are now implemented so that turning on
`BRIDGE_TIME_MANAGEMENT` cannot silently stop callbacks.

### `connectionLost` exists and is delivered

`FederateAmbassador.connectionLost(String faultDescription)` is dispatched by
FedPro when the session dies. Nothing implemented it, so `/health` kept
reporting "connected" after a drop and the bridge never attempted to recover.
It is now implemented: it clears the connected flag, drops stale entity state,
and asks the run loop to re-run `connectWithRetry` (the reconnect happens on
the run-loop thread, not the callback thread).

### FOM modules are compressed automatically

`RTIambassadorClientAdapter.getFomModule()` zips any `file:` FOM larger than
1 KB and sends it as a `COMPRESSED` module; only if the file cannot be read
does it fall back to sending the URL string for the *server* to resolve. So the
1.4 MB `SWORD_FOM.xml` is fine over the wire, and there is no need to
pre-compress or host it.

The sample federate also passes the FOM modules to `joinFederationExecution`,
not just `createFederationExecution`. The bridge now does the same, so the
classes it needs are added even when another federate created the federation.

### The encoder factory is pure client-side code

`RtiFactoryImpl.getEncoderFactory()` returns `OmtEncoderFactory.getInstance()`,
and `RtiFactoryFactory.getRtiFactory()` is just a `ServiceLoader` lookup —
neither needs a connection. That means `HlaEncoder` can be unit tested offline,
which is what `src/test/java/.../HlaEncoderTest.java` now does.

Reading `OmtHLAvariantRecord` also settled a detail that had been reasoned
about rather than measured: a variant record encodes as discriminant + padding
to the alternative's octet boundary + the alternative, with **no trailing
padding**. An `AreaVariantStruct` circle is therefore 28 bytes, not 32 — a
hand-rolled encoder would very likely have got this wrong.

## 10. Firewall migration to `4.223.210.7`, and the 15164 fallback's second life (2026-09-10)

The Azure firewall public IP moved from `4.165.4.53` to `4.223.210.7`. Every
resource was repointed except MACE, whose new DNAT rule still doesn't work
(TCP connects, TLS handshake times out), so the MACE source deliberately
stays on the old IP.

The HLA Streamer then stopped joining the federation, with logs that looked
almost right:

```
CSE_ENVIRONMENT=5
FedPro: 4.223.210.7 (protocol=tcp)
Port probe 4.223.210.7:30520 (fedpro-tcp) -> OPEN
Port probe 4.223.210.7:30521 (fedpro-tls) -> OPEN
...
Set FedPro.connect.hostname=4.223.210.7 FedPro.connect.port=15164
```

**The port probes proved nothing about the connection.** The bridge probed
`30520`, reported it OPEN, and then connected to `15164` — the same FedPro
library default as the original bug in sections 4 and 9, reached by a
different route.

The route: `FIREWALL_HOST` was still hardcoded to the old IP, so the
deployment worked around it by setting `FEDPRO_ADDRESS=4.223.210.7` — an IP
with no port. `resolveFedproAddress` returned any explicit override verbatim,
skipping port derivation, and `BridgeFederate.connect()` splits on `:`, finds
no port, and falls back to `15164`. The workaround for the stale constant
silently disabled the port logic.

Fixed in three places, so no single mistake reproduces it:

1. `FIREWALL_HOST` is now read from the environment (default `4.223.210.7`),
   so a firewall migration needs no code change and no address override.
2. `resolveFedproAddress` appends the environment's port to a host-only
   override instead of passing it through. `resolveCrcAddress` does the same
   with the exposed CRC port (`30<env>10`), since a host-only CRC candidate
   would otherwise inherit the in-cluster `8989`.
3. `BridgeFederate.connect()` logs a warning if it ever has to use the
   `15164` fallback, which should now be unreachable.

`EnvironmentPortsTest` locks all of this in, including the assertion that no
input resolves to `15164`.

**Operational note:** this Foundry copy of the bridge source is a mirror —
every file carries its path as line 1, so it isn't the tree that builds the
image. Applying the fix to the running Streamer means either rebuilding from
the real source repo, or, as an immediate unblock, setting
`FEDPRO_ADDRESS=4.223.210.7:30520` on the compute module.
