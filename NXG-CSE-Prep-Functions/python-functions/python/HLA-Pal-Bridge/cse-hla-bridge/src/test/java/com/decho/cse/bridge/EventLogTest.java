package com.decho.cse.bridge;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class EventLogTest {

    private static Map<String, Object> event(String kind) {
        Map<String, Object> e = new HashMap<>();
        e.put("kind", kind);
        e.put("latitude", Double.NaN);
        e.put("text", "");
        e.put("target", null);
        return e;
    }

    @Test
    void numbersFromOneAndPagesAfterTheLastSeen() {
        EventLog log = new EventLog(10);
        for (int i = 0; i < 5; i++) log.add(event("k" + i));
        assertEquals(5, log.last());
        List<Map<String, Object>> page = log.after(2, 2);
        assertEquals(2, page.size());
        assertEquals(3L, page.get(0).get("seq"));
        assertEquals("k2", page.get(0).get("kind"));
        assertTrue(log.after(5, 10).isEmpty());
    }

    @Test
    void absentValuesAreLeftOutNotZeroed() {
        EventLog log = new EventLog(10);
        log.add(event("fire.hit"));
        Map<String, Object> e = log.after(0, 1).get(0);
        assertFalse(e.containsKey("latitude"), "NaN is absent, not a number");
        assertFalse(e.containsKey("text"), "an empty string is absent");
        assertFalse(e.containsKey("target"), "null is absent");
        assertTrue(e.containsKey("receivedAt"));
    }

    @Test
    void overflowIsCountedNotSilent() {
        EventLog log = new EventLog(3);
        for (int i = 0; i < 7; i++) log.add(event("k" + i));
        assertEquals(3, log.size());
        assertEquals(4, log.dropped());
        assertEquals(5, log.first());
        assertEquals(7, log.last());
    }
}
