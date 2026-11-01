[main/java/com/decho/cse/bridge/model/request/ObstacleRequest.java]
package com.decho.cse.bridge.model.request;

// Body of POST /map/obstacle. CreateObstacle is a task: the FOM requires a
// Taskee, so an engineer entity has to be nominated via entityId.
//
// type: label for the obstacle ("minefield" | "roadblock" | "wire")
// entityId: the engineer entity to task (HLA id or NETN UniqueId)
// radiusMeters: size of the circular obstacle area (default 50)
// obstacleType: optional explicit SISO-REF-010 dotted DIS type
public record ObstacleRequest(
        String type,
        double latitude,
        double longitude,
        String entityId,
        Double radiusMeters,
        String obstacleType
) {}