[test/java/com/decho/cse/bridge/EnvironmentPortsTest.java]
package com.decho.cse.bridge;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

// Address-resolution regression tests.
//
// These exist because of a specific failure: FEDPRO_ADDRESS was set to a bare
// IP during a firewall migration, the override was returned verbatim, and the
// FedPro client fell back to its built-in default port (15164). The bridge
// probed the correct port, reported it OPEN, and then connected to a different
// one - so the logs looked healthy right up to the join failing. Anything that
// lets a portless address reach the FedPro client should fail here instead.
class EnvironmentPortsTest {

    @Test
    void derivesFedproPortFromEnvironmentAndProtocol() {
        assertEquals("30520", portOf(EnvironmentPorts.resolveFedproAddress("5", "tcp", null)));
        assertEquals("30521", portOf(EnvironmentPorts.resolveFedproAddress("5", "tls", null)));
        assertEquals("30120", portOf(EnvironmentPorts.resolveFedproAddress("1", "tcp", null)));
        assertEquals("30921", portOf(EnvironmentPorts.resolveFedproAddress("9", "TLS", null)));
    }

    @Test
    void hostOnlyFedproOverrideKeepsHostAndGainsEnvironmentPort() {
        // The exact shape of the outage: an operator repoints the bridge at a
        // new firewall IP and writes only the IP.
        assertEquals(
                "4.223.210.7:30520",
                EnvironmentPorts.resolveFedproAddress("5", "tcp", "4.223.210.7"));
        assertEquals(
                "4.223.210.7:30521",
                EnvironmentPorts.resolveFedproAddress("5", "tls", "4.223.210.7"));
        assertEquals(
                "fedpro.example.internal:30320",
                EnvironmentPorts.resolveFedproAddress("3", "tcp", " fedpro.example.internal "));
    }

    @Test
    void explicitFedproPortIsPreserved() {
        assertEquals(
                "4.223.210.7:30599",
                EnvironmentPorts.resolveFedproAddress("5", "tcp", "4.223.210.7:30599"));
        // An explicit port wins even when it contradicts the protocol's
        // derived port - the operator said what they meant.
        assertEquals(
                "4.223.210.7:30520",
                EnvironmentPorts.resolveFedproAddress("5", "tls", "4.223.210.7:30520"));
    }

    @Test
    void resolvedFedproAddressAlwaysCarriesAPort() {
        for (String override : new String[] {null, "", "  ", "4.223.210.7", "4.223.210.7:30520"}) {
            String resolved = EnvironmentPorts.resolveFedproAddress("5", "tcp", override);
            assertTrue(resolved.contains(":"),
                    "resolved address must carry a port, got: " + resolved);
            assertNotEquals("15164", portOf(resolved),
                    "must never resolve to the FedPro library default port");
        }
    }

    @Test
    void hostOnlyCrcOverrideGetsExposedCrcPort() {
        List<String> candidates = EnvironmentPorts.splitCandidates(
                EnvironmentPorts.resolveCrcAddress("5", "4.223.210.7"));

        // 8989 is the in-cluster CRC port and is not what the firewall
        // exposes; externally the CRC is on 30<env>10.
        assertEquals("4.223.210.7:30510", candidates.get(0));
        assertTrue(candidates.contains(EnvironmentPorts.DEFAULT_CRC));
    }

    @Test
    void crcOverrideKeepsExplicitPortsAndTheDefaultCandidate() {
        List<String> candidates = EnvironmentPorts.splitCandidates(
                EnvironmentPorts.resolveCrcAddress("5", "pitch-rti:8989,default"));

        assertEquals("pitch-rti:8989", candidates.get(0));
        assertTrue(candidates.contains(EnvironmentPorts.DEFAULT_CRC));
        // Derived candidates are always appended, so an override never leaves
        // the bridge without a fallback.
        assertTrue(candidates.stream().anyMatch(c -> c.contains("pitch-booster")));
    }

    @Test
    void completeOverrideIsHonouredWithoutAValidEnvironment() {
        // Pinning an exact address shouldn't also require holding
        // CSE_ENVIRONMENT valid, since nothing is derived from it.
        assertEquals(
                "4.223.210.7:30520",
                EnvironmentPorts.resolveFedproAddress("not-a-number", "tcp", "4.223.210.7:30520"));
    }

    @Test
    void rejectsUnusableEnvironmentValues() {
        for (String bad : new String[] {"0", "10", "", "five", "5x"}) {
            assertThrows(IllegalArgumentException.class,
                    () -> EnvironmentPorts.resolveFedproAddress(bad, "tcp", null),
                    "should reject CSE_ENVIRONMENT='" + bad + "'");
        }
    }

    private static String portOf(String address) {
        return address.substring(address.lastIndexOf(':') + 1);
    }
}
