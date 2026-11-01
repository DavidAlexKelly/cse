package com.decho.cse.bridge;

import hla.rti1516e.InteractionClassHandle;
import hla.rti1516e.ParameterHandleValueMap;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * NETN v4 tasking — {@code SMC_EntityControl.*}, per NETN-ETR 3.0 / NETN-SMC 1.0.
 *
 * <h2>What changed from v2</h2>
 * <ul>
 *   <li>{@code ETR_Root}, {@code ETR_SimCon} and {@code ETR_TaskManagement} are
 *       gone. Every task is a subclass of {@code SMC_EntityControl.Task}, and
 *       MagicMove — an umpire action in v2 — is now an ordinary task.</li>
 *   <li>{@code Taskee} became {@code Entity}, inherited from
 *       {@code SMC_EntityControl}.</li>
 *   <li>{@code Tasker} changed from a Callsign <em>string</em> to a
 *       <em>UUID</em> referencing the commanding entity. Sending a string here
 *       decodes as garbage rather than failing, so it is omitted unless
 *       {@code TASKER_UUID} is configured.</li>
 *   <li>{@code StartWhen} (Datetime18) became {@code StartTime} (EpochTime) and
 *       {@code Why} became {@code Annotation}.</li>
 *   <li>Every task's own parameters collapse into a single
 *       {@code TaskParameters} fixed record whose type differs per task.</li>
 *   <li>Durations are {@code TimeMillisecondInt64} milliseconds, not int32
 *       seconds.</li>
 *   <li>Headings are {@code DirectionDegreesFloat32} degrees, not radians.</li>
 *   <li>{@code CancelAllTasks} and {@code CancelSpecifiedTasks} merged into
 *       {@code CancelTasks}, where an empty {@code Tasks} array means all.</li>
 *   <li>Obstacles, comms disruption and resupply moved out of NETN-ETR into
 *       NETN-SE, NETN-COM and NETN-LOG respectively. Those modules are optional,
 *       so those three endpoints work only if the federation loaded them —
 *       {@link #optional()} exists so the startup log says which.</li>
 * </ul>
 *
 * <p>{@code LocationStruct} is <em>geocentric ECEF metres</em>, not
 * latitude/longitude — see {@link HlaEncoder}. That is the one place where the
 * name invites a wrong conversion.
 */
class SmcV4Dialect extends BaseDialect {

    // ── FOM class names ───────────────────────────────────────────────────────
    private static final String SMC  = "HLAinteractionRoot.SMC_EntityControl.";
    private static final String TASK = SMC + "Task.";

    // NETN-ETR 3.0 tasks.
    static final String MOVE_TO_LOCATION   = TASK + "MoveToLocation";
    static final String MOVE_BY_ROUTE      = TASK + "MoveByRoute";
    static final String MOVE_IN_DIRECTION  = TASK + "MoveInDirection";
    static final String FOLLOW_ENTITY      = TASK + "FollowEntity";
    static final String PATROL             = TASK + "Patrol";
    static final String MAGIC_MOVE         = TASK + "MagicMove";
    static final String DIRECT_FIRE        = TASK + "DirectFire";
    static final String INDIRECT_FIRE      = TASK + "IndirectFire";
    static final String CHANGE_ROE         = TASK + "ChangeRulesOfEngagement";
    static final String CHANGE_HEADING     = TASK + "ChangeHeading";
    static final String CHANGE_SPEED       = TASK + "ChangeSpeed";
    static final String CHANGE_ALTITUDE    = TASK + "ChangeAltitude";
    static final String STOP_AT_SIDE_OF_ROAD = TASK + "StopAtSideOfRoad";
    static final String OBSERVE            = TASK + "Observe";

    // Task management (siblings of Task, not subclasses of it).
    static final String CANCEL_TASKS        = SMC + "CancelTasks";
    static final String REQUEST_TASK_STATUS = SMC + "RequestTaskStatus";

    // Tasks that moved to other modules.
    static final String CREATE_OBSTACLE       = TASK + "CreateObstacle";        // NETN-SE
    static final String CLEAR_ENGINEERING     = TASK + "ClearEngineering";      // NETN-SE
    static final String DISRUPT_COMMUNICATION = TASK + "DisruptCommunication";  // NETN-COM
    static final String SET_SUPPLIES_STATUS   = SMC + "SetSuppliesStatus";      // NETN-LOG

    // NETN-MRM 3.0: entity control actions, no longer addressed to a federate.
    static final String MRM_AGGREGATE    = SMC + "Aggregate";
    static final String MRM_DISAGGREGATE = SMC + "Disaggregate";
    static final String MRM_DIVIDE       = SMC + "Divide";
    static final String MRM_MERGE        = SMC + "Merge";

    // Reports and acknowledgements.
    private static final String REPORT = "HLAinteractionRoot.ETR_Report.";
    static final String TASK_STATUS              = "HLAinteractionRoot.ETR_TaskStatus";
    static final String SMC_RESPONSE             = "HLAinteractionRoot.SMC_Response";
    static final String POSITION_STATUS_REPORT   = REPORT + "PositionStatusReport";
    static final String DAMAGE_STATUS_REPORT     = REPORT + "DamageStatusReport";
    static final String RESOURCE_STATUS_REPORT   = REPORT + "ResourceStatusReport";
    static final String UNDER_ATTACK_REPORT      = REPORT + "UnderAttackStatusReport";
    static final String IN_WEAPON_RANGE_REPORT   = REPORT + "InWeaponRangeReport";
    static final String OBSERVATION_REPORT       = REPORT + "ObservationReport";
    static final String ENTITY_SENSOR_UPDATE     = "HLAinteractionRoot.ETR_SensorEvent.EntitySensorUpdate";

    /** Points used to approximate a circular area as a LocationStructArray. */
    private static final int AREA_POLYGON_POINTS = 8;

    SmcV4Dialect(BridgeFederate federate, Identity identity) {
        super(federate, identity);
    }

    @Override public String id()   { return "v4"; }
    @Override public String name() { return "NETN v4 (SMC_EntityControl.Task)"; }
    @Override public String detectionClass() { return MOVE_TO_LOCATION; }

    /**
     * Class names are qualified with the type even though they are fields of it:
     * several {@link Op} constants share a name with the field they map to
     * (PATROL, MAGIC_MOVE, CANCEL_TASKS, CREATE_OBSTACLE), and while the case
     * label and the result expression resolve in different namespaces, reading
     * {@code case PATROL -> PATROL} invites the reader to assume a mistake.
     */
    @Override
    public String classFor(Op op) {
        return switch (op) {
            case MOVE              -> SmcV4Dialect.MOVE_TO_LOCATION;
            case PATROL            -> SmcV4Dialect.PATROL;
            case MAGIC_MOVE        -> SmcV4Dialect.MAGIC_MOVE;
            case FIRE_AT_LOCATION  -> SmcV4Dialect.INDIRECT_FIRE;
            case FIRE_AT_ENTITY    -> SmcV4Dialect.DIRECT_FIRE;
            case ROE               -> SmcV4Dialect.CHANGE_ROE;
            case CANCEL_TASKS      -> SmcV4Dialect.CANCEL_TASKS;
            case INJECT_SUPPLIES   -> SmcV4Dialect.SET_SUPPLIES_STATUS;
            case CREATE_OBSTACLE   -> SmcV4Dialect.CREATE_OBSTACLE;
            case DISRUPT_COMMS     -> SmcV4Dialect.DISRUPT_COMMUNICATION;
            case AGGREGATE         -> SmcV4Dialect.MRM_AGGREGATE;
            case DISAGGREGATE      -> SmcV4Dialect.MRM_DISAGGREGATE;
            case CHANGE_HEADING    -> SmcV4Dialect.CHANGE_HEADING;
            case CHANGE_SPEED      -> SmcV4Dialect.CHANGE_SPEED;
            case CHANGE_ALTITUDE   -> SmcV4Dialect.CHANGE_ALTITUDE;
            case STOP              -> SmcV4Dialect.STOP_AT_SIDE_OF_ROAD;
        };
    }

    // ── Simple scalar tasks ───────────────────────────────────────────────────
    // Each carries a one-field TaskParameters struct, except StopAtSideOfRoad
    // which the FOM gives no parameters at all (TaskDefinitionVariantRecord maps
    // it to EmptyTaskStruct).

    @Override
    public UUID changeHeading(String entityUuid, double headingDegrees) throws Exception {
        InteractionClassHandle handle = interaction(CHANGE_HEADING);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, entityUuid, "CSE bridge heading change", true);
        HlaEncoder e = enc();
        // ChangeHeadingTaskStruct { Heading : DirectionDegreesFloat32 } — degrees.
        put(params, handle, "TaskParameters", e.fixedRecord(e.directionDegreesEl(headingDegrees)));
        send(handle, params);
        logger.info("ChangeHeading task {} -> {} ({} deg true)", taskId, entityUuid, headingDegrees);
        return taskId;
    }

    @Override
    public UUID changeSpeed(String entityUuid, double speedMetersPerSecond) throws Exception {
        InteractionClassHandle handle = interaction(CHANGE_SPEED);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, entityUuid, "CSE bridge speed change", true);
        HlaEncoder e = enc();
        // ChangeSpeedTaskStruct { Speed : VelocityMeterPerSecondFloat32 }.
        put(params, handle, "TaskParameters", e.fixedRecord(e.float32El(speedMetersPerSecond)));
        send(handle, params);
        logger.info("ChangeSpeed task {} -> {} ({} m/s)", taskId, entityUuid, speedMetersPerSecond);
        return taskId;
    }

    @Override
    public UUID changeAltitude(String entityUuid, double altitudeMeters) throws Exception {
        InteractionClassHandle handle = interaction(CHANGE_ALTITUDE);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, entityUuid, "CSE bridge altitude change", true);
        HlaEncoder e = enc();
        // ChangeAltitudeTaskStruct { Altitude : AltitudeMeterFloat64 }, MSL.
        put(params, handle, "TaskParameters", e.fixedRecord(e.float64El(altitudeMeters)));
        send(handle, params);
        logger.info("ChangeAltitude task {} -> {} ({} m MSL)", taskId, entityUuid, altitudeMeters);
        return taskId;
    }

    @Override
    public UUID stopAtSideOfRoad(String entityUuid) throws Exception {
        InteractionClassHandle handle = interaction(STOP_AT_SIDE_OF_ROAD);
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
                MOVE_TO_LOCATION,
                PATROL,
                MAGIC_MOVE,
                DIRECT_FIRE,
                INDIRECT_FIRE,
                CHANGE_ROE,
                CANCEL_TASKS,
                CHANGE_HEADING,
                CHANGE_SPEED,
                CHANGE_ALTITUDE,
                STOP_AT_SIDE_OF_ROAD,
                // Optional modules: publishing is attempted and skipped with a
                // warning if the class is absent, exactly as for v2.
                CREATE_OBSTACLE,
                DISRUPT_COMMUNICATION,
                SET_SUPPLIES_STATUS,
                MRM_AGGREGATE,
                MRM_DISAGGREGATE);
    }

    @Override
    public List<String> subscribed() {
        return List.of(
                TASK_STATUS,
                SMC_RESPONSE,
                POSITION_STATUS_REPORT,
                DAMAGE_STATUS_REPORT,
                RESOURCE_STATUS_REPORT,
                UNDER_ATTACK_REPORT,
                IN_WEAPON_RANGE_REPORT,
                OBSERVATION_REPORT,
                ENTITY_SENSOR_UPDATE);
    }

    @Override
    public List<String> optional() {
        return List.of(
                MOVE_BY_ROUTE,
                MOVE_IN_DIRECTION,
                FOLLOW_ENTITY,
                OBSERVE,
                REQUEST_TASK_STATUS,
                CLEAR_ENGINEERING,
                MRM_DIVIDE,
                MRM_MERGE);
    }

    // ── Base parameters ───────────────────────────────────────────────────────

    /**
     * Parameters common to every {@code Task} subclass.
     *
     * <p>Only {@code Entity} and {@code TaskId} are Required. {@code UniqueId}
     * and {@code SendTime} are formally Optional but NETN-ETR states they are
     * "required for all ETR related interactions" — {@code UniqueId} in
     * particular is what a {@code SMC_Response} correlates against, so omitting
     * it costs the acknowledgement.
     *
     * <p>{@code StartTime} is deliberately omitted: its documented default is
     * the current {@code SendTime}, i.e. "start now", which is what every REST
     * endpoint means. Sending an explicit value would only add a rounding error.
     */
    private ParameterHandleValueMap taskBase(InteractionClassHandle handle,
                                             UUID taskId,
                                             String entityUuid,
                                             String annotation,
                                             boolean concurrent) throws Exception {
        ParameterHandleValueMap params = newParams(8);
        put(params, handle, "Entity", enc().uuid(entityUuid));
        put(params, handle, "TaskId", enc().uuid(taskId));
        // UniqueId is deliberately the same value as TaskId. SMC_Response.Action
        // references the *interaction's* UniqueId, not the TaskId, so a distinct
        // random value here would make every response impossible to attribute to
        // the task that caused it — which is the one thing we need it for. The
        // value is still unique: a fresh TaskId is generated per request.
        putOptional(params, handle, "UniqueId", enc().uuid(taskId));
        putOptional(params, handle, "SendTime", enc().epochTime(null));
        putOptional(params, handle, "TaskMode", enc().octet(
                concurrent ? TaskEnums.TASK_MODE_CONCURRENT : TaskEnums.TASK_MODE_NON_CONCURRENT));
        if (annotation != null && !annotation.isBlank()) {
            putOptional(params, handle, "Annotation", enc().unicodeString(annotation));
        }
        putTasker(params, handle);
        return params;
    }

    /**
     * Parameters common to the entity-control actions that are not tasks —
     * {@code CancelTasks}, {@code SetSuppliesStatus}, {@code Aggregate}. These
     * have no TaskId, TaskMode or Annotation.
     */
    private ParameterHandleValueMap controlBase(InteractionClassHandle handle,
                                                String entityUuid,
                                                UUID actionId) throws Exception {
        ParameterHandleValueMap params = newParams(4);
        put(params, handle, "Entity", enc().uuid(entityUuid));
        putOptional(params, handle, "UniqueId", enc().uuid(actionId));
        putOptional(params, handle, "SendTime", enc().epochTime(null));
        return params;
    }

    /**
     * {@code Tasker} is a UUID in v4. Omitted unless a real entity UUID is
     * configured: the FOM's default for a missing Tasker is "commander
     * undefined", which is true, whereas a fabricated UUID would claim a
     * commanding entity that does not exist in the federation.
     */
    private void putTasker(ParameterHandleValueMap params, InteractionClassHandle handle) {
        String taskerUuid = identity.taskerUuid();
        if (taskerUuid == null || taskerUuid.isBlank()) {
            return;
        }
        try {
            putOptional(params, handle, "Tasker", enc().uuid(taskerUuid));
        } catch (Exception e) {
            logger.warn("TASKER_UUID '{}' is not a UUID, omitting Tasker: {}",
                    taskerUuid, e.getMessage());
        }
    }

    // ── Movement ──────────────────────────────────────────────────────────────

    /** {@code Task.MoveToLocation}, TaskParameters = MoveToLocationTaskStruct. */
    @Override
    public UUID moveToLocation(String entityUuid,
                               double latitude,
                               double longitude,
                               double altitudeMeters,
                               String moveType,
                               Double speedMetersPerSecond,
                               String annotation) throws Exception {
        InteractionClassHandle handle = interaction(MOVE_TO_LOCATION);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params = taskBase(handle, taskId, entityUuid,
                annotation == null || annotation.isBlank() ? "CSE bridge move order" : annotation,
                false);
        put(params, handle, "TaskParameters", moveToLocationTaskParameters(
                latitude, longitude, altitudeMeters, moveType, speedMetersPerSecond));
        send(handle, params);
        logger.info("MoveToLocation task {} -> {} ({}, {}) alt={}m speed={}m/s moveType={}",
                taskId, entityUuid, latitude, longitude, altitudeMeters,
                speedMetersPerSecond == null ? 0.0 : speedMetersPerSecond,
                TaskEnums.moveType(moveType));
        return taskId;
    }

    /**
     * {@code MoveToLocationTaskStruct} = {Location, Path, MoveType, Speed}.
     *
     * <p>Extracted so {@link #describeMoveTask} previews the bytes this method
     * actually sends, rather than a second implementation that might drift from
     * it.
     *
     * <p>{@code Path} is sent empty: the destination is given, and NETN leaves
     * route-finding to the simulator when no path is supplied. {@code Speed} 0
     * means "the entity's own default" — note that a receiver taking 0 literally
     * will hold the entity stationary, which is worth ruling out first when a
     * move is accepted but nothing happens.
     */
    private byte[] moveToLocationTaskParameters(double latitude,
                                                double longitude,
                                                double altitudeMeters,
                                                String moveType,
                                                Double speedMetersPerSecond) throws Exception {
        HlaEncoder e = enc();
        return e.fixedRecord(
                e.locationEl(latitude, longitude, altitudeMeters),
                e.locationArrayEl(List.of()),
                e.int32El(TaskEnums.moveType(moveType)),
                e.float32El(speedMetersPerSecond == null ? 0.0 : speedMetersPerSecond));
    }

    @Override
    public Map<String, String> describeMoveTask(double latitude,
                                                double longitude,
                                                double altitudeMeters,
                                                String moveType,
                                                Double speedMetersPerSecond) throws Exception {
        HlaEncoder e = enc();
        double[] ecef = HlaEncoder.wgs84ToEcef(latitude, longitude, altitudeMeters);
        double speed = speedMetersPerSecond == null ? 0.0 : speedMetersPerSecond;
        byte[] taskParameters = moveToLocationTaskParameters(
                latitude, longitude, altitudeMeters, moveType, speedMetersPerSecond);

        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("interactionClass", MOVE_TO_LOCATION);
        fields.put("TaskParameters.datatype", "MoveToLocationTaskStruct (HLAfixedRecord)");
        fields.put("TaskParameters.Location.datatype",
                "LocationStruct = 3 x MeterFloat64 {X, Y, Z}, GEOCENTRIC ECEF METRES "
                + "(IEEE 1278.1-2012 section 1.6.3 world coordinate system) — NOT degrees");
        fields.put("TaskParameters.Location.input",
                String.format("latitude %.6f, longitude %.6f, altitude %.1f m (WGS-84)",
                        latitude, longitude, altitudeMeters));
        fields.put("TaskParameters.Location.encodedAs",
                String.format("X=%.3f Y=%.3f Z=%.3f (metres)", ecef[0], ecef[1], ecef[2]));
        fields.put("TaskParameters.Location.hex",
                HlaEncoder.hex(e.fixedRecord(e.locationEl(latitude, longitude, altitudeMeters))));
        fields.put("TaskParameters.Path",
                "LocationStructArray, sent EMPTY (element count 0) — route-finding left to the "
                + "receiving simulator");
        fields.put("TaskParameters.MoveType",
                "MoveTypeEnum32 = " + TaskEnums.moveType(moveType)
                + " (0 CrossCountry, 1 OnlyRoads, 2 RoadsAndCrossCountry) from moveType='"
                + moveType + "'");
        fields.put("TaskParameters.Speed",
                String.format("VelocityMeterPerSecondFloat32 = %.3f m/s%s", speed,
                        speed == 0.0 ? " — 0 means 'entity default'; a receiver reading it "
                                + "literally would keep the entity stationary" : ""));
        fields.put("TaskParameters.hex", HlaEncoder.hex(taskParameters));
        fields.put("TaskParameters.lengthBytes", String.valueOf(taskParameters.length));
        fields.put("inheritedParameters",
                "Entity (UUID, 16 raw bytes), TaskId (UUID), UniqueId (= TaskId, what "
                + "SMC_Response.Action references), SendTime (EpochTime int32 seconds), "
                + "TaskMode (TaskModeEnum8 octet), Annotation (HLAunicodeString)"
                + (identity.taskerUuid() == null || identity.taskerUuid().isBlank()
                        ? ", Tasker omitted (TASKER_UUID unset)" : ", Tasker (UUID)"));
        return fields;
    }

    /**
     * {@code Task.Patrol}, TaskParameters = PatrolTaskStruct.
     *
     * <p>v4 merged {@code PatrolRepeating} into {@code Patrol}: the repeat is
     * expressed by the {@code Duration} and {@code IntervalTime} fields rather
     * than by a different class.
     */
    @Override
    public UUID patrol(String entityUuid,
                       List<double[]> waypointsLatLonAlt,
                       String patrolType,
                       String patrolMoveType,
                       Integer durationSeconds,
                       Integer intervalSeconds,
                       Double speedMetersPerSecond) throws Exception {
        InteractionClassHandle handle = interaction(PATROL);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, entityUuid, "CSE bridge patrol order", false);
        HlaEncoder e = enc();
        // {Path (ArrayOfWaypoints), PatrolType, MoveType, Duration, IntervalTime}
        put(params, handle, "TaskParameters", e.fixedRecord(
                e.waypointArrayEl(waypointsLatLonAlt,
                        speedMetersPerSecond == null ? 0.0 : speedMetersPerSecond, 0.0),
                e.int32El(TaskEnums.patrolType(patrolType)),
                e.int32El(TaskEnums.patrolMoveType(patrolMoveType)),
                e.millisEl(TaskEnums.secondsToMillis(durationSeconds)),
                e.millisEl(TaskEnums.secondsToMillis(intervalSeconds))));
        send(handle, params);
        logger.info("Patrol task {} -> {} ({} waypoints, duration {}s, interval {}s)",
                taskId, entityUuid, waypointsLatLonAlt.size(), durationSeconds, intervalSeconds);
        return taskId;
    }

    /** {@code Task.MagicMove}, TaskParameters = MagicMoveTaskStruct{Location, Heading}. */
    @Override
    public UUID magicMove(String entityUuid,
                          double latitude,
                          double longitude,
                          double altitudeMeters,
                          double headingDegrees) throws Exception {
        InteractionClassHandle handle = interaction(MAGIC_MOVE);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, entityUuid, "CSE bridge magic move", false);
        HlaEncoder e = enc();
        // Heading is DirectionDegreesFloat32 — degrees, unlike v2's radians.
        put(params, handle, "TaskParameters", e.fixedRecord(
                e.locationEl(latitude, longitude, altitudeMeters),
                e.directionDegreesEl(headingDegrees)));
        send(handle, params);
        logger.info("MagicMove task {} -> {} ({}, {}) heading {}deg",
                taskId, entityUuid, latitude, longitude, TaskEnums.normaliseDegrees(headingDegrees));
        return taskId;
    }

    // ── Fires ─────────────────────────────────────────────────────────────────

    /**
     * {@code Task.IndirectFire} (v2 FireAtLocation), TaskParameters =
     * IndirectFireTaskStruct{Area, Duration, Round}.
     *
     * <p>{@code Area} is a {@code LocationStructArray}. The REST call gives a
     * single point, which is sent as a one-element area — the target point
     * itself. Pass a polygon here if the simulator rejects a degenerate area.
     */
    @Override
    public UUID fireAtLocation(String entityUuid,
                               double latitude,
                               double longitude,
                               double altitudeMeters,
                               int durationSeconds) throws Exception {
        InteractionClassHandle handle = interaction(INDIRECT_FIRE);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, entityUuid, "CSE bridge fire mission", false);
        HlaEncoder e = enc();
        put(params, handle, "TaskParameters", e.fixedRecord(
                e.locationArrayEl(List.of(new double[]{latitude, longitude, altitudeMeters})),
                e.millisEl(TaskEnums.secondsToMillis(Math.max(0, durationSeconds))),
                unspecifiedRound(e)));
        send(handle, params);
        logger.info("IndirectFire task {} -> {} ({}, {}) for {}s",
                taskId, entityUuid, latitude, longitude, durationSeconds);
        return taskId;
    }

    /** {@code Task.DirectFire} (v2 FireAtEntity), TaskParameters = DirectFireTaskStruct. */
    @Override
    public UUID fireAtEntity(String entityUuid, String targetUuid) throws Exception {
        InteractionClassHandle handle = interaction(DIRECT_FIRE);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, entityUuid, "CSE bridge engagement order", false);
        HlaEncoder e = enc();
        // {Target, Duration, Round}. Duration 0 = "as required", per the FOM.
        put(params, handle, "TaskParameters", e.fixedRecord(
                e.uuidEl(targetUuid),
                e.millisEl(0L),
                unspecifiedRound(e)));
        send(handle, params);
        logger.info("DirectFire task {} -> {} at target {}", taskId, entityUuid, targetUuid);
        return taskId;
    }

    /**
     * A {@code RoundStruct} that specifies nothing.
     *
     * <p>v4 requires weapon and munition types on every fire task, but DIS
     * enumerations are scenario-specific: guessing one produces a
     * plausible-looking engagement with the wrong weapon. All-zero types with
     * zero quantity and rate mean "simulator decides", which is both honest and
     * the closest equivalent to v2, where these fields did not exist.
     */
    private hla.rti1516e.encoding.DataElement unspecifiedRound(HlaEncoder e) {
        return e.roundEl(TaskEnums.TYPE_UNSPECIFIED, TaskEnums.TYPE_UNSPECIFIED, 0, 0.0);
    }

    // ── Control ───────────────────────────────────────────────────────────────

    /** {@code Task.ChangeRulesOfEngagement} (v2 SetRulesOfEngagement). */
    @Override
    public UUID setRulesOfEngagement(String entityUuid, String roe) throws Exception {
        InteractionClassHandle handle = interaction(CHANGE_ROE);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, entityUuid, "CSE bridge ROE change", true);
        HlaEncoder e = enc();
        put(params, handle, "TaskParameters",
                e.fixedRecord(e.octetEl(TaskEnums.rulesOfEngagement(roe))));
        send(handle, params);
        logger.info("ChangeRulesOfEngagement task {} -> {} ({})", taskId, entityUuid, roe);
        return taskId;
    }

    /**
     * {@code CancelTasks} with an empty {@code Tasks} array.
     *
     * <p>v4 merged CancelAllTasks and CancelSpecifiedTasks: the FOM defines an
     * empty or absent list as "cancel all scheduled and ongoing tasks".
     */
    @Override
    public UUID cancelAllTasks(String entityUuid) throws Exception {
        InteractionClassHandle handle = interaction(CANCEL_TASKS);
        UUID actionId = UUID.randomUUID();
        ParameterHandleValueMap params = controlBase(handle, entityUuid, actionId);
        put(params, handle, "Tasks", enc().arrayOfUuid(List.of()));
        send(handle, params);
        logger.info("CancelTasks {} -> {} (all tasks)", actionId, entityUuid);
        return actionId;
    }

    /**
     * {@code SetSuppliesStatus} (v2 MagicResource), from NETN-LOG.
     *
     * <p>Note the semantic change: MagicResource added resources, whereas
     * SetSuppliesStatus <em>sets</em> the new quantity of one supply type. The
     * FOM also restricts it to {@code AggregateEntity}, so applying it to a
     * platform or lifeform may be refused by the simulator.
     */
    @Override
    public UUID injectSupplies(String entityUuid, String resourceType, String supplyType,
                               double quantity) throws Exception {
        InteractionClassHandle handle = interaction(SET_SUPPLIES_STATUS);
        UUID actionId = UUID.randomUUID();
        ParameterHandleValueMap params = controlBase(handle, entityUuid, actionId);
        HlaEncoder e = enc();
        put(params, handle, "SupplyStatus", e.fixedRecord(
                e.entityTypeEl(TaskEnums.supplyType(resourceType, supplyType)),
                e.float64El(quantity)));
        send(handle, params);
        logger.info("SetSuppliesStatus {} -> {} ({} = {}). Note v4 sets the quantity rather than "
                + "adding to it, and the FOM restricts this action to aggregate entities.",
                actionId, entityUuid, resourceType, quantity);
        return actionId;
    }

    // ── Environment ───────────────────────────────────────────────────────────

    /**
     * {@code Task.CreateObstacle} from NETN-SE, TaskParameters =
     * CreateObstacleTaskStruct{EngineeringTask{EngineeringObjectId, Name,
     * Duration}, Area}.
     *
     * <p>The obstacle type is no longer part of the task: NETN-SE models the
     * result as an {@code EnvironmentObject} whose type the engineering federate
     * decides, so a supplied {@code obstacleType} is only logged.
     */
    @Override
    public UUID createObstacle(String entityUuid,
                               String obstacleName,
                               String obstacleType,
                               double latitude,
                               double longitude,
                               double radiusMeters) throws Exception {
        InteractionClassHandle handle = interaction(CREATE_OBSTACLE);
        UUID taskId = UUID.randomUUID();
        UUID obstacleUuid = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, entityUuid, "CSE bridge obstacle: " + obstacleName, false);
        HlaEncoder e = enc();
        put(params, handle, "TaskParameters", e.fixedRecord(
                e.recordEl(
                        e.uuidEl(obstacleUuid),
                        e.stringEl(obstacleName == null ? "obstacle" : obstacleName),
                        e.millisEl(0L)),           // Duration 0 = simulator's own estimate
                e.locationArrayEl(HlaEncoder.circleToPolygon(
                        latitude, longitude, radiusMeters, 0.0, AREA_POLYGON_POINTS))));
        send(handle, params);
        if (obstacleType != null && !obstacleType.isBlank()) {
            logger.info("obstacleType '{}' is not sent in v4 — NETN-SE lets the engineering "
                    + "federate choose the resulting EnvironmentObject type.", obstacleType);
        }
        logger.info("CreateObstacle task {} -> {} obstacle {} ({}, {}) r={}m as a {}-point area",
                taskId, entityUuid, obstacleUuid, latitude, longitude, radiusMeters,
                AREA_POLYGON_POINTS);
        return obstacleUuid;
    }

    /**
     * {@code Task.DisruptCommunication} from NETN-COM, TaskParameters =
     * {Network (UUID), Area (LocationStructArray), DisruptionEnabled}.
     *
     * <p>v4 identifies the network by the UUID of a NETN-COM
     * {@code CommunicationNetwork} object rather than by name. A name cannot be
     * resolved to a UUID without subscribing to those objects, so a non-UUID
     * {@code network} is rejected — the all-zero UUID means "all networks",
     * which is what omitting it should mean, and silently widening a request
     * from one network to all of them would be worse than an error.
     */
    @Override
    public UUID disruptCommunication(String entityUuid,
                                     String network,
                                     double latitude,
                                     double longitude,
                                     double radiusKm,
                                     boolean enabled) throws Exception {
        InteractionClassHandle handle = interaction(DISRUPT_COMMUNICATION);
        UUID taskId = UUID.randomUUID();
        ParameterHandleValueMap params =
                taskBase(handle, taskId, entityUuid, "CSE bridge comms disruption", true);
        HlaEncoder e = enc();

        hla.rti1516e.encoding.DataElement networkEl;
        if (network == null || network.isBlank()) {
            networkEl = e.nilUuidEl();
        } else {
            try {
                networkEl = e.uuidEl(network);
            } catch (IllegalArgumentException bad) {
                throw new IllegalArgumentException(
                        "NETN v4 identifies a communication network by UUID, not by name, so "
                        + "\"network\": \"" + network + "\" cannot be used. Omit \"network\" to "
                        + "disrupt all networks, or pass the UUID of the NETN-COM "
                        + "CommunicationNetwork object.");
            }
        }

        put(params, handle, "TaskParameters", e.fixedRecord(
                networkEl,
                e.locationArrayEl(HlaEncoder.circleToPolygon(
                        latitude, longitude, radiusKm * 1000.0, 0.0, AREA_POLYGON_POINTS)),
                e.booleanEl(enabled)));
        send(handle, params);
        logger.info("DisruptCommunication task {} -> {} {} around ({}, {}) r={}km",
                taskId, entityUuid, enabled ? "enabled" : "disabled", latitude, longitude, radiusKm);
        return taskId;
    }

    // ── Multi-resolution modelling ────────────────────────────────────────────

    /**
     * {@code Aggregate} / {@code Disaggregate} from NETN-MRM 3.0.
     *
     * <p>Two v2 concepts disappear here. The request is no longer addressed to a
     * federate — it goes to the entity, and the RTI routes it to whichever
     * federate has modelling responsibility — so {@code federate} and
     * {@code MRM_FEDERATE} are unused. And {@code RemoveSubunits} is gone:
     * aggregation in v4 always deletes the entities listed in
     * {@code DisaggregatedEntities}.
     */
    @Override
    public UUID multiResolution(boolean aggregate,
                                String aggregateUuid,
                                String federateName,
                                boolean removeSubunits) throws Exception {
        InteractionClassHandle handle = interaction(aggregate ? MRM_AGGREGATE : MRM_DISAGGREGATE);
        UUID actionId = UUID.randomUUID();
        // Aggregate has no parameters of its own; Disaggregate has an optional
        // Formation, omitted so the simulator uses its default formation.
        ParameterHandleValueMap params = controlBase(handle, aggregateUuid, actionId);
        send(handle, params);
        if (federateName != null && !federateName.isBlank()) {
            logger.info("Ignoring \"federate\": \"{}\" — v4 MRM addresses the aggregate entity, "
                    + "and the RTI routes the action to whichever federate owns it.", federateName);
        }
        if (aggregate && removeSubunits) {
            logger.info("Ignoring \"removeSubunits\" — v4 aggregation always deletes the "
                    + "disaggregated entities.");
        }
        logger.info("MRM {} {} entity {}",
                aggregate ? "Aggregate" : "Disaggregate", actionId, aggregateUuid);
        return actionId;
    }
}
