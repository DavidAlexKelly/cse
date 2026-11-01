[main/java/com/decho/cse/bridge/model/request/HeadingRequest.java]
package com.decho.cse.bridge.model.request;

// Body of POST /entities/{id}/heading.
//
// headingDegrees: clockwise from true north, [0,360). Always degrees at
// this layer; the dialect converts to radians for the v2-era wire format.
public record HeadingRequest(double headingDegrees) {}