[main/java/com/decho/cse/bridge/FederationAmbassador.java]
package com.decho.cse.bridge;

import hla.rti1516e.*;
import hla.rti1516e.encoding.*;
import hla.rti1516e.exceptions.*;
import hla.rti1516e.time.HLAfloat64Time;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class FederationAmbassador extends NullFederateAmbassador {

    private static final Logger log = LoggerFactory.getLogger(FederationAmbassador.class);

    private final EntityStateStore store;
    private final RTIambassador rtiAmbassador;

    // Concurrent, not plain HashMaps: written by the connect thread while
    // pub/sub is set up, and read by RTI callback threads delivering
    // discovery and reflection at the same moment, since HLA_IMMEDIATE
    // callbacks can start arriving before subscription finishes.
    private final Map<AttributeHandle, String> attrNames = new java.util.concurrent.ConcurrentHashMap<>();
    private final Map<InteractionClassHandle, String> interNames = new java.util.concurrent.ConcurrentHashMap<>();
    private final Map<ParameterHandle, String> paramNames = new java.util.concurrent.ConcurrentHashMap<>();
    private final Map<ObjectClassHandle, String> classNames = new java.util.concurrent.ConcurrentHashMap<>();

    // Object instances that are MOM federate records rather than entities.
    private final java.util.Set<String> momInstances =
            java.util.Collections.synchronizedSet(new java.util.HashSet<>());

    // Invoked when the RTI reports the connection lost; may be null.
    private final Runnable connectionLostHandler;

    // Observational state for diagnostics. Never affects what is decoded.
    private final BridgeDiagnostics diagnostics;

    public FederationAmbassador(RTIambassador rtiAmbassador, EntityStateStore store) {
        this(rtiAmbassador, store, new BridgeDiagnostics(), null);
    }

    public FederationAmbassador(RTIambassador rtiAmbassador,
                                 EntityStateStore store,
                                 BridgeDiagnostics diagnostics,
                                 Runnable connectionLostHandler) {
        this.rtiAmbassador = rtiAmbassador;
        this.store = store;
        this.diagnostics = diagnostics;
        this.connectionLostHandler = connectionLostHandler;
    }

    public void registerAttributeName(AttributeHandle h, String name) { attrNames.put(h, name); }
    public void registerInteractionName(InteractionClassHandle h, String name) { interNames.put(h, name); }
    public void registerParameterName(ParameterHandle h, String name) { paramNames.put(h, name); }
    public void registerObjectClassName(ObjectClassHandle h, String name) { classNames.put(h, name); }

    // -- Asking for current values --------------------------------------------------
    // Subscribing only entitles this federate to attribute updates the
    // publisher chooses to send from now on. HLA publishers typically send
    // on change, so a federate joining an already-running federation - the
    // usual case here - sees a discovery burst and then nothing until
    // something moves. requestAttributeValueUpdate asks the owner to
    // publish current values now, the standard remedy for a late joiner,
    // and also what makes a paused scenario visible rather than empty.

    // The attributes subscribed per object class, for value requests.
    // Concurrent for the same reason as the name maps above.
    private final Map<ObjectClassHandle, AttributeHandleSet> subscribedAttributes =
            new java.util.concurrent.ConcurrentHashMap<>();

    // Discovered instances and their class, so values can be re-requested later.
    private final Map<ObjectInstanceHandle, ObjectClassHandle> discoveredClasses =
            new java.util.concurrent.ConcurrentHashMap<>();

    // The subscribed attributes that have actually arrived for each
    // instance. This is what lets the periodic refresh stop asking once an
    // instance is complete, keeping the refresh cost bounded rather than
    // re-requesting every attribute of every instance on every cycle.
    private final Map<ObjectInstanceHandle, java.util.Set<AttributeHandle>> receivedAttributes =
            new java.util.concurrent.ConcurrentHashMap<>();

    // Rotates the starting point so a capped cycle cannot starve the same tail forever.
    private int refreshCursor = 0;

    public void registerSubscribedAttributes(ObjectClassHandle h, AttributeHandleSet attributes) {
        subscribedAttributes.put(h, attributes);
    }

    // Asks the owning federate for the current value of everything
    // subscribed on this instance. Best-effort by design: the request can
    // be refused, ignored, or arrive before the publisher is ready, none of
    // which is worth failing a discovery callback over.
    private void requestCurrentValues(ObjectInstanceHandle instance, ObjectClassHandle objectClass) {
        AttributeHandleSet attributes = outstandingAttributes(instance, objectClass);
        if (attributes == null) {
            return;
        }
        try {
            rtiAmbassador.requestAttributeValueUpdate(instance, attributes, null);
        } catch (Exception e) {
            log.debug("Could not request attribute values for {}: {}", instance, e.getMessage());
        }
    }

    // The subscribed attributes this instance has not reported yet, or null
    // if it has reported all of them (or none are subscribed). Returning
    // the full set for an instance that has reported nothing is deliberate:
    // that is the late-joiner case this refresh exists for.
    private AttributeHandleSet outstandingAttributes(ObjectInstanceHandle instance,
                                                       ObjectClassHandle objectClass) {
        AttributeHandleSet subscribed = subscribedAttributes.get(objectClass);
        if (subscribed == null || subscribed.isEmpty()) {
            return null;
        }
        java.util.Set<AttributeHandle> arrived = receivedAttributes.get(instance);
        if (arrived == null) {
            return subscribed;
        }
        if (arrived.containsAll(subscribed)) {
            return null;
        }
        try {
            AttributeHandleSet missing = rtiAmbassador.getAttributeHandleSetFactory().create();
            for (AttributeHandle handle : subscribed) {
                if (!arrived.contains(handle)) {
                    missing.add(handle);
                }
            }
            return missing.isEmpty() ? null : missing;
        } catch (Exception e) {
            return subscribed;
        }
    }

    // Summary of one refresh pass, for the run loop's log line.
    public record RefreshSummary(int asked, int outstanding, int complete, boolean capped) {}

    // Re-requests current values for every discovered instance. Called
    // periodically from the run loop, since one request at discovery is
    // not always enough - the publisher may not have been ready, the
    // scenario may have been loaded after joining, or the response may
    // simply have been dropped.
    //
    // Returns how many instances were asked.
    public RefreshSummary requestValuesForAllInstances(int maxRequests) {
        List<Map.Entry<ObjectInstanceHandle, ObjectClassHandle>> incomplete = new java.util.ArrayList<>();
        int complete = 0;

        for (Map.Entry<ObjectInstanceHandle, ObjectClassHandle> entry : discoveredClasses.entrySet()) {
            if (outstandingAttributes(entry.getKey(), entry.getValue()) == null) {
                complete++;
            } else {
                incomplete.add(entry);
            }
        }

        if (incomplete.isEmpty()) {
            return new RefreshSummary(0, 0, complete, false);
        }

        // Starts where the last pass stopped, so a cap smaller than the
        // backlog reaches every instance eventually rather than starving the tail.
        int limit = maxRequests > 0 ? Math.min(maxRequests, incomplete.size()) : incomplete.size();
        int start = Math.floorMod(refreshCursor, incomplete.size());
        for (int i = 0; i < limit; i++) {
            Map.Entry<ObjectInstanceHandle, ObjectClassHandle> entry =
                    incomplete.get((start + i) % incomplete.size());
            requestCurrentValues(entry.getKey(), entry.getValue());
        }
        refreshCursor = start + limit;

        return new RefreshSummary(limit, incomplete.size(), complete, limit < incomplete.size());
    }

    // No explicit clear for discoveredClasses: a new FederationAmbassador
    // is built for every connect attempt, so stale instance handles go with
    // the old one.

    // -- Object lifecycle -----------------------------------------------------------
    // Both discoverObjectInstance overloads must be implemented. The
    // 4-argument variant is only invoked when the RTI's
    // conveyProducingFederate switch is on, which is off by default, so the
    // 3-argument one must forward to it rather than being left unimplemented.
    @Override
    public void discoverObjectInstance(
            ObjectInstanceHandle theObject,
            ObjectClassHandle theObjectClass,
            String objectName)
            throws FederateInternalError {
        discoverObjectInstance(theObject, theObjectClass, objectName, null);
    }

    @Override
    public void discoverObjectInstance(
            ObjectInstanceHandle theObject,
            ObjectClassHandle theObjectClass,
            String objectName,
            FederateHandle producingFederate)
            throws FederateInternalError {
        String id = theObject.toString();
        String className = classNames.getOrDefault(theObjectClass, "");

        if (isMomFederate(className)) {
            // One MOM instance per joined federate. Not an entity - the RTI
            // telling us who else is in the federation.
            momInstances.add(id);
            log.info("A federate is joined to this federation (details follow if the RTI "
                    + "reports them): {}", objectName);
            return;
        }

        String entityType = classifyEntity(className);
        log.info("Discovered entity: {} ({}) class={} type={}", objectName, id, className, entityType);

        // The class name is kept alongside the bucket: an object is
        // discovered at the most specific class we subscribed to, and only
        // attributes available there can ever reach us - so when a field is
        // null, this is what says whether the subscription was deep enough
        // to receive it.
        store.discover(id, objectName, entityType,
                className == null || className.isEmpty() ? "(unregistered class)" : className);

        // Asks for current values immediately. Without this the entity
        // stays a name with no position until the publisher next changes
        // something, which in a paused or slow-moving scenario can be never.
        discoveredClasses.put(theObject, theObjectClass);
        requestCurrentValues(theObject, theObjectClass);
    }

    private static boolean isMomFederate(String className) {
        return className.endsWith("HLAmanager.HLAfederate");
    }

    // Maps the discovered FOM object class onto the coarse entity type the
    // REST API exposes. Instances are discovered at the most specific class
    // this federate subscribes to, so NETN leaf classes resolve precisely.
    private static String classifyEntity(String className) {
        if (className == null || className.isEmpty()) return "unknown";
        if (className.contains("AggregateEntity")) return "aggregate";
        if (className.contains("Aircraft")) return "aircraft";
        if (className.contains("Human")) return "human";
        if (className.contains("Lifeform")) return "human";
        if (className.contains("Vessel")) return "vessel";
        if (className.contains("Spacecraft")) return "spacecraft";
        if (className.contains("Vehicle") || className.contains("Platform")) return "vehicle";
        // Discovered at the catch-all: a real entity at a class we
        // subscribe to, distinct from "unknown" which means the discovered
        // class was never registered at all.
        if (className.contains("BaseEntity")) return "entity";
        return "unknown";
    }

    @Override
    public void reflectAttributeValues(
            ObjectInstanceHandle theObject,
            AttributeHandleValueMap theAttributes,
            byte[] userSuppliedTag,
            OrderType sentOrdering,
            TransportationTypeHandle theTransport,
            SupplementalReflectInfo supplementalReflectInfo)
            throws FederateInternalError {
        String id = theObject.toString();

        if (momInstances.contains(id)) {
            logMomFederate(theAttributes);
            return;
        }

        // Remembers which subscribed attributes this instance has now
        // reported, so the periodic refresh can stop asking for them.
        // Recorded before decoding: the attribute arrived whether or not it
        // could be decoded, and re-requesting it would not fix a decode fault.
        receivedAttributes.computeIfAbsent(theObject,
                        k -> java.util.concurrent.ConcurrentHashMap.newKeySet())
                .addAll(theAttributes.keySet());

        for (var entry : theAttributes.entrySet()) {
            String attrName = attrNames.getOrDefault(entry.getKey(), entry.getKey().toString());
            byte[] value = entry.getValue();
            try {
                switch (attrName) {
                    case "Spatial" -> decodeSpatial(id, value);
                    case "EntityType" -> store.updateEntityType(id, decodeEntityType(value));
                    case "EntityIdentifier" -> decodeEntityIdentifier(id, value);
                    case "Marking" -> store.updateMarking(id, decodeMarking(value));
                    case "AggregateMarking" -> store.updateMarking(id, decodeMarking(value));
                    // Callsign is an HLAunicodeString (4-byte count then
                    // UTF-16BE), not a null-terminated UTF-8 string.
                    case "Callsign" -> store.updateCallsign(id, decodeUnicodeString(value));
                    // Both spellings are handled since different FOM
                    // generations disagree on the attribute name.
                    case "Symbol", "SymbolId" -> store.updateSymbol(id, decodeString(value));
                    case "DamageState" -> store.updateDamageState(id, decodeDamageState(value));
                    case "ForceIdentifier" -> store.updateForce(id, decodeForce(value));
                    case "AggregateState" -> store.updateAggregateState(id, decodeAggregateState(value));
                    case "Posture" -> store.updatePosture(id, decodeString(value));
                    case "Mission" -> store.updateMission(id, decodeString(value));
                    case "Activity" -> store.updateActivity(id, decodeString(value));
                    case "CombatValue" -> store.updateCombatValue(id, decodeInt32(value));
                    case "Echelon" -> store.updateEchelon(id, decodeString(value));
                    case "IsPC" -> store.updateIsCommandPost(id, decodeBoolean(value));
                    // Both spellings are handled since different FOM
                    // generations disagree on the attribute name, and no
                    // UUID means no task, since every NETN task names its
                    // Taskee by one.
                    case "UniqueId", "UniqueID" -> store.updateUniqueId(id, decodeUUID(value));
                    case "SupportedActions" -> logSupportedActions(id, value);
                    default -> {} // ignore
                }
            } catch (Exception e) {
                log.warn("Failed to decode attr '{}' for entity {}: {}",
                        attrName, id, e.getMessage());
            }
        }
    }

    // Time-stamp-order variant. Only delivered if this federate becomes
    // time-constrained; implemented so enabling time management cannot
    // silently stop attribute updates from arriving.
    @Override
    public void reflectAttributeValues(
            ObjectInstanceHandle theObject,
            AttributeHandleValueMap theAttributes,
            byte[] userSuppliedTag,
            OrderType sentOrdering,
            TransportationTypeHandle theTransport,
            LogicalTime theTime,
            OrderType receivedOrdering,
            SupplementalReflectInfo supplementalReflectInfo)
            throws FederateInternalError {
        reflectAttributeValues(theObject, theAttributes, userSuppliedTag, sentOrdering,
                theTransport, supplementalReflectInfo);
    }

    @Override
    public void reflectAttributeValues(
            ObjectInstanceHandle theObject,
            AttributeHandleValueMap theAttributes,
            byte[] userSuppliedTag,
            OrderType sentOrdering,
            TransportationTypeHandle theTransport,
            LogicalTime theTime,
            OrderType receivedOrdering,
            MessageRetractionHandle retractionHandle,
            SupplementalReflectInfo supplementalReflectInfo)
            throws FederateInternalError {
        reflectAttributeValues(theObject, theAttributes, userSuppliedTag, sentOrdering,
                theTransport, supplementalReflectInfo);
    }

    @Override
    public void removeObjectInstance(
            ObjectInstanceHandle theObject,
            byte[] userSuppliedTag,
            OrderType sentOrdering,
            SupplementalRemoveInfo supplementalRemoveInfo)
            throws FederateInternalError {
        log.debug("Removed entity: {}", theObject);
        store.remove(theObject.toString());
        discoveredClasses.remove(theObject);
        receivedAttributes.remove(theObject);
    }

    @Override
    public void removeObjectInstance(
            ObjectInstanceHandle theObject,
            byte[] userSuppliedTag,
            OrderType sentOrdering,
            LogicalTime theTime,
            OrderType receivedOrdering,
            SupplementalRemoveInfo supplementalRemoveInfo)
            throws FederateInternalError {
        removeObjectInstance(theObject, userSuppliedTag, sentOrdering, supplementalRemoveInfo);
    }

    @Override
    public void removeObjectInstance(
            ObjectInstanceHandle theObject,
            byte[] userSuppliedTag,
            OrderType sentOrdering,
            LogicalTime theTime,
            OrderType receivedOrdering,
            MessageRetractionHandle retractionHandle,
            SupplementalRemoveInfo supplementalRemoveInfo)
            throws FederateInternalError {
        removeObjectInstance(theObject, userSuppliedTag, sentOrdering, supplementalRemoveInfo);
    }

    // -- Interactions -----------------------------------------------------------------
    @Override
    public void receiveInteraction(
            InteractionClassHandle theInteraction,
            ParameterHandleValueMap theParameters,
            byte[] userSuppliedTag,
            OrderType sentOrdering,
            TransportationTypeHandle theTransport,
            SupplementalReceiveInfo supplementalReceiveInfo)
            throws FederateInternalError {
        String interName = interNames.getOrDefault(theInteraction, theInteraction.toString());

        // Counts everything, including classes handled below: "did we
        // receive any of these at all, and when was the last one?" is the
        // first question asked when a report is expected and not seen.
        diagnostics.recordInteractionReceived(interName);

        for (var entry : theParameters.entrySet()) {
            String paramName = paramNames.getOrDefault(entry.getKey(), entry.getKey().toString());
            log.debug(" param {}: {} bytes", paramName, entry.getValue().length);
        }

        // The acknowledgement for anything this bridge tasked: whether the
        // simulator accepted, refused or completed the task, keyed by the
        // taskId returned from the REST tasking endpoints. Different FOM
        // generations name this class and its identifier field differently.
        if (interName.endsWith(".TaskStatusReport") || interName.endsWith(".ETR_TaskStatus")) {
            logTaskStatus(theInteraction, theParameters);
            return;
        }

        // v4 only. Sent by any compliant federate for every entity control
        // action it receives, whether or not it supports it - so silence
        // here means nothing is listening, a different problem from a task
        // being refused.
        if (interName.endsWith(".SMC_Response")) {
            logSmcResponse(theInteraction, theParameters);
            return;
        }

        log.info("Received interaction: {}", interName);
    }

    // Time-stamp-order variant, see the note on reflectAttributeValues.
    @Override
    public void receiveInteraction(
            InteractionClassHandle theInteraction,
            ParameterHandleValueMap theParameters,
            byte[] userSuppliedTag,
            OrderType sentOrdering,
            TransportationTypeHandle theTransport,
            LogicalTime theTime,
            OrderType receivedOrdering,
            SupplementalReceiveInfo supplementalReceiveInfo)
            throws FederateInternalError {
        receiveInteraction(theInteraction, theParameters, userSuppliedTag, sentOrdering,
                theTransport, supplementalReceiveInfo);
    }

    @Override
    public void receiveInteraction(
            InteractionClassHandle theInteraction,
            ParameterHandleValueMap theParameters,
            byte[] userSuppliedTag,
            OrderType sentOrdering,
            TransportationTypeHandle theTransport,
            LogicalTime theTime,
            OrderType receivedOrdering,
            MessageRetractionHandle retractionHandle,
            SupplementalReceiveInfo supplementalReceiveInfo)
            throws FederateInternalError {
        receiveInteraction(theInteraction, theParameters, userSuppliedTag, sentOrdering,
                theTransport, supplementalReceiveInfo);
    }

    // The RTI/FedPro session has gone away. Without this the bridge would
    // keep reporting healthy after the connection drops, since nothing else
    // clears the connected flag.
    @Override
    public void connectionLost(String faultDescription) throws FederateInternalError {
        log.error("Connection to the RTI lost: {}", faultDescription);
        store.setConnected(false);
        if (connectionLostHandler != null) {
            connectionLostHandler.run();
        }
    }

    private void logTaskStatus(InteractionClassHandle theInteraction,
                                ParameterHandleValueMap theParameters) {
        // Different FOM generations name the task reference differently;
        // both are tried rather than branching on the class name, since a
        // merged FOM can define either.
        String taskId = firstDecodable(theInteraction, theParameters,
                this::decodeUUID, "TaskId", "Task");
        String status = firstDecodable(theInteraction, theParameters,
                this::decodeTaskStatus, "TaskStatus");

        log.info("Task status: task {} is {}", taskId, status);

        // Attributed to the task if we sent it. An unmatched one means
        // another federate is tasking, which is itself useful to know: the
        // classes work.
        diagnostics.recordAcknowledgement(taskId, "task status: " + status);
    }

    // v4 SMC_Response - {Action (the UniqueId of the action being
    // answered), Status (HLAboolean)}.
    private void logSmcResponse(InteractionClassHandle theInteraction,
                                 ParameterHandleValueMap theParameters) {
        String action = firstDecodable(theInteraction, theParameters,
                this::decodeUUID, "Action");
        String status = firstDecodable(theInteraction, theParameters,
                value -> decodeInt32(value) != 0 ? "accepted" : "rejected/failed", "Status");

        log.info("SMC_Response: action {} was {}", action, status);

        // SMC_Response.Action references the UniqueId of the interaction it
        // answers, which is the id recorded when the task was sent.
        diagnostics.recordAcknowledgement(action, "SMC_Response: " + status);
    }

    // Decodes the first of several candidate parameter names that this FOM
    // defines and the interaction actually carried.
    private String firstDecodable(InteractionClassHandle theInteraction,
                                   ParameterHandleValueMap theParameters,
                                   java.util.function.Function<byte[], String> decoder,
                                   String... parameterNames) {
        for (String parameterName : parameterNames) {
            try {
                byte[] raw = theParameters.get(
                        rtiAmbassador.getParameterHandle(theInteraction, parameterName));
                if (raw != null) {
                    return decoder.apply(raw);
                }
            } catch (Exception e) {
                log.debug("Parameter {} not present here: {}", parameterName, e.getMessage());
            }
        }
        return "?";
    }

    // Reports a MOM federate record. objectsRegistered and updatesSent are
    // the useful ones when entities are missing: a federate registering
    // objects while this bridge discovers nothing means the objects are
    // published as a class we do not subscribe to, whereas zero registered
    // means that federate is not publishing at all.
    private void logMomFederate(AttributeHandleValueMap theAttributes) {
        StringBuilder details = new StringBuilder();

        String name = null;
        String type = null;
        String host = null;
        Integer objectsRegistered = null;
        Integer updatesSent = null;
        List<String> fomModules = null;

        for (var entry : theAttributes.entrySet()) {
            String attrName = attrNames.getOrDefault(entry.getKey(), "");
            byte[] value = entry.getValue();
            try {
                switch (attrName) {
                    case "HLAfederateName" -> {
                        name = decodeUnicodeString(value);
                        details.append(" name='").append(name).append('\'');
                    }
                    case "HLAfederateType" -> {
                        type = decodeUnicodeString(value);
                        details.append(" type='").append(type).append('\'');
                    }
                    case "HLAfederateHost" -> {
                        host = decodeUnicodeString(value);
                        details.append(" host='").append(host).append('\'');
                    }
                    case "HLAFOMmoduleDesignatorList" -> {
                        fomModules = decodeStringArray(value);
                        details.append(" fomModules=").append(fomModules);
                    }
                    case "HLAobjectInstancesRegistered" -> {
                        objectsRegistered = decodeInt32(value);
                        details.append(" objectsRegistered=").append(objectsRegistered);
                    }
                    case "HLAupdatesSent" -> {
                        updatesSent = decodeInt32(value);
                        details.append(" updatesSent=").append(updatesSent);
                    }
                    default -> { }
                }
            } catch (Exception e) {
                log.debug("Could not decode MOM attribute {}: {}", attrName, e.getMessage());
            }
        }

        log.info("Federate:{}", details.length() == 0 ? " (no details reported)" : details);
        diagnostics.recordFederate(name, type, host, objectsRegistered, updatesSent, fomModules);
    }

    // Decodes an HLAvariableArray of HLAunicodeString: a 4-byte element
    // count, then each element as its own 4-byte character count plus
    // UTF-16BE characters, padded to the 4-byte element boundary between entries.
    private java.util.List<String> decodeStringArray(byte[] value) {
        java.util.List<String> out = new java.util.ArrayList<>();
        if (value == null || value.length < 4) return out;
        int count = decodeInt32Raw(value, 0);
        int offset = 4;
        for (int i = 0; i < count && offset + 4 <= value.length; i++) {
            int chars = decodeInt32Raw(value, offset);
            offset += 4;
            int bytes = Math.min(Math.max(chars, 0) * 2, value.length - offset);
            if (bytes < 0) break;
            out.add(new String(value, offset, bytes, java.nio.charset.StandardCharsets.UTF_16BE));
            offset += bytes;
            while (offset % 4 != 0 && offset < value.length) offset++;
        }
        return out;
    }

    // Decodes an HLAunicodeString: 4-byte big-endian character count, then UTF-16BE.
    private String decodeUnicodeString(byte[] value) {
        if (value == null || value.length < 4) return "";
        int chars = decodeInt32Raw(value, 0);
        int bytes = Math.min(chars * 2, value.length - 4);
        if (bytes <= 0) return "";
        return new String(value, 4, bytes, java.nio.charset.StandardCharsets.UTF_16BE);
    }

    // EntityControlActionEnum values, collected from every v4 module that
    // extends it. Note that the enumerator for ChangeRulesOfEngagement is
    // still named SetRulesOfEngagement, since the interaction was renamed
    // in v4 but the enumerator was not.
    private static final Map<Integer, String> ENTITY_CONTROL_ACTIONS = Map.ofEntries(
            Map.entry(10, "MagicMove"),
            Map.entry(18, "Detach"),
            Map.entry(20, "DirectFire"),
            Map.entry(21, "EnterFacility"),
            Map.entry(22, "IndirectFire"),
            Map.entry(24, "FollowEntity"),
            Map.entry(25, "MoveInDirection"),
            Map.entry(26, "MoveIntoFormation"),
            Map.entry(28, "MoveToLocation"),
            Map.entry(29, "MoveByRoute"),
            Map.entry(30, "Attach"),
            Map.entry(31, "Observe"),
            Map.entry(32, "OperateCheckpoint"),
            Map.entry(33, "Patrol"),
            Map.entry(34, "OperateObservationPost"),
            Map.entry(35, "ChangeAltitude"),
            Map.entry(36, "ChangeSpeed"),
            Map.entry(39, "StopAtSideOfRoad"),
            Map.entry(40, "ChangeHeading"),
            Map.entry(41, "ChangeRulesOfEngagement"),
            Map.entry(42, "OtherActivity"),
            Map.entry(100, "Aggregate"),
            Map.entry(101, "Disaggregate"),
            Map.entry(102, "Divide"),
            Map.entry(103, "Merge"),
            Map.entry(200, "DisruptCommunication"),
            Map.entry(201, "SetTransmitterStatus"),
            Map.entry(401, "ClearEngineering"),
            Map.entry(402, "CreateBreach"),
            Map.entry(403, "EstablishCheckpoint"),
            Map.entry(404, "LayMinefield"),
            Map.entry(405, "CreateObstacle"),
            Map.entry(406, "EstablishObservationPost"),
            Map.entry(601, "Resupply"),
            Map.entry(602, "Repair"),
            Map.entry(603, "Transport"),
            Map.entry(604, "Reset"),
            Map.entry(605, "SetSupplies"),
            Map.entry(606, "SetPersonnelStatus"),
            Map.entry(607, "SetEquipmentStatus"));

    // Entities whose SupportedActions have already been logged.
    private final java.util.Set<String> loggedSupportedActions =
            java.util.Collections.synchronizedSet(new java.util.HashSet<>());

    // Reports a v4 entity's SupportedActions. This is the most useful
    // single line the bridge can log about tasking: NETN-SMC says to check
    // it before sending an entity control action, and it distinguishes
    // "the simulator will not accept this task" from "the task was sent
    // and ignored" without waiting on a response that may never come.
    //
    // Logged once per entity: it is a rarely-changing attribute, and the
    // RTI may re-send it on any update.
    private void logSupportedActions(String id, byte[] value) {
        List<String> actions = decodeEntityControlActions(value);
        diagnostics.recordSupportedActions(id, actions);

        if (!loggedSupportedActions.add(id)) {
            log.debug("Entity {} supports control actions: {}", id, actions);
            return;
        }

        if (actions.isEmpty()) {
            log.warn("Entity {} publishes SupportedActions but the list is EMPTY - its simulator "
                    + "accepts no NETN entity control actions, so it cannot be tasked.", id);
        } else {
            log.info("Entity {} supports control actions: {}", id, actions);
        }
    }

    // Decodes EntityControlActions - an HLAvariableArray of
    // EntityControlActionEnum (HLAinteger32BE): a 4-byte element count
    // followed by 4-byte enumerators. Unknown values are reported
    // numerically rather than dropped, since a federation may extend the
    // enumeration with modules this bridge does not know.
    private List<String> decodeEntityControlActions(byte[] value) {
        List<String> actions = new java.util.ArrayList<>();
        if (value == null || value.length < 4) return actions;
        int count = decodeInt32Raw(value, 0);
        for (int i = 0; i < count && 4 + 4 * i + 4 <= value.length; i++) {
            int code = decodeInt32Raw(value, 4 + 4 * i);
            actions.add(ENTITY_CONTROL_ACTIONS.getOrDefault(code, "action#" + code));
        }
        return actions;
    }

    // TaskStatusEnum32 as defined in the loaded FOM.
    private String decodeTaskStatus(byte[] value) {
        return switch (decodeInt32(value)) {
            case 0 -> "Accepted";
            case 1 -> "Refused";
            case 2 -> "Cancelled";
            case 3 -> "Executing";
            case 4 -> "Completed";
            case 5 -> "Error";
            default -> "unknown";
        };
    }

    // -- Time management -----------------------------------------------------------
    @Override
    public void timeAdvanceGrant(LogicalTime theTime) throws FederateInternalError {
        if (theTime instanceof HLAfloat64Time t) {
            store.setSimTime(t.getValue());
        }
    }

    @Override
    public void timeRegulationEnabled(LogicalTime theFederateTime) throws FederateInternalError {
        log.info("Time regulation enabled at {}", theFederateTime);
    }

    @Override
    public void timeConstrainedEnabled(LogicalTime theFederateTime) throws FederateInternalError {
        log.info("Time constrained enabled at {}", theFederateTime);
    }

    // -- Decoders --------------------------------------------------------------------
    // Decodes the RPR-FOM Spatial attribute.
    //
    // SpatialVariantStruct is a variant record: a 1-byte dead-reckoning
    // discriminant, padding to an 8-byte boundary, then WorldLocation
    // (X/Y/Z, 24 bytes), IsFrozen (1 byte), and Orientation (Psi/Theta/Phi,
    // 12 bytes). Every dead-reckoning alternative shares this prefix and
    // differs only in the velocity/acceleration fields that follow, so the
    // fields wanted here sit at fixed offsets regardless of the algorithm.
    private void decodeSpatial(String id, byte[] value) {
        if (value == null || value.length < 32) {
            log.debug("Spatial attribute too short to decode ({} bytes) for {}",
                    value == null ? 0 : value.length, id);
            return;
        }

        double x = decodeDouble(value, 8);
        double y = decodeDouble(value, 16);
        double z = decodeDouble(value, 24);

        // An all-zero WorldLocation means the publisher has not set a
        // position yet; converting it would report a point at the centre
        // of the Earth.
        if (x == 0.0 && y == 0.0 && z == 0.0) {
            log.debug("Spatial for {} has no position set yet.", id);
            return;
        }

        double[] wgs84 = ecefToWgs84(x, y, z);
        store.updatePosition(id, wgs84[0], wgs84[1], wgs84[2]);

        // Orientation.Psi is the heading, in radians, true north.
        if (value.length >= 40) {
            float psi = Float.intBitsToFloat(decodeInt32Raw(value, 36));
            if (!Float.isNaN(psi) && !Float.isInfinite(psi)) {
                double heading = Math.toDegrees(psi) % 360.0;
                store.updateHeading(id, heading < 0 ? heading + 360.0 : heading);
            }
        }

        // VelocityVector, three float32 ECEF components immediately after
        // the orientation. Only the dead-reckoned alternatives carry it;
        // the static alternative (discriminant 1) ends after the
        // orientation, so the discriminant is checked as well as the length.
        int deadReckoningAlgorithm = value[0] & 0xFF;
        if (deadReckoningAlgorithm != 1 && value.length >= 60) {
            float vx = Float.intBitsToFloat(decodeInt32Raw(value, 48));
            float vy = Float.intBitsToFloat(decodeInt32Raw(value, 52));
            float vz = Float.intBitsToFloat(decodeInt32Raw(value, 56));
            boolean usable = !Float.isNaN(vx) && !Float.isNaN(vy) && !Float.isNaN(vz)
                    && !Float.isInfinite(vx) && !Float.isInfinite(vy) && !Float.isInfinite(vz);
            if (usable) {
                // Magnitude of the geocentric velocity: speed through
                // space, which for a ground unit is ground speed to within
                // the vertical component.
                store.updateSpeed(id, Math.sqrt(
                        (double) vx * vx + (double) vy * vy + (double) vz * vz));
            }
        }
    }

    private String decodeEntityType(byte[] value) {
        if (value.length < 8) return "0.0.0.0.0.0.0";
        int kind = value[0] & 0xFF;
        int domain = value[1] & 0xFF;
        int country = ((value[2] & 0xFF) << 8) | (value[3] & 0xFF);
        int category = value[4] & 0xFF;
        int sub = value[5] & 0xFF;
        int specific = value[6] & 0xFF;
        int extra = value[7] & 0xFF;
        return kind + "." + domain + "." + country + "." + category + "." + sub + "." + specific + "." + extra;
    }

    // Decodes EntityIdentifierStruct - {{SiteID, ApplicationID}, EntityNumber}:
    // six bytes, three big-endian unsigned 16-bit fields, no padding. This
    // is the DIS-side name for an entity, and for a simulator that
    // publishes no NETN UniqueId it is the only name there is.
    //
    // A short or absent value is ignored rather than defaulted: an all-zero
    // identifier looks legal but would silently address nothing.
    private void decodeEntityIdentifier(String id, byte[] value) {
        if (value == null || value.length < 6) {
            log.debug("EntityIdentifier for {} was {} bytes, expected 6 - ignoring.",
                    id, value == null ? 0 : value.length);
            return;
        }
        int site = decodeUint16(value, 0);
        int app = decodeUint16(value, 2);
        int number = decodeUint16(value, 4);
        store.updateEntityIdentifier(id, site, app, number);
    }

    private int decodeUint16(byte[] b, int offset) {
        return ((b[offset] & 0xFF) << 8) | (b[offset + 1] & 0xFF);
    }

    private String decodeMarking(byte[] value) {
        if (value.length < 2) return "";
        int len = Math.min(11, value.length - 1);
        return new String(value, 1, len).trim().replace("\0", "");
    }

    private String decodeString(byte[] value) {
        if (value == null || value.length == 0) return "";
        int len = value.length;
        for (int i = 0; i < value.length; i++) {
            if (value[i] == 0) { len = i; break; }
        }
        return new String(value, 0, len, java.nio.charset.StandardCharsets.UTF_8).trim();
    }

    private String decodeDamageState(byte[] value) {
        if (value.length < 4) return "unknown";
        return switch (decodeInt32Raw(value, 0)) {
            case 0 -> "no_damage";
            case 1 -> "slight_damage";
            case 2 -> "moderate_damage";
            case 3 -> "destroyed";
            default -> "unknown";
        };
    }

    private String decodeForce(byte[] value) {
        if (value.length < 1) return "unknown";
        return switch (value[0] & 0xFF) {
            case 1 -> "friendly";
            case 2 -> "opposing";
            case 3 -> "neutral";
            default -> "other";
        };
    }

    private String decodeAggregateState(byte[] value) {
        if (value.length < 1) return "unknown";
        return switch (value[0] & 0xFF) {
            case 1 -> "aggregated";
            case 2 -> "disaggregated";
            case 3 -> "fully_disaggregated";
            case 4 -> "pseudo_disaggregated";
            default -> "unknown";
        };
    }

    private int decodeInt32(byte[] value) {
        if (value.length < 4) return 0;
        return decodeInt32Raw(value, 0);
    }

    private int decodeInt32Raw(byte[] b, int offset) {
        return ((b[offset] & 0xFF) << 24)
                | ((b[offset + 1] & 0xFF) << 16)
                | ((b[offset + 2] & 0xFF) << 8)
                | (b[offset + 3] & 0xFF);
    }

    private boolean decodeBoolean(byte[] value) {
        return value.length > 0 && value[0] != 0;
    }

    private String decodeUUID(byte[] value) {
        if (value.length < 16) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 16; i++) {
            if (i == 4 || i == 6 || i == 8 || i == 10) sb.append('-');
            sb.append(String.format("%02x", value[i] & 0xFF));
        }
        return sb.toString();
    }

    private double decodeDouble(byte[] b, int offset) {
        long bits = 0;
        for (int i = 0; i < 8; i++)
            bits = (bits << 8) | (b[offset + i] & 0xFF);
        return Double.longBitsToDouble(bits);
    }

    private double[] ecefToWgs84(double x, double y, double z) {
        double a = 6378137.0;
        double e2 = 6.6943799901377997e-3;
        double lon = Math.toDegrees(Math.atan2(y, x));
        double p = Math.sqrt(x * x + y * y);
        double lat = Math.toDegrees(Math.atan2(z, p * (1 - e2)));
        for (int i = 0; i < 5; i++) {
            double sinLat = Math.sin(Math.toRadians(lat));
            double N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
            lat = Math.toDegrees(Math.atan2(z + e2 * N * sinLat, p));
        }
        double sinLat = Math.sin(Math.toRadians(lat));
        double N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
        double alt = p / Math.cos(Math.toRadians(lat)) - N;
        return new double[]{lat, lon, alt};
    }
}