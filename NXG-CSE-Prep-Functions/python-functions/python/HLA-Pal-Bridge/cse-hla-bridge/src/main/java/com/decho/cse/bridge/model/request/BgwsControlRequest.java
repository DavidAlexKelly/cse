package com.decho.cse.bridge.model.request;

import com.fasterxml.jackson.databind.JsonNode;

// Body of POST /bgws/control: one command to a BGWS simulation waiting in
// the federation (`bgws federate`), sent as a BGWS_Control interaction.
//
// federate: the BGWS federate name to address, e.g. "BGWS-1-1"; null or
// empty addresses every BGWS simulation in the federation
// command: "load", "start", "pause", "resume", "stop" or "speed"
// requestId: the caller's id, echoed back in the federate.status events
// that answer it; generated when absent. The command stream passes its
// command_id, so an answer can be found on the outcome stream by the same id
// scenario: load only; the scenario (format "bgws.foundry" v1, or a full
// "bgws.scenario" v4) as a JSON object, or as JSON text already serialised
// options: a JSON object (or its text), e.g. {"speed": 2.0} - simulated
// seconds per wall-clock second; "speed" needs it
//
// scenario and options are JsonNode rather than String so a caller may send
// either form: an object straight from a frontend, or the text a stream
// column carries. The interaction parameter is HLAunicodeString either way.
public record BgwsControlRequest(
        String federate,
        String command,
        String requestId,
        JsonNode scenario,
        JsonNode options
) {}
