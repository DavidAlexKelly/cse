[main/java/com/decho/cse/bridge/EntityStateStore.java]
package com.decho.cse.bridge;

import com.decho.cse.bridge.model.Entity;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

// Thread-safe in-memory store of all live HLA entities. Written by
// FederationAmbassador on HLA callback threads, read by BridgeServer on
// REST API threads.
@Component
public class EntityStateStore {

    private final ConcurrentHashMap<String, Entity> entities = new ConcurrentHashMap<>();
    private volatile double simTime = 0.0;
    private volatile boolean connected = false;
    private volatile String federationName = "";

    // -- Write (called from the HLA callback thread) ---------------------------
    public void discover(String id, String name, String entityType) {
        discover(id, name, entityType, null);
    }

    // Records a discovered instance, keeping the FOM class it was
    // discovered at. Only attributes available at the discovered class can
    // ever reach us, so an entity with no position is explained by its
    // class rather than by its emptiness.
    public void discover(String id, String name, String entityType, String discoveredClass) {
        entities.computeIfAbsent(id, k -> {
            Entity created = new Entity(id, name, entityType, discoveredClass);
            // Inferred from the object instance name, the only
            // publisher-identifying thing available at discovery time.
            created.simulator = inferSimulator(name);
            return created;
        });
    }

    public void updatePosition(String id, double lat, double lon, double alt) {
        Entity e = entities.get(id);
        if (e != null) {
            e.latitude = lat;
            e.longitude = lon;
            e.altitudeMeters = alt;
            e.touch();
        }
    }

    // Speed in metres per second, from the magnitude of the Spatial
    // velocity vector. Only present on dead-reckoned Spatial alternatives -
    // a static entity carries no velocity and keeps a null speed, which is
    // correct rather than zero.
    public void updateSpeed(String id, double speedMps) {
        Entity e = entities.get(id);
        if (e != null) {
            e.speedMps = speedMps;
            e.touch();
        }
    }

    // Heading in degrees true north, decoded from the Spatial orientation.
    public void updateHeading(String id, double headingDegrees) {
        Entity e = entities.get(id);
        if (e != null) {
            e.headingDegrees = headingDegrees;
            e.touch();
        }
    }

    public void updateEntityType(String id, String dis) {
        Entity e = entities.get(id);
        if (e != null) {
            e.dis = dis;
            e.touch();
        }
    }

    public void updateMarking(String id, String marking) {
        Entity e = entities.get(id);
        if (e != null) {
            if (e.name == null || e.name.isBlank()) e.name = marking;
            e.touch();
        }
    }

    public void updateCallsign(String id, String callsign) {
        Entity e = entities.get(id);
        if (e != null) {
            e.callsign = callsign;
            e.touch();
        }
    }

    public void updateSymbol(String id, String symbolId) {
        Entity e = entities.get(id);
        if (e != null) {
            e.symbolId = symbolId;
            e.touch();
        }
    }

    public void updateDamageState(String id, String damageState) {
        Entity e = entities.get(id);
        if (e != null) {
            e.damageState = damageState;
            e.touch();
        }
    }

    public void updateForce(String id, String forceId) {
        Entity e = entities.get(id);
        if (e != null) {
            e.forceId = forceId;
            e.touch();
        }
    }

    public void updateAggregateState(String id, String aggregateState) {
        Entity e = entities.get(id);
        if (e != null) {
            e.aggregateState = aggregateState;
            e.touch();
        }
    }

    public void updatePosture(String id, String posture) {
        Entity e = entities.get(id);
        if (e != null) {
            e.posture = posture;
            e.touch();
        }
    }

    public void updateMission(String id, String mission) {
        Entity e = entities.get(id);
        if (e != null) {
            e.mission = mission;
            e.touch();
        }
    }

    public void updateActivity(String id, String activity) {
        Entity e = entities.get(id);
        if (e != null) {
            e.activity = activity;
            e.touch();
        }
    }

    public void updateCombatValue(String id, int combatValue) {
        Entity e = entities.get(id);
        if (e != null) {
            e.combatValue = combatValue;
            e.touch();
        }
    }

    public void updateEchelon(String id, String echelon) {
        Entity e = entities.get(id);
        if (e != null) {
            e.echelon = echelon;
            e.touch();
        }
    }

    public void updateIsCommandPost(String id, boolean isPC) {
        Entity e = entities.get(id);
        if (e != null) {
            e.isCommandPost = isPC;
            e.touch();
        }
    }

    public void updateUniqueId(String id, String uniqueId) {
        Entity e = entities.get(id);
        if (e != null) {
            e.uniqueId = uniqueId;
            e.touch();
        }
    }

    public void remove(String id) {
        entities.remove(id);
    }

    // Drops all entity state. Used on reconnect: the entities were
    // discovered in a federation this federate is no longer attached to,
    // so keeping them would serve stale positions until they happened to
    // be rediscovered.
    public void clear() {
        entities.clear();
        simTime = 0.0;
    }

    public void setSimTime(double time) {
        this.simTime = time;
    }

    public void setConnected(boolean connected) {
        this.connected = connected;
    }

    public void setFederationName(String name) {
        this.federationName = name;
    }

    // DIS EntityIdentifier - the simulation's own name for this entity.
    // Stored as three fields plus a formatted "site-app-entity" string. The
    // formatted form is what a REST caller addresses; the numeric fields
    // are what a SetData datum needs.
    public void updateEntityIdentifier(String id, int siteId, int applicationId, int entityNumber) {
        Entity e = entities.get(id);
        if (e != null) {
            e.disSiteId = siteId;
            e.disApplicationId = applicationId;
            e.disEntityNumber = entityNumber;
            e.entityIdentifier = siteId + "-" + applicationId + "-" + entityNumber;
            e.touch();
        }
    }

    // -- Read (called from the REST API thread) ---------------------------------
    public List<Entity> getAll() {
        return new ArrayList<>(entities.values());
    }

    public Entity get(String id) {
        return entities.get(id);
    }

    // Finds an entity by UniqueId (NETN UUID) - needed for issuing
    // interactions since ETR tasks address entities by UniqueId, not by
    // HLA object handle.
    public Optional<Entity> getByUniqueId(String uniqueId) {
        return entities.values().stream()
                .filter(e -> uniqueId.equals(e.uniqueId))
                .findFirst();
    }

    // Finds an entity by its DIS EntityIdentifier, written "site-app-entity".
    // The counterpart to getByUniqueId for simulators that publish no NETN
    // UniqueId. Whitespace-tolerant, since this value is typed by hand far
    // more often than a UUID is.
    public Optional<Entity> getByEntityIdentifier(String entityIdentifier) {
        if (entityIdentifier == null) return Optional.empty();
        String wanted = entityIdentifier.trim();
        return entities.values().stream()
                .filter(e -> wanted.equals(e.entityIdentifier))
                .findFirst();
    }

    // Same lookup, from the three numeric fields.
    public Optional<Entity> getByEntityIdentifier(int siteId, int applicationId, int entityNumber) {
        return getByEntityIdentifier(siteId + "-" + applicationId + "-" + entityNumber);
    }

    // Every distinct DIS site/application pair currently observed, with a
    // count and an example entity. A federate's site/app pair is
    // effectively its address on the DIS side, so grouping live entities by
    // it identifies which simulators are publishing what.
    public List<Map<String, Object>> observedDisSourcesGrouped() {
        Map<String, List<Entity>> bySource = new TreeMap<>();
        for (Entity e : entities.values()) {
            if (e.disSiteId == null || e.disApplicationId == null) continue;
            bySource.computeIfAbsent(e.disSiteId + "-" + e.disApplicationId,
                    k -> new ArrayList<>()).add(e);
        }

        List<Map<String, Object>> out = new ArrayList<>();
        bySource.forEach((source, group) -> {
            Entity sample = group.get(0);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("siteApplication", source);
            row.put("entityCount", group.size());
            row.put("exampleEntityIdentifier", sample.entityIdentifier);
            row.put("exampleName", sample.name);
            row.put("exampleSimulator", sample.simulator);
            row.put("exampleDiscoveredClass", sample.discoveredClass);
            out.add(row);
        });
        return out;
    }

    // Entities carrying a DIS EntityIdentifier, so addressable without a UniqueId.
    public List<Entity> getRprAddressable() {
        return entities.values().stream()
                .filter(e -> e.entityIdentifier != null)
                .toList();
    }

    public List<Entity> getBySimulator(String simulator) {
        return entities.values().stream()
                .filter(e -> simulator.equalsIgnoreCase(e.simulator))
                .toList();
    }

    public List<Entity> getInArea(double lat, double lon, double radiusKm) {
        return entities.values().stream()
                .filter(e -> e.latitude != null && e.longitude != null)
                .filter(e -> haversineKm(lat, lon, e.latitude, e.longitude) <= radiusKm)
                .toList();
    }

    public double getSimTime() { return simTime; }
    public boolean isConnected() { return connected; }
    public String getFederationName() { return federationName; }

    // -- Helpers ----------------------------------------------------------------
    // Guesses which simulator published an entity, from its object
    // instance name prefix. Publishers commonly encode their own name into
    // the instance name, so this is a heuristic rather than an
    // authoritative source - the authoritative source is the producing
    // federate handle supplied to discoverObjectInstance, which the RTI
    // only provides when its conveyProducingFederate switch is enabled;
    // it is off by default here.
    private String inferSimulator(String objectName) {
        if (objectName == null || objectName.isBlank()) return "unknown";
        int separator = objectName.indexOf('_');
        String prefix = (separator > 0 ? objectName.substring(0, separator) : objectName)
                .toLowerCase();
        if (prefix.startsWith("sword")) return "sword";
        if (prefix.startsWith("vbs")) return "vbs4";
        if (prefix.startsWith("simworks")) return "simworks";
        return "unknown";
    }

    private double haversineKm(double lat1, double lon1, double lat2, double lon2) {
        double R = 6371.0;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                        * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * 2 * Math.asin(Math.sqrt(a));
    }
}