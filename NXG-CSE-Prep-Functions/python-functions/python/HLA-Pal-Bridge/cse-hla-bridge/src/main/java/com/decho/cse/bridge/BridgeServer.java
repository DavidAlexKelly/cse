[main/java/com/decho/cse/bridge/BridgeServer.java]
package com.decho.cse.bridge;

import com.decho.cse.bridge.model.Entity;
import com.decho.cse.bridge.model.request.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

// REST facade over the HLA federation.
//
// Every tasking endpoint sends the correct concrete NETN interaction via
// EtrTaskSender rather than a generic interaction with a type string.
// Tasking responses return the taskId, which is what the task status
// report reports progress against.
//
// The paths, request bodies and vocabulary here are the same whichever NETN
// FOM version the federation runs: this layer speaks degrees, seconds,
// latitude and longitude, and TaskDialect converts to whatever the loaded
// FOM wants. Every tasking response carries a dialect field, and GET
// /status reports the dialect in use - worth checking first when a task is
// accepted but nothing happens. A request field that only applies to one
// dialect is ignored with a log line rather than silently, and a request a
// dialect cannot express at all returns 409 rather than something approximate.
@RestController
@RequestMapping("/api/v1/bridge")
public class BridgeServer {

    private static final Logger logger = LoggerFactory.getLogger(BridgeServer.class);

    private final BridgeFederate bridgeFederate;
    private final EtrTaskSender tasks;
    private final EntityStateStore store;
    private final BridgeDiagnostics diagnostics;
    private final BridgeApplication.BuildInfo buildInfo;

    @Autowired
    public BridgeServer(BridgeFederate bridgeFederate, EtrTaskSender tasks, EntityStateStore store,
                         BridgeDiagnostics diagnostics, BridgeApplication.BuildInfo buildInfo) {
        this.bridgeFederate = bridgeFederate;
        this.tasks = tasks;
        this.store = store;
        this.diagnostics = diagnostics;
        this.buildInfo = buildInfo;
    }

    // -- Health & Status ---------------------------------------------------------
    @GetMapping("/health")
    public ResponseEntity<String> healthCheck() {
        if (store.isConnected()) {
            return ResponseEntity.ok("Bridge is connected to RTI.");
        }
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body("Bridge is not connected to RTI. Retrying...");
    }

    @GetMapping("/status")
    public ResponseEntity<StatusResponse> getStatus() {
        return ResponseEntity.ok(new StatusResponse(
                store.isConnected(),
                store.getFederationName(),
                store.getSimTime(),
                store.getAll().size(),
                bridgeFederate.dialectId(),
                bridgeFederate.dialectName(),
                bridgeFederate.getFederateName(),
                bridgeFederate.getWorkingCrcCandidate(),
                bridgeFederate.isFederationCreatedByUs(),
                diagnostics.federateCount(),
                buildInfo.version(),
                buildInfo.sha(),
                buildInfo.builtAt()
        ));
    }

    // -- Diagnostics ---------------------------------------------------------------
    // Read-only and observational: nothing here changes bridge behaviour.
    // They exist because most hard problems on this bridge are only
    // diagnosable by correlating several facts at once.

    // One call that explains the current state, ordered most serious first:
    // are we connected, which tasking dialect this federation speaks, which
    // FOM modules are missing, whether any entity can actually be tasked,
    // and whether anything has ever acknowledged a task we sent.
    @GetMapping("/diagnostics")
    public ResponseEntity<?> diagnosticsSummary() {
        List<Entity> entities = store.getAll();
        int withoutUniqueId = 0;
        for (Entity entity : entities) {
            if (entity.uniqueId == null || entity.uniqueId.isBlank()) {
                withoutUniqueId++;
            }
        }

        List<BridgeDiagnostics.Finding> findings = diagnostics.assess(
                store.isConnected(), store.getFederationName(), entities.size(), withoutUniqueId);

        boolean anyError = findings.stream()
                .anyMatch(f -> BridgeDiagnostics.Level.ERROR.name().equals(f.level()));
        boolean anyWarning = findings.stream()
                .anyMatch(f -> BridgeDiagnostics.Level.WARN.name().equals(f.level()));

        // A LinkedHashMap rather than Map.of, since this carries more
        // entries than Map.of accepts and some values can legitimately be
        // null before a successful join.
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("verdict", anyError ? "BROKEN" : (anyWarning ? "DEGRADED" : "HEALTHY"));
        summary.put("findings", findings);
        summary.put("connected", store.isConnected());
        summary.put("federation", String.valueOf(store.getFederationName()));
        summary.put("uptime", diagnostics.uptime());
        summary.put("taskDialect", bridgeFederate.dialectId());
        summary.put("entities", entities.size());
        summary.put("tasksSent", diagnostics.tasksSent());
        summary.put("acknowledgementsReceived", diagnostics.acknowledgementsReceived());
        summary.put("federateName", bridgeFederate.getFederateName());
        summary.put("crcCandidate", bridgeFederate.getWorkingCrcCandidate());
        summary.put("federationCreatedByUs", bridgeFederate.isFederationCreatedByUs());
        summary.put("federateCount", diagnostics.federateCount());
        return ResponseEntity.ok(summary);
    }

    // Every interaction class the bridge knows about: which dialect and FOM
    // module it belongs to, whether this federation defines it, and
    // whether we publish or subscribe to it.
    @GetMapping("/diagnostics/fom")
    public ResponseEntity<?> fomClasses() {
        List<BridgeDiagnostics.FomClassStatus> all = diagnostics.fomClassStatuses();
        long resolved = all.stream().filter(BridgeDiagnostics.FomClassStatus::resolved).count();

        Map<String, String> operations = new LinkedHashMap<>();
        try {
            for (TaskDialect.Op op : TaskDialect.Op.values()) {
                operations.put(op.name(), tasks.classFor(op));
            }
        } catch (Exception e) {
            operations.put("error", e.getMessage());
        }

        return ResponseEntity.ok(Map.of(
                "taskDialect", bridgeFederate.dialectId(),
                "taskDialectName", bridgeFederate.dialectName(),
                "knownClasses", all.size(),
                "resolvedInThisFederation", resolved,
                "operationToClass", operations,
                "classes", all));
    }

    // Which object classes this federation defines, and which attributes
    // of each we were able to subscribe to. The counterpart of
    // /diagnostics/fom for objects rather than interactions - this answers
    // "why is this entity field null?".
    @GetMapping("/diagnostics/objects")
    public ResponseEntity<?> objectClasses() {
        List<BridgeDiagnostics.ObjectClassStatus> all = diagnostics.objectClassStatuses();
        long resolved = all.stream().filter(BridgeDiagnostics.ObjectClassStatus::resolved).count();

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("subscribedClasses", resolved);
        body.put("knownClasses", all.size());
        body.put("note", "Attributes under 'missing' are not defined by this federation's FOM and "
                + "were skipped. If an entity has a name but no identity or position, look for the "
                + "class it was published as being unresolved, or its identity attributes missing.");
        body.put("objectClasses", all);
        return ResponseEntity.ok(body);
    }

    // -- Federate slot management --------------------------------------------------
    // Resigns from the federation, releasing this federate's licence seat.
    //
    // Only ever resigns this bridge - HLA offers no way to resign another
    // federate. The process keeps running and can rejoin via POST /reconnect.
    // Idempotent: resigning when not joined is a 200 with released: false.
    @PostMapping("/disconnect")
    public ResponseEntity<?> disconnectFederate() {
        try {
            boolean released = bridgeFederate.releaseSlot();
            return ResponseEntity.ok(Map.of(
                    "status", released ? "resigned" : "not-joined",
                    "released", released,
                    "connected", store.isConnected(),
                    "note", released
                            ? "Resigned and closed the FedPro session. The licence seat is free. "
                                    + "The process is still running - POST /reconnect to rejoin."
                            : "Nothing was joined, so no seat was held. Already released, or the "
                                    + "bridge never connected."));
        } catch (Exception e) {
            return failure("resign from the federation", e);
        }
    }

    // Connects and joins again after POST /disconnect.
    //
    // Asynchronous by design: the rejoin runs on the run loop thread,
    // because re-entering the RTI from an HTTP thread is unsafe. This
    // returns as soon as the request is queued; poll GET /status until
    // connected is true.
    @PostMapping("/reconnect")
    public ResponseEntity<?> reconnectFederate() {
        try {
            boolean queued = bridgeFederate.requestRejoin();
            return ResponseEntity.ok(Map.of(
                    "status", queued ? "rejoin-requested" : "no-action",
                    "queued", queued,
                    "connected", store.isConnected(),
                    "note", queued
                            ? "The run loop will connect and join within about a second. Poll "
                                    + "GET /status until connected is true."
                            : store.isConnected()
                                    ? "Already connected; nothing to do."
                                    : "The run loop is not running, so it cannot rejoin. Restart "
                                            + "the container."));
        } catch (Exception e) {
            return failure("rejoin the federation", e);
        }
    }

    // Who is publishing entities on the DIS side, grouped by site/application.
    //
    // A federate's DIS site/application pair is effectively its address, so
    // grouping live entities by it says which simulator published what -
    // the precondition for any RPR-addressed control path.
    @GetMapping("/diagnostics/dis-sources")
    public ResponseEntity<?> disSources() {
        List<Map<String, Object>> sources = store.observedDisSourcesGrouped();
        int addressable = store.getRprAddressable().size();
        int total = store.getAll().size();

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("sources", sources);
        body.put("entitiesWithEntityIdentifier", addressable);
        body.put("entitiesTotal", total);
        if (sources.isEmpty()) {
            body.put("note", total == 0
                    ? "No entities discovered yet."
                    : "No entity has reflected an EntityIdentifier. Either no publisher sends it, "
                            + "or it is not subscribed at the class these entities were discovered at - "
                            + "see /diagnostics/objects.");
        }
        return ResponseEntity.ok(body);
    }

    @GetMapping("/diagnostics/federates")
    public ResponseEntity<?> federates() {
        List<BridgeDiagnostics.FederateRecord> all = diagnostics.federateRecords();
        return ResponseEntity.ok(Map.of(
                "count", all.size(),
                "note", all.isEmpty()
                        ? "No MOM data reported. Either the RTI does not expose HLAmanager, or it "
                                + "has not answered the attribute request yet."
                        : "From HLAobjectRoot.HLAmanager.HLAfederate, published by the RTI itself.",
                "federates", all));
    }

    // Re-asks the RTI for MOM federate details. The automatic request
    // happens once at connect, so a simulator started after the bridge
    // does not appear until asked for again.
    @PostMapping("/diagnostics/refresh-federates")
    public ResponseEntity<?> refreshFederates() {
        if (!store.isConnected()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", "Not connected to the RTI."));
        }
        bridgeFederate.refreshFederateReports();
        return ResponseEntity.ok(Map.of(
                "status", "requested",
                "note", "The RTI replies asynchronously. Read /diagnostics/federates in a moment.",
                "knownNow", diagnostics.federateRecords().size()));
    }

    // Recent tasks and whether anything answered them. A 200 from a
    // tasking endpoint only means the interaction was sent; an empty
    // acknowledgements list here means nothing has replied.
    @GetMapping("/diagnostics/tasks")
    public ResponseEntity<?> taskHistory() {
        List<BridgeDiagnostics.TaskRecord> all = diagnostics.recentTasks();
        long acknowledged = all.stream()
                .filter(BridgeDiagnostics.TaskRecord::isAcknowledged).count();
        return ResponseEntity.ok(Map.of(
                "sentThisSession", diagnostics.tasksSent(),
                "inHistory", all.size(),
                "acknowledged", acknowledged,
                "unacknowledged", all.size() - acknowledged,
                "tasks", all));
    }

    // Exactly what POST /entities/{id}/move would send, without sending it.
    // For reconciling with another federate's decoder: returns field
    // values, datatypes and encoded bytes so a disagreement in units or
    // coordinate system is visible directly.
    @GetMapping("/diagnostics/preview/move-task")
    public ResponseEntity<?> previewMoveTask(
            @RequestParam double lat,
            @RequestParam double lon,
            @RequestParam(required = false) Double alt,
            @RequestParam(required = false) String moveType,
            @RequestParam(required = false) Double speedMetersPerSecond) {
        try {
            Map<String, String> fields = tasks.describeMoveTask(
                    lat, lon, alt == null ? 0.0 : alt, moveType, speedMetersPerSecond);
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("dialect", tasks.dialectId());
            body.put("sent", false);
            body.put("note", "Nothing was sent. This is what a move with these arguments would "
                    + "put on the wire. Compare the Location datatype and bytes with what the "
                    + "receiving federate decodes.");
            body.put("wouldSend", fields);
            return ResponseEntity.ok(body);
        } catch (Exception e) {
            return failure("preview a move task", e);
        }
    }

    // Interaction classes actually received, with counts and last-seen times.
    @GetMapping("/diagnostics/interactions")
    public ResponseEntity<?> interactionTraffic() {
        List<BridgeDiagnostics.InteractionTraffic> all = diagnostics.interactionTraffic();
        return ResponseEntity.ok(Map.of(
                "distinctClasses", all.size(),
                "note", all.isEmpty()
                        ? "Nothing received. Normal in a quiet scenario - entity position updates "
                                + "are attribute reflections, not interactions."
                        : "Counted since the current connection was established.",
                "received", all));
    }

    // Whether a specific entity can be tasked, and with what: a NETN
    // UniqueId to address, a tasking dialect in the FOM, the entity's own
    // SupportedActions, and any tasks already sent to it.
    @GetMapping("/entities/{id}/diagnostics")
    public ResponseEntity<?> entityDiagnostics(@PathVariable String id) {
        Entity entity = store.get(id);
        if (entity == null) {
            entity = store.getByUniqueId(id).orElse(null);
        }
        if (entity == null) {
            // A third way to name an entity, and the only one available to
            // a simulator that publishes no NETN UniqueId: its DIS
            // EntityIdentifier, written "site-app-entity".
            entity = store.getByEntityIdentifier(id).orElse(null);
        }
        if (entity == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of(
                    "error", "Entity not found: " + id,
                    "note", "Tasking still accepts a bare UUID for an entity this bridge has not "
                            + "discovered - HLA is decoupled, and an entity can exist without us "
                            + "subscribing to the class it was published as."));
        }

        List<String> blockers = new ArrayList<>();
        boolean hasUniqueId = entity.uniqueId != null && !entity.uniqueId.isBlank();
        boolean rprAddressable = entity.entityIdentifier != null;

        if (!hasUniqueId) {
            blockers.add(rprAddressable
                    ? "No NETN UniqueId: NETN tasks address entities by UUID, so this entity "
                            + "cannot be tasked through a NETN dialect. It does carry a DIS "
                            + "EntityIdentifier (" + entity.entityIdentifier + "), so it is addressable "
                            + "by any RPR-addressed path."
                    : "No NETN UniqueId and no DIS EntityIdentifier: this entity cannot be "
                            + "addressed by any route. Check which class it was discovered at - only "
                            + "attributes available there can reach us.");
        }

        String dialect = bridgeFederate.dialectId();
        if ("none".equals(dialect) || "unknown".equals(dialect)) {
            blockers.add("This federation's FOM defines no NETN tasking classes.");
        }

        List<String> supported = diagnostics.supportedActionsFor(entity.id).orElse(null);
        if (supported != null && supported.isEmpty()) {
            blockers.add("The entity advertises SupportedActions but the list is empty: its "
                    + "simulator accepts no NETN control actions, so it cannot be tasked.");
        }

        List<BridgeDiagnostics.TaskRecord> sentToThis = new ArrayList<>();
        for (BridgeDiagnostics.TaskRecord record : diagnostics.recentTasks()) {
            if (record.getEntity() != null
                    && (record.getEntity().equals(entity.uniqueId) || record.getEntity().equals(id))) {
                sentToThis.add(record);
            }
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", entity.id);
        body.put("uniqueId", String.valueOf(entity.uniqueId));
        body.put("entityIdentifier", entity.entityIdentifier == null
                ? "not reflected (EntityIdentifier absent or not subscribed at the discovered class)"
                : entity.entityIdentifier);
        body.put("disSiteId", entity.disSiteId);
        body.put("disApplicationId", entity.disApplicationId);
        body.put("disEntityNumber", entity.disEntityNumber);
        body.put("rprAddressable", rprAddressable);
        body.put("name", String.valueOf(entity.name));
        body.put("entityType", String.valueOf(entity.entityType));
        body.put("lastUpdated", entity.lastUpdated);
        body.put("position", entity.latitude == null ? "unknown"
                : entity.latitude + ", " + entity.longitude);
        body.put("taskDialect", dialect);
        body.put("supportedActions", supported == null
                ? "not published by this entity (expected on a v2-era FOM)" : supported);
        body.put("taskable", blockers.isEmpty());
        body.put("blockers", blockers);
        body.put("tasksSentToThisEntity", sentToThis);
        return ResponseEntity.ok(body);
    }

    // -- Entity Queries ------------------------------------------------------------
    @GetMapping("/entities")
    public ResponseEntity<List<Entity>> getEntities() {
        return ResponseEntity.ok(store.getAll());
    }

    @GetMapping("/entities/{id}")
    public ResponseEntity<?> getEntity(@PathVariable String id) {
        Entity e = store.get(id);
        if (e == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "Entity not found: " + id));
        }
        return ResponseEntity.ok(e);
    }

    @GetMapping("/entities/simulator/{simulator}")
    public ResponseEntity<List<Entity>> getEntitiesBySimulator(@PathVariable String simulator) {
        return ResponseEntity.ok(store.getBySimulator(simulator));
    }

    @GetMapping("/entities/area")
    public ResponseEntity<List<Entity>> getEntitiesInArea(
            @RequestParam double lat,
            @RequestParam double lon,
            @RequestParam double radiusKm) {
        return ResponseEntity.ok(store.getInArea(lat, lon, radiusKm));
    }

    // -- Scenario Control -----------------------------------------------------------
    // RPR-FOM simulation management. NETN has no start/pause/stop scenario
    // interaction; StartResume and StopFreeze are the DIS-derived
    // federation-wide equivalents.
    @PostMapping("/start")
    public ResponseEntity<?> startScenario() {
        try {
            long requestId = tasks.startResume();
            return ResponseEntity.ok(Map.of(
                    "status", "started",
                    "interaction", "StartResume",
                    "requestId", requestId));
        } catch (Exception e) {
            return failure("start scenario", e);
        }
    }

    @PostMapping("/pause")
    public ResponseEntity<?> pauseScenario() {
        try {
            long requestId = tasks.stopFreeze(true);
            return ResponseEntity.ok(Map.of(
                    "status", "paused",
                    "interaction", "StopFreeze(Recess)",
                    "requestId", requestId));
        } catch (Exception e) {
            return failure("pause scenario", e);
        }
    }

    @PostMapping("/stop")
    public ResponseEntity<?> stopScenario() {
        try {
            long requestId = tasks.stopFreeze(false);
            return ResponseEntity.ok(Map.of(
                    "status", "stopped",
                    "interaction", "StopFreeze(Termination)",
                    "requestId", requestId));
        } catch (Exception e) {
            return failure("stop scenario", e);
        }
    }

    // -- Movement -------------------------------------------------------------------
    @PostMapping("/entities/{id}/move")
    public ResponseEntity<?> moveToLocation(@PathVariable String id,
                                             @RequestBody MoveRequest req) {
        try {
            Taskee taskee = resolveTaskee(id);
            String uuid = taskee.uuid();
            var taskId = tasks.moveToLocation(uuid, req.latitude(), req.longitude(),
                    altitudeOf(req.altitudeMeters(), taskee.entity()), req.moveType(),
                    req.speedMetersPerSecond(),
                    composeAnnotation(req.annotation(), req.orbitRadiusMeters()));
            return ResponseEntity.ok(Map.of(
                    "status", "tasked", "entityId", id, "task", "MoveToLocation",
                    "taskId", taskId.toString(), "dialect", tasks.dialectId()));
        } catch (Exception e) {
            return failure("send move task for " + id, e);
        }
    }

    @PostMapping("/entities/{id}/patrol")
    public ResponseEntity<?> patrol(@PathVariable String id,
                                     @RequestBody PatrolRequest req) {
        try {
            Taskee taskee = resolveTaskee(id);
            String uuid = taskee.uuid();
            if (req.waypoints() == null || req.waypoints().isEmpty()) {
                throw new IllegalArgumentException("At least one waypoint is required.");
            }
            List<double[]> path = new ArrayList<>();
            for (PatrolRequest.Waypoint wp : req.waypoints()) {
                path.add(new double[]{wp.latitude(), wp.longitude(),
                        wp.altitudeMeters() == null ? 0.0 : wp.altitudeMeters()});
            }
            var taskId = tasks.patrol(uuid, path, req.patrolType(), req.moveType(),
                    req.durationSeconds(), req.intervalSeconds(), req.speedMetersPerSecond());
            boolean repeating = req.durationSeconds() != null && req.durationSeconds() > 0;
            return ResponseEntity.ok(Map.of(
                    "status", "tasked", "entityId", id,
                    "task", repeating ? taskLabel("PatrolRepeating", "Patrol") : "Patrol",
                    "repeating", repeating,
                    "taskId", taskId.toString(), "dialect", tasks.dialectId()));
        } catch (Exception e) {
            return failure("send patrol task for " + id, e);
        }
    }

    @PostMapping("/entities/{id}/magic-move")
    public ResponseEntity<?> magicMove(@PathVariable String id,
                                        @RequestBody MagicMoveRequest req) {
        try {
            Taskee taskee = resolveTaskee(id);
            String uuid = taskee.uuid();
            var taskId = tasks.magicMove(uuid, req.latitude(), req.longitude(),
                    altitudeOf(req.altitudeMeters(), taskee.entity()), req.headingDegrees());
            return ResponseEntity.ok(Map.of(
                    "status", "moved", "entityId", id, "task", "MagicMove",
                    "taskId", taskId.toString(), "dialect", tasks.dialectId()));
        } catch (Exception e) {
            return failure("magic-move entity " + id, e);
        }
    }

    // -- Fires ------------------------------------------------------------------------
    @PostMapping("/entities/{id}/fire-at-location")
    public ResponseEntity<?> fireAtLocation(@PathVariable String id,
                                             @RequestBody FireAtLocationRequest req) {
        try {
            Taskee taskee = resolveTaskee(id);
            String uuid = taskee.uuid();
            var taskId = tasks.fireAtLocation(uuid, req.latitude(), req.longitude(),
                    req.altitudeMeters() == null ? 0.0 : req.altitudeMeters(),
                    req.durationSeconds());
            return ResponseEntity.ok(Map.of(
                    "status", "tasked", "entityId", id,
                    "task", taskLabel("FireAtLocation", "IndirectFire"),
                    "taskId", taskId.toString(), "dialect", tasks.dialectId()));
        } catch (Exception e) {
            return failure("send fire-at-location for " + id, e);
        }
    }

    @PostMapping("/entities/{id}/fire-at-entity")
    public ResponseEntity<?> fireAtEntity(@PathVariable String id,
                                           @RequestBody FireAtEntityRequest req) {
        try {
            String attackerUuid = resolveTaskee(id).uuid();
            String targetUuid = resolveTaskee(req.targetId()).uuid();
            var taskId = tasks.fireAtEntity(attackerUuid, targetUuid);
            return ResponseEntity.ok(Map.of(
                    "status", "tasked", "entityId", id,
                    "targetId", String.valueOf(req.targetId()),
                    "task", taskLabel("FireAtEntity", "DirectFire"),
                    "taskId", taskId.toString(), "dialect", tasks.dialectId()));
        } catch (Exception e) {
            return failure("send fire-at-entity for " + id, e);
        }
    }

    // -- ROE & Control ------------------------------------------------------------------
    @PostMapping("/entities/{id}/roe")
    public ResponseEntity<?> setRoe(@PathVariable String id, @RequestBody RoeRequest req) {
        try {
            Taskee taskee = resolveTaskee(id);
            String uuid = taskee.uuid();
            var taskId = tasks.setRulesOfEngagement(uuid, req.roe());
            return ResponseEntity.ok(Map.of(
                    "status", "updated", "entityId", id, "roe", String.valueOf(req.roe()),
                    "task", taskLabel("SetRulesOfEngagement", "ChangeRulesOfEngagement"),
                    "taskId", taskId.toString(), "dialect", tasks.dialectId()));
        } catch (Exception e) {
            return failure("set ROE for " + id, e);
        }
    }

    // Turns to a heading, in degrees clockwise from true north in both
    // dialects - the v2-era wire carries radians and the dialect converts.
    @PostMapping("/entities/{id}/heading")
    public ResponseEntity<?> setHeading(@PathVariable String id, @RequestBody HeadingRequest req) {
        try {
            String uuid = resolveTaskee(id).uuid();
            var taskId = tasks.changeHeading(uuid, req.headingDegrees());
            return ResponseEntity.ok(Map.of(
                    "status", "tasked", "entityId", id,
                    "headingDegrees", req.headingDegrees(),
                    "task", taskLabel("TurnToHeading", "ChangeHeading"),
                    "taskId", taskId.toString(), "dialect", tasks.dialectId()));
        } catch (Exception e) {
            return failure("set heading for " + id, e);
        }
    }

    // Sets the ordered speed, metres per second.
    @PostMapping("/entities/{id}/speed")
    public ResponseEntity<?> setSpeed(@PathVariable String id, @RequestBody SpeedRequest req) {
        try {
            String uuid = resolveTaskee(id).uuid();
            var taskId = tasks.changeSpeed(uuid, req.speedMetersPerSecond());
            return ResponseEntity.ok(Map.of(
                    "status", "tasked", "entityId", id,
                    "speedMetersPerSecond", req.speedMetersPerSecond(),
                    "task", taskLabel("SetOrderedSpeed", "ChangeSpeed"),
                    "taskId", taskId.toString(), "dialect", tasks.dialectId()));
        } catch (Exception e) {
            return failure("set speed for " + id, e);
        }
    }

    // Sets the ordered altitude, metres above mean sea level.
    @PostMapping("/entities/{id}/altitude")
    public ResponseEntity<?> setAltitude(@PathVariable String id,
                                          @RequestBody AltitudeRequest req) {
        try {
            String uuid = resolveTaskee(id).uuid();
            var taskId = tasks.changeAltitude(uuid, req.altitudeMeters());
            return ResponseEntity.ok(Map.of(
                    "status", "tasked", "entityId", id,
                    "altitudeMeters", req.altitudeMeters(),
                    "task", taskLabel("SetOrderedAltitude", "ChangeAltitude"),
                    "taskId", taskId.toString(), "dialect", tasks.dialectId()));
        } catch (Exception e) {
            return failure("set altitude for " + id, e);
        }
    }

    // Stops and holds. No body: the task carries no parameters in either
    // dialect. Distinct from /cancel-tasks, which withdraws scheduled
    // tasks rather than ordering a stop-in-place.
    @PostMapping("/entities/{id}/stop")
    public ResponseEntity<?> stopEntity(@PathVariable String id) {
        try {
            String uuid = resolveTaskee(id).uuid();
            var taskId = tasks.stopAtSideOfRoad(uuid);
            return ResponseEntity.ok(Map.of(
                    "status", "stopping", "entityId", id, "task", "StopAtSideOfRoad",
                    "taskId", taskId.toString(), "dialect", tasks.dialectId()));
        } catch (Exception e) {
            return failure("stop entity " + id, e);
        }
    }

    @PostMapping("/entities/{id}/cancel-tasks")
    public ResponseEntity<?> cancelTasks(@PathVariable String id) {
        try {
            Taskee taskee = resolveTaskee(id);
            String uuid = taskee.uuid();
            var managementId = tasks.cancelAllTasks(uuid);
            return ResponseEntity.ok(Map.of(
                    "status", "cancelled", "entityId", id,
                    "task", taskLabel("CancelAllTasks", "CancelTasks"),
                    "taskManagementId", managementId.toString(),
                    "dialect", tasks.dialectId()));
        } catch (Exception e) {
            return failure("cancel tasks for " + id, e);
        }
    }

    // -- Umpire / Exercise Control ------------------------------------------------------
    @PostMapping("/entities/{id}/inject-supplies")
    public ResponseEntity<?> injectSupplies(@PathVariable String id,
                                             @RequestBody InjectSuppliesRequest req) {
        try {
            Taskee taskee = resolveTaskee(id);
            String uuid = taskee.uuid();
            double quantity = req.quantity() == null ? 100.0 : req.quantity();
            var taskId = tasks.injectSupplies(uuid, req.resourceType(), req.supplyType(), quantity);
            return ResponseEntity.ok(Map.of(
                    "status", "injected", "entityId", id,
                    "resourceType", String.valueOf(req.resourceType()),
                    "quantity", quantity,
                    "task", taskLabel("MagicResource", "SetSuppliesStatus"),
                    "taskId", taskId.toString(), "dialect", tasks.dialectId()));
        } catch (Exception e) {
            return failure("inject supplies for " + id, e);
        }
    }

    @PostMapping("/entities/{id}/disaggregate")
    public ResponseEntity<?> disaggregate(@PathVariable String id,
                                           @RequestBody(required = false) MrmRequest req) {
        return multiResolution(id, req, false);
    }

    @PostMapping("/entities/{id}/aggregate")
    public ResponseEntity<?> aggregate(@PathVariable String id,
                                        @RequestBody(required = false) MrmRequest req) {
        return multiResolution(id, req, true);
    }

    private ResponseEntity<?> multiResolution(String id, MrmRequest req, boolean aggregate) {
        try {
            Taskee taskee = resolveTaskee(id);
            String uuid = taskee.uuid();
            boolean removeSubunits = req != null && Boolean.TRUE.equals(req.removeSubunits());
            var eventId = tasks.multiResolution(aggregate, uuid,
                    req == null ? null : req.federate(), removeSubunits);
            return ResponseEntity.ok(Map.of(
                    "status", aggregate ? "aggregating" : "disaggregating",
                    "entityId", id,
                    "interaction", aggregate ? "MRM Aggregate" : "MRM Disaggregate",
                    "eventId", eventId.toString(),
                    "dialect", tasks.dialectId()));
        } catch (Exception e) {
            return failure((aggregate ? "aggregate" : "disaggregate") + " entity " + id, e);
        }
    }

    // -- Map / Environment ---------------------------------------------------------------
    @PostMapping("/map/obstacle")
    public ResponseEntity<?> createObstacle(@RequestBody ObstacleRequest req) {
        try {
            if (req.entityId() == null || req.entityId().isBlank()) {
                throw new IllegalArgumentException(
                        "CreateObstacle is an ETR task and requires an engineer entity to task: "
                                + "provide \"entityId\".");
            }
            Taskee taskee = resolveTaskee(req.entityId());
            String uuid = taskee.uuid();
            double radius = req.radiusMeters() == null ? 50.0 : req.radiusMeters();
            var obstacleUuid = tasks.createObstacle(uuid, req.type(), req.obstacleType(),
                    req.latitude(), req.longitude(), radius);
            return ResponseEntity.ok(Map.of(
                    "status", "created", "type", String.valueOf(req.type()),
                    "entityId", req.entityId(), "obstacleId", obstacleUuid.toString(),
                    "dialect", tasks.dialectId()));
        } catch (Exception e) {
            return failure("create obstacle", e);
        }
    }

    @PostMapping("/map/disrupt-comms")
    public ResponseEntity<?> disruptComms(@RequestBody DisruptCommsRequest req) {
        try {
            if (req.entityId() == null || req.entityId().isBlank()) {
                throw new IllegalArgumentException(
                        "DisruptCommunication is an ETR task and requires the entity performing "
                                + "the disruption: provide \"entityId\".");
            }
            Taskee taskee = resolveTaskee(req.entityId());
            String uuid = taskee.uuid();
            var taskId = tasks.disruptCommunication(uuid, req.network(), req.latitude(),
                    req.longitude(), req.radiusKm(), req.enabled());
            return ResponseEntity.ok(Map.of(
                    "status", "updated", "enabled", req.enabled(),
                    "entityId", req.entityId(), "task", "DisruptCommunication",
                    "taskId", taskId.toString(), "dialect", tasks.dialectId()));
        } catch (Exception e) {
            return failure("disrupt comms", e);
        }
    }

    // -- Helpers ---------------------------------------------------------------------
    // The resolved target of a task: the UUID to put in the Taskee
    // parameter, plus the discovered entity if known.
    private record Taskee(String uuid, Entity entity) {}

    // Resolves a request's entity identifier to the NETN UniqueId used as
    // the Taskee.
    //
    // Accepts an HLA object-instance handle or a NETN UniqueId of a
    // discovered entity, and also a bare UUID for an entity this bridge has
    // not discovered. That last case is deliberate: HLA is decoupled, and
    // an entity existing in the federation is independent of whether this
    // bridge happens to subscribe to the class it was published as.
    private Taskee resolveTaskee(String id) throws EntityNotFoundException {
        Entity entity = store.get(id);
        if (entity == null) {
            entity = store.getByUniqueId(id).orElse(null);
        }
        if (entity != null && entity.uniqueId != null && !entity.uniqueId.isBlank()) {
            return new Taskee(entity.uniqueId, entity);
        }

        // Either not discovered, or discovered without a NETN UniqueId.
        // Both are usable if the caller gave us a UUID to address.
        try {
            String uuid = HlaEncoder.parseUuid(id).toString();
            if (entity == null) {
                logger.warn("Entity {} has not been discovered by this bridge; tasking it by UUID "
                        + "anyway. Watch for an ETR TaskStatusReport to see whether any federate "
                        + "accepts it.", id);
            } else {
                logger.warn("Entity {} was discovered without a NETN UniqueId; using the supplied "
                        + "UUID as the Taskee.", id);
            }
            return new Taskee(uuid, entity);
        } catch (IllegalArgumentException e) {
            if (entity == null) {
                throw new EntityNotFoundException(id);
            }
            throw new IllegalStateException(
                    "Entity '" + id + "' has no NETN UniqueId, so it cannot be tasked. ETR tasks "
                            + "address entities by UUID. Either pass the UUID directly, or check that the "
                            + "entity is published as a NETN object class with the UniqueId attribute.");
        }
    }

    // The FOM class name a task was actually sent as, for the response
    // body, so it can be matched against an RTI trace or the simulator's
    // own log without first working out which dialect was in play.
    private String taskLabel(String v2Name, String v4Name) {
        return "v4".equals(tasks.dialectId()) ? v4Name : v2Name;
    }

    // Builds the task Annotation, optionally carrying an orbit radius.
    //
    // NETN-ETR has no orbit-radius field, so a receiving federate may read
    // a range=<metres> (and alt=<metres>) key/value pair out of the
    // Annotation text as a convention. Emitted only when a caller asks for
    // it, and appended to whatever note they supplied.
    //
    // Formatted as a plain decimal with no exponent, since the matching
    // regular expression on the receiving side does not accept one.
    private static String composeAnnotation(String annotation, Double orbitRadiusMeters) {
        String text = annotation == null || annotation.isBlank()
                ? "CSE bridge move order" : annotation.trim();
        if (orbitRadiusMeters == null || orbitRadiusMeters <= 0) {
            return text;
        }
        return text + " range=" + new java.math.BigDecimal(orbitRadiusMeters)
                .setScale(1, java.math.RoundingMode.HALF_UP).toPlainString();
    }

    private static double altitudeOf(Double requested, Entity entity) {
        if (requested != null) return requested;
        if (entity != null && entity.altitudeMeters != null) return entity.altitudeMeters;
        return 0.0;
    }

    // Maps failures onto sensible HTTP statuses: 404 unknown entity, 400
    // bad request, 409 not taskable, 503 RTI problems.
    //
    // 409 covers three related cases, all meaning "this federation cannot
    // do that": the interaction class is absent from the loaded FOM, no
    // NETN tasking dialect was detected at all, or the live dialect cannot
    // express the request.
    private ResponseEntity<?> failure(String action, Exception e) {
        if (e instanceof EntityNotFoundException) {
            logger.info("Could not {}: {}", action, e.getMessage());
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", e.getMessage()));
        }
        if (e instanceof IllegalArgumentException) {
            logger.info("Could not {}: {}", action, e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Map.of("error", e.getMessage()));
        }
        if (e instanceof IllegalStateException) {
            logger.warn("Could not {}: {}", action, e.getMessage());
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(Map.of("error", e.getMessage()));
        }
        logger.error("Failed to {}", action, e);
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("error", "RTI error: " + e.getMessage()));
    }

    // -- DTOs ------------------------------------------------------------------------
    // taskDialect: "v2", "v4" or "none" - which NETN tasking dialect this
    // federation's FOM defines. "none" means monitoring works but every
    // tasking endpoint returns 409.
    // federateName: the name this bridge actually joined under, not always
    // the configured one.
    // crcCandidate: the CRC candidate that answered.
    // federationCreatedByUs: true means every other federate is elsewhere
    // and nothing will ever be discovered here.
    // federateCount: federates known from the RTI's MOM, including this
    // bridge. 1 means alone; 0 means the RTI has not reported yet.
    public record StatusResponse(
            boolean connected,
            String federationName,
            double simTime,
            int entityCount,
            String taskDialect,
            String taskDialectName,
            String federateName,
            String crcCandidate,
            boolean federationCreatedByUs,
            int federateCount,
            String buildVersion,
            String buildSha,
            String builtAt
    ) {}

    private static class EntityNotFoundException extends Exception {
        EntityNotFoundException(String id) {
            super("Entity not found: " + id);
        }
    }
}