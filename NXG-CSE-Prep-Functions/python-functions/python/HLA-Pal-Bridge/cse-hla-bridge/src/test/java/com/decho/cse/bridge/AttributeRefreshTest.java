[test/java/com/decho/cse/bridge/AttributeRefreshTest.java]
package com.decho.cse.bridge;

import hla.rti1516e.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

// Verifies that the periodic attribute refresh asks only about what is
// still missing.
//
// This matters because the FedPro client's default synchronous update mode
// makes every attribute request a blocking round trip to the CRC. Asking
// about every discovered object on every cycle, rather than only the
// incomplete ones, can saturate the connection to the point where the
// federate stops answering the CRC's heartbeat and gets ejected. None of
// that produces an error the bridge itself can see, which is why it is
// asserted here instead.
class AttributeRefreshTest {

    // A plain Set that satisfies the RTI's AttributeHandleSet interface.
    static class TestAttributeSet extends HashSet<AttributeHandle>
            implements AttributeHandleSet, Serializable {
        @Override public AttributeHandleSet clone() {
            TestAttributeSet copy = new TestAttributeSet();
            copy.addAll(this);
            return copy;
        }
    }

    // Likewise for the reflection payload; only the key set matters here.
    static class TestValueMap extends LinkedHashMap<AttributeHandle, byte[]>
            implements AttributeHandleValueMap, Serializable {
        @Override public hla.rti1516e.encoding.ByteWrapper getValueReference(AttributeHandle h) {
            return null;
        }
        @Override public hla.rti1516e.encoding.ByteWrapper getValueReference(
                AttributeHandle h, hla.rti1516e.encoding.ByteWrapper w) {
            return null;
        }
    }

    private RTIambassador rti;
    private FederationAmbassador ambassador;
    private ObjectClassHandle aircraft;
    private AttributeHandle spatial, marking, entityType;
    private final List<ObjectInstanceHandle> asked = new ArrayList<>();

    @BeforeEach
    void setUp() throws Exception {
        rti = mock(RTIambassador.class);
        aircraft = mock(ObjectClassHandle.class);
        spatial = mock(AttributeHandle.class);
        marking = mock(AttributeHandle.class);
        entityType = mock(AttributeHandle.class);

        AttributeHandleSetFactory factory = mock(AttributeHandleSetFactory.class);
        when(factory.create()).thenAnswer(i -> new TestAttributeSet());
        when(rti.getAttributeHandleSetFactory()).thenReturn(factory);

        asked.clear();
        doAnswer(invocation -> {
            asked.add(invocation.getArgument(0));
            return null;
        }).when(rti).requestAttributeValueUpdate(
                any(ObjectInstanceHandle.class), any(AttributeHandleSet.class), any());

        ambassador = new FederationAmbassador(rti, new EntityStateStore());

        TestAttributeSet subscribed = new TestAttributeSet();
        subscribed.add(spatial);
        subscribed.add(marking);
        subscribed.add(entityType);
        ambassador.registerSubscribedAttributes(aircraft, subscribed);
    }

    private ObjectInstanceHandle discover(String name) throws Exception {
        ObjectInstanceHandle instance = mock(ObjectInstanceHandle.class);
        when(instance.toString()).thenReturn(name);
        ambassador.discoverObjectInstance(instance, aircraft, name);
        return instance;
    }

    // Discards the request discovery itself issues, so a test can assert
    // about the periodic refresh alone. Discovery asking once is pinned
    // separately by discoveryAsksOnceOnItsOwn(); it is only noise elsewhere.
    private void ignoreDiscoveryRequests() {
        asked.clear();
        clearInvocations(rti);
    }

    private void reflect(ObjectInstanceHandle instance, AttributeHandle... attributes) throws Exception {
        TestValueMap values = new TestValueMap();
        for (AttributeHandle attribute : attributes) {
            values.put(attribute, new byte[]{0});
        }
        ambassador.reflectAttributeValues(instance, values, null, OrderType.RECEIVE,
                mock(TransportationTypeHandle.class), null);
    }

    @Test
    void discoveryAsksOnceOnItsOwn() throws Exception {
        ObjectInstanceHandle instance = discover("HLA1");
        assertEquals(List.of(instance), asked,
                "discovery must ask immediately; waiting a full cycle would leave entities "
                        + "as names with no position for longer than necessary");
    }

    @Test
    void asksForEverythingWhenNothingHasArrivedYet() throws Exception {
        discover("HLA1");
        ignoreDiscoveryRequests();

        FederationAmbassador.RefreshSummary summary = ambassador.requestValuesForAllInstances(0);

        assertEquals(1, summary.asked(), "a silent instance is the case the refresh exists for");
        assertEquals(1, summary.outstanding());
        assertEquals(0, summary.complete());
    }

    @Test
    void stopsAskingOnceEveryAttributeHasArrived() throws Exception {
        ObjectInstanceHandle instance = discover("HLA1");
        reflect(instance, spatial, marking, entityType);
        ignoreDiscoveryRequests();

        FederationAmbassador.RefreshSummary summary = ambassador.requestValuesForAllInstances(0);

        assertEquals(0, summary.asked(),
                "a fully reported instance must cost nothing on every subsequent cycle");
        assertEquals(1, summary.complete());
        assertTrue(asked.isEmpty());
    }

    @Test
    void keepsAskingWhilePartiallyReported() throws Exception {
        ObjectInstanceHandle instance = discover("HLA1");
        reflect(instance, spatial); // Marking and EntityType still missing
        ignoreDiscoveryRequests();

        FederationAmbassador.RefreshSummary summary = ambassador.requestValuesForAllInstances(0);

        assertEquals(1, summary.asked());
        assertEquals(0, summary.complete());
    }

    @Test
    void asksOnlyForTheMissingAttributes() throws Exception {
        ObjectInstanceHandle instance = discover("HLA1");
        reflect(instance, spatial);
        ignoreDiscoveryRequests();

        ambassador.requestValuesForAllInstances(0);

        var captor = org.mockito.ArgumentCaptor.forClass(AttributeHandleSet.class);
        verify(rti).requestAttributeValueUpdate(eq(instance), captor.capture(), any());
        AttributeHandleSet requested = captor.getValue();

        assertFalse(requested.contains(spatial), "already reported, so re-asking is pure cost");
        assertTrue(requested.contains(marking));
        assertTrue(requested.contains(entityType));
    }

    @Test
    void capBoundsOneCycleAndRotatesSoNothingStarves() throws Exception {
        List<ObjectInstanceHandle> fleet = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            fleet.add(discover("HLA" + i));
        }
        ignoreDiscoveryRequests();

        FederationAmbassador.RefreshSummary first = ambassador.requestValuesForAllInstances(4);
        assertEquals(4, first.asked(), "the cap is what keeps a backlog from saturating the LRC");
        assertEquals(10, first.outstanding());
        assertTrue(first.capped());

        List<ObjectInstanceHandle> firstPass = new ArrayList<>(asked);
        asked.clear();

        ambassador.requestValuesForAllInstances(4);
        List<ObjectInstanceHandle> secondPass = new ArrayList<>(asked);

        assertEquals(4, secondPass.size());
        assertTrue(java.util.Collections.disjoint(firstPass, secondPass),
                "a cap that re-asked the same head every cycle would never reach the tail");
    }

    @Test
    void forgetsInstancesThatAreRemoved() throws Exception {
        ObjectInstanceHandle instance = discover("HLA1");
        reflect(instance, spatial, marking, entityType);
        ignoreDiscoveryRequests();

        assertEquals(1, ambassador.requestValuesForAllInstances(0).complete());

        ambassador.removeObjectInstance(instance, null, OrderType.RECEIVE, null);

        FederationAmbassador.RefreshSummary summary = ambassador.requestValuesForAllInstances(0);
        assertEquals(0, summary.complete());
        assertEquals(0, summary.outstanding());
    }
}