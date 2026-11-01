[main/java/com/decho/cse/bridge/PortProbe.java]
package com.decho.cse.bridge;

import org.slf4j.Logger;
import javax.net.ssl.SNIHostName;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.security.SecureRandom;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.List;

// Optional diagnostic that probes a fixed list of ports for the currently
// configured environment, from wherever this pod actually runs, to get a
// real open/closed map. Probing from this pod's own network position is
// meaningful because it is the actual client attempting to reach the
// firewall/ports; probing from an unrelated machine would only test that
// machine's own egress rules.
//
// Controlled by a configuration flag (default enabled) so it can be turned
// off without a code change.
final class PortProbe {

    private PortProbe() {}

    // App codes are the same across every environment; only the leading
    // environment digit in the port pattern changes. The FedPro UDP port is
    // intentionally omitted, since a plain socket connect is TCP-only.
    private static final int[] APP_CODES = {10, 11, 12, 20, 21, 24, 25};
    private static final String[] TCP_LABELS = {
            "crc", "crc-ui", "crc-registry", "fedpro-tcp", "fedpro-tls", "fedpro-ws", "fedpro-wss"
    };
    private static final int CONNECT_TIMEOUT_MS = 3000;

    static void runAndLog(Logger logger, String host, int environmentNumber, String tlsSniHostname) {
        logger.info("-- Port probe starting for {} (environment {}) --", host, environmentNumber);

        int tlsPort = 0;
        for (int i = 0; i < APP_CODES.length; i++) {
            int port = 30_000 + environmentNumber * 100 + APP_CODES[i];
            if (APP_CODES[i] == 21) {
                tlsPort = port;
            }
            probeTcp(logger, host, port, TCP_LABELS[i]);
        }

        if (tlsPort > 0) {
            probeTls(logger, host, tlsPort, tlsSniHostname);
        }

        logger.info("-- Port probe complete --");
    }

    private static void probeTcp(Logger logger, String host, int port, String label) {
        long start = System.currentTimeMillis();
        // host/port come from fixed internal config and a hardcoded
        // diagnostic port list, never user-supplied input - this is a
        // one-off outbound connectivity probe, not a request proxy.
        InetSocketAddress target = new InetSocketAddress(host, port); // nosemgrep
        try (Socket socket = new Socket()) {
            socket.connect(target, CONNECT_TIMEOUT_MS);
            logger.info("Port probe {}:{} ({}) -> OPEN ({}ms)",
                    host, port, label, System.currentTimeMillis() - start);
        } catch (Exception e) {
            logger.info("Port probe {}:{} ({}) -> {} - {} ({}ms)",
                    host, port, label, e.getClass().getSimpleName(), e.getMessage(),
                    System.currentTimeMillis() - start);
        }
    }

    // TLS handshake probe with SNI, the equivalent of an openssl s_client
    // -servername check.
    private static void probeTls(Logger logger, String host, int port, String sniHostname) {
        long start = System.currentTimeMillis();
        try {
            TrustManager trustAllCerts = new X509TrustManager() {
                public void checkClientTrusted(X509Certificate[] chain, String authType) {}
                public void checkServerTrusted(X509Certificate[] chain, String authType) {}
                public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            };

            // Pins to TLSv1.2/1.3 explicitly, since this is a diagnostic
            // handshake probe rather than a general-purpose client and
            // should not silently allow a downgraded connection.
            SSLContext sslContext = SSLContext.getInstance("TLSv1.3");
            sslContext.init(null, new TrustManager[]{trustAllCerts}, new SecureRandom());

            try (Socket rawSocket = new Socket()) {
                rawSocket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS); // nosemgrep
                SSLSocketFactory factory = sslContext.getSocketFactory();
                try (SSLSocket sslSocket = (SSLSocket) factory.createSocket(rawSocket, host, port, true)) {
                    sslSocket.setEnabledProtocols(new String[]{"TLSv1.2", "TLSv1.3"});
                    if (sniHostname != null && !sniHostname.isBlank()) {
                        SSLParameters params = sslSocket.getSSLParameters();
                        params.setServerNames(List.of(new SNIHostName(sniHostname)));
                        sslSocket.setSSLParameters(params);
                    }
                    sslSocket.setSoTimeout(CONNECT_TIMEOUT_MS);
                    sslSocket.startHandshake();

                    Certificate[] peerCerts = sslSocket.getSession().getPeerCertificates();
                    String subject = (peerCerts.length > 0 && peerCerts[0] instanceof X509Certificate x509)
                            ? x509.getSubjectX500Principal().getName()
                            : "(no cert)";
                    logger.info("TLS probe {}:{} (sni={}) -> HANDSHAKE OK, peer cert subject={} ({}ms)",
                            host, port, sniHostname, subject, System.currentTimeMillis() - start);
                }
            }
        } catch (Exception e) {
            logger.info("TLS probe {}:{} (sni={}) -> {} - {} ({}ms)",
                    host, port, sniHostname, e.getClass().getSimpleName(), e.getMessage(),
                    System.currentTimeMillis() - start);
        }
    }
}