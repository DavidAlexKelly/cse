[main/java/com/decho/cse/bridge/model/request/SpeedRequest.java]
package com.decho.cse.bridge.model.request;

// Body of POST /entities/{id}/speed.
//
// speedMetersPerSecond: ordered speed over ground. 0 is passed through
// rather than treated as unset, since a receiver may legitimately read it
// as a hold order.
public record SpeedRequest(double speedMetersPerSecond) {}