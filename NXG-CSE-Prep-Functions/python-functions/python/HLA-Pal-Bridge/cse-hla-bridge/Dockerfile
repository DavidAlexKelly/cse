# ── Build stage ───────────────────────────────────────────────────────────────
FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /build

RUN apk add --no-cache maven

COPY pom.xml .
RUN mvn dependency:go-offline -q

# The commit this image is built from. Pass it:
#   docker build --build-arg GIT_SHA=$(git rev-parse --short HEAD) ...
# It is baked into build-info.properties and reported by GET /status. Left
# unset it reads "unknown", which is the honest answer and still useful: it
# says the image did not come through the documented build.
ARG GIT_SHA=unknown

COPY src/ src/
# Tests are NOT skipped. HlaEncoderTest asserts the exact wire layout of every
# NETN struct this bridge sends, and those assertions are the only thing that
# checks the v4 encodings before they reach an RTI: a wrong struct produces a
# task the simulator silently ignores, not an error. Failing the image build is
# the cheapest place to catch it. They are plain JUnit tests with no Spring
# context and add a few seconds.
# If a build is urgently needed despite a failing test, add -DskipTests back.
RUN mvn package -q -Dgit.sha="${GIT_SHA}"

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

COPY --from=build /build/target/hla-bridge-1.0.0.jar app.jar

# The FOM CSE-Prep actually runs: the whole NETN FOM merged with RPR-FOM v2.0,
# exported in HLA Evolved (1516-2010) format. This replaced SWORD_FOM.xml, which
# is NETN v2-era and a different generation of the model — ETR_Root.ETR_Task.*
# tasking, NETN_* leaf object classes, SymbolId — none of which exists here.
# Loading the wrong generation is not a failure, which is what made it expensive:
# classes resolve to nothing, subscriptions are skipped silently, and entities
# arrive with a position and almost no attributes.
#
# Exactly one FOM module goes in FOM_PATH. The merged file is self-contained, so
# adding NETN-BASE/CBRN/ENTITY/MRM alongside it would ask the RTI to merge each
# definition against its own embedded counterpart, which can fail outright. Those
# files, and SWORD_FOM.xml, stay in foms/ in the repo for reference only.
COPY foms/NETN-Merged-With-RPR.xml /foms/NETN-Merged-With-RPR.xml

# The MIM is deliberately NOT in FOM_PATH: BridgeFederate.resolveFomUrls() globs
# that directory for *.xml and would pass the MIM as an ordinary FOM module.
# A MIM is not a module — in IEEE 1516-2010 it can only be supplied to
# createFederationExecution(name, fomModules, mimModule), and joinFederationExecution
# has no MIM parameter at all. This custom MIM is the standard one plus the
# NETN-BASE/NETN-TMR extensions to HLAobjectRoot and HLAinteractionRoot, and it is
# the only place UniqueId is declared — so without it no entity has a UUID and
# nothing can be tasked, since every NETN task addresses its Taskee by UUID.
#
# It therefore only takes effect when this bridge CREATES the federation
# (BRIDGE_CREATE_FEDERATION=true). When we join one someone else created, their
# MIM is in force and this file is ignored.
COPY foms/NETN-MIM.xml /mim/NETN-MIM.xml

# Create non-root user — required by Foundry
RUN addgroup -S app && adduser -S -u 5001 -G app app

# Give the user access to the foms and mim directories
RUN chown -R app:app /app /foms /mim

USER 5001

EXPOSE 8080

# CRC (central RTI component) and FedPro server are DISTINCT endpoints — see
# BridgeFederate.java / EnvironmentPorts.java for details.
#
# CSE_ENVIRONMENT picks which CSE-Prep namespace/environment to use — it
# derives both CRC_ADDRESS and FEDPRO_ADDRESS automatically from the
# 30{ENVIRONMENT}{APPLICATION} port pattern. To switch environments, just
# change this one value. Set CRC_ADDRESS/FEDPRO_ADDRESS explicitly instead
# to override the derived value for one-off testing.
ENV CSE_ENVIRONMENT=1
# The Azure Firewall public IP fronting every environment. Change this alone
# after a firewall migration — ports stay derived from CSE_ENVIRONMENT. Do NOT
# repoint by setting FEDPRO_ADDRESS to a bare IP: that skips port derivation.
ENV FIREWALL_HOST=4.223.210.7
ENV FEDPRO_PROTOCOL=tcp
ENV FEDPRO_SNI_HOSTNAME=
ENV FEDPRO_CONNECT_TIMEOUT_SECONDS=15
ENV FEDERATION_NAME=CSE-Exercise
# Must be unique per federate in a federation. Override it in each compute module
# that runs a bridge against the same federation — a suffix is appended
# automatically if the name is already taken, but a deliberate name is easier to
# recognise in the RTI's federate list. See application.properties.
ENV FEDERATE_NAME=CSE-HLA-Bridge
# "full" (monitoring and tasking) or "monitor" (subscribe only, publish nothing).
ENV BRIDGE_MODE=full
# Re-ask publishers for current attribute values this often (seconds; 0 disables).
# Subscribing alone only yields *future* updates, so a late joiner to a paused
# scenario sees entity names with no state until this asks for them.
ENV BRIDGE_ATTRIBUTE_REFRESH_SECONDS=30
# Off by default, deliberately. This RTI reports discovery at the
# HLAobjectRoot.BaseEntity catch-all whenever it is subscribed, which limits every
# object to BaseEntity attributes and leaves ForceIdentifier, Marking, DamageState,
# Echelon, CombatValue and AggregateState permanently null. Measured on CSE-Prep.
# Set true only to identify an object published as a class this bridge does not
# enumerate. See application.properties.
ENV BRIDGE_SUBSCRIBE_BASE_ENTITY=false
ENV FOM_PATH=/foms
# Only used when this bridge creates the federation — see the COPY above.
ENV MIM_PATH=/mim/NETN-MIM.xml
ENV BRIDGE_RETRY_ATTEMPTS=60
ENV BRIDGE_RETRY_DELAY=10
ENV PORT_PROBE_ENABLED=true

# NOTE: JVM system properties (FedPro.connect.*, FedPro.tls.sniHostname)
# are set at runtime from these env vars by BridgeFederate.connect() — no
# need (and, in exec-form ENTRYPOINT, no ability) to pass them as -D flags
# here since Docker does not perform shell substitution in exec form.
ENTRYPOINT ["java", "-Xmx512m", "-jar", "app.jar"]