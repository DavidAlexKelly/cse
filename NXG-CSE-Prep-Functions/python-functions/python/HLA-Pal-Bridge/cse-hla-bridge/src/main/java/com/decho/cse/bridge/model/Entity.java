[main/java/com/decho/cse/bridge/model/Entity.java]
package com.decho.cse.bridge.model;

import com.fasterxml.jackson.annotation.JsonInclude;

// Represents a live entity in the HLA federation. Populated from whichever
// NETN or RPR object classes the federation publishes.
@JsonInclude(JsonInclude.Include.NON_NULL)
public class Entity {

    // -- Identity --------------------------------------------------------------
    public String id;         // HLA object instance handle (string)
    public String uniqueId;   // NETN UUID
    public String name;       // Marking / AggregateMarking
    public String callsign;   // NETN Callsign
    public String symbolId;   // NETN SymbolId (SIDC)

    // -- DIS identity (RPR EntityIdentifier) ------------------------------------
    // The other way to name an entity, and the only way for a simulator
    // that publishes no NETN UniqueId. Unlike id, which is an RTI
    // object-instance handle unique only within one federation execution,
    // this triple is the simulation's own identifier and is what a SetData
    // datum has to be addressed to.
    public Integer disSiteId;
    public Integer disApplicationId;
    public Integer disEntityNumber;

    // The triple formatted as "site-app-entity", or null if not yet reflected.
    public String entityIdentifier;

    // -- Classification ----------------------------------------------------------
    public String entityType; // "vehicle" | "human" | "aircraft" | "aggregate" | ...

    // The FOM class this instance was discovered at, verbatim. Reported
    // because entityType is a coarse bucket that loses the fact that
    // matters when attributes are missing: an object is discovered at the
    // most specific class subscribed to, and only attributes available at
    // that class can ever reach us. Empty means the discovered class was
    // one never registered.
    public String discoveredClass;

    public String simulator; // "vbs4" | "sword" | "simworks" | "unknown"
    public String dis;       // DIS entity type, e.g. "1.1.222.4.3.1.0"
    public String forceId;   // "friendly" | "opposing" | "neutral"
    public String echelon;   // NETN Echelon (aggregates only)

    // -- Position ------------------------------------------------------------
    public Double latitude;
    public Double longitude;
    public Double altitudeMeters;
    public Double headingDegrees;
    public Double speedMps;

    // -- State ---------------------------------------------------------------
    public String damageState;      // "no_damage" | "slight" | "moderate" | "destroyed"
    public String aggregateState;   // "aggregated" | "disaggregated"
    public String posture;          // NETN Posture
    public String mission;          // NETN Mission
    public String activity;         // NETN Activity
    public Integer combatValue;     // 0-100
    public Boolean isCommandPost;   // NETN IsPC

    // -- Timestamps ------------------------------------------------------------
    public Long discoveredAt; // when first seen
    public Long lastUpdated;  // when last updated

    public Entity() {}

    public Entity(String id, String name, String entityType) {
        this(id, name, entityType, null);
    }

    public Entity(String id, String name, String entityType, String discoveredClass) {
        this.id = id;
        this.name = name;
        this.entityType = entityType;
        this.discoveredClass = discoveredClass;
        this.discoveredAt = System.currentTimeMillis();
        this.lastUpdated = System.currentTimeMillis();
    }

    public void touch() {
        this.lastUpdated = System.currentTimeMillis();
    }
}