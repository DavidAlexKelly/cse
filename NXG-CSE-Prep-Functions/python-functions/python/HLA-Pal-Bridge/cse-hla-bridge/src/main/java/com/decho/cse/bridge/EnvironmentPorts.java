[main/java/com/decho/cse/bridge/EnvironmentPorts.java]
package com.decho.cse.bridge;

// Resolves the FedPro/CRC addresses for a given environment number from a
// single CSE_ENVIRONMENT value, following a fixed port pattern where the
// environment digit and an application code together determine the port.
// Every environment shares the same externally exposed firewall host; only
// the port changes between environments.
//
// Explicit FEDPRO_ADDRESS / CRC_ADDRESS env vars take priority over anything
// derived here - this is a convenience for switching environments with one
// value instead of computing exact ports by hand. An override that names only
// a host still gets the environment's port appended, since a portless address
// would otherwise fall through to the FedPro client's built-in default port.
//
// To repoint every environment at a new firewall IP, set FIREWALL_HOST and
// leave FEDPRO_ADDRESS / CRC_ADDRESS unset, so ports stay derived.
final class EnvironmentPorts {

    // Same firewall IP for every environment - only the port differs.
    // Overridable via FIREWALL_HOST so a firewall migration is a config
    // change rather than a rebuild. Default is the current (post-migration)
    // public IP; the pre-migration IP was 4.165.4.53.
    private static final String FIREWALL_HOST =
            System.getenv().getOrDefault("FIREWALL_HOST", "4.223.210.7");

    // Application codes within the per-environment port block 30<env>XX.
    private static final String APP_CRC = "10";
    private static final String APP_FEDPRO_TCP = "20";
    private static final String APP_FEDPRO_TLS = "21";

    private EnvironmentPorts() {}

    // Builds the externally exposed port for one application in one
    // environment, e.g. environment 5 + FedPro TCP -> 30520.
    private static String port(int env, String appCode) {
        return "30" + env + appCode;
    }

    // True when the value already carries an explicit ":port".
    // Host-only values are the common mistake: an operator repointing the
    // bridge at a new firewall IP naturally writes just the IP, and without
    // a port the FedPro client silently falls back to its built-in default
    // (15164), which is not exposed here - so the probes pass against the
    // right port while the connection is attempted against the wrong one.
    private static boolean hasPort(String value) {
        int separator = value.lastIndexOf(':');
        if (separator < 0 || separator == value.length() - 1) {
            return false;
        }
        return value.substring(separator + 1).chars().allMatch(Character::isDigit);
    }

    static String resolveFedproAddress(String cseEnvironment, String protocol, String explicitOverride) {
        // A complete override needs nothing from the environment number, so
        // it is honoured without parsing one - an operator pinning an exact
        // address shouldn't also have to hold CSE_ENVIRONMENT valid.
        if (explicitOverride != null && !explicitOverride.isBlank() && hasPort(explicitOverride.trim())) {
            return explicitOverride.trim();
        }
        int env = parseEnvironmentNumber(cseEnvironment);
        String appCode = "tls".equalsIgnoreCase(protocol) ? APP_FEDPRO_TLS : APP_FEDPRO_TCP;
        if (explicitOverride != null && !explicitOverride.isBlank()) {
            // A host-only override still means "use this host", so keep the
            // host and supply the environment's port rather than handing a
            // portless address to the FedPro client.
            return explicitOverride.trim() + ":" + port(env, appCode);
        }
        return FIREWALL_HOST + ":" + port(env, appCode);
    }

    // The candidate meaning "send no crcHost/crcPort at all", leaving the
    // FedPro server to reach the CRC on whatever address it was configured with.
    static final String DEFAULT_CRC = "default";

    // The CRC addresses to try, in order, as a comma-separated list.
    //
    // The CRC's advertised address is not stable in this deployment: with a
    // network booster enabled the CRC advertises a different host and port
    // than when reached directly, and connecting against the wrong one
    // fails in a way indistinguishable from the CRC being down. Trying each
    // candidate and reporting which one answered turns that ambiguity into
    // a log line.
    //
    // DEFAULT_CRC is tried first because it is what works when the CRC is
    // directly reachable. Explicit CRC_ADDRESS entries, if given, are tried
    // before the derived candidates, which are always appended so an
    // explicit value never leaves the bridge with no fallback.
    static String resolveCrcAddress(String cseEnvironment, String explicitOverride) {
        int env = parseEnvironmentNumber(cseEnvironment);
        java.util.LinkedHashSet<String> candidates = new java.util.LinkedHashSet<>();

        if (explicitOverride != null && !explicitOverride.isBlank()) {
            for (String candidate : splitCandidates(explicitOverride)) {
                // A host-only CRC candidate would otherwise inherit the
                // in-cluster default port (8989) in buildConnectSettings,
                // which is not what the firewall exposes. Externally the CRC
                // is reachable on the environment's 30<env>10 port.
                candidates.add(
                        DEFAULT_CRC.equals(candidate) || hasPort(candidate)
                                ? candidate
                                : candidate + ":" + port(env, APP_CRC));
            }
        }

        candidates.add(DEFAULT_CRC);
        // Booster mode: the CRC's advertised host changes to the booster's,
        // which listens on a different port than the CRC itself.
        candidates.add(String.format(
                "pitch-booster.cse-prep-simulation-%02d.svc.cluster.local:8688", env));
        // The CRC's own in-cluster service address, fully qualified and short.
        candidates.add(String.format(
                "pitch-rti.cse-prep-simulation-%02d.svc.cluster.local:8989", env));
        candidates.add("pitch-rti:8989");

        return String.join(",", candidates);
    }

    // Splits a comma-separated candidate list, trimming blanks.
    static java.util.List<String> splitCandidates(String value) {
        java.util.List<String> out = new java.util.ArrayList<>();
        if (value == null) {
            return out;
        }
        for (String part : value.split(",")) {
            String trimmed = part.trim();
            if (!trimmed.isEmpty() && !out.contains(trimmed)) {
                out.add(trimmed);
            }
        }
        return out;
    }

    static int parseEnvironmentNumber(String cseEnvironment) {
        try {
            int n = Integer.parseInt(cseEnvironment.trim());
            if (n < 1 || n > 9) {
                throw new NumberFormatException("out of range: " + n);
            }
            return n;
        } catch (Exception e) {
            // Fails loudly rather than silently falling back to a default
            // environment, since a broken value should be obvious at startup.
            throw new IllegalArgumentException(
                    "CSE_ENVIRONMENT must be a single digit 1-9 - got: '" + cseEnvironment + "'", e);
        }
    }
}