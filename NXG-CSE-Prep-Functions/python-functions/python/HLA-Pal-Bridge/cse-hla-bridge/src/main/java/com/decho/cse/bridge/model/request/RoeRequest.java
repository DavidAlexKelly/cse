[main/java/com/decho/cse/bridge/model/request/RoeRequest.java]
package com.decho.cse.bridge.model.request;

public record RoeRequest(
        String roe // "hold_fire" | "return_fire" | "fire_at_will"
) {}