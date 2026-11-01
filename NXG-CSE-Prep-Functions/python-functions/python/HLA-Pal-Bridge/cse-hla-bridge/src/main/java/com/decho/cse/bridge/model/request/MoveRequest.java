[main/java/com/decho/cse/bridge/model/request/MoveRequest.java]
package com.decho.cse.bridge.model.request;

// Body of POST /entities/{id}/move.
//
// moveType: "roads" | "cross_country" | "roads_and_cross_country" (default).
// altitudeMeters: optional; defaults to the entity's last known altitude,
// or 0 if unknown.
// speedMetersPerSecond: optional initial speed; only meaningful on v4,
// which sends 0 ("entity default") when omitted, and is ignored on v2-era.
// annotation: optional free text recorded with the task.
// orbitRadiusMeters: optional; appended to the annotation as a key/value
// pair for federates that read it that way, since NETN-ETR has no
// orbit-radius field of its own.
public record MoveRequest(
        double latitude,
        double longitude,
        String moveType,
        Double altitudeMeters,
        Double speedMetersPerSecond,
        String annotation,
        Double orbitRadiusMeters
) {}