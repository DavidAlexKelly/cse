[main/java/com/decho/cse/bridge/EtrV2Dialect.java]
package com.decho.cse.bridge;

import com.decho.cse.bridge.BridgeFederate.Fom;
import hla.rti1516e.InteractionClassHandle;
import hla.rti1516e.ParameterHandleValueMap;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

// NETN v2-era tasking: ETR_Root.ETR_Task.* and siblings.
//
// ETR_Task is abstract and cannot be published or sent - only its concrete
// subclasses can, and the subclass identifies the task; there is no
// separate task-type parameter. Every task carries the parameters inherited
// from ETR_Task (TaskId, Taskee, Tasker, StartWhen, Why, TaskMode) plus a
// parameter set specific to that subclass. Taskee is a NETN UniqueId, a
// 16-byte UUID, not an HLA object-instance handle and not a marking string.
//
// ETR_SimCon (umpire actions such as MagicMove and MagicResource) and
// ETR_TaskManagement (CancelAllTasks, TaskStatusReport) are sibling
// branches with their own base parameters - SimCon has no
// StartWhen/TaskMode, and TaskManagement names its identifier
// TaskManagementId rather than TaskId.
//
// This is the dialect the bridge's own reference FOM defines, so it stays
// supported for any federation created against that FOM.
class EtrV2Dialect extends BaseDialect {

    EtrV2Dialect(BridgeFederate federate, Identity identity) {
        super(federate, identity);
    }

    @Override public String id() { return "v2"; }
    @Override public String name() { return "NETN v2-era (ETR_Root.ETR_Task)"; }
    @Override public String detectionClass() { return Fom.MOVE_TO_LOCATION; }

    @Override
    public String classFor(Op op) {
        return switch (op) {
            case MOVE -> Fom.MOVE_TO_LOCATION;
            // Patrol picks its class per request: a duration means the
            // PatrolRepeating subclass. Reports the base class here.
            case PATROL -> Fom.PATROL;
            case MAGIC_MOVE -> Fom.MAGIC_MOVE;
            case FIRE_AT_LOCATION -> Fom.FIRE_AT_LOCATION;
            case FIRE_AT_ENTITY -> Fom.FIRE_AT_ENTITY;
            case ROE -> Fom.SET_RULES_OF_ENGAGEMENT;
            case CANCEL_TASKS -> Fom.CANCEL_ALL_TASKS;
            case INJECT_SUPPLIES -> Fom.MAGIC_RESOURCE;
            case CREATE_OBSTACLE -> Fom.CREATE_OBSTACLE;
            case DISRUPT_COMMS -> Fom.DISRUPT_COMMUNICATION;
            case AGGREGATE -> Fom.MRM_AGGREGATE;
            case DISAGGREGATE -> Fom.MRM_DISAGGREGATE;
            case CHANGE_HEADING -> Fom.TURN_TO_HEADING;
            case CHANGE_SPEED -> Fom.SET_ORDERED_SPEED;
            case CHANGE_ALTITUDE -> Fom.SET_ORDERED_ALTITUDE;
            case STOP -> Fom.STOP_AT_SIDE_OF_ROAD;
        };
    }

    // -- Simple scalar tasks ------------------------------------------------------
    // v2 names these differently from v4, and for heading uses different units.

    @Override
    public UUID changeHeading(String entityUuid, double headingDegrees) throws Exception {
        InteractionClassHandle handle = interaction(Fom.TURN_TO_HEADING);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, entityUuid, "CSE bridge heading change", true);
        // Heading here is AngleRadianFloat32 - v2 wants radians where v4
        // wants degrees, and the REST API speaks degrees throughout.
        put(params, handle, "Heading",
                enc().float32(Math.toRadians(TaskEnums.normaliseDegrees(headingDegrees))));
        send(handle, params);
        logger.info("TurnToHeading task {} -> {} ({} deg true, sent as radians)",
                taskId, entityUuid, headingDegrees);
        return taskId;
    }

    @Override
    public UUID changeSpeed(String entityUuid, double speedMetersPerSecond) throws Exception {
        InteractionClassHandle handle = interaction(Fom.SET_ORDERED_SPEED);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, entityUuid, "CSE bridge speed change", true);
        put(params, handle, "Speed", enc().float32(speedMetersPerSecond));
        send(handle, params);
        logger.info("SetOrderedSpeed task {} -> {} ({} m/s)", taskId, entityUuid, speedMetersPerSecond);
        return taskId;
    }

    @Override
    public UUID changeAltitude(String entityUuid, double altitudeMeters) throws Exception {
        InteractionClassHandle handle = interaction(Fom.SET_ORDERED_ALTITUDE);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, entityUuid, "CSE bridge altitude change", true);
        put(params, handle, "Altitude", enc().float64(altitudeMeters));
        // AltitudeType is deliberately omitted: guessing its reference
        // datum without a confirmed enumeration would be worse than letting
        // the receiver's default apply.
        send(handle, params);
        logger.info("SetOrderedAltitude task {} -> {} ({} m, AltitudeType omitted)",
                taskId, entityUuid, altitudeMeters);
        return taskId;
    }

    @Override
    public UUID stopAtSideOfRoad(String entityUuid) throws Exception {
        InteractionClassHandle handle = interaction(Fom.STOP_AT_SIDE_OF_ROAD);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, entityUuid, "CSE bridge stop order", false);
        send(handle, params);
        logger.info("StopAtSideOfRoad task {} -> {}", taskId, entityUuid);
        return taskId;
    }

    @Override
    public List<String> published() {
        return List.of(
                Fom.MOVE_TO_LOCATION,
                Fom.PATROL,
                Fom.PATROL_REPEATING,
                Fom.FIRE_AT_LOCATION,
                Fom.FIRE_AT_ENTITY,
                Fom.SET_RULES_OF_ENGAGEMENT,
                Fom.CREATE_OBSTACLE,
                Fom.DISRUPT_COMMUNICATION,
                Fom.MAGIC_MOVE,
                Fom.MAGIC_RESOURCE,
                Fom.CANCEL_ALL_TASKS,
                Fom.TURN_TO_HEADING,
                Fom.SET_ORDERED_SPEED,
                Fom.SET_ORDERED_ALTITUDE,
                Fom.STOP_AT_SIDE_OF_ROAD,
                Fom.MRM_AGGREGATE,
                Fom.MRM_DISAGGREGATE);
    }

    @Override
    public List<String> subscribed() {
        return List.of(
                Fom.TASK_STATUS_REPORT,
                Fom.CAPABILITIES_SUPPORTED,
                Fom.POSITION_STATUS_REPORT,
                Fom.DAMAGE_STATUS_REPORT,
                Fom.RESOURCE_STATUS_REPORT,
                Fom.UNDER_ATTACK_REPORT,
                Fom.SPOT_REPORT,
                Fom.IN_WEAPON_RANGE_REPORT,
                Fom.MRM_RESPONSE);
    }

    @Override
    public List<String> optional() {
        // Present in the FOM and usable, but no REST endpoint sends them
        // yet. Resolved so the startup log records whether this federation
        // offers them at all.
        return List.of(
                Fom.MOVE_TO_ENTITY,
                Fom.CLEAR_OBSTACLE,
                Fom.QUERY_CAPABILITIES,
                Fom.CANCEL_SPECIFIED_TASKS);
    }

    // -- Base parameter builders ----------------------------------------------------

    // Parameters inherited by every ETR_Task subclass.
    // taskeeUuid: NETN UniqueId of the entity to task.
    // why: free text recorded with the task, optional.
    private ParameterHandleValueMap taskBase(InteractionClassHandle handle,
                                              UUID taskId,
                                              String taskeeUuid,
                                              String why,
                                              boolean concurrent) throws Exception {
        ParameterHandleValueMap params = newParams(8);
        put(params, handle, "TaskId", enc().uuid(taskId));
        put(params, handle, "Taskee", enc().uuid(taskeeUuid));
        put(params, handle, "Tasker", enc().unicodeString(identity.taskerCallsign()));
        // Datetime18 all-zero means start immediately.
        put(params, handle, "StartWhen", enc().datetime18(null));
        put(params, handle, "TaskMode", enc().octet(
                concurrent ? TaskEnums.TASK_MODE_CONCURRENT : TaskEnums.TASK_MODE_NON_CONCURRENT));
        if (why != null && !why.isBlank()) {
            putOptional(params, handle, "Why", enc().unicodeString(why));
        }
        return params;
    }

    // Parameters inherited by every ETR_SimCon subclass.
    private ParameterHandleValueMap simConBase(InteractionClassHandle handle,
                                                UUID taskId,
                                                String taskeeUuid) throws Exception {
        ParameterHandleValueMap params = newParams(4);
        put(params, handle, "TaskId", enc().uuid(taskId));
        put(params, handle, "Taskee", enc().uuid(taskeeUuid));
        put(params, handle, "Tasker", enc().unicodeString(identity.taskerCallsign()));
        return params;
    }

    // Parameters inherited by every ETR_TaskManagement subclass.
    private ParameterHandleValueMap taskManagementBase(InteractionClassHandle handle,
                                                        UUID managementId,
                                                        String taskeeUuid) throws Exception {
        ParameterHandleValueMap params = newParams(4);
        put(params, handle, "TaskManagementId", enc().uuid(managementId));
        put(params, handle, "Taskee", enc().uuid(taskeeUuid));
        put(params, handle, "Tasker", enc().unicodeString(identity.taskerCallsign()));
        return params;
    }

    // -- Movement -----------------------------------------------------------------
    @Override
    public UUID moveToLocation(String taskeeUuid,
                                double latitude,
                                double longitude,
                                double altitudeMeters,
                                String moveType,
                                Double speedMetersPerSecond,
                                String annotation) throws Exception {
        InteractionClassHandle handle = interaction(Fom.MOVE_TO_LOCATION);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params = taskBase(handle, taskId, taskeeUuid,
                annotation == null || annotation.isBlank() ? "CSE bridge move order" : annotation,
                false);
        put(params, handle, "Location", enc().worldLocation(latitude, longitude, altitudeMeters));
        put(params, handle, "MoveType", enc().int32(TaskEnums.moveType(moveType)));
        if (speedMetersPerSecond != null) {
            // v2 MoveToLocation has no Speed parameter; SetOrderedSpeed is
            // a separate task, so the value is dropped with a log line
            // rather than silently.
            logger.info("Ignoring speedMetersPerSecond={} - the v2 MoveToLocation task has no "
                    + "Speed parameter. Send SetOrderedSpeed separately.", speedMetersPerSecond);
        }
        send(handle, params);
        logger.info("MoveToLocation task {} -> {} ({}, {})", taskId, taskeeUuid, latitude, longitude);
        return taskId;
    }

    @Override
    public Map<String, String> describeMoveTask(double latitude,
                                                  double longitude,
                                                  double altitudeMeters,
                                                  String moveType,
                                                  Double speedMetersPerSecond) throws Exception {
        // v2 has no TaskParameters struct: Location and MoveType are
        // parameters of the interaction itself, and there is no Speed field.
        double[] ecef = HlaEncoder.wgs84ToEcef(latitude, longitude, altitudeMeters);
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("interactionClass", Fom.MOVE_TO_LOCATION);
        fields.put("Location.datatype",
                "WorldLocationStruct = 3 x HLAfloat64BE {X, Y, Z}, geocentric ECEF metres");
        fields.put("Location.input",
                String.format("latitude %.6f, longitude %.6f, altitude %.1f m (WGS-84)",
                        latitude, longitude, altitudeMeters));
        fields.put("Location.encodedAs",
                String.format("X=%.3f Y=%.3f Z=%.3f (metres)", ecef[0], ecef[1], ecef[2]));
        fields.put("Location.hex",
                HlaEncoder.hex(enc().worldLocation(latitude, longitude, altitudeMeters)));
        fields.put("MoveType",
                "MoveTypeEnum32 = " + TaskEnums.moveType(moveType) + " from moveType='"
                        + moveType + "'");
        fields.put("Speed", "not present in the v2 MoveToLocation task"
                + (speedMetersPerSecond == null ? "" : " - the supplied "
                        + speedMetersPerSecond + " m/s would be ignored"));
        fields.put("inheritedParameters",
                "TaskId (UUID), Taskee (UUID), Tasker (Callsign string '"
                        + identity.taskerCallsign() + "'), StartWhen (Datetime18, all zeroes means "
                        + "immediately), TaskMode (octet), Why (HLAunicodeString)");
        return fields;
    }

    // ETR_Task.Patrol, or Patrol.PatrolRepeating when a duration is given.
    @Override
    public UUID patrol(String taskeeUuid,
                        List<double[]> waypointsLatLonAlt,
                        String patrolType,
                        String patrolMoveType,
                        Integer durationSeconds,
                        Integer intervalSeconds,
                        Double speedMetersPerSecond) throws Exception {
        boolean repeating = durationSeconds != null && durationSeconds > 0;
        InteractionClassHandle handle = interaction(repeating ? Fom.PATROL_REPEATING : Fom.PATROL);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, taskeeUuid, "CSE bridge patrol order", false);
        put(params, handle, "Path", enc().arrayOfWorldLocation(waypointsLatLonAlt));
        put(params, handle, "PatrolType", enc().int32(TaskEnums.patrolType(patrolType)));
        put(params, handle, "MoveType", enc().int32(TaskEnums.patrolMoveType(patrolMoveType)));
        if (repeating) {
            put(params, handle, "Duration", enc().int32(durationSeconds));
            put(params, handle, "IntervalTime",
                    enc().int32(intervalSeconds == null ? 0 : intervalSeconds));
        }
        if (speedMetersPerSecond != null) {
            logger.info("Ignoring speedMetersPerSecond={} - the v2 Patrol path is an array of "
                    + "locations with no per-waypoint speed.", speedMetersPerSecond);
        }
        send(handle, params);
        logger.info("{} task {} -> {} ({} waypoints)",
                repeating ? "PatrolRepeating" : "Patrol", taskId, taskeeUuid,
                waypointsLatLonAlt.size());
        return taskId;
    }

    // ETR_SimCon.MagicMove - a teleport, an umpire action rather than a
    // task, so it has no StartWhen/TaskMode.
    @Override
    public UUID magicMove(String taskeeUuid,
                           double latitude,
                           double longitude,
                           double altitudeMeters,
                           double headingDegrees) throws Exception {
        InteractionClassHandle handle = interaction(Fom.MAGIC_MOVE);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params = simConBase(handle, taskId, taskeeUuid);
        put(params, handle, "Location", enc().worldLocation(latitude, longitude, altitudeMeters));
        put(params, handle, "Heading",
                enc().float32(Math.toRadians(TaskEnums.normaliseDegrees(headingDegrees))));
        send(handle, params);
        logger.info("MagicMove {} -> {} ({}, {})", taskId, taskeeUuid, latitude, longitude);
        return taskId;
    }

    // -- Fires -----------------------------------------------------------------------
    @Override
    public UUID fireAtLocation(String taskeeUuid,
                                double latitude,
                                double longitude,
                                double altitudeMeters,
                                int durationSeconds) throws Exception {
        InteractionClassHandle handle = interaction(Fom.FIRE_AT_LOCATION);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, taskeeUuid, "CSE bridge fire mission", false);
        put(params, handle, "Location", enc().worldLocation(latitude, longitude, altitudeMeters));
        put(params, handle, "Duration", enc().int32(Math.max(0, durationSeconds)));
        send(handle, params);
        logger.info("FireAtLocation task {} -> {} ({}, {}) for {}s",
                taskId, taskeeUuid, latitude, longitude, durationSeconds);
        return taskId;
    }

    @Override
    public UUID fireAtEntity(String taskeeUuid, String targetUuid) throws Exception {
        InteractionClassHandle handle = interaction(Fom.FIRE_AT_ENTITY);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, taskeeUuid, "CSE bridge engagement order", false);
        put(params, handle, "Target", enc().uuid(targetUuid));
        send(handle, params);
        logger.info("FireAtEntity task {} -> {} at target {}", taskId, taskeeUuid, targetUuid);
        return taskId;
    }

    // -- Control -----------------------------------------------------------------------
    @Override
    public UUID setRulesOfEngagement(String taskeeUuid, String roe) throws Exception {
        InteractionClassHandle handle = interaction(Fom.SET_RULES_OF_ENGAGEMENT);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, taskeeUuid, "CSE bridge ROE change", true);
        put(params, handle, "RulesOfEngagement", enc().octet(TaskEnums.rulesOfEngagement(roe)));
        send(handle, params);
        logger.info("SetRulesOfEngagement task {} -> {} ({})", taskId, taskeeUuid, roe);
        return taskId;
    }

    @Override
    public UUID cancelAllTasks(String taskeeUuid) throws Exception {
        InteractionClassHandle handle = interaction(Fom.CANCEL_ALL_TASKS);
        UUID managementId = UUID.randomUUID();
        ParameterHandleValueMap params = taskManagementBase(handle, managementId, taskeeUuid);
        send(handle, params);
        logger.info("CancelAllTasks {} -> {}", managementId, taskeeUuid);
        return managementId;
    }

    // ETR_SimCon.MagicResource - umpire-style resupply.
    @Override
    public UUID injectSupplies(String taskeeUuid, String resourceType, String supplyType,
                                double quantity) throws Exception {
        InteractionClassHandle handle = interaction(Fom.MAGIC_RESOURCE);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params = simConBase(handle, taskId, taskeeUuid);
        put(params, handle, "Resource",
                enc().supply(TaskEnums.supplyType(resourceType, supplyType), quantity));
        send(handle, params);
        logger.info("MagicResource {} -> {} ({} x{})", taskId, taskeeUuid, resourceType, quantity);
        return taskId;
    }

    // -- Environment ---------------------------------------------------------------
    // ETR_Task.CreateObstacle. A task on an engineer entity - the FOM
    // requires a Taskee, so there is no way to create an obstacle without one.
    @Override
    public UUID createObstacle(String taskeeUuid,
                                String obstacleName,
                                String obstacleType,
                                double latitude,
                                double longitude,
                                double radiusMeters) throws Exception {
        InteractionClassHandle handle = interaction(Fom.CREATE_OBSTACLE);
        UUID taskId = UUID.randomUUID();
        UUID obstacleUuid = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, taskeeUuid, "CSE bridge obstacle: " + obstacleName, false);
        put(params, handle, "UniqueId", enc().uuid(obstacleUuid));
        put(params, handle, "ObstacleType",
                enc().entityType(TaskEnums.obstacleType(obstacleName, obstacleType)));
        put(params, handle, "Geometry", enc().areaCircle(latitude, longitude, radiusMeters));
        send(handle, params);
        logger.info("CreateObstacle task {} -> {} obstacle {} ({}, {}) r={}m",
                taskId, taskeeUuid, obstacleUuid, latitude, longitude, radiusMeters);
        return obstacleUuid;
    }

    // ETR_Task.DisruptCommunication. Also a task on an entity (the EW asset
    // doing the jamming), over a geodetic quadrangle rather than a radius.
    @Override
    public UUID disruptCommunication(String taskeeUuid,
                                      String network,
                                      double latitude,
                                      double longitude,
                                      double radiusKm,
                                      boolean enabled) throws Exception {
        InteractionClassHandle handle = interaction(Fom.DISRUPT_COMMUNICATION);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, taskeeUuid, "CSE bridge comms disruption", true);
        put(params, handle, "AffectedCommunicationNetwork",
                enc().unicodeString(network == null ? "" : network));
        double dLat = radiusKm / 111.32;
        double dLon = radiusKm / (111.32 * Math.max(0.01, Math.cos(Math.toRadians(latitude))));
        put(params, handle, "AffectedArea",
                enc().geodeticQuadrangle(latitude - dLat, longitude - dLon,
                        latitude + dLat, longitude + dLon));
        put(params, handle, "DisruptionEnabled", enc().hlaBoolean(enabled));
        send(handle, params);
        logger.info("DisruptCommunication task {} -> {} {} around ({}, {}) r={}km",
                taskId, taskeeUuid, enabled ? "enabled" : "disabled", latitude, longitude, radiusKm);
        return taskId;
    }

    // -- Multi-resolution modelling ---------------------------------------------------
    // Addressed to a federate (the one with modelling responsibility for
    // the aggregate), unlike ETR tasks which address an entity directly.
    @Override
    public UUID multiResolution(boolean aggregate,
                                 String aggregateUnitUuid,
                                 String federateName,
                                 boolean removeSubunits) throws Exception {
        String target = (federateName == null || federateName.isBlank())
                ? identity.defaultMrmFederate() : federateName;
        if (target == null || target.isBlank()) {
            throw new IllegalArgumentException(
                    "MRM aggregate/disaggregate requires the name of the federate responsible "
                            + "for the unit. Pass \"federate\" in the request body or set MRM_FEDERATE.");
        }

        InteractionClassHandle handle =
                interaction(aggregate ? Fom.MRM_AGGREGATE : Fom.MRM_DISAGGREGATE);
        UUID eventId = UUID.randomUUID();
        ParameterHandleValueMap params = newParams(4);
        put(params, handle, "EventId", enc().uuid(eventId));
        put(params, handle, "Federate", enc().unicodeString(target));
        put(params, handle, "AggregateUnit", enc().uuid(aggregateUnitUuid));
        if (aggregate) {
            put(params, handle, "RemoveSubunits", enc().hlaBoolean(removeSubunits));
        }
        send(handle, params);
        logger.info("MRM {} event {} unit {} federate {}",
                aggregate ? "Aggregate" : "Disaggregate", eventId, aggregateUnitUuid, target);
        return eventId;
    }
}