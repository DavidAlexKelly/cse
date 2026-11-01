[main/java/com/decho/cse/bridge/model/request/FireAtLocationRequest.java]
package com.decho.cse.bridge.model.request;

// Body of POST /entities/{id}/fire-at-location.
public record FireAtLocationRequest(
        double latitude,
        double longitude,
        int durationSeconds,
        Double altitudeMeters
) {}