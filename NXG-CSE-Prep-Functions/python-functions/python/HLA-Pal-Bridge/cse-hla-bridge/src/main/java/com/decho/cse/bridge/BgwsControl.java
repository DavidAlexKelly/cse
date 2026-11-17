package com.decho.cse.bridge;

import com.decho.cse.bridge.model.request.BgwsControlRequest;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

// Turns a POST /bgws/control body into the five strings of a BGWS_Control
// interaction, refusing anything BGWS could only misread.
//
// Kept apart from the sending, and free of RTI types, so the rules can be
// unit tested without a federation. Every parameter of BGWS_Control is an
// HLAunicodeString (foms/BGWS-Events.xml), so the scenario and options
// travel as JSON text; this is the one place that decides that text.
//
// What is checked here is only what the wire cannot carry faithfully: an
// unknown command, a load with nothing to load, JSON that is not an object.
// Whether a scenario is a *good* scenario - its format, its units, its
// platforms - is BGWS's call, and it answers with a federate.status event
// in state "error" and a message. Checking the format here as well would
// mean a second copy of a rule that BGWS may relax (it already accepts two
// formats), and the Commander checks it before anything is queued anyway.
public final class BgwsControl {

    // In the order a session uses them, for the error message.
    public static final List<String> COMMANDS =
            List.of("load", "start", "pause", "resume", "stop", "speed");

    private static final ObjectMapper JSON = new ObjectMapper();

    // What goes on the wire, parameter for parameter.
    public record Message(String federate, String command, String requestId,
                          String scenario, String options) {}

    private BgwsControl() {}

    // Throws IllegalArgumentException (HTTP 400) on anything refused.
    public static Message from(BgwsControlRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("A body is required: {\"command\": \"load\", "
                    + "\"scenario\": {...}}.");
        }

        String command = request.command() == null
                ? "" : request.command().trim().toLowerCase(Locale.ROOT);
        if (!COMMANDS.contains(command)) {
            throw new IllegalArgumentException("\"command\" must be one of " + COMMANDS
                    + ", got " + (request.command() == null ? "nothing" : "'" + request.command() + "'")
                    + ".");
        }

        // Only a load carries a scenario. Anything sent with another command
        // is dropped rather than put on the wire, where it would be 50 KB
        // that every BGWS federate decodes and ignores.
        String scenario = "";
        if ("load".equals(command)) {
            if (isAbsent(request.scenario())) {
                throw new IllegalArgumentException("\"load\" needs a \"scenario\": the scenario as a "
                        + "JSON object (format bgws.foundry v1 or bgws.scenario v4), or its text.");
            }
            scenario = objectText(request.scenario(), "scenario");
        }

        // An absent options is sent as {} rather than an empty string, so
        // the parameter is always the JSON object the FOM promises and BGWS
        // never has to special-case blank text.
        String options = isAbsent(request.options()) ? "{}" : objectText(request.options(), "options");
        if ("speed".equals(command)) {
            requirePositiveSpeed(options);
        }

        String requestId = request.requestId() == null || request.requestId().isBlank()
                ? UUID.randomUUID().toString() : request.requestId().trim();
        String federate = request.federate() == null ? "" : request.federate().trim();

        return new Message(federate, command, requestId, scenario, options);
    }

    private static boolean isAbsent(JsonNode node) {
        return node == null || node.isNull() || node.isMissingNode()
                || (node.isTextual() && node.asText().isBlank());
    }

    // The JSON text of an object, whether it arrived as one or as text.
    //
    // Text is parsed rather than passed through, for two reasons. A string
    // that is not JSON would otherwise reach BGWS, which can only answer
    // with an error event the caller may not be watching for; a 400 here is
    // on the outcome stream against the command that caused it. And
    // re-serialising normalises whitespace, so a pretty-printed scenario
    // costs no more on the wire than a compact one.
    static String objectText(JsonNode node, String field) {
        JsonNode value = node;
        if (node.isTextual()) {
            try {
                value = JSON.readTree(node.asText());
            } catch (JsonProcessingException e) {
                throw new IllegalArgumentException("\"" + field + "\" is text but not JSON: "
                        + e.getOriginalMessage());
            }
        }
        if (value == null || !value.isObject()) {
            throw new IllegalArgumentException("\"" + field + "\" must be a JSON object, got "
                    + (value == null ? "nothing" : value.getNodeType().toString().toLowerCase(Locale.ROOT))
                    + ".");
        }
        try {
            return JSON.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            // A tree Jackson has just built always serialises; kept so the
            // contract of this method stays "400 or the text".
            throw new IllegalArgumentException("\"" + field + "\" could not be serialised: "
                    + e.getOriginalMessage());
        }
    }

    // "speed" with no speed would be a command BGWS can only refuse, and
    // a zero or negative one would freeze or reverse a clock that has a
    // pause for the first and no meaning for the second.
    private static void requirePositiveSpeed(String options) {
        JsonNode speed;
        try {
            speed = JSON.readTree(options).get("speed");
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("\"options\" could not be read: " + e.getOriginalMessage());
        }
        if (speed == null || !speed.isNumber() || !(speed.asDouble() > 0)) {
            throw new IllegalArgumentException("\"speed\" needs \"options\": {\"speed\": <simulated "
                    + "seconds per wall-clock second, greater than zero>}, got " + options + ".");
        }
    }
}
