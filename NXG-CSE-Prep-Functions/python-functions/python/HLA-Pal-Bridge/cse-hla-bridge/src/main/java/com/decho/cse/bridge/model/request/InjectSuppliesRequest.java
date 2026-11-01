[main/java/com/decho/cse/bridge/model/request/MagicMoveRequest.java]
package com.decho.cse.bridge.model.request;

// Body of POST /entities/{id}/magic-move.
//
// headingDegrees is degrees true north here and is converted to radians
// for the v2-era wire format.
public record MagicMoveRequest(
        double latitude,
        double longitude,
        double headingDegrees,
        Double altitudeMeters
) {}