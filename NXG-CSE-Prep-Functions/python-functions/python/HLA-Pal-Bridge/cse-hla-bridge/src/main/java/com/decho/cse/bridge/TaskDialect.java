[main/java/com/decho/cse/bridge/TaskDialect.java]
package com.decho.cse.bridge;

import java.util.List;
import java.util.Map;
import java.util.UUID;

// One NETN tasking dialect.
//
// NETN restructured tasking between FOM versions and the two schemes are
// mutually unintelligible:
// - v2-era (EtrV2Dialect): ETR_Root.ETR_Task.* with flat parameters,
//   Taskee, StartWhen as a Datetime18 string, angles in radians.
// - v4 (SmcV4Dialect): SMC_EntityControl.Task.* with one TaskParameters
//   struct per task, Entity, StartTime as EpochTime, angles in degrees.
//
// Which one applies is not ours to choose: the bridge may join a
// federation created by another federate, and the FOM that federation was
// created with decides. Sending the wrong dialect is not an error the RTI
// reports - the class simply does not exist, or exists with different
// parameters - so the dialect is detected at connect time from the FOM
// actually loaded, and both implementations are kept.
//
// Methods take and return the REST API's vocabulary (degrees, seconds,
// lat/lon, human-readable enum names) so the HTTP contract is identical
// whichever dialect is live; each implementation converts to what its FOM
// wants.
//
// All operations are implemented by both dialects, but not always
// identically, and never approximately:
// - A parameter one dialect has no field for is ignored with a log line.
// - A value one dialect cannot represent is rejected with
//   IllegalArgumentException (HTTP 400).
// - UnsupportedTaskException (HTTP 409) is for when no dialect is
//   available at all, or for an operation a dialect genuinely cannot express.
public interface TaskDialect {

    // The REST operations a dialect implements. Kept as a single enum so
    // "which FOM class does an endpoint send?" has one answer per dialect,
    // usable by the REST response, the diagnostics endpoints and the task
    // log alike.
    enum Op {
        MOVE, PATROL, MAGIC_MOVE, FIRE_AT_LOCATION, FIRE_AT_ENTITY, ROE, CANCEL_TASKS,
        INJECT_SUPPLIES, CREATE_OBSTACLE, DISRUPT_COMMS, AGGREGATE, DISAGGREGATE,
        CHANGE_HEADING, CHANGE_SPEED, CHANGE_ALTITUDE, STOP
    }

    // The FOM class name this dialect sends for an operation.
    String classFor(Op op);

    // Exactly what /move would put on the wire, without sending it. Built
    // for reconciling with another federate's decoder: comparing field
    // values and hex bytes settles a units or coordinate-system
    // disagreement directly. Implementations must build the value through
    // the same code path used to send it.
    //
    // Returns ordered field name to description, including the encoded bytes.
    Map<String, String> describeMoveTask(double latitude,
                                          double longitude,
                                          double altitudeMeters,
                                          String moveType,
                                          Double speedMetersPerSecond) throws Exception;

    // Short identifier used in configuration and logs: "v2" or "v4".
    String id();

    // Human-readable name.
    String name();

    // The interaction class whose presence in the loaded FOM proves this
    // dialect is the one the federation speaks.
    String detectionClass();

    // Classes this dialect sends, and therefore must publish.
    List<String> published();

    // Classes this dialect listens for.
    List<String> subscribed();

    // Classes resolved only so the startup log records whether the FOM
    // offers them. Not published - several live in optional modules whose
    // absence is normal and only matters to the endpoints that need them.
    List<String> optional();

    // -- Movement --------------------------------------------------------------
    // annotation: free text recorded with the task. Blank uses a default.
    // NETN treats this as a human-readable note, but a receiving federate
    // may parse it for its own purposes, since NETN-ETR has no
    // orbit-radius field of its own.
    UUID moveToLocation(String entityUuid,
                        double latitude,
                        double longitude,
                        double altitudeMeters,
                        String moveType,
                        Double speedMetersPerSecond,
                        String annotation) throws Exception;

    UUID patrol(String entityUuid,
                List<double[]> waypointsLatLonAlt,
                String patrolType,
                String patrolMoveType,
                Integer durationSeconds,
                Integer intervalSeconds,
                Double speedMetersPerSecond) throws Exception;

    UUID magicMove(String entityUuid,
                   double latitude,
                   double longitude,
                   double altitudeMeters,
                   double headingDegrees) throws Exception;

    // -- Fires -----------------------------------------------------------------
    UUID fireAtLocation(String entityUuid,
                         double latitude,
                         double longitude,
                         double altitudeMeters,
                         int durationSeconds) throws Exception;

    UUID fireAtEntity(String entityUuid, String targetUuid) throws Exception;

    // -- Control ---------------------------------------------------------------
    UUID setRulesOfEngagement(String entityUuid, String roe) throws Exception;

    // Turns to a heading, in degrees clockwise from true north. The REST
    // vocabulary is degrees in both dialects, but the wire is not: each
    // implementation converts, and callers never see the difference.
    UUID changeHeading(String entityUuid, double headingDegrees) throws Exception;

    // Sets the ordered speed in metres per second.
    UUID changeSpeed(String entityUuid, double speedMetersPerSecond) throws Exception;

    // Sets the ordered altitude in metres above mean sea level.
    UUID changeAltitude(String entityUuid, double altitudeMeters) throws Exception;

    // Stops and holds. Carries no task parameters in either dialect.
    UUID stopAtSideOfRoad(String entityUuid) throws Exception;

    UUID cancelAllTasks(String entityUuid) throws Exception;

    UUID injectSupplies(String entityUuid,
                         String resourceType,
                         String supplyType,
                         double quantity) throws Exception;

    // -- Environment -------------------------------------------------------------
    // Returns the UUID assigned to the created obstacle object.
    UUID createObstacle(String entityUuid,
                         String obstacleName,
                         String obstacleType,
                         double latitude,
                         double longitude,
                         double radiusMeters) throws Exception;

    UUID disruptCommunication(String entityUuid,
                               String network,
                               double latitude,
                               double longitude,
                               double radiusKm,
                               boolean enabled) throws Exception;

    // -- Multi-resolution modelling ------------------------------------------------
    UUID multiResolution(boolean aggregate,
                         String aggregateUuid,
                         String federateName,
                         boolean removeSubunits) throws Exception;

    // Identity this bridge tasks under, and MRM defaults.
    // taskerCallsign: v2 Tasker is a callsign string.
    // taskerUuid: v4 Tasker is a UUID reference to the commanding entity.
    // Blank means omit the parameter, which the FOM defines as "commander
    // undefined" - preferable to inventing a UUID that resolves to no
    // entity in the federation.
    // defaultMrmFederate: v2 MRM requests must name the federate with
    // modelling responsibility; v4 addresses the entity instead and
    // ignores this.
    record Identity(String taskerCallsign, String taskerUuid, String defaultMrmFederate) {}

    // The live dialect cannot express this request. Extends
    // IllegalStateException so it is mapped to HTTP 409 alongside "class
    // not in the loaded FOM" - from a caller's point of view both mean
    // "this federation cannot do that".
    class UnsupportedTaskException extends IllegalStateException {
        public UnsupportedTaskException(String message) {
            super(message);
        }
    }
}