package com.decho.cse.bridge;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

// What happened in the federation, in the order this bridge heard it: fire
// and detonations from any simulator (RPR WeaponFire, MunitionDetonation)
// and every event a BGWS simulation logs (BGWS_Event). A bounded buffer
// numbered from 1; a reader asks for everything after the last number it
// has (GET /events?after=N), so a poll that misses a beat loses nothing
// unless the buffer has since overflowed - which `dropped` reports, rather
// than leaving a silent gap.
//
// Written by RTI callback threads, read by REST threads: every method is
// synchronized, and readers get copies.
public class EventLog {

    private final int capacity;
    private final Deque<Map<String, Object>> events = new ArrayDeque<>();
    private long next = 1;
    private long dropped = 0;

    public EventLog(int capacity) {
        this.capacity = Math.max(1, capacity);
    }

    // Numbers and stamps the event, and keeps it. Null values are left out,
    // so an absent fact reads as absent rather than as zero.
    public synchronized long add(Map<String, Object> fields) {
        Map<String, Object> e = new LinkedHashMap<>();
        long seq = next++;
        e.put("seq", seq);
        e.put("receivedAt", System.currentTimeMillis());
        for (var f : fields.entrySet()) {
            Object v = f.getValue();
            if (v == null) continue;
            if (v instanceof Double d && (d.isNaN() || d.isInfinite())) continue;
            if (v instanceof String s && s.isEmpty()) continue;
            e.put(f.getKey(), v);
        }
        events.addLast(e);
        while (events.size() > capacity) {
            events.removeFirst();
            dropped++;
        }
        return seq;
    }

    // Up to `limit` events numbered above `after`, oldest first.
    public synchronized List<Map<String, Object>> after(long after, int limit) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> e : events) {
            if ((long) e.get("seq") > after) {
                out.add(new LinkedHashMap<>(e));
                if (out.size() >= limit) break;
            }
        }
        return out;
    }

    // The number of the newest event (0 before any).
    public synchronized long last() {
        return next - 1;
    }

    // The number of the oldest event still held (0 when empty).
    public synchronized long first() {
        return events.isEmpty() ? 0 : (long) events.peekFirst().get("seq");
    }

    // Events pushed out of the buffer before anyone read them past.
    public synchronized long dropped() {
        return dropped;
    }

    public synchronized int size() {
        return events.size();
    }

    public int capacity() {
        return capacity;
    }
}
