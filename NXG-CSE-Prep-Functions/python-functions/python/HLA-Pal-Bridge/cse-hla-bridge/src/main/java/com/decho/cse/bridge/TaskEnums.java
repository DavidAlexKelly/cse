[main/java/com/decho/cse/bridge/TaskEnums.java]
package com.decho.cse.bridge;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

// Maps the REST API's human-friendly vocabulary onto FOM enumerations.
//
// Shared between dialects because NETN v4 restructured the tasking class
// tree and every task's parameters, but did not renumber these
// enumerations - MoveTypeEnum32, PatrolTypeEnum32, PatrolMoveTypeEnum32,
// RulesOfEngagementEnum8 and TaskModeEnum8 have identical enumerators and
// values across NETN-ETR generations. Keeping one copy means a corrected
// value applies to both dialects at once.
final class TaskEnums {

    private static final Logger logger = LoggerFactory.getLogger(TaskEnums.class);

    // MoveTypeEnum32
    static final int MOVE_CROSS_COUNTRY = 0;
    static final int MOVE_ONLY_ROADS = 1;
    static final int MOVE_ROADS_AND_CROSS_COUNTRY = 2;

    // PatrolTypeEnum32
    static final int PATROL_OTHER = 0;
    static final int PATROL_CIRCLE = 1;
    static final int PATROL_REVERSE = 2;

    // PatrolMoveTypeEnum32
    static final int PATROL_MOVE_OTHER = 0;
    static final int PATROL_MOVE_STEALTH = 1;
    static final int PATROL_MOVE_CAUTION = 2;
    static final int PATROL_MOVE_OPEN = 3;

    // RulesOfEngagementEnum8
    static final int ROE_HOLD_FIRE = 0;
    static final int ROE_FIRE_AT_WILL = 1;
    static final int ROE_FIRE_WHEN_FIRED_UPON = 2;

    // TaskModeEnum8
    static final int TASK_MODE_NON_CONCURRENT = 0;
    static final int TASK_MODE_CONCURRENT = 1;

    // StopFreezeReasonEnum8 (RPR, dialect independent)
    static final int STOP_REASON_RECESS = 1;
    static final int STOP_REASON_TERMINATION = 2;

    // Placeholder SISO-REF-010 types. DIS enumerations are simulator- and
    // scenario-specific, so these are only sensible defaults: every
    // endpoint accepts an explicit dotted type to override them, and a
    // warning is logged whenever a default is used.
    static final String SUPPLY_AMMUNITION = "6.1.0.1.0.0.0";
    static final String SUPPLY_FUEL = "6.1.0.2.0.0.0";
    static final String SUPPLY_PROVISIONS = "6.1.0.3.0.0.0";
    static final String SUPPLY_PERSONNEL = "6.1.0.4.0.0.0";
    static final String OBSTACLE_GENERIC = "5.1.0.1.0.0.0";

    // All-zero EntityTypeStruct - "unspecified, simulator decides".
    static final String TYPE_UNSPECIFIED = "0.0.0.0.0.0.0";

    private TaskEnums() {}

    static int moveType(String value) {
        if (value == null) return MOVE_ROADS_AND_CROSS_COUNTRY;
        return switch (value.trim().toLowerCase()) {
            case "roads", "only_roads", "road" -> MOVE_ONLY_ROADS;
            case "cross_country", "crosscountry", "offroad" -> MOVE_CROSS_COUNTRY;
            default -> MOVE_ROADS_AND_CROSS_COUNTRY;
        };
    }

    static int patrolType(String value) {
        if (value == null) return PATROL_CIRCLE;
        return switch (value.trim().toLowerCase()) {
            case "loop", "circle", "circuit" -> PATROL_CIRCLE;
            case "pingpong", "reverse", "there_and_back" -> PATROL_REVERSE;
            case "once", "other" -> PATROL_OTHER;
            default -> PATROL_CIRCLE;
        };
    }

    static int patrolMoveType(String value) {
        if (value == null) return PATROL_MOVE_OPEN;
        return switch (value.trim().toLowerCase()) {
            case "stealth", "covert" -> PATROL_MOVE_STEALTH;
            case "caution", "careful" -> PATROL_MOVE_CAUTION;
            case "other" -> PATROL_MOVE_OTHER;
            default -> PATROL_MOVE_OPEN;
        };
    }

    static int rulesOfEngagement(String value) {
        if (value == null) return ROE_FIRE_WHEN_FIRED_UPON;
        return switch (value.trim().toLowerCase()) {
            case "hold_fire", "holdfire", "weapons_hold" -> ROE_HOLD_FIRE;
            case "fire_at_will", "fireatwill", "weapons_free" -> ROE_FIRE_AT_WILL;
            default -> ROE_FIRE_WHEN_FIRED_UPON;
        };
    }

    static String supplyType(String resourceType, String explicitDisType) {
        if (explicitDisType != null && !explicitDisType.isBlank()) {
            return explicitDisType;
        }
        String key = resourceType == null ? "" : resourceType.trim().toLowerCase();
        String mapped = switch (key) {
            case "ammo", "ammunition", "munition" -> SUPPLY_AMMUNITION;
            case "fuel", "petrol", "diesel" -> SUPPLY_FUEL;
            case "food", "provisions", "water" -> SUPPLY_PROVISIONS;
            case "personnel", "troops" -> SUPPLY_PERSONNEL;
            default -> SUPPLY_AMMUNITION;
        };
        logger.warn("Using placeholder DIS supply type {} for resourceType '{}'. Confirm the "
                + "correct SISO-REF-010 enumeration for this scenario and pass it as "
                + "\"supplyType\" to avoid relying on this default.", mapped, resourceType);
        return mapped;
    }

    static String obstacleType(String name, String explicitDisType) {
        if (explicitDisType != null && !explicitDisType.isBlank()) {
            return explicitDisType;
        }
        logger.warn("Using placeholder DIS obstacle type {} for '{}'. Confirm the correct "
                + "SISO-REF-010 land cultural feature enumeration and pass it as "
                + "\"obstacleType\".", OBSTACLE_GENERIC, name);
        return OBSTACLE_GENERIC;
    }

    static double normaliseDegrees(double degrees) {
        double d = degrees % 360.0;
        return d < 0 ? d + 360.0 : d;
    }

    // Seconds (the REST vocabulary) to milliseconds (the v4 FOM vocabulary).
    static long secondsToMillis(Integer seconds) {
        return seconds == null ? 0L : Math.max(0L, seconds.longValue() * 1000L);
    }
}