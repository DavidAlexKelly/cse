package com.decho.cse.bridge.model.request;

public record RoeRequest(
        String roe // "hold_fire" | "return_fire" | "fire_at_will"
) {}