[main/java/com/decho/cse/bridge/model/request/DisruptCommsRequest.java]
package com.decho.cse.bridge.model.request;

// Body of POST /map/disrupt-comms. Like CreateObstacle this is a task, so
// an entity (the EW asset) must be nominated via entityId. The FOM's
// AffectedArea is a geodetic quadrangle, so radiusKm is converted to a
// bounding box around the given centre.
//
// network: NETN-COM communication network name; empty means all networks.
public record DisruptCommsRequest(
        double latitude,
        double longitude,
        double radiusKm,
        boolean enabled,
        String entityId,
        String network
) {}