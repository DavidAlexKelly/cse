[main/java/com/decho/cse/bridge/model/request/PatrolRequest.java]
package com.decho.cse.bridge.model.request;

import java.util.List;

// Body of POST /entities/{id}/patrol.
//
// patrolType: PatrolTypeEnum32: "circle"/"loop" (default), "reverse"/"pingpong", "once"
// moveType: PatrolMoveTypeEnum32: "open" (default), "stealth", "caution", "other"
// durationSeconds: optional; when set, the patrol repeats for this long
// intervalSeconds: optional; time between the start of two patrol cycles
// speedMetersPerSecond: optional speed to reach each waypoint; ignored on
// v2-era, which models a patrol path as bare locations with no per-waypoint speed
public record PatrolRequest(
        List<Waypoint> waypoints,
        String patrolType,
        String moveType,
        Integer durationSeconds,
        Integer intervalSeconds,
        Double speedMetersPerSecond
) {
    public record Waypoint(double latitude, double longitude, Double altitudeMeters) {}
}