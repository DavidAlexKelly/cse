[main/java/com/decho/cse/bridge/BridgeFederate.java]
package com.decho.cse.bridge;

import hla.rti1516e.*;
import hla.rti1516e.exceptions.*;
import hla.rti1516e.time.HLAfloat64Interval;
import hla.rti1516e.time.HLAfloat64TimeFactory;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.decho.cse.bridge.model.Entity;

import java.io.File;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class BridgeFederate {

    private static final Logger logger = LoggerFactory.getLogger(BridgeFederate.class);

    // -- FOM class names ------------------------------------------------------
    // Names as declared in the FOM actually loaded into the federation.
    //
    // Tasking is a tree of concrete interaction subclasses under
    // ETR_Root.ETR_Task, disambiguated by class rather than by a type
    // string. ETR_Root, ETR_Task, ETR_SimCon and ETR_TaskManagement are all
    // abstract and cannot be published or sent directly.
    //
    // These are the NETN v2-era names. The v4 equivalents live in
    // SmcV4Dialect, next to the code that encodes for them. Only the
    // RPR-FOM and MOM names below are dialect independent.
    public static final class Fom {
        private static final String TASK = "HLAinteractionRoot.ETR_Root.ETR_Task.";
        private static final String SIMCON = "HLAinteractionRoot.ETR_Root.ETR_SimCon.";
        private static final String TASKMGT = "HLAinteractionRoot.ETR_Root.ETR_TaskManagement.";
        private static final String REPORT = "HLAinteractionRoot.ETR_Root.ETR_Report.";
        private static final String MRM = "HLAinteractionRoot.MRM_Interaction.";

        // Tasks (ETR_Task subclasses) - inherit TaskId, Taskee, Tasker,
        // StartWhen, Why, TaskMode, CommunicationNetworkIds.
        public static final String MOVE_TO_LOCATION = TASK + "MoveToLocation";
        public static final String MOVE_TO_ENTITY = TASK + "MoveToEntity";
        public static final String PATROL = TASK + "Patrol";
        public static final String PATROL_REPEATING = TASK + "Patrol.PatrolRepeating";
        public static final String FIRE_AT_LOCATION = TASK + "FireAtLocation";
        public static final String FIRE_AT_ENTITY = TASK + "FireAtEntity";
        public static final String SET_RULES_OF_ENGAGEMENT = TASK + "SetRulesOfEngagement";
        public static final String CREATE_OBSTACLE = TASK + "CreateObstacle";
        public static final String CLEAR_OBSTACLE = TASK + "ClearObstacle";
        public static final String DISRUPT_COMMUNICATION = TASK + "DisruptCommunication";
        public static final String STOP_AT_SIDE_OF_ROAD = TASK + "StopAtSideOfRoad";
        public static final String TURN_TO_HEADING = TASK + "TurnToHeading";
        public static final String SET_ORDERED_SPEED = TASK + "SetOrderedSpeed";
        public static final String SET_ORDERED_ALTITUDE = TASK + "SetOrderedAltitude";

        // Simulation control (ETR_SimCon subclasses) - umpire actions.
        // Inherit TaskId, Taskee, Tasker only (no StartWhen/TaskMode).
        public static final String MAGIC_MOVE = SIMCON + "MagicMove";
        public static final String MAGIC_RESOURCE = SIMCON + "MagicResource";
        public static final String QUERY_CAPABILITIES = SIMCON + "QuerySupportedCapabilities";
        public static final String CAPABILITIES_SUPPORTED = SIMCON + "CapabilitiesSupported";

        // Task management - inherit TaskManagementId, Taskee, Tasker.
        public static final String CANCEL_ALL_TASKS = TASKMGT + "CancelAllTasks";
        public static final String CANCEL_SPECIFIED_TASKS = TASKMGT + "CancelSpecifiedTasks";
        public static final String TASK_STATUS_REPORT = TASKMGT + "TaskStatusReport";

        // Reports published by the simulators.
        public static final String POSITION_STATUS_REPORT = REPORT + "StatusReport.PositionStatusReport";
        public static final String DAMAGE_STATUS_REPORT = REPORT + "StatusReport.DamageStatusReport";
        public static final String RESOURCE_STATUS_REPORT = REPORT + "StatusReport.ResourceStatusReport";
        public static final String UNDER_ATTACK_REPORT = REPORT + "StatusReport.UnderAttackStatusReport";
        public static final String SPOT_REPORT = REPORT + "SpotReport";
        public static final String IN_WEAPON_RANGE_REPORT = REPORT + "InWeaponRangeReport";

        // Multi-resolution modelling (aggregate / disaggregate).
        public static final String MRM_AGGREGATE = MRM + "Request.Aggregate";
        public static final String MRM_DISAGGREGATE = MRM + "Request.Disaggregate";
        public static final String MRM_RESPONSE = MRM + "Response";

        // RPR-FOM simulation management. NETN has no scenario-control
        // interaction of its own; start/pause/stop of an exercise uses the
        // DIS-derived StartResume / StopFreeze interactions.
        public static final String START_RESUME = "HLAinteractionRoot.StartResume";
        public static final String STOP_FREEZE = "HLAinteractionRoot.StopFreeze";
        public static final String WEAPON_FIRE = "HLAinteractionRoot.WeaponFire";
        public static final String MUNITION_DETONATION = "HLAinteractionRoot.MunitionDetonation";

        // MOM class the RTI itself publishes, one instance per joined
        // federate. Subscribing turns "who else is in this federation, and
        // are they publishing?" into a log line rather than a trip to the
        // CRC console.
        public static final String MOM_FEDERATE = "HLAobjectRoot.HLAmanager.HLAfederate";

        private Fom() {}
    }

    // Attributes wanted from the MOM federate class.
    private static final List<String> MOM_FEDERATE_ATTRIBUTES = List.of(
            "HLAfederateName",
            "HLAfederateType",
            "HLAfederateHost",
            // The FOM modules each federate joined with - the most direct
            // answer to "which FOM is this federation actually running?".
            "HLAFOMmoduleDesignatorList",
            "HLAobjectInstancesRegistered",
            "HLAupdatesSent");

    // Dialect-independent RPR-FOM simulation management this federate sends.
    // Everything else it publishes comes from the selected TaskDialect.
    private static final List<String> RPR_PUBLISHED = List.of(
            Fom.START_RESUME,
            Fom.STOP_FREEZE
    );

    // Dialect-independent RPR-FOM events this federate listens for.
    private static final List<String> RPR_SUBSCRIBED = List.of(
            Fom.WEAPON_FIRE,
            Fom.MUNITION_DETONATION
    );

    // Object classes to subscribe to, with the attributes wanted from each.
    //
    // The NETN UniqueId attribute, the UUID every ETR task needs as its
    // Taskee, is declared on leaf classes or via the MIM rather than on
    // Platform alone, so entities must be subscribed at multiple levels to
    // guarantee it arrives.
    private static final Map<String, List<String>> SUBSCRIBED_OBJECTS = buildObjectSubscriptions();

    private static Map<String, List<String>> buildObjectSubscriptions() {
        // Different NETN generations disagree on where attributes live and
        // how they are spelled:
        //
        // - v2-era: Callsign/Status/SymbolId/UniqueId live on NETN leaf
        //   classes (NETN_GroundVehicle, NETN_Aggregate, ...).
        // - v4: those classes do not exist. Callsign/Symbol/Status/
        //   SupportedActions moved onto BaseEntity, aggregate attributes onto
        //   AggregateEntity, SymbolId was renamed Symbol, and UniqueId moved
        //   to HLAobjectRoot where the NETN MIM declares it.
        //
        // Subscribing with the wrong generation's names against the wrong
        // federation fails silently: the class or attribute is simply not
        // found, the subscription is skipped, and entities arrive with only
        // a position and a callsign.
        Map<String, List<String>> map = new LinkedHashMap<>();
        String physical = "HLAobjectRoot.BaseEntity.PhysicalEntity.";

        // UniqueId is inherited from HLAobjectRoot, where the NETN MIM
        // declares it - it is not an attribute of BaseEntity or of any RPR
        // class, so it has to be requested explicitly on whichever class an
        // entity is actually discovered at.
        //
        // SupportedActions (NETN-SMC, v4 only) is how a v4 entity advertises
        // which control actions its simulator will accept, answering
        // "can this entity be tasked, and with what?" without having to send
        // a task and wait to see whether anything happens. Absent in v2-era
        // FOMs, where it is skipped silently.
        //
        // Both spellings of the identity attributes are listed deliberately,
        // because different FOM generations disagree on case and naming, and
        // asking for only one spelling means an entity from the other
        // generation never carries a UUID.
        List<String> platformAttrs = List.of(
                "UniqueId", "UniqueID", "Callsign", "Symbol", "SymbolId", "Status",
                "SupportedActions",
                "EntityIdentifier", "Spatial", "EntityType", "Marking",
                "ForceIdentifier", "DamageState");

        // BaseEntity is the root of every RPR entity class, so subscribing to
        // it as a catch-all means an object published as an unenumerated
        // class is still discovered, just with fewer attributes than a more
        // specific subscription would provide.
        map.put("HLAobjectRoot.BaseEntity", List.of(
                "UniqueId", "UniqueID", "Callsign", "Symbol", "SymbolId", "Status",
                "SupportedActions", "EntityType", "EntityIdentifier", "Spatial"));

        // Physical entities, plain RPR classes and NETN leaves both. Which
        // one an object is registered as depends on the federation's FOM
        // generation, and subscribing to only one side means the object is
        // discovered at whichever ancestor was subscribed, losing every
        // attribute declared below that point.
        map.put(physical.substring(0, physical.length() - 1), platformAttrs);
        map.put(physical + "Platform", platformAttrs);
        map.put(physical + "Lifeform", platformAttrs);

        // Non-platform physical entities, and the environmental branch.
        map.put("HLAobjectRoot.BaseEntity.EnvironmentalEntity", platformAttrs);
        for (String leaf : List.of(
                "Sensor",
                "CulturalFeature",
                "Munition",
                "Expendables",
                "Radio",
                "Supplies",
                "Platform.Aircraft",
                "Platform.AmphibiousVehicle",
                "Platform.GroundVehicle",
                "Platform.MultiDomainPlatform",
                "Platform.Spacecraft",
                "Platform.SubmersibleVessel",
                "Platform.SurfaceVessel",
                "Lifeform.Human",
                "Lifeform.NonHuman",
                // NETN leaves, present in some FOM generations and absent in
                // others; skipped silently where absent.
                "Platform.Aircraft.NETN_Aircraft",
                "Platform.AmphibiousVehicle.NETN_AmphibiousVehicle",
                "Platform.GroundVehicle.NETN_GroundVehicle",
                "Platform.MultiDomainPlatform.NETN_MultiDomainPlatform",
                "Platform.Spacecraft.NETN_Spacecraft",
                "Platform.SubmersibleVessel.NETN_SubmersibleVessel",
                "Platform.SurfaceVessel.NETN_SurfaceVessel",
                "Lifeform.Human.NETN_Human",
                "Lifeform.NonHuman.NETN_NonHuman")) {
            map.put(physical + leaf, platformAttrs);
        }

        // Aggregates carry their own attribute set, split across FOM
        // generations between NETN_Aggregate and AggregateEntity; both are
        // listed so whichever exists wins.
        List<String> aggregateAttrs = List.of(
                "EntityType", "EntityIdentifier",
                "Spatial", "AggregateMarking", "AggregateState", "ForceIdentifier",
                "UniqueId", "UniqueID", "Callsign", "Symbol", "SymbolId", "Status",
                "Echelon", "CombatValue", "SupportedActions",
                "EntityList", "EmbeddedUnitList", "HigherHeadquarters", "Mounted",
                "DisaggregatedEntities", "DividedEntities");
        map.put("HLAobjectRoot.BaseEntity.AggregateEntity", aggregateAttrs);
        map.put("HLAobjectRoot.BaseEntity.AggregateEntity.NETN_Aggregate", aggregateAttrs);

        // The RTI's own view of who is joined. Not entities - reported separately.
        map.put(Fom.MOM_FEDERATE, MOM_FEDERATE_ATTRIBUTES);

        return Collections.unmodifiableMap(map);
    }

    // -- Config ---------------------------------------------------------------
    // The CRC and the FedPro server are distinct endpoints and must not be
    // assumed to share a host/port. This bridge only ever talks over
    // FedPro; the FedPro server reaches the CRC on our behalf.
    //
    // crcAddress is a comma-separated list of candidate CRC addresses,
    // tried in turn as LRC crcHost/crcPort settings until one connects,
    // because the CRC's advertised address is not stable in this
    // deployment. The first candidate means "send nothing and let the
    // FedPro server use its own configured address".
    private final String crcAddress;
    private final String fedproAddress;

    // FedPro connection settings, configurable via env vars. Defaults are
    // plain TCP with no SNI.
    private final String fedproProtocol;
    private final String fedproSniHostname;

    // Optional LRC advertised address; empty means let the LRC derive one.
    private final String lrcAdvertisedAddress;
    private final int fedproConnectTimeoutSeconds;
    private final String federationName;
    private final String fomPath;

    // Path to the NETN MIM, or blank for the RTI's standard MIM. Only usable
    // when this bridge creates the federation, since the MIM can only be
    // supplied at create time. It is the only declaration of UniqueId, so a
    // federation created without it has no taskable entities.
    private final String mimPath;

    private final boolean timeManagementEnabled;
    private final EntityStateStore store;

    // Observational state for the diagnostics endpoints. Never affects behaviour.
    private final BridgeDiagnostics diagnostics;

    // -- Tasking dialects -------------------------------------------------------
    // Constructed up front; one is selected per connection from the FOM
    // actually loaded. Neither holds connection state of its own, so a
    // reconnect that lands on a federation running a different FOM version
    // simply reselects.
    private final TaskDialect v4Dialect;

    // "auto" (default), "v2" or "v4".
    private final String dialectPreference;

    // The dialect in use, or null when this federation defines neither.
    private volatile TaskDialect dialect;

    // -- HLA internals ----------------------------------------------------------
    private RTIambassador rtiAmbassador;
    private FederationAmbassador federationAmbassador;
    private final Map<String, InteractionClassHandle> interactionHandles = new ConcurrentHashMap<>();
    private final Map<ObjectInstanceHandle, Entity> discoveredEntities =
            Collections.synchronizedMap(new HashMap<>());

    // -- Federate identity and role ----------------------------------------------
    // The federate name is configurable, with a suffix appended on
    // collision: the RTI keeps a name registered until the federate resigns
    // or a timeout expires, so a second instance under a fixed name would be
    // refused every time.
    private final String preferredFederateName;

    // The name actually joined under, which is not always the preferred one.
    // Null until a join succeeds.
    private volatile String federateName = null;

    // The CRC candidate that last connected, tried first next time. Null
    // until one succeeds, and cleared when every candidate fails, so a
    // change in network topology costs one slow connect rather than a
    // permanent wrong guess.
    private volatile String workingCrcCandidate = null;

    // Monitor-only: subscribes to entity state, publishes nothing, tasks
    // nothing. Contributes no FOM modules, so it cannot trigger a FOM merge
    // failure, and needs no tasking dialect.
    private final boolean monitorOnly;

    // Whether to create the federation execution when it does not exist.
    // Off by default: this bridge is a guest in a federation the simulators
    // own, and creating an empty one in their absence produces a bridge
    // that reports connected but discovers and receives nothing - which
    // reads exactly like a subscription or FOM bug.
    private final boolean createFederationIfAbsent;

    // Whether this bridge created the execution it is currently joined to.
    // Reported by /status and /diagnostics, since it is the difference
    // between "I cannot see the entities" and "I am not where the entities
    // are".
    private volatile boolean federationCreatedByUs = false;

    // Whether to subscribe to the HLAobjectRoot.BaseEntity catch-all. Off by
    // default: on this RTI, subscribing to the catch-all causes every object
    // to be reported as discovered at BaseEntity rather than its own class,
    // which limits every object to BaseEntity's attributes regardless of
    // what else is subscribed - because discovery is reported at whatever
    // class is subscribed, not at the most specific one.
    private final boolean subscribeBaseEntity;

    // How often to re-ask publishers for current attribute values, in
    // seconds; 0 disables it. Subscribing alone only entitles this federate
    // to future updates, so a paused scenario, or one loaded after joining,
    // otherwise leaves entities as names with no state.
    private final int attributeRefreshSeconds;
    private final int attributeRefreshMaxRequests;

    private volatile boolean running = false;
    private volatile boolean reconnectRequested = false;

    // Remembered from the initial connect so a reconnect can use the same policy.
    private volatile int retryAttempts = 60;
    private volatile int retryDelaySeconds = 10;

    // -- Constructor ------------------------------------------------------------
    public BridgeFederate(String crcAddress,
                           String fedproAddress,
                           String fedproProtocol,
                           String fedproSniHostname,
                           String lrcAdvertisedAddress,
                           int fedproConnectTimeoutSeconds,
                           String federationName,
                           String fomPath,
                           String mimPath,
                           boolean timeManagementEnabled,
                           EntityStateStore store,
                           BridgeDiagnostics diagnostics,
                           TaskDialect.Identity taskIdentity,
                           String dialectPreference,
                           String federateName,
                           String mode,
                           boolean createFederationIfAbsent,
                           boolean subscribeBaseEntity,
                           int attributeRefreshSeconds,
                           int attributeRefreshMaxRequests) {
        this.preferredFederateName = federateName == null || federateName.isBlank()
                ? "CSE-HLA-Bridge" : federateName.trim();
        this.monitorOnly = "monitor".equalsIgnoreCase(mode == null ? "" : mode.trim());
        this.createFederationIfAbsent = createFederationIfAbsent;
        this.subscribeBaseEntity = subscribeBaseEntity;
        this.attributeRefreshSeconds = attributeRefreshSeconds;
        this.attributeRefreshMaxRequests = attributeRefreshMaxRequests;
        this.diagnostics = diagnostics;
        this.crcAddress = crcAddress;
        this.fedproAddress = fedproAddress;
        this.fedproProtocol = fedproProtocol;
        this.fedproSniHostname = fedproSniHostname;
        this.lrcAdvertisedAddress = lrcAdvertisedAddress;
        this.fedproConnectTimeoutSeconds = fedproConnectTimeoutSeconds;
        this.federationName = federationName;
        this.fomPath = fomPath;
        this.mimPath = mimPath;
        this.timeManagementEnabled = timeManagementEnabled;
        this.store = store;
        this.dialectPreference = dialectPreference == null || dialectPreference.isBlank()
                ? "auto" : dialectPreference.trim().toLowerCase();
        this.v4Dialect = new SmcV4Dialect(this, taskIdentity);
    }

    // The federation execution does not exist yet.
    //
    // Separated from every other connect failure because it is not a fault
    // of this bridge's: before an exercise starts, the simulators simply
    // have not created their federation yet, so it is waited on
    // indefinitely rather than counted against the retry budget.
    public static class FederationNotRunningException extends IllegalStateException {
        FederationNotRunningException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    // -- Connection with retry --------------------------------------------------
    public void connectWithRetry(int maxAttempts, int delaySeconds) throws Exception {
        this.retryAttempts = maxAttempts;
        this.retryDelaySeconds = delaySeconds;
        Exception lastException = null;

        // Counted manually rather than in a for-header: waiting for a
        // federation that does not exist yet must not consume an attempt.
        int attempt = 0;
        while (attempt < maxAttempts) {
            try {
                logger.info("Connection attempt {}/{} to federation '{}'",
                        attempt + 1, maxAttempts, federationName);
                connect();
                logger.info("Successfully connected to federation '{}'", federationName);
                store.setConnected(true);
                store.setFederationName(federationName);
                diagnostics.recordConnected();
                return;
            } catch (FederationNotRunningException waiting) {
                // Normal before an exercise starts, so INFO rather than WARN,
                // and deliberately not an attempt: this loop should keep
                // asking hours later if that is when the simulators start.
                lastException = waiting;
                diagnostics.recordConnectionError(waiting.getMessage());
                logger.info("Federation '{}' is not running yet - waiting {}s and asking again "
                                + "(this does not count against the {} retry attempts). {}",
                        federationName, delaySeconds, maxAttempts, waiting.getMessage());
                abandonFailedAttempt();
                sleepBetweenAttempts(delaySeconds);
            } catch (Exception e) {
                attempt++;
                lastException = e;
                // Keeps the reason so diagnostics can explain why the bridge
                // is not connected, not only that it is not.
                diagnostics.recordConnectionError(e.getMessage());
                logger.warn("Attempt {}/{} failed: {}. Retrying in {}s...",
                        attempt, maxAttempts, e.getMessage(), delaySeconds);
                abandonFailedAttempt();
                if (attempt < maxAttempts) {
                    sleepBetweenAttempts(delaySeconds);
                }
            }
        }

        throw new RuntimeException("Failed to connect after " + maxAttempts + " attempts", lastException);
    }

    private static void sleepBetweenAttempts(int delaySeconds) throws InterruptedException {
        try {
            Thread.sleep(delaySeconds * 1000L);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw ie;
        }
    }

    // Tears down a half-established connection after a failed attempt.
    //
    // Without this, every retry would leak a FedPro session: the client
    // keeps the session open, the FedPro server allocates a fresh LRC port
    // for each attempt, and with many attempts that is many abandoned
    // sessions on a server shared with other simulators.
    //
    // A failure can occur before or after joining the federation, so the
    // resign and the disconnect are attempted separately and both are
    // best-effort.
    private void abandonFailedAttempt() {
        RTIambassador ambassador = rtiAmbassador;
        if (ambassador == null) {
            return;
        }
        try {
            ambassador.resignFederationExecution(ResignAction.DELETE_OBJECTS_THEN_DIVEST);
        } catch (Exception e) {
            logger.debug("Nothing to resign after the failed attempt: {}", e.getMessage());
        }
        try {
            ambassador.disconnect();
            logger.debug("Closed the FedPro session left by the failed attempt.");
        } catch (Exception e) {
            logger.debug("Could not close the FedPro session cleanly: {}", e.getMessage());
        } finally {
            rtiAmbassador = null;
            federationAmbassador = null;
            interactionHandles.clear();
        }
    }

    // Builds the local-settings-designator string for one CRC candidate.
    //
    // crcAddress is rewritten by the FedPro client into
    // connect.hostname/connect.port and removed from the list, so it names
    // the FedPro server, not the CRC. Everything else not prefixed with
    // FedPro. is forwarded to the RTI as a plain LRC setting, which is how
    // crcHost/crcPort reach the far side and tell it where the CRC actually is.
    private String buildConnectSettings(String crcCandidate) {
        String settings = "crcAddress=" + fedproAddress;
        if (!EnvironmentPorts.DEFAULT_CRC.equals(crcCandidate)) {
            int separator = crcCandidate.lastIndexOf(':');
            String host = separator > 0 ? crcCandidate.substring(0, separator) : crcCandidate;
            String port = separator > 0 ? crcCandidate.substring(separator + 1) : "8989";
            settings += "\ncrcHost=" + host + "\ncrcPort=" + port;
        }
        if (lrcAdvertisedAddress != null && !lrcAdvertisedAddress.isBlank()) {
            // The address the CRC is told to reach this LRC on. Left unset,
            // the LRC derives one, and a join can be refused if the CRC
            // cannot verify it. Pinning an address the CRC can definitely
            // reach makes the join deterministic.
            settings += "\naddress=" + lrcAdvertisedAddress;
        }
        return settings;
    }

    // -- Core connect logic -------------------------------------------------------
    private void connect() throws Exception {
        // FedPro settings are resolved with a fixed priority order (system
        // property overrides, then env var overrides, then the connect()
        // parameter, then defaults). Set the connect.* system properties
        // before creating the RTI ambassador so the factory picks them up.
        String[] fedProParts = fedproAddress.split(":");
        String fedProHost = fedProParts[0];
        String fedProPort = fedProParts.length > 1 ? fedProParts[1] : "15164";
        if (fedProParts.length <= 1) {
            // EnvironmentPorts always supplies a port, so reaching this means
            // the address bypassed it. Worth saying out loud: 15164 is the
            // FedPro library default and is not exposed by the CSE firewall,
            // so the connect below will hang rather than fail fast, and the
            // port probes will still look healthy against the real port.
            logger.warn(
                    "FedPro address '{}' has no port - falling back to the FedPro default {}, "
                            + "which the CSE firewall does not expose. Set FEDPRO_ADDRESS to "
                            + "host:port (or unset it and set FIREWALL_HOST) to derive the "
                            + "environment's port.",
                    fedproAddress, fedProPort);
        }
        System.setProperty("FedPro.connect.hostname", fedProHost);
        System.setProperty("FedPro.connect.port", fedProPort);
        System.setProperty("FedPro.connect.protocol", fedproProtocol);
        System.setProperty("FedPro.connect.timeout", String.valueOf(fedproConnectTimeoutSeconds));
        if (fedproSniHostname != null && !fedproSniHostname.isBlank()) {
            System.setProperty("FedPro.tls.sniHostname", fedproSniHostname);
        }

        logger.info(
                "Set FedPro.connect.hostname={} FedPro.connect.port={} FedPro.connect.protocol={} "
                        + "FedPro.connect.timeout={}s FedPro.tls.sniHostname={}",
                fedProHost, fedProPort, fedproProtocol, fedproConnectTimeoutSeconds,
                (fedproSniHostname == null || fedproSniHostname.isBlank()) ? "(unset)" : fedproSniHostname);

        // The CRC address is not stable here, so each candidate is tried in
        // turn. A candidate that worked before is tried first, so the common
        // case costs a single attempt.
        List<String> candidates = EnvironmentPorts.splitCandidates(crcAddress);
        String known = workingCrcCandidate;
        if (known != null && candidates.remove(known)) {
            candidates.add(0, known);
        }
        logger.info("CRC candidates to try, in order: {}", candidates);

        Exception lastFailure = null;
        for (String candidate : candidates) {
            // A fresh ambassador per candidate: reusing one that already
            // failed can leave a half-open session and produce a misleading
            // "already has a session" error instead of the real one.
            rtiAmbassador = RtiFactoryFactory.getRtiFactory().getRtiAmbassador();
            federationAmbassador =
                    new FederationAmbassador(rtiAmbassador, store, diagnostics, this::onConnectionLost);

            String settings = buildConnectSettings(candidate);
            logger.info("Connecting via CRC candidate '{}' with settings: {}",
                    candidate, settings.replace("\n", " | "));

            try {
                rtiAmbassador.connect(federationAmbassador, CallbackModel.HLA_IMMEDIATE, settings);
                workingCrcCandidate = candidate;
                lastFailure = null;
                logger.info("Connected to RTI via FedPro {} using CRC candidate '{}'.",
                        fedproAddress, candidate);
                break;
            } catch (Exception e) {
                lastFailure = e;
                logger.info("CRC candidate '{}' did not connect: {}", candidate, e.getMessage());
                // Closes any session this attempt may have opened before
                // trying the next candidate.
                abandonFailedAttempt();
            }
        }

        if (lastFailure != null) {
            workingCrcCandidate = null;
            throw lastFailure;
        }

        // Joins the federation, creating it only if explicitly allowed.
        // Creating unconditionally would silently replace an absent
        // federation (the simulators not running) with an empty execution
        // of our own, reporting connected=true with nothing discovered -
        // indistinguishable from a subscription gap. Waiting is the useful
        // default; standing in for the simulators is not.
        List<URL> fomUrls = resolveFomUrls(fomPath);
        federationCreatedByUs = false;

        if (createFederationIfAbsent) {
            try {
                // With a MIM configured, use the overload that takes one.
                // The NETN MIM extends HLAobjectRoot with UniqueId, which
                // the merged FOM relies on and the RTI's standard MIM does
                // not provide.
                URL mimUrl = resolveMimUrl(mimPath);
                if (mimUrl == null) {
                    logger.warn("Creating federation '{}' with the RTI's standard MIM: MIM_PATH is "
                                    + "not set. UniqueId is declared by the NETN MIM, so entities in this "
                                    + "federation will have no UUID and cannot be tasked.", federationName);
                    rtiAmbassador.createFederationExecution(
                            federationName,
                            fomUrls.toArray(new URL[0]));
                } else {
                    logger.info("Creating federation '{}' with the NETN MIM at {}.",
                            federationName, mimUrl);
                    rtiAmbassador.createFederationExecution(
                            federationName,
                            fomUrls.toArray(new URL[0]),
                            mimUrl);
                }
                federationCreatedByUs = true;
                logger.warn("Federation '{}' did not exist and was CREATED by this bridge "
                                + "(BRIDGE_CREATE_FEDERATION=true). Every other federate is therefore "
                                + "somewhere else and no entities will ever be discovered here. If the "
                                + "simulators are expected to already be running, check FEDERATION_NAME "
                                + "and CSE_ENVIRONMENT against theirs, and set BRIDGE_CREATE_FEDERATION"
                                + "=false so the bridge waits for their federation instead.",
                        federationName);
            } catch (FederationExecutionAlreadyExists e) {
                logger.info("Federation '{}' already exists - joining.", federationName);
            }
        }

        try {
            joinFederation(fomUrls);
        } catch (FederationExecutionDoesNotExist e) {
            // Deliberately a failed attempt rather than a created
            // federation: the retry loop keeps asking, and the next
            // attempt succeeds the moment the simulators bring their own
            // execution up.
            throw new FederationNotRunningException(
                    "Federation '" + federationName + "' does not exist on the CRC reached via "
                            + "candidate '" + workingCrcCandidate + "'. The simulators are either not "
                            + "running or are on a different CRC - compare with a bridge that does see "
                            + "entities. Retrying rather than creating an empty federation; set "
                            + "BRIDGE_CREATE_FEDERATION=true if this bridge is meant to create it.", e);
        }

        // Records the identity of this connection for status and
        // diagnostics: two bridges with identical configuration can land
        // in different places, since the CRC address is not stable here.
        diagnostics.recordIdentity(federateName, workingCrcCandidate, federationCreatedByUs);

        // Handles, pub/sub, time.
        initializeHandles();
        publishAndSubscribe();
        enableTimeManagement();
    }

    // -- Run loop (blocks until disconnected) ------------------------------------
    public void run() {
        running = true;
        logger.info("HLA bridge run loop started.");
        long lastAttributeRefresh = System.currentTimeMillis();

        while (running) {
            try {
                // With HLA_IMMEDIATE, callbacks are delivered automatically
                // on RTI-managed threads, so this thread only needs to stay
                // alive and handle reconnection.
                Thread.sleep(1000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }

            if (reconnectRequested && running) {
                reconnectRequested = false;
                reconnect();
                lastAttributeRefresh = System.currentTimeMillis();
                continue;
            }

            // Periodically re-asks for current attribute values. A single
            // request at discovery is not always answered - the publisher
            // may not be ready, or a paused scenario may have nothing to
            // send yet - and without this an entity discovered during a
            // pause stays a bare name indefinitely.
            if (attributeRefreshSeconds > 0
                    && federationAmbassador != null
                    && System.currentTimeMillis() - lastAttributeRefresh
                            >= attributeRefreshSeconds * 1000L) {
                lastAttributeRefresh = System.currentTimeMillis();
                try {
                    FederationAmbassador.RefreshSummary summary =
                            federationAmbassador.requestValuesForAllInstances(attributeRefreshMaxRequests);
                    if (summary.asked() > 0) {
                        logger.debug("Requested current attribute values for {} of {} incomplete "
                                        + "instance(s); {} already complete.{}",
                                summary.asked(), summary.outstanding(), summary.complete(),
                                summary.capped()
                                        ? " Capped by BRIDGE_ATTRIBUTE_REFRESH_MAX_REQUESTS; the"
                                                + " remainder are asked on the next cycle."
                                        : "");
                    }
                } catch (Exception e) {
                    logger.debug("Attribute value refresh failed: {}", e.getMessage());
                }
            }
        }

        logger.info("HLA bridge run loop ended.");
    }

    // Called by FederationAmbassador.connectionLost on an RTI callback
    // thread. Only sets a flag: the actual reconnect happens on the run
    // loop thread, since re-entering the RTI from inside a callback is unsafe.
    void onConnectionLost() {
        reconnectRequested = true;
    }

    private void reconnect() {
        logger.warn("Re-establishing the RTI connection after connection loss...");

        // The old ambassador and every handle resolved through it are dead.
        rtiAmbassador = null;
        federationAmbassador = null;
        interactionHandles.clear();

        // The dialect described the FOM we were connected to and is
        // reselected on reconnect, since a restarted federation can come
        // back with a different FOM.
        dialect = null;
        federationCreatedByUs = false;

        // Entity state came from a federation we are no longer attached to;
        // keeping it would serve stale positions over the REST API.
        store.clear();
        store.setConnected(false);

        // FOM classes, federates and traffic counts described the
        // federation just lost. Task history is kept.
        diagnostics.clearConnectionState();

        try {
            connectWithRetry(retryAttempts, retryDelaySeconds);
        } catch (Exception e) {
            logger.error("Could not re-establish the RTI connection: {}", e.getMessage(), e);
        }
    }

    public void stop() {
        running = false;
    }

    // Joins the federation, preferring to contribute our own FOM modules
    // but falling back to the federation's existing FOM if they cannot be
    // merged.
    //
    // Supplying modules on join adds any classes the federation lacks. But
    // HLA only merges modules that define shared classes identically, so
    // joining a federation whose FOM defines a shared class with a
    // different attribute set fails outright. That is worse than not
    // contributing modules at all - without them we still see everything
    // the federation defines, whereas a failed join sees nothing - so the
    // join is tried with our modules first, then without.
    private void joinFederation(List<URL> fomUrls) throws Exception {
        // One attempt. connectWithRetry already retries the whole
        // connect-and-join cycle; an inner retry loop would only delay
        // errors that are not transient.
        joinOnce(fomUrls);
    }

    // Joins under the configured name, or under a suffixed one if it is taken.
    //
    // A name collision is not transient and not a FOM problem: the RTI
    // keeps an unresigned name registered for a timeout period after a hard
    // restart, so waiting does not clear it while the holder is alive.
    // Renaming costs nothing, since no other component identifies this
    // federate by name.
    private void joinOnce(List<URL> fomUrls) throws Exception {
        try {
            attemptJoin(preferredFederateName, fomUrls);
            return;
        } catch (Exception first) {
            if (!isNameAlreadyInUse(first)) {
                throw first;
            }
            String unique = preferredFederateName + "-" + instanceSuffix();
            logger.warn("Federate name '{}' is already registered in '{}' - either another bridge "
                            + "is live or a previous run did not resign and the RTI has not expired it "
                            + "yet. Joining as '{}' instead of waiting it out.",
                    preferredFederateName, federationName, unique);
            attemptJoin(unique, fomUrls);
        }
    }

    // Whether an exception means the federate name is taken. Matched on the
    // message as well as the type, since FedPro tunnels the far side's
    // exception and a wrapped one arrives as a generic RTI failure carrying
    // the original text.
    private static boolean isNameAlreadyInUse(Exception e) {
        if (e instanceof FederateNameAlreadyInUse) {
            return true;
        }
        String message = e.getMessage();
        return message != null && message.toLowerCase().contains("already in use");
    }

    // A short suffix identifying this instance, so two live federates are
    // distinguishable in the RTI's federate list. The pod name is the most
    // useful thing available; a clock-derived value is the fallback outside
    // Kubernetes.
    private static String instanceSuffix() {
        String hostname = System.getenv("HOSTNAME");
        if (hostname != null && !hostname.isBlank()) {
            String cleaned = hostname.replaceAll("[\^A-Za-z0-9]", "");
            if (!cleaned.isEmpty()) {
                return cleaned.length() > 6 ? cleaned.substring(cleaned.length() - 6) : cleaned;
            }
        }
        return Long.toHexString(System.nanoTime() & 0xFFFFFL);
    }

    private void attemptJoin(String name, List<URL> fomUrls) throws Exception {
        // A monitor contributes nothing, so there is nothing to merge and
        // no reason to risk a merge failure. Straight to the federation's
        // own FOM.
        if (monitorOnly) {
            rtiAmbassador.joinFederationExecution(name, "BridgeFederateType", federationName);
            federateName = name;
            logger.info("Joined federation '{}' as '{}' in monitor-only mode, using its "
                    + "existing FOM.", federationName, name);
            return;
        }

        try {
            rtiAmbassador.joinFederationExecution(
                    name, "BridgeFederateType", federationName,
                    fomUrls.toArray(new URL[0]));
            federateName = name;
            logger.info("Joined federation '{}' as '{}', contributing our FOM modules.",
                    federationName, name);
            return;
        } catch (Exception withModules) {
            // A taken name will be taken again without our modules, so let
            // the caller rename rather than logging a misleading FOM warning first.
            if (isNameAlreadyInUse(withModules)) {
                throw withModules;
            }
            logger.warn("Could not join '{}' while contributing our FOM modules ({}). "
                            + "Retrying with the federation's existing FOM - any class it does not "
                            + "define will be unavailable, and the endpoints needing it will fail.",
                    federationName, withModules.getMessage());
            try {
                rtiAmbassador.joinFederationExecution(
                        name, "BridgeFederateType", federationName);
                federateName = name;
                logger.info("Joined federation '{}' as '{}' using its existing FOM.",
                        federationName, name);
                return;
            } catch (Exception withoutModules) {
                if (isNameAlreadyInUse(withoutModules)) {
                    throw withoutModules;
                }
                // Reports the fallback's failure rather than the first
                // one: contributing our modules is optional and its
                // failure is often expected when the two FOM generations
                // disagree on a shared class, whereas the fallback failing
                // is what actually stops the join.
                logger.warn("Join failed both ways. Contributing our FOM modules: {}. "
                                + "Using the federation's own FOM: {}",
                        withModules.getMessage(), withoutModules.getMessage());
                throw withoutModules;
            }
        }
    }

    // The configured MIM as a URL, or null when none is set. A missing file
    // is reported as null rather than thrown, since a MIM only applies when
    // creating the federation and should not fail the whole connect.
    private URL resolveMimUrl(String path) {
        if (path == null || path.isBlank()) {
            return null;
        }
        File mim = new File(path.trim());
        if (!mim.isFile()) {
            logger.warn("MIM_PATH is set to '{}' but there is no file there - creating with the "
                    + "RTI's standard MIM instead.", path);
            return null;
        }
        try {
            return mim.toURI().toURL();
        } catch (Exception e) {
            logger.warn("Could not turn MIM path '{}' into a URL: {}", path, e.getMessage());
            return null;
        }
    }

    // -- FOM URL resolution -------------------------------------------------------
    private List<URL> resolveFomUrls(String fomPath) throws Exception {
        List<URL> urls = new ArrayList<>();
        File fomDir = new File(fomPath);
        if (fomDir.isDirectory()) {
            File[] fomFiles = fomDir.listFiles(
                    (dir, name) -> name.endsWith(".xml") || name.endsWith(".fed"));
            if (fomFiles != null) {
                for (File f : fomFiles) {
                    urls.add(f.toURI().toURL());
                    logger.info("FOM file: {}", f.getName());
                }
            }
        } else {
            urls.add(new File(fomPath).toURI().toURL());
        }
        if (urls.isEmpty()) {
            throw new IllegalStateException("No FOM files found at: " + fomPath);
        }
        return urls;
    }

    // -- Handle initialisation -----------------------------------------------------
    private void initializeHandles() throws Exception {
        logger.info("Resolving FOM interaction handles...");
        List<String> missing = new ArrayList<>();

        for (Map.Entry<String, String> known : allKnownInteractions().entrySet()) {
            String name = known.getKey();
            try {
                InteractionClassHandle handle = rtiAmbassador.getInteractionClassHandle(name);
                interactionHandles.put(name, handle);
                federationAmbassador.registerInteractionName(handle, name);
                diagnostics.recordFomClass(name, known.getValue(), true);
            } catch (NameNotFound e) {
                diagnostics.recordFomClass(name, known.getValue(), false);
                // Does not abort the whole connection for one optional
                // class: an absent class only breaks the endpoints that use
                // it, and the loaded FOM may legitimately omit some modules.
                missing.add(name);
            }
        }

        logger.info("Resolved {} of {} known interaction classes.",
                interactionHandles.size(), interactionHandles.size() + missing.size());
        if (!missing.isEmpty()) {
            logger.debug("Not present in the loaded FOM: {}", missing);
        }

        selectDialect();
    }

    // v2-era class names, resolved and reported but never published or
    // subscribed. Kept purely so /diagnostics/fom can still answer "which
    // generations does this federation define?" - reporting a class is
    // free, publishing or subscribing to it is what would reactivate v2
    // tasking, and neither happens here.
    private static final List<String> V2_REPORTED_ONLY = List.of(
            Fom.MOVE_TO_LOCATION, Fom.MOVE_TO_ENTITY, Fom.PATROL, Fom.MAGIC_MOVE,
            Fom.FIRE_AT_LOCATION, Fom.FIRE_AT_ENTITY, Fom.SET_RULES_OF_ENGAGEMENT,
            Fom.CREATE_OBSTACLE, Fom.DISRUPT_COMMUNICATION, Fom.STOP_AT_SIDE_OF_ROAD,
            Fom.TURN_TO_HEADING, Fom.SET_ORDERED_SPEED, Fom.SET_ORDERED_ALTITUDE,
            Fom.CANCEL_ALL_TASKS, Fom.TASK_STATUS_REPORT,
            Fom.MRM_AGGREGATE, Fom.MRM_DISAGGREGATE, Fom.MRM_RESPONSE);

    // Every interaction class name either dialect might use, plus the
    // dialect-independent RPR ones. All are resolved regardless of which
    // dialect is selected: the resolution result is the evidence for the
    // selection, and it is also what makes a federation's actual module set
    // visible rather than discovered later by a failing endpoint.
    private Map<String, String> allKnownInteractions() {
        Map<String, String> all = new LinkedHashMap<>();
        for (String name : RPR_PUBLISHED) all.putIfAbsent(name, "rpr");
        for (String name : RPR_SUBSCRIBED) all.putIfAbsent(name, "rpr");
        for (TaskDialect candidate : List.of(v4Dialect)) {
            for (String name : candidate.published()) all.putIfAbsent(name, candidate.id());
            for (String name : candidate.subscribed()) all.putIfAbsent(name, candidate.id());
            for (String name : candidate.optional()) all.putIfAbsent(name, candidate.id());
        }
        for (String name : V2_REPORTED_ONLY) all.putIfAbsent(name, "v2");
        return all;
    }

    // Decides which tasking dialect this federation speaks.
    //
    // The bridge may join a federation created by another federate, so the
    // dialect is not ours to choose. Getting it wrong is not an error the
    // RTI reports: the class is simply absent, or present with different
    // parameters. Deciding from the loaded FOM and logging it once at
    // startup turns "why did nothing happen?" into a log line.
    //
    // A configured preference forces a choice for the case where a
    // federation defines both trees and the simulators only act on one. A
    // forced dialect the FOM does not define is refused rather than used.
    private void selectDialect() {
        boolean v4Present = hasInteraction(v4Dialect.detectionClass());
        logger.info("FOM tasking dialect: v4={} ({})", v4Present, v4Dialect.detectionClass());

        // v2 tasking is no longer wired up: the v2-era class tree belongs
        // to a different generation of the model, and supporting both
        // meant a federation carrying the wrong generation could silently
        // select it, sending every task in a format nothing listened for.
        // EtrV2Dialect is kept for reference and for encoder tests; nothing
        // constructs it.
        if ("v2".equals(dialectPreference)) {
            logger.error("BRIDGE_TASK_DIALECT=v2 was requested but v2 support has been removed. "
                    + "Ignoring the preference and using v4 if this FOM defines it.");
        }

        TaskDialect selected = v4Present ? v4Dialect : null;
        if (selected == null && !"auto".equals(dialectPreference)) {
            logger.error("BRIDGE_TASK_DIALECT={} was requested but this federation's FOM does not "
                            + "define it. Tasking is disabled rather than sending classes the federation "
                            + "cannot receive. Unset BRIDGE_TASK_DIALECT to select automatically.",
                    dialectPreference);
        }

        dialect = selected;
        diagnostics.recordDialect(
                selected == null ? "none" : selected.id(),
                selected == null ? "none" : selected.name(),
                dialectPreference);

        if (selected == null) {
            logger.warn("No NETN tasking dialect available in this federation's FOM. Entities can "
                    + "be monitored but not tasked; every tasking endpoint will return 409.");
        } else {
            logger.info("Tasking dialect selected: {} (preference '{}'). Publishing {} class(es).",
                    selected.name(), dialectPreference, selected.published().size());
            logReportingCapability(selected);
        }
    }

    // Logs which of the selected dialect's report classes exist. Task
    // acknowledgement is the difference between "the task was sent" and
    // "the task was accepted": without the status/response class, a task
    // that no federate acts on is indistinguishable from one that succeeded.
    private void logReportingCapability(TaskDialect selected) {
        List<String> availableReports = new ArrayList<>();
        List<String> missingReports = new ArrayList<>();
        for (String name : selected.subscribed()) {
            (hasInteraction(name) ? availableReports : missingReports).add(shortName(name));
        }
        logger.info("Task feedback and reports available: {}", availableReports);
        if (!missingReports.isEmpty()) {
            logger.warn("Not available in this FOM, so the corresponding feedback will never "
                    + "arrive: {}", missingReports);
        }
    }

    private static String shortName(String fomClassName) {
        int lastDot = fomClassName.lastIndexOf('.');
        return lastDot < 0 ? fomClassName : fomClassName.substring(lastDot + 1);
    }

    // -- Publish / Subscribe -------------------------------------------------------
    private void publishAndSubscribe() throws Exception {
        logger.info("Setting up pub/sub...");

        for (Map.Entry<String, List<String>> entry : SUBSCRIBED_OBJECTS.entrySet()) {
            if ("HLAobjectRoot.BaseEntity".equals(entry.getKey())) {
                if (!subscribeBaseEntity) {
                    logger.info("Not subscribing to the {} catch-all (the default). This RTI "
                                    + "reports discovery at the catch-all whenever it is subscribed, which "
                                    + "would limit every object to BaseEntity attributes. An object "
                                    + "published as a class this bridge does not enumerate is invisible "
                                    + "rather than appearing as a bare BaseEntity - see /diagnostics/objects.",
                            entry.getKey());
                    continue;
                }
                logger.warn("Subscribing to the {} catch-all (BRIDGE_SUBSCRIBE_BASE_ENTITY=true). "
                                + "On this RTI, subscribing it means every object is discovered at "
                                + "BaseEntity, so only its eight attributes are ever requested and "
                                + "everything declared further down the class tree will stay null. Use "
                                + "it only to identify an object published as an unenumerated class, then "
                                + "turn it back off.", entry.getKey());
            }
            subscribeObjectClass(entry.getKey(), entry.getValue());
        }

        // A monitor publishes nothing at all: it exists to read entity
        // state, and advertising tasking classes it will never send would
        // be misleading.
        if (monitorOnly) {
            logger.info("Monitor-only mode: subscribing to entity state and reports, publishing "
                    + "no interaction classes. Tasking endpoints on this instance return 409.");
        } else {
            // Publishes only what the selected dialect actually sends.
            // Publishing the other dialect's classes would advertise a
            // capability this bridge will never exercise.
            List<String> toPublish = new ArrayList<>(RPR_PUBLISHED);
            if (dialect != null) {
                toPublish.addAll(dialect.published());
            }
            for (String name : toPublish) {
                InteractionClassHandle handle = interactionHandles.get(name);
                if (handle == null) continue;
                try {
                    rtiAmbassador.publishInteractionClass(handle);
                    diagnostics.recordPublished(name);
                } catch (Exception e) {
                    logger.warn("Could not publish {}: {}", name, e.getMessage());
                }
            }
        }

        // Subscribes to both dialects' reports regardless of the
        // selection. Listening costs nothing, absent classes are skipped,
        // and seeing traffic in the dialect this bridge is not tasking in
        // matters most exactly when the two disagree.
        List<String> toSubscribe = new ArrayList<>(RPR_SUBSCRIBED);
        toSubscribe.addAll(v4Dialect.subscribed());
        for (String name : new java.util.LinkedHashSet<>(toSubscribe)) {
            InteractionClassHandle handle = interactionHandles.get(name);
            if (handle == null) continue;
            try {
                rtiAmbassador.subscribeInteractionClass(handle);
                diagnostics.recordSubscribed(name);
            } catch (Exception e) {
                logger.warn("Could not subscribe {}: {}", name, e.getMessage());
            }
        }

        requestMomFederateUpdates();
        logger.info("Pub/sub configured.");
    }

    // Re-asks the RTI for MOM federate details.
    //
    // Exposed for POST /diagnostics/refresh-federates: the automatic
    // request happens once at connect, so a federate that joined later is
    // missing from the reported list until asked for again.
    public void refreshFederateReports() {
        requestMomFederateUpdates();
    }

    private void requestMomFederateUpdates() {
        try {
            ObjectClassHandle momFederate = rtiAmbassador.getObjectClassHandle(Fom.MOM_FEDERATE);
            AttributeHandleSet attributes = rtiAmbassador.getAttributeHandleSetFactory().create();
            for (String attributeName : MOM_FEDERATE_ATTRIBUTES) {
                try {
                    attributes.add(rtiAmbassador.getAttributeHandle(momFederate, attributeName));
                } catch (Exception e) {
                    logger.debug("MOM attribute {} not in FOM, skipping.", attributeName);
                }
            }
            if (attributes.isEmpty()) return;
            rtiAmbassador.requestAttributeValueUpdate(momFederate, attributes, null);
            logger.info("Requested MOM federate details - each federate joined to '{}' "
                    + "should be reported below.", federationName);
        } catch (Exception e) {
            logger.debug("Could not request MOM federate updates: {}", e.getMessage());
        }
    }

    // Subscribes to an object class, skipping the class or any individual
    // attribute the loaded FOM does not define. Different simulators
    // publish different NETN subclasses, so a missing class is normal and
    // must not abort the connection.
    private void subscribeObjectClass(String className, List<String> attributeNames) {
        ObjectClassHandle classHandle;
        try {
            classHandle = rtiAmbassador.getObjectClassHandle(className);
        } catch (Exception e) {
            logger.debug("Object class not in FOM, skipping: {}", className);
            diagnostics.recordObjectClass(className, false, List.of(), attributeNames);
            return;
        }

        try {
            AttributeHandleSet attributes = rtiAmbassador.getAttributeHandleSetFactory().create();

            // Tracked by name so /diagnostics/objects can report which
            // attributes this FOM actually defined.
            List<String> gotAttributes = new ArrayList<>();
            List<String> missingAttributes = new ArrayList<>();

            for (String attributeName : attributeNames) {
                try {
                    AttributeHandle attributeHandle =
                            rtiAmbassador.getAttributeHandle(classHandle, attributeName);
                    attributes.add(attributeHandle);
                    gotAttributes.add(attributeName);
                    federationAmbassador.registerAttributeName(attributeHandle, attributeName);
                } catch (Exception e) {
                    missingAttributes.add(attributeName);
                    logger.debug("Attribute {}.{} not in FOM, skipping.", className, attributeName);
                }
            }

            if (attributes.isEmpty()) {
                // The class exists but defines none of the attributes
                // wanted, so no subscription is made - objects published
                // as it are discovered at whatever ancestor was subscribed.
                logger.info("Object class {} defines none of the {} attributes wanted - not "
                                + "subscribed. Entities published as it will be discovered at an "
                                + "ancestor class instead.", className, attributeNames.size());
                diagnostics.recordObjectClass(className, false, List.of(), missingAttributes);
                return;
            }

            // Registered before subscribing, not after: callbacks are
            // HLA_IMMEDIATE, so the RTI can deliver discoverObjectInstance
            // the moment a subscription lands, and joining a federation
            // that already holds hundreds of objects produces that burst
            // instantly. Registering afterwards would lose the race for
            // every entity discovered in that window.
            federationAmbassador.registerObjectClassName(classHandle, className);

            // Remembered so the ambassador can ask for current values on
            // discovery and again periodically - subscribing alone only
            // entitles this federate to future updates.
            federationAmbassador.registerSubscribedAttributes(classHandle, attributes);

            rtiAmbassador.subscribeObjectClassAttributes(classHandle, attributes);
            diagnostics.recordObjectClass(className, true, gotAttributes, missingAttributes);
            logger.info("Subscribed {} ({} of {} attributes; not in this FOM: {}).",
                    className, gotAttributes.size(), attributeNames.size(),
                    missingAttributes.isEmpty() ? "none" : missingAttributes);
        } catch (Exception e) {
            diagnostics.recordObjectClass(className, false, List.of(), attributeNames);
            logger.warn("Could not subscribe object class {}: {}", className, e.getMessage());
        }
    }

    // -- Time management -----------------------------------------------------------
    private void enableTimeManagement() throws Exception {
        if (!timeManagementEnabled) {
            // Off by default: this bridge is a passive observer plus an
            // out-of-band tasking channel and never requests a time
            // advance. A time-regulating federate that never advances
            // stalls every time-constrained federate in the federation.
            // Without time management, everything is sent/received in
            // receive order, which is what this bridge wants.
            logger.info("Time management disabled (receive-order only). "
                    + "Set BRIDGE_TIME_MANAGEMENT=true to enable.");
            return;
        }

        logger.info("Enabling time management...");
        HLAfloat64TimeFactory timeFactory =
                (HLAfloat64TimeFactory) rtiAmbassador.getTimeFactory();
        HLAfloat64Interval lookahead = timeFactory.makeInterval(1.0);

        try {
            rtiAmbassador.enableTimeConstrained();
        } catch (TimeConstrainedAlreadyEnabled e) {
            logger.debug("Time constrained already enabled.");
        }
        try {
            rtiAmbassador.enableTimeRegulation(lookahead);
        } catch (TimeRegulationAlreadyEnabled e) {
            logger.debug("Time regulation already enabled.");
        }
    }

    // -- Interaction sending --------------------------------------------------------
    // Looks up a previously resolved interaction class handle. Throws
    // IllegalStateException if not connected, or if the class is not
    // present in the loaded FOM.
    public InteractionClassHandle interaction(String fomClassName) {
        if (rtiAmbassador == null) {
            throw new IllegalStateException("Not connected to the RTI yet.");
        }
        InteractionClassHandle handle = interactionHandles.get(fomClassName);
        if (handle == null) {
            throw new IllegalStateException(
                    "Interaction class not available in the loaded FOM: " + fomClassName);
        }
        return handle;
    }

    public boolean hasInteraction(String fomClassName) {
        return interactionHandles.containsKey(fomClassName);
    }

    public ParameterHandle parameter(InteractionClassHandle handle, String parameterName) throws Exception {
        return rtiAmbassador.getParameterHandle(handle, parameterName);
    }

    public ParameterHandleValueMap newParameterMap(int capacity) throws Exception {
        return rtiAmbassador.getParameterHandleValueMapFactory().create(capacity);
    }

    public void sendInteraction(InteractionClassHandle handle,
                                 ParameterHandleValueMap params) throws Exception {
        if (rtiAmbassador == null) {
            throw new IllegalStateException("RTI Ambassador not initialised.");
        }
        rtiAmbassador.sendInteraction(handle, params, null);
    }

    // -- Attribute update -----------------------------------------------------------
    public void updateAttributeValues(ObjectInstanceHandle instanceHandle,
                                       AttributeHandleValueMap attributes) throws Exception {
        if (rtiAmbassador == null) {
            throw new IllegalStateException("RTI Ambassador not initialised.");
        }
        rtiAmbassador.updateAttributeValues(instanceHandle, attributes, null);
    }

    // -- Disconnect -----------------------------------------------------------------
    // How long to allow for a clean resign before giving up and exiting.
    private static final int SHUTDOWN_TIMEOUT_SECONDS = 10;

    // Resigns and closes the FedPro session when the container stops.
    //
    // Without this the JVM would be killed with the federate still joined
    // and the session still open, and an abandoned session is what makes
    // the FedPro server allocate a new LRC port next time, so every
    // uncontrolled restart would make the next start worse. Spring Boot
    // installs a shutdown hook by default, so a SIGTERM reaches this method.
    @PreDestroy
    public void disconnect() {
        running = false;
        resignAndClose("Shutting down");
    }

    // Resigns on request, leaving this process running so it can rejoin
    // later.
    //
    // Licensed RTI federate seats are scarce, and an unclean container stop
    // leaks one for a timeout period after which the next start is pushed
    // onto a suffixed name and holds a second seat. Calling this before
    // stopping releases the seat deterministically instead of depending on
    // a signal reaching the JVM in time.
    //
    // Deliberately does not clear running: the run loop has to stay alive
    // to service a later requestRejoin(). It tolerates a null ambassador.
    //
    // Returns false if nothing was joined, so there was no seat to release.
    public boolean releaseSlot() {
        return resignAndClose("Releasing the federate slot on request");
    }

    // Asks the run loop to connect and join again after releaseSlot().
    //
    // Sets the same flag onConnectionLost() uses, so the rejoin runs on the
    // run loop thread rather than the caller's HTTP thread - re-entering
    // the RTI from anywhere else is unsafe. Returns as soon as the flag is
    // set; poll GET /status for the outcome.
    //
    // Returns false if already connected, or if the run loop is not running.
    public boolean requestRejoin() {
        if (rtiAmbassador != null || !running) {
            return false;
        }
        reconnectRequested = true;
        return true;
    }

    // Resigns and closes the FedPro session. Shared by shutdown and slot release.
    //
    // Bounded on purpose: if the RTI is unreachable the resign can hang,
    // and hanging until the pod's grace period expires earns a forced kill
    // anyway, which leaks the session - the exact outcome this exists to
    // prevent. Better to try for a few seconds and exit cleanly.
    //
    // Returns false if there was no live ambassador to resign.
    private boolean resignAndClose(String reason) {
        RTIambassador ambassador = rtiAmbassador;
        if (ambassador == null) {
            return false;
        }

        logger.info("{}: resigning from '{}' so the FedPro session is closed rather "
                + "than abandoned.", reason, federationName);

        java.util.concurrent.ExecutorService closer =
                java.util.concurrent.Executors.newSingleThreadExecutor(runnable -> {
                    Thread thread = new Thread(runnable, "hla-bridge-resign");
                    thread.setDaemon(true);
                    return thread;
                });

        try {
            closer.submit(() -> {
                try {
                    ambassador.resignFederationExecution(ResignAction.DELETE_OBJECTS_THEN_DIVEST);
                    logger.info("Resigned from federation '{}'.", federationName);
                } catch (Exception e) {
                    logger.warn("Resign failed, still attempting to close the session: {}",
                            e.getMessage());
                }
                try {
                    ambassador.disconnect();
                    logger.info("FedPro session closed cleanly.");
                } catch (Exception e) {
                    logger.warn("Could not close the FedPro session: {}", e.getMessage());
                }
                return null;
            }).get(SHUTDOWN_TIMEOUT_SECONDS, java.util.concurrent.TimeUnit.SECONDS);
        } catch (java.util.concurrent.TimeoutException e) {
            logger.warn("Resign did not complete within {}s; exiting anyway. The session may be "
                            + "left open, and the next start will be given a new LRC port.",
                    SHUTDOWN_TIMEOUT_SECONDS);
        } catch (Exception e) {
            logger.warn("Error while shutting down: {}", e.getMessage());
        } finally {
            closer.shutdownNow();
            rtiAmbassador = null;
            federationAmbassador = null;
            interactionHandles.clear();
            dialect = null;
            store.setConnected(false);
        }
        return true;
    }

    // -- Getters ----------------------------------------------------------------
    public RTIambassador getRtiAmbassador() { return rtiAmbassador; }
    public String getCrcAddress() { return crcAddress; }

    // The name we asked to join as.
    public String getPreferredFederateName() { return preferredFederateName; }

    // The name we actually joined as, or null before the first successful join.
    public String getFederateName() { return federateName; }

    public boolean isMonitorOnly() { return monitorOnly; }

    // Whether this bridge created the execution it is joined to.
    public boolean isFederationCreatedByUs() { return federationCreatedByUs; }

    // The CRC candidate that answered, or null before a successful connect.
    public String getWorkingCrcCandidate() { return workingCrcCandidate; }

    public Map<ObjectInstanceHandle, Entity> getDiscoveredEntities() { return discoveredEntities; }

    // The tasking dialect in use. Throws IllegalStateException if not
    // connected yet, or if this federation defines neither dialect - both
    // are mapped to HTTP 409 by BridgeServer.
    public TaskDialect dialect() {
        TaskDialect current = dialect;
        if (current == null) {
            if (rtiAmbassador == null) {
                throw new IllegalStateException(
                        "Not connected to the RTI yet, so no tasking dialect has been selected.");
            }
            throw new TaskDialect.UnsupportedTaskException(
                    "This federation's FOM does not define " + v4Dialect.detectionClass()
                            + ", so there is nothing to task with. Entities can still be monitored. This "
                            + "bridge speaks NETN v4 only - if the federation is running a v2-era FOM, it "
                            + "is the wrong model. Check /diagnostics/fom and which modules the federation "
                            + "was created with.");
        }
        return current;
    }

    // The dialect id ("v2"/"v4") or "none", for /status. Never throws.
    public String dialectId() {
        TaskDialect current = dialect;
        return current == null ? "none" : current.id();
    }

    // The dialect display name or "none", for /status. Never throws.
    public String dialectName() {
        TaskDialect current = dialect;
        return current == null ? "none" : current.name();
    }
}