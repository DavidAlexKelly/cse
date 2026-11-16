package com.decho.cse.bridge;

import com.decho.cse.bridge.model.request.BgwsControlRequest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class BgwsControlTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static JsonNode json(String text) throws Exception {
        return JSON.readTree(text);
    }

    // Deserialised the way Spring does it, so object-or-string is tested
    // through the same path a real request takes.
    private static BgwsControlRequest body(String text) throws Exception {
        return JSON.readValue(text, BgwsControlRequest.class);
    }

    @Test
    void loadSerialisesAnObjectScenarioCompactly() throws Exception {
        BgwsControl.Message m = BgwsControl.from(body(
                "{\"command\": \"load\", \"requestId\": \"abc\", \"federate\": \" BGWS-1-1 \","
                        + " \"scenario\": {\"format\": \"bgws.foundry\", \"version\": 1, \"units\": []},"
                        + " \"options\": {\"speed\": 2.0}}"));
        assertEquals("load", m.command());
        assertEquals("abc", m.requestId());
        assertEquals("BGWS-1-1", m.federate());
        assertEquals("{\"format\":\"bgws.foundry\",\"version\":1,\"units\":[]}", m.scenario());
        assertEquals("{\"speed\":2.0}", m.options());
    }

    @Test
    void loadAcceptsScenarioAndOptionsAsJsonText() throws Exception {
        BgwsControl.Message m = BgwsControl.from(new BgwsControlRequest(null, "LOAD", null,
                JSON.getNodeFactory().textNode("{ \"format\" : \"bgws.scenario\",\n \"version\": 4 }"),
                JSON.getNodeFactory().textNode("{\"speed\": 1}")));
        assertEquals("load", m.command(), "commands are case-insensitive");
        assertEquals("{\"format\":\"bgws.scenario\",\"version\":4}", m.scenario());
        assertEquals("{\"speed\":1}", m.options());
        assertEquals("", m.federate(), "no federate is every BGWS federate");
    }

    @Test
    void requestIdIsGeneratedWhenAbsent() throws Exception {
        BgwsControl.Message m = BgwsControl.from(body("{\"command\": \"start\", \"requestId\": \" \"}"));
        assertDoesNotThrow(() -> UUID.fromString(m.requestId()));
        assertEquals("", m.scenario());
        assertEquals("{}", m.options(), "absent options are an empty object, never blank text");
    }

    @Test
    void scenarioIsDroppedFromCommandsOtherThanLoad() throws Exception {
        BgwsControl.Message m = BgwsControl.from(new BgwsControlRequest(
                "", "pause", "r", json("{\"format\": \"bgws.foundry\"}"), null));
        assertEquals("", m.scenario());
    }

    @Test
    void refusesWhatBgwsCouldOnlyMisread() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> BgwsControl.from(null));
        assertThrows(IllegalArgumentException.class,
                () -> BgwsControl.from(body("{\"command\": \"rewind\"}")));
        assertThrows(IllegalArgumentException.class,
                () -> BgwsControl.from(body("{}")));
        assertThrows(IllegalArgumentException.class,
                () -> BgwsControl.from(body("{\"command\": \"load\"}")), "load without a scenario");
        assertThrows(IllegalArgumentException.class,
                () -> BgwsControl.from(body("{\"command\": \"load\", \"scenario\": null}")));
        assertThrows(IllegalArgumentException.class,
                () -> BgwsControl.from(body("{\"command\": \"load\", \"scenario\": \"not json\"}")));
        assertThrows(IllegalArgumentException.class,
                () -> BgwsControl.from(body("{\"command\": \"load\", \"scenario\": [1, 2]}")),
                "a scenario is an object");
        assertThrows(IllegalArgumentException.class,
                () -> BgwsControl.from(body("{\"command\": \"start\", \"options\": 3}")));
    }

    @Test
    void speedNeedsAPositiveSpeed() throws Exception {
        assertThrows(IllegalArgumentException.class,
                () -> BgwsControl.from(body("{\"command\": \"speed\"}")));
        assertThrows(IllegalArgumentException.class,
                () -> BgwsControl.from(body("{\"command\": \"speed\", \"options\": {\"speed\": 0}}")));
        assertThrows(IllegalArgumentException.class,
                () -> BgwsControl.from(body("{\"command\": \"speed\", \"options\": {\"speed\": \"fast\"}}")));
        assertEquals("{\"speed\":4.0}", BgwsControl.from(
                body("{\"command\": \"speed\", \"options\": {\"speed\": 4.0}}")).options());
    }
}
