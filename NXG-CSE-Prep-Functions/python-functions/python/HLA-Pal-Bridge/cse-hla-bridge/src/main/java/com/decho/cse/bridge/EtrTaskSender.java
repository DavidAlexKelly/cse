[main/java/com/decho/cse/bridge/EtrTaskSender.java]
package com.decho.cse.bridge;

import com.decho.cse.bridge.BridgeFederate.Fom;
import hla.rti1516e.InteractionClassHandle;
import hla.rti1516e.ParameterHandleValueMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

// Sends NETN tasks and RPR simulation-management interactions.
//
// Tasking itself lives in TaskDialect: the two NETN generations model it so
// differently - different class tree, different parameter names, different
// datatypes, different units - that one implementation cannot serve both,
// and this bridge does not get to choose which the federation speaks. This
// class delegates each REST operation to whichever dialect BridgeFederate
// selected from the FOM actually loaded, and keeps the two things that are
// genuinely dialect independent: scenario start/pause/stop (not an ETR
// concept at all, using the DIS-derived StartResume/StopFreeze
// interactions) and the DIS site/application identity they are sent with.
@Component
public class EtrTaskSender {

    private static final Logger logger = LoggerFactory.getLogger(EtrTaskSender.class);

    private final BridgeFederate federate;
    private final BridgeDiagnostics diagnostics;
    private volatile HlaEncoder encoder;
    private final int disSiteId;
    private final int disApplicationId;

    public EtrTaskSender(BridgeFederate federate,
                          BridgeDiagnostics diagnostics,
                          @Value("${bridge.dis-site-id}") int disSiteId,
                          @Value("${bridge.dis-application-id}") int disApplicationId) {
        this.federate = federate;
        this.diagnostics = diagnostics;
        this.disSiteId = disSiteId;
        this.disApplicationId = disApplicationId;
    }

    // Sends a task and records it, so "what did we send, and did anything
    // answer?" can be asked over HTTP later. Wrapping every delegation here
    // means the record is written exactly once per task, with the
    // operation, the FOM class the live dialect chose, and the entity - the
    // three things needed to correlate a task with an acknowledgement.
    private UUID sendAndRecord(TaskDialect.Op op, String entityUuid, TaskSend send) throws Exception {
        TaskDialect dialect = federate.dialect();
        UUID taskId = send.execute(dialect);
        diagnostics.recordTaskSent(taskId.toString(), op.name(), dialect.classFor(op),
                dialect.id(), entityUuid);
        return taskId;
    }

    // The dialect call to make. Kept as a separate interface so recording
    // cannot be forgotten at a call site.
    private interface TaskSend {
        UUID execute(TaskDialect dialect) throws Exception;
    }

    // Lazily creates the RTI encoder factory, for the same reason as in
    // BaseDialect: a classpath/RTI problem here must not fail Spring startup.
    private HlaEncoder enc() throws Exception {
        HlaEncoder local = encoder;
        if (local == null) {
            synchronized (this) {
                local = encoder;
                if (local == null) {
                    local = new HlaEncoder();
                    encoder = local;
                }
            }
        }
        return local;
    }

    // The dialect in use, for /status and for logging what a task was sent as.
    public String dialectName() {
        return federate.dialectName();
    }

    public String dialectId() {
        return federate.dialectId();
    }

    // -- Tasking (delegated to the live dialect) ---------------------------------
    public UUID moveToLocation(String entityUuid,
                                double latitude,
                                double longitude,
                                double altitudeMeters,
                                String moveType,
                                Double speedMetersPerSecond,
                                String annotation) throws Exception {
        return sendAndRecord(TaskDialect.Op.MOVE, entityUuid, dialect -> dialect.moveToLocation(
                entityUuid, latitude, longitude, altitudeMeters, moveType, speedMetersPerSecond,
                annotation));
    }

    public UUID patrol(String entityUuid,
                        List<double[]> waypointsLatLonAlt,
                        String patrolType,
                        String patrolMoveType,
                        Integer durationSeconds,
                        Integer intervalSeconds,
                        Double speedMetersPerSecond) throws Exception {
        return sendAndRecord(TaskDialect.Op.PATROL, entityUuid, dialect -> dialect.patrol(
                entityUuid, waypointsLatLonAlt, patrolType, patrolMoveType,
                durationSeconds, intervalSeconds, speedMetersPerSecond));
    }

    public UUID magicMove(String entityUuid,
                           double latitude,
                           double longitude,
                           double altitudeMeters,
                           double headingDegrees) throws Exception {
        return sendAndRecord(TaskDialect.Op.MAGIC_MOVE, entityUuid, dialect -> dialect.magicMove(
                entityUuid, latitude, longitude, altitudeMeters, headingDegrees));
    }

    public UUID fireAtLocation(String entityUuid,
                                double latitude,
                                double longitude,
                                double altitudeMeters,
                                int durationSeconds) throws Exception {
        return sendAndRecord(TaskDialect.Op.FIRE_AT_LOCATION, entityUuid,
                dialect -> dialect.fireAtLocation(
                        entityUuid, latitude, longitude, altitudeMeters, durationSeconds));
    }

    public UUID fireAtEntity(String entityUuid, String targetUuid) throws Exception {
        return sendAndRecord(TaskDialect.Op.FIRE_AT_ENTITY, entityUuid,
                dialect -> dialect.fireAtEntity(entityUuid, targetUuid));
    }

    public UUID setRulesOfEngagement(String entityUuid, String roe) throws Exception {
        return sendAndRecord(TaskDialect.Op.ROE, entityUuid,
                dialect -> dialect.setRulesOfEngagement(entityUuid, roe));
    }

    public UUID changeHeading(String entityUuid, double headingDegrees) throws Exception {
        return sendAndRecord(TaskDialect.Op.CHANGE_HEADING, entityUuid,
                dialect -> dialect.changeHeading(entityUuid, headingDegrees));
    }

    public UUID changeSpeed(String entityUuid, double speedMetersPerSecond) throws Exception {
        return sendAndRecord(TaskDialect.Op.CHANGE_SPEED, entityUuid,
                dialect -> dialect.changeSpeed(entityUuid, speedMetersPerSecond));
    }

    public UUID changeAltitude(String entityUuid, double altitudeMeters) throws Exception {
        return sendAndRecord(TaskDialect.Op.CHANGE_ALTITUDE, entityUuid,
                dialect -> dialect.changeAltitude(entityUuid, altitudeMeters));
    }

    public UUID stopAtSideOfRoad(String entityUuid) throws Exception {
        return sendAndRecord(TaskDialect.Op.STOP, entityUuid,
                dialect -> dialect.stopAtSideOfRoad(entityUuid));
    }

    public UUID cancelAllTasks(String entityUuid) throws Exception {
        return sendAndRecord(TaskDialect.Op.CANCEL_TASKS, entityUuid,
                dialect -> dialect.cancelAllTasks(entityUuid));
    }

    public UUID injectSupplies(String entityUuid, String resourceType, String supplyType,
                                double quantity) throws Exception {
        return sendAndRecord(TaskDialect.Op.INJECT_SUPPLIES, entityUuid,
                dialect -> dialect.injectSupplies(entityUuid, resourceType, supplyType, quantity));
    }

    public UUID createObstacle(String entityUuid,
                                String obstacleName,
                                String obstacleType,
                                double latitude,
                                double longitude,
                                double radiusMeters) throws Exception {
        return sendAndRecord(TaskDialect.Op.CREATE_OBSTACLE, entityUuid,
                dialect -> dialect.createObstacle(entityUuid, obstacleName, obstacleType,
                        latitude, longitude, radiusMeters));
    }

    public UUID disruptCommunication(String entityUuid,
                                      String network,
                                      double latitude,
                                      double longitude,
                                      double radiusKm,
                                      boolean enabled) throws Exception {
        return sendAndRecord(TaskDialect.Op.DISRUPT_COMMS, entityUuid,
                dialect -> dialect.disruptCommunication(
                        entityUuid, network, latitude, longitude, radiusKm, enabled));
    }

    public UUID multiResolution(boolean aggregate,
                                 String aggregateUuid,
                                 String federateName,
                                 boolean removeSubunits) throws Exception {
        return sendAndRecord(
                aggregate ? TaskDialect.Op.AGGREGATE : TaskDialect.Op.DISAGGREGATE, aggregateUuid,
                dialect -> dialect.multiResolution(
                        aggregate, aggregateUuid, federateName, removeSubunits));
    }

    // The FOM class the live dialect would send for an operation, for diagnostics.
    public String classFor(TaskDialect.Op op) {
        return federate.dialect().classFor(op);
    }

    // What a move would put on the wire, without sending it. For handing to
    // another federate's owner when a task is accepted and nothing
    // happens: shows the field values, datatypes and bytes, so a units or
    // coordinate-system disagreement is visible rather than inferred.
    public java.util.Map<String, String> describeMoveTask(double latitude,
                                                            double longitude,
                                                            double altitudeMeters,
                                                            String moveType,
                                                            Double speedMetersPerSecond)
            throws Exception {
        return federate.dialect().describeMoveTask(
                latitude, longitude, altitudeMeters, moveType, speedMetersPerSecond);
    }

    // -- Scenario control (RPR simulation management) ------------------------------
    // Dialect independent: NETN has no start/pause/stop scenario
    // interaction. These are the DIS-derived RPR-FOM equivalents.

    // StartResume, broadcast to the whole federation.
    public long startResume() throws Exception {
        InteractionClassHandle handle = federate.interaction(Fom.START_RESUME);
        long requestId = nextRequestId();
        Instant now = Instant.now();

        ParameterHandleValueMap params = federate.newParameterMap(5);
        params.put(federate.parameter(handle, "OriginatingEntity"),
                enc().entityIdentifier(disSiteId, disApplicationId, 0));
        // EntityNumber 0 with the broadcast site/application means "all".
        params.put(federate.parameter(handle, "ReceivingEntity"), enc().entityIdentifier(0, 0, 0));
        params.put(federate.parameter(handle, "RequestIdentifier"), enc().int32((int) requestId));
        params.put(federate.parameter(handle, "RealWorldTime"), enc().clockTime(now));
        params.put(federate.parameter(handle, "SimulationTime"), enc().clockTime(now));

        federate.sendInteraction(handle, params);
        logger.info("StartResume sent (request {}).", requestId);
        return requestId;
    }

    // StopFreeze. pause=true means Recess (internal clock keeps running);
    // false means Termination (a full stop).
    public long stopFreeze(boolean pause) throws Exception {
        InteractionClassHandle handle = federate.interaction(Fom.STOP_FREEZE);
        long requestId = nextRequestId();

        ParameterHandleValueMap params = federate.newParameterMap(8);
        params.put(federate.parameter(handle, "OriginatingEntity"),
                enc().entityIdentifier(disSiteId, disApplicationId, 0));
        params.put(federate.parameter(handle, "ReceivingEntity"), enc().entityIdentifier(0, 0, 0));
        params.put(federate.parameter(handle, "RequestIdentifier"), enc().int32((int) requestId));
        params.put(federate.parameter(handle, "RealWorldTime"), enc().clockTime(Instant.now()));
        params.put(federate.parameter(handle, "Reason"), enc().octet(
                pause ? TaskEnums.STOP_REASON_RECESS : TaskEnums.STOP_REASON_TERMINATION));
        params.put(federate.parameter(handle, "ReflectValues"), enc().rprBoolean(true));
        params.put(federate.parameter(handle, "RunInternalSimulationClock"), enc().rprBoolean(pause));
        params.put(federate.parameter(handle, "UpdateAttributes"), enc().rprBoolean(pause));

        federate.sendInteraction(handle, params);
        logger.info("StopFreeze sent (request {}, reason {}).",
                requestId, pause ? "Recess/pause" : "Termination/stop");
        return requestId;
    }

    private static int requestCounter = 0;

    private static synchronized long nextRequestId() {
        return ++requestCounter;
    }
}