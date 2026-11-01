[main/java/com/decho/cse/bridge/BridgeDiagnostics.java]
package com.decho.cse.bridge;

import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

// Tracks what the bridge knows about its own state, in a form readable over
// HTTP instead of only inferred from logs.
//
// A resolved interaction handle does not mean a federate is listening for it,
// a 200 from the REST layer does not mean a task was accepted, and an absent
// status class means an accepted task cannot be distinguished from an ignored
// one. This class keeps the small amount of state needed to answer "why isn't
// this working?" and assess() turns it into ordered findings.
//
// Everything here is observational: it records what happened and never
// changes bridge behaviour, so a wrong diagnosis cannot break tasking.
// Bounded on purpose - a fixed-size task history and one counter per
// interaction class - because this runs in a memory-constrained container.
@Component
public class BridgeDiagnostics {

    // How many recent tasks to keep, enough for a debugging session.
    private static final int TASK_HISTORY = 50;

    // Severity of a Finding.
    public enum Level { OK, INFO, WARN, ERROR }

    // One conclusion about the current state.
    // summary: what is true.
    // detail: why it matters, or what to do about it.
    public record Finding(String level, String summary, String detail) {}

    // An interaction class the bridge knows about, and what it can do with it.
    // dialect: "v2", "v4" or "rpr".
    // module: the FOM module that defines it, i.e. which modules the
    // federation was created with.
    // resolved: whether the loaded FOM defines it at all.
    public record FomClassStatus(String name, String dialect, String module,
                                  boolean resolved, boolean published, boolean subscribed) {}

    // A task this bridge sent, and anything that came back about it.
    public static final class TaskRecord {
        private final String taskId;
        private final String operation;
        private final String fomClass;
        private final String dialect;
        private final String entity;
        private final String sentAt;
        private final List<String> acknowledgements =
                java.util.Collections.synchronizedList(new ArrayList<>());

        TaskRecord(String taskId, String operation, String fomClass, String dialect,
                   String entity, Instant sentAt) {
            this.taskId = taskId;
            this.operation = operation;
            this.fomClass = fomClass;
            this.dialect = dialect;
            this.entity = entity;
            this.sentAt = sentAt.toString();
        }

        public String getTaskId() { return taskId; }
        public String getOperation() { return operation; }
        public String getFomClass() { return fomClass; }
        public String getDialect() { return dialect; }
        public String getEntity() { return entity; }
        public String getSentAt() { return sentAt; }
        public List<String> getAcknowledgements() { return acknowledgements; }

        // Whether anything answered this task at all.
        public boolean isAcknowledged() { return !acknowledgements.isEmpty(); }
    }

    // A federate joined to this federation, as reported by the RTI's MOM.
    public record FederateRecord(String name, String type, String host,
                                  Integer objectsRegistered, Integer updatesSent,
                                  List<String> fomModules, String lastReportedAt) {}

    // How many of an interaction class arrived, and when the last one did.
    public record InteractionTraffic(String fomClass, long count, String lastReceivedAt) {}

    // The result of trying to subscribe to one object class.
    // subscribed: attribute names this FOM defined and we asked for.
    // missing: attribute names this FOM did not define, skipped silently.
    public record ObjectClassStatus(String name, boolean resolved,
                                     List<String> subscribed, List<String> missing) {}

    // -- State --------------------------------------------------------------
    private final Map<String, FomClassStatus> fomClasses = new ConcurrentHashMap<>();
    private final Map<String, ObjectClassStatus> objectClasses = new ConcurrentHashMap<>();
    private final Deque<TaskRecord> tasks = new ArrayDeque<>();
    private final Map<String, TaskRecord> tasksById = new ConcurrentHashMap<>();
    private final Map<String, AtomicLong> receivedCounts = new ConcurrentHashMap<>();
    private final Map<String, String> receivedLast = new ConcurrentHashMap<>();
    private final Map<String, FederateRecord> federates = new ConcurrentHashMap<>();

    // Entity id to the control actions it advertises. Empty list means it
    // advertises none.
    private final Map<String, List<String>> supportedActions = new ConcurrentHashMap<>();

    private final AtomicLong acknowledgementsReceived = new AtomicLong();
    private final AtomicLong tasksSent = new AtomicLong();

    private volatile String dialectId = "unknown";
    private volatile String dialectName = "unknown";
    private volatile String dialectPreference = "auto";
    private volatile String connectedSince;
    private volatile String lastConnectionError;

    // Identity of the current connection. Two bridges with identical
    // configuration can end up in different federations of the same name -
    // the CRC address is not stable here - so each instance records its own
    // working candidate.
    private volatile String federateName;
    private volatile String crcCandidate;
    private volatile boolean federationCreatedByUs;

    // -- Recording ------------------------------------------------------------

    // Called once per known class after handle resolution.
    void recordFomClass(String name, String dialect, boolean resolved) {
        fomClasses.put(name,
                new FomClassStatus(name, dialect, moduleOf(name), resolved, false, false));
    }

    // Called once per object class after the attempt to subscribe to it.
    void recordObjectClass(String name, boolean resolved,
                            List<String> subscribed, List<String> missing) {
        objectClasses.put(name, new ObjectClassStatus(name, resolved,
                List.copyOf(subscribed), List.copyOf(missing)));
    }

    void recordPublished(String name) {
        fomClasses.computeIfPresent(name, (key, old) -> new FomClassStatus(
                old.name(), old.dialect(), old.module(), old.resolved(), true, old.subscribed()));
    }

    void recordSubscribed(String name) {
        fomClasses.computeIfPresent(name, (key, old) -> new FomClassStatus(
                old.name(), old.dialect(), old.module(), old.resolved(), old.published(), true));
    }

    void recordDialect(String id, String name, String preference) {
        this.dialectId = id;
        this.dialectName = name;
        this.dialectPreference = preference;
    }

    // Records the identity of this connection: the name actually joined
    // under, the CRC candidate that answered, and whether this bridge
    // created the execution. Called once per successful join. These answer
    // "where am I?", which is different from "what can I see?" and has to be
    // settled first: a bridge alone in an execution of its own making looks
    // identical to one with a subscription gap.
    void recordIdentity(String federateName, String crcCandidate, boolean federationCreatedByUs) {
        this.federateName = federateName;
        this.crcCandidate = crcCandidate;
        this.federationCreatedByUs = federationCreatedByUs;
    }

    void recordConnected() {
        this.connectedSince = Instant.now().toString();
        this.lastConnectionError = null;
    }

    void recordConnectionError(String message) {
        this.lastConnectionError = Instant.now() + " - " + message;
    }

    // Called when the bridge sends a task, whether or not anything receives it.
    void recordTaskSent(String taskId, String operation, String fomClass,
                         String dialect, String entity) {
        TaskRecord record =
                new TaskRecord(taskId, operation, fomClass, dialect, entity, Instant.now());
        tasksSent.incrementAndGet();
        synchronized (tasks) {
            tasks.addFirst(record);
            while (tasks.size() > TASK_HISTORY) {
                tasksById.remove(tasks.removeLast().getTaskId());
            }
        }
        tasksById.put(taskId, record);
    }

    // Called for anything referencing a task: a status report or a response
    // interaction. An unmatched acknowledgement is counted but not
    // attributed - it refers to a task issued by another federate, which is
    // still useful to know, since it proves the classes work.
    void recordAcknowledgement(String taskOrActionId, String description) {
        acknowledgementsReceived.incrementAndGet();
        TaskRecord record = taskOrActionId == null ? null : tasksById.get(taskOrActionId);
        if (record != null) {
            record.acknowledgements.add(Instant.now() + " - " + description);
        }
    }

    void recordInteractionReceived(String fomClass) {
        receivedCounts.computeIfAbsent(fomClass, key -> new AtomicLong()).incrementAndGet();
        receivedLast.put(fomClass, Instant.now().toString());
    }

    void recordFederate(String name, String type, String host,
                         Integer objectsRegistered, Integer updatesSent, List<String> fomModules) {
        String key = name == null || name.isBlank() ? "(unnamed)" : name;
        federates.put(key, new FederateRecord(key, type, host, objectsRegistered, updatesSent,
                fomModules == null ? List.of() : List.copyOf(fomModules),
                Instant.now().toString()));
    }

    void recordSupportedActions(String entityId, List<String> actions) {
        supportedActions.put(entityId, List.copyOf(actions));
    }

    // Resets per-connection state on reconnect, so counts and class lists
    // describe the federation currently attached to.
    //
    // Task history is kept deliberately: what was attempted before a
    // reconnect is exactly what a debugging session wants to see.
    void clearConnectionState() {
        fomClasses.clear();
        objectClasses.clear();
        federates.clear();
        supportedActions.clear();
        receivedCounts.clear();
        receivedLast.clear();
        dialectId = "unknown";
        dialectName = "unknown";
        connectedSince = null;
        // Identity belongs to a connection, not the process: a reconnect can
        // land on a different CRC candidate, and reporting the old one would
        // be worse than reporting none.
        federateName = null;
        crcCandidate = null;
        federationCreatedByUs = false;
    }

    // -- Reading --------------------------------------------------------------

    // Object-class subscription results, in FOM class-name order.
    public List<ObjectClassStatus> objectClassStatuses() {
        List<ObjectClassStatus> all = new ArrayList<>(objectClasses.values());
        all.sort(Comparator.comparing(ObjectClassStatus::name));
        return all;
    }

    public List<FomClassStatus> fomClassStatuses() {
        List<FomClassStatus> all = new ArrayList<>(fomClasses.values());
        all.sort(Comparator.comparing(FomClassStatus::dialect)
                .thenComparing(FomClassStatus::module)
                .thenComparing(FomClassStatus::name));
        return all;
    }

    public List<TaskRecord> recentTasks() {
        synchronized (tasks) {
            return new ArrayList<>(tasks);
        }
    }

    public List<FederateRecord> federateRecords() {
        List<FederateRecord> all = new ArrayList<>(federates.values());
        all.sort(Comparator.comparing(FederateRecord::name));
        return all;
    }

    public List<InteractionTraffic> interactionTraffic() {
        List<InteractionTraffic> all = new ArrayList<>();
        receivedCounts.forEach((name, count) ->
                all.add(new InteractionTraffic(name, count.get(), receivedLast.get(name))));
        all.sort(Comparator.comparingLong(InteractionTraffic::count).reversed());
        return all;
    }

    public Optional<List<String>> supportedActionsFor(String entityId) {
        return Optional.ofNullable(supportedActions.get(entityId));
    }

    public long tasksSent() { return tasksSent.get(); }
    public long acknowledgementsReceived() { return acknowledgementsReceived.get(); }
    public String connectedSince() { return connectedSince; }
    public String lastConnectionError() { return lastConnectionError; }

    // The name this bridge joined under, or null before a successful join.
    public String federateName() { return federateName; }

    // The CRC candidate that answered, or null before a successful connect.
    public String crcCandidate() { return crcCandidate; }

    // Whether this bridge created the execution it is joined to.
    public boolean federationCreatedByUs() { return federationCreatedByUs; }

    // Federates known from the RTI's MOM, including this bridge.
    // Zero means the RTI has not reported any yet, not that the federation
    // is empty - MOM attributes are requested once at connect.
    public int federateCount() { return federates.size(); }

    // Whether a MOM record describes this bridge rather than another federate.
    private boolean isUs(FederateRecord record) {
        return federateName != null && federateName.equals(record.name());
    }

    // How long the current connection has been up.
    public String uptime() {
        String since = connectedSince;
        if (since == null) {
            return "not connected";
        }
        try {
            Duration up = Duration.between(Instant.parse(since), Instant.now());
            return up.toHours() + "h " + up.toMinutesPart() + "m " + up.toSecondsPart() + "s";
        } catch (Exception e) {
            return since;
        }
    }

    // -- Assessment -----------------------------------------------------------

    // Turns the state above into ordered findings, most serious first.
    //
    // entitiesWithoutUniqueId: entities discovered with no NETN UniqueId,
    // which therefore cannot be tasked.
    public List<Finding> assess(boolean connected, String federationName,
                                 int entityCount, int entitiesWithoutUniqueId) {
        List<Finding> findings = new ArrayList<>();

        if (!connected) {
            findings.add(new Finding(Level.ERROR.name(), "Not connected to the RTI.",
                    lastConnectionError == null
                            ? "The bridge is retrying. Nothing can be monitored or tasked until it "
                                    + "joins. Check CSE_ENVIRONMENT / FEDPRO_ADDRESS and the egress policy."
                            : "Last error: " + lastConnectionError));
            return findings;
        }

        findings.add(new Finding(Level.OK.name(),
                "Connected to federation '" + federationName + "' for " + uptime() + "."
                        + (federateName == null ? "" : " Joined as '" + federateName + "'"
                        + (crcCandidate == null ? "" : " via CRC candidate '" + crcCandidate + "'")
                        + "."), ""));

        // Checks whether the bridge is in the right federation at all before
        // anything about subscriptions is worth investigating: an entity
        // count of zero has several causes, and the structural ones - an
        // execution of our own making, or one nobody else has joined - are
        // the cheapest to rule out first.
        if (federationCreatedByUs) {
            findings.add(new Finding(Level.ERROR.name(),
                    "This bridge CREATED federation '" + federationName + "' - it was not already "
                            + "running.",
                    "So every other federate is somewhere else, and nothing will ever be discovered "
                            + "here however the subscriptions look. Either the simulators are not running, "
                            + "or this bridge reached a different CRC than they did (candidate '"
                            + crcCandidate + "'). Set BRIDGE_CREATE_FEDERATION=false and the bridge will "
                            + "wait for the real federation instead of standing in for it."));
        }

        long otherFederates = federates.values().stream().filter(record -> !isUs(record)).count();
        if (federates.isEmpty()) {
            findings.add(new Finding(Level.INFO.name(),
                    "The RTI has not reported any federate records yet.",
                    "Not evidence of an empty federation: MOM attributes are requested once at "
                            + "connect, so anything that joined at another moment is simply unreported. "
                            + "POST /diagnostics/refresh-federates, then read /diagnostics/federates."));
        } else if (otherFederates == 0) {
            findings.add(new Finding(Level.ERROR.name(),
                    "This bridge is the ONLY federate in '" + federationName + "'.",
                    "From the RTI's own MOM accounting, so it is not a guess: no simulator is "
                            + "joined to the federation this bridge is attached to. Nothing about "
                            + "subscriptions or the FOM can explain the missing entities, and changing "
                            + "either will not help. Compare CRC candidate ('" + crcCandidate + "'), "
                            + "FEDERATION_NAME and CSE_ENVIRONMENT against a bridge that does see entities."));
        } else {
            findings.add(new Finding(Level.OK.name(),
                    otherFederates + " other federate(s) joined to '" + federationName + "'.",
                    "See /diagnostics/federates for who they are and whether they are publishing."));
        }

        // Tasking dialect.
        if ("none".equals(dialectId) || "unknown".equals(dialectId)) {
            findings.add(new Finding(Level.ERROR.name(),
                    "No NETN tasking dialect is available.",
                    "This FOM defines neither of the known tasking class trees, so every tasking "
                            + "endpoint returns 409. Entities can still be monitored. See /diagnostics/fom "
                            + "for what it does define."));
        } else {
            findings.add(new Finding(Level.OK.name(), "Tasking dialect: " + dialectName + ".",
                    "Detected from the loaded FOM; preference is '" + dialectPreference + "'."));
        }

        // Modules the federation did not load, for the dialect in use only -
        // the other dialect's classes are expected to be absent.
        Map<String, List<String>> missingByModule = new LinkedHashMap<>();
        for (FomClassStatus status : fomClasses.values()) {
            boolean relevant = status.dialect().equals(dialectId) || "rpr".equals(status.dialect());
            if (relevant && !status.resolved()) {
                missingByModule.computeIfAbsent(status.module(), key -> new ArrayList<>())
                        .add(shortName(status.name()));
            }
        }
        missingByModule.forEach((module, classes) -> findings.add(new Finding(Level.WARN.name(),
                module + " is not loaded in this federation.",
                "Endpoints needing these classes return 409: " + classes)));

        // Entities.
        if (entityCount == 0) {
            findings.add(new Finding(Level.WARN.name(), "No entities discovered.",
                    "Either nothing is publishing, or it publishes object classes this bridge does "
                            + "not subscribe to. Compare with /diagnostics/federates: a federate reporting "
                            + "objectsRegistered > 0 while this is empty is a subscription gap on our side, "
                            + "not a publishing problem on theirs."));
        } else {
            findings.add(new Finding(Level.OK.name(),
                    entityCount + " entity(ies) discovered.", ""));
        }

        if (entitiesWithoutUniqueId > 0) {
            findings.add(new Finding(Level.WARN.name(),
                    entitiesWithoutUniqueId + " entity(ies) have no NETN UniqueId.",
                    "NETN tasks address entities by UUID, so these cannot be tasked unless the UUID "
                            + "is passed directly. They are probably published as plain RPR classes rather "
                            + "than NETN classes."));
        }

        // Taskability, from the entities themselves.
        if (supportedActions.isEmpty()) {
            findings.add(new Finding(Level.INFO.name(),
                    "No entity has published SupportedActions.",
                    "v4 entities may advertise which control actions their simulator accepts. "
                            + "v2-era FOMs have no such attribute, so this is expected there. On v4 it "
                            + "means taskability cannot be confirmed in advance - send a task and watch "
                            + "for an acknowledgement."));
        } else {
            supportedActions.forEach((entityId, actions) -> findings.add(actions.isEmpty()
                    ? new Finding(Level.WARN.name(),
                            "Entity " + entityId + " advertises no control actions.",
                            "Its simulator accepts no NETN entity control actions, so it cannot be "
                                    + "tasked whatever the FOM defines - a publisher-only federate as far as "
                                    + "tasking is concerned.")
                    : new Finding(Level.OK.name(),
                            "Entity " + entityId + " accepts: " + actions + ".",
                            "Published by the entity itself via SupportedActions.")));
        }

        // Task acknowledgement.
        long sent = tasksSent.get();
        long acked = acknowledgementsReceived.get();
        boolean feedbackAvailable = fomClasses.values().stream()
                .anyMatch(status -> status.resolved() && isFeedbackClass(status.name()));

        if (sent == 0) {
            findings.add(new Finding(Level.INFO.name(), "No tasks sent yet this session.", ""));
        } else if (acked > 0) {
            findings.add(new Finding(Level.OK.name(),
                    acked + " acknowledgement(s) for " + sent + " task(s) sent.",
                    "See /diagnostics/tasks for which tasks were answered and how."));
        } else if (feedbackAvailable) {
            findings.add(new Finding(Level.WARN.name(),
                    sent + " task(s) sent, none acknowledged.",
                    "The interactions left this bridge but no federate answered. A task status "
                            + "class does exist in this FOM, and a compliant federate must reply "
                            + "to every entity control action - so the likeliest explanation is that "
                            + "nothing subscribes to these task classes. A 200 from the REST layer only "
                            + "means the interaction was sent."));
        } else {
            findings.add(new Finding(Level.WARN.name(),
                    sent + " task(s) sent, and this FOM has no task status class.",
                    "Without a status/response class there is no way to distinguish an accepted "
                            + "task from an ignored one. Judge by observed effect: MagicMove is the "
                            + "clearest test, being an unconditional teleport with no route planning "
                            + "or ROE involved."));
        }

        // Received traffic.
        if (receivedCounts.isEmpty()) {
            findings.add(new Finding(Level.INFO.name(), "No interactions received at all.",
                    "Normal in a quiet scenario - reports and weapon events only appear when "
                            + "something happens. Entity position updates are attribute reflections, "
                            + "counted separately, and are the better sign of a healthy connection."));
        }

        return findings;
    }

    // The classes that tell us whether a task was accepted.
    private static boolean isFeedbackClass(String name) {
        return name.endsWith(".TaskStatusReport")
                || name.endsWith(".ETR_TaskStatus")
                || name.endsWith(".SMC_Response")
                || name.endsWith(".Response");
    }

    // Which FOM module defines a class, derived from its name. Kept here
    // rather than declared per class in each dialect: this is observational
    // metadata for humans, and deriving it means adding a class to a dialect
    // cannot forget to declare it.
    private static String moduleOf(String className) {
        if (className.contains("ETR_Root") || className.contains("ETR_Report")
                || className.contains("ETR_TaskStatus") || className.contains("ETR_SensorEvent")) {
            return "NETN-ETR";
        }
        if (className.contains("MRM_Interaction")) {
            return "NETN-MRM";
        }
        if (className.endsWith("SMC_EntityControl.Aggregate")
                || className.endsWith("SMC_EntityControl.Disaggregate")
                || className.endsWith("SMC_EntityControl.Divide")
                || className.endsWith("SMC_EntityControl.Merge")) {
            return "NETN-MRM";
        }
        if (className.endsWith("Task.CreateObstacle") || className.endsWith("Task.ClearEngineering")) {
            return "NETN-SE";
        }
        if (className.endsWith("Task.DisruptCommunication")) {
            return "NETN-COM";
        }
        if (className.endsWith("SMC_EntityControl.SetSuppliesStatus")) {
            return "NETN-LOG";
        }
        if (className.endsWith("SMC_Response")) {
            return "NETN-SMC";
        }
        if (className.contains("SMC_EntityControl")) {
            return "NETN-ETR";
        }
        return "RPR-FOM";
    }

    private static String shortName(String fomClassName) {
        int lastDot = fomClassName.lastIndexOf('.');
        return lastDot < 0 ? fomClassName : fomClassName.substring(lastDot + 1);
    }
}