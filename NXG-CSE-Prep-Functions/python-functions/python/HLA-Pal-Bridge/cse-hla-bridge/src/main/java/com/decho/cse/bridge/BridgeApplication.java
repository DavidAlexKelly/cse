[main/java/com/decho/cse/bridge/BridgeApplication.java]
package com.decho.cse.bridge;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.bridge.SLF4JBridgeHandler;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.info.BuildProperties;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

import java.util.logging.Level;
import java.util.logging.LogManager;

// Spring Boot entry point for the CSE HLA Bridge.
//
// Starts the REST API on port 8080 and the BridgeFederate in a virtual
// thread, which connects to the Pitch RTI via FedPro and retries until the
// federation is running.
@SpringBootApplication
public class BridgeApplication {

    private static final Logger log = LoggerFactory.getLogger(BridgeApplication.class);

    public static void main(String[] args) {
        // The FedPro client logs via java.util.logging rather than SLF4J.
        // Bridging JUL into SLF4J/Logback gives application.properties
        // control over its log level and makes its connection/session
        // handling visible in the same place as everything else.
        LogManager.getLogManager().reset();
        SLF4JBridgeHandler.install();

        // Installing the bridge handler alone does not raise the level JUL
        // itself will create records at; without this, fine-grained records
        // never reach the handler.
        java.util.logging.Logger.getLogger("se.pitch.oss.fedpro").setLevel(Level.FINEST);

        SpringApplication.run(BridgeApplication.class, args);
    }

    // The build this jar came from, resolved once at startup and served on
    // GET /status, so it can be checked against the source without reading
    // pod logs.
    @Bean
    public BuildInfo buildInfo(ObjectProvider<BuildProperties> buildProperties) {
        BuildProperties properties = buildProperties.getIfAvailable();
        BuildInfo info = properties == null
                ? new BuildInfo("unknown", "unknown", "unknown")
                : new BuildInfo(
                        properties.getVersion(),
                        properties.get("sha") == null ? "unknown" : properties.get("sha"),
                        properties.getTime() == null ? "unknown" : properties.getTime().toString());

        if (properties == null) {
            log.warn("No build-info.properties on the classpath, so this bridge cannot say which "
                    + "commit it was built from. Builds through the project Docker path always "
                    + "carry one.");
        } else {
            log.info("Build: version={} sha={} builtAt={}", info.version(), info.sha(), info.builtAt());
        }
        return info;
    }

    // Version, commit and build time of the running jar.
    public record BuildInfo(String version, String sha, String builtAt) {}

    @Bean
    public EntityStateStore entityStateStore() {
        return new EntityStateStore();
    }

    @Bean
    public BridgeFederate bridgeFederate(
            EntityStateStore store,
            BridgeDiagnostics diagnostics,
            @Value("${bridge.cse-environment}") String cseEnvironment,
            @Value("${bridge.crc-address}") String crcAddressOverride,
            @Value("${bridge.fedpro-address}") String fedproAddressOverride,
            @Value("${bridge.fedpro-protocol}") String fedproProtocol,
            @Value("${bridge.fedpro-sni-hostname}") String fedproSniHostname,
            @Value("${bridge.lrc-advertised-address}") String lrcAdvertisedAddress,
            @Value("${bridge.fedpro-connect-timeout-seconds}") int fedproConnectTimeoutSeconds,
            @Value("${bridge.federation-name}") String federationName,
            @Value("${bridge.fom-path}") String fomPath,
            @Value("${bridge.mim-path}") String mimPath,
            @Value("${bridge.retry-attempts}") int retryAttempts,
            @Value("${bridge.retry-delay-seconds}") int retryDelay,
            @Value("${bridge.port-probe-enabled}") boolean portProbeEnabled,
            @Value("${bridge.time-management-enabled}") boolean timeManagementEnabled,
            @Value("${bridge.tasker-callsign}") String taskerCallsign,
            @Value("${bridge.tasker-uuid}") String taskerUuid,
            @Value("${bridge.mrm-federate}") String mrmFederate,
            @Value("${bridge.task-dialect}") String taskDialect,
            @Value("${bridge.federate-name}") String federateName,
            @Value("${bridge.mode}") String mode,
            @Value("${bridge.create-federation}") boolean createFederation,
            @Value("${bridge.auto-connect}") boolean autoConnect,
            @Value("${bridge.subscribe-base-entity}") boolean subscribeBaseEntity,
            @Value("${bridge.attribute-refresh-seconds}") int attributeRefreshSeconds,
            @Value("${bridge.attribute-refresh-max-requests}") int attributeRefreshMaxRequests
    ) {
        // CSE_ENVIRONMENT derives both addresses from the environment's port
        // pattern, so one value is enough instead of computing exact ports
        // by hand. Explicit FEDPRO_ADDRESS/CRC_ADDRESS env vars, if set,
        // always win over the derived value.
        String fedproAddress = EnvironmentPorts.resolveFedproAddress(cseEnvironment, fedproProtocol, fedproAddressOverride);
        String crcAddress = EnvironmentPorts.resolveCrcAddress(cseEnvironment, crcAddressOverride);

        // The tasking identity is dialect dependent: one dialect records the
        // Tasker as a callsign string, the other as a UUID reference to the
        // commanding entity. Both are supplied and each dialect uses the one
        // its FOM defines.
        TaskDialect.Identity taskIdentity =
                new TaskDialect.Identity(taskerCallsign, taskerUuid, mrmFederate);

        BridgeFederate federate = new BridgeFederate(
                crcAddress, fedproAddress, fedproProtocol, fedproSniHostname,
                lrcAdvertisedAddress, fedproConnectTimeoutSeconds, federationName, fomPath, mimPath,
                timeManagementEnabled, store, diagnostics, taskIdentity, taskDialect,
                federateName, mode, createFederation, subscribeBaseEntity, attributeRefreshSeconds,
                attributeRefreshMaxRequests
        );

        log.info("Starting HLA bridge - CSE_ENVIRONMENT={} CRC: {} FedPro: {} (protocol={}) Federation: {}",
                cseEnvironment, crcAddress, fedproAddress, fedproProtocol, federationName);

        // The federate name and mode decide what this instance is, and are
        // the first thing worth knowing when two bridges are joined to one
        // federation: which name it took, and whether it can task or only watch.
        log.info("Federate name: {} (a suffix is appended if that name is already in use). "
                        + "Mode: {}.", federateName,
                federate.isMonitorOnly()
                        ? "monitor-only - subscribes to entity state, publishes nothing, tasks nothing"
                        : "full - monitoring and tasking");

        log.info("Tasking dialect preference: {} (the loaded FOM decides when 'auto').",
                taskDialect == null || taskDialect.isBlank() ? "auto" : taskDialect);

        // States whether an absent federation is treated as an error or an
        // invitation to create one, since that policy is worth knowing before
        // the first connection attempt rather than inferred afterwards.
        log.info("Absent federation policy: {}.", createFederation
                ? "CREATE it (BRIDGE_CREATE_FEDERATION=true) - only correct when no simulator is "
                        + "expected to be running, since anyone joining later must merge with our FOM"
                : "wait for it (BRIDGE_CREATE_FEDERATION=false) - the connect attempt fails and is "
                        + "retried until the simulators' own federation exists");

        log.info("Will retry {} times with {}s delay", retryAttempts, retryDelay);

        // States whether this process takes a pRTI licence seat immediately
        // or only when asked, since a deliberately idle bridge and a bridge
        // that cannot find its federation both report connected=false.
        log.info("Startup connection policy: {}.", autoConnect
                ? "CONNECT now (BRIDGE_AUTO_CONNECT=true) - join as soon as the federation exists "
                        + "and hold a seat from then on"
                : "WAIT (BRIDGE_AUTO_CONNECT=false) - serve the REST API and idle the run loop with "
                        + "connected=false, taking no seat until a RECONNECT command arrives");

        // Connect in a background virtual thread so Spring startup is not
        // blocked. The REST API reports connected=false until the
        // federation is up, indefinitely if auto-connect is off.
        Thread.ofVirtual().name("hla-bridge").start(() -> {
            try {
                if (portProbeEnabled) {
                    // Optional startup diagnostic run from this pod's own
                    // network position, the only vantage point that can
                    // meaningfully test connectivity to the firewall/ports.
                    String probeHost = fedproAddress.contains(":")
                            ? fedproAddress.substring(0, fedproAddress.indexOf(':'))
                            : fedproAddress;
                    int envNumber = EnvironmentPorts.parseEnvironmentNumber(cseEnvironment);
                    String probeSni = String.format(
                            "pitch-federate-protocol-server.cse-prep-simulation-%02d.apps.csecluster.cse.local",
                            envNumber);
                    PortProbe.runAndLog(log, probeHost, envNumber, probeSni);
                }

                if (autoConnect) {
                    federate.connectWithRetry(retryAttempts, retryDelay);
                } else {
                    log.info("Auto-connect is off - not joining. The run loop starts idle and no "
                            + "pRTI seat is held. POST /reconnect, or send a RECONNECT command on "
                            + "the command stream, to connect and join.");
                }

                // Started in both cases, deliberately: the loop services
                // requestRejoin(), so skipping it when auto-connect is off
                // would leave a bridge that can never be told to connect.
                federate.run(); // blocks until stopped
            } catch (Exception e) {
                log.error("HLA bridge fatal error: {}", e.getMessage(), e);
                store.setConnected(false);
            }
        });

        return federate;
    }
}