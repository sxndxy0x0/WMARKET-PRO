package com.example.pricesync.util;

import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;

import java.text.Normalizer;
import java.util.Locale;

/**
 * Stable identity for the multiplayer server the client is actually connected to.
 *
 * We deliberately do NOT use ServerData.name: that is only the player's local
 * multiplayer-list label and can be different on two clients. The connection
 * address is the only client-side value available here that is not user-facing
 * display text. Hostnames are normalized and the default Minecraft port is
 * canonicalized so example.com and example.com:25565 cannot split the data.
 */
public final class ServerIdentity {

    public static final int DEFAULT_PORT = 25565;

    private ServerIdentity() {}

    /** Must be called on the Minecraft client thread. */
    public static String getCurrent() {
        ServerData server = Minecraft.getInstance().getCurrentServer();
        if (server == null) {
            return null;
        }
        return normalize(server.ip);
    }

    /**
     * Canonicalizes a Minecraft server address.
     * Examples:
     *   SIAM.example.       -> siam.example:25565
     *   siam.example:25565  -> siam.example:25565
     *   siam.example:25566  -> siam.example:25566
     *   [2001:db8::1]        -> [2001:db8::1]:25565
     */
    public static String normalize(String raw) {
        if (raw == null) return null;

        String value = raw.trim();
        if (value.isEmpty()) return null;

        // Accept a scheme defensively, although ServerData.ip normally does not
        // contain one. Reject paths/query/fragment rather than silently changing
        // a malformed identity into a different server.
        if (value.contains("://")) {
            try {
                java.net.URI uri = java.net.URI.create(value);
                if (uri.getHost() == null || uri.getUserInfo() != null
                        || uri.getPath() != null && !uri.getPath().isEmpty()
                        || uri.getQuery() != null || uri.getFragment() != null) {
                    return null;
                }
                value = uri.getHost() + (uri.getPort() >= 0 ? ":" + uri.getPort() : "");
            } catch (IllegalArgumentException e) {
                return null;
            }
        }

        String host;
        int port = DEFAULT_PORT;

        // Bracketed IPv6: [2001:db8::1] or [2001:db8::1]:25565
        if (value.startsWith("[")) {
            int close = value.indexOf(']');
            if (close < 0) return null;
            host = value.substring(1, close);
            String suffix = value.substring(close + 1);
            if (!suffix.isEmpty()) {
                if (!suffix.startsWith(":")) return null;
                port = parsePort(suffix.substring(1));
                if (port < 0) return null;
            }
            if (host.isBlank()) return null;
            host = normalizeHost(host);
            if (host.isBlank() || !isValidIpv6Literal(host)) return null;
            return "[" + host + "]:" + port;
        }

        // Unbracketed IPv6 has multiple ':' characters and therefore has no
        // unambiguous port syntax. Treat it as an IPv6 host using the default port.
        if (count(value, ':') > 1) {
            host = value;
            host = normalizeHost(host);
            if (host.isBlank() || !isValidIpv6Literal(host) || port < 1 || port > 65535) return null;
            // Canonicalize every IPv6 form to bracketed host:port.
            return "[" + host + "]:" + port;
        } else {
            int colon = value.lastIndexOf(':');
            if (colon > 0) {
                host = value.substring(0, colon);
                port = parsePort(value.substring(colon + 1));
                if (port < 0) return null;
            } else {
                host = value;
            }
        }

        host = normalizeHost(host);
        if (host.isBlank() || port < 1 || port > 65535) return null;
        return host + ":" + port;
    }

    private static String normalizeHost(String rawHost) {
        String host = rawHost.trim();
        if (host.isEmpty()) return "";

        // ServerData.ip should normally already be a clean host/address, but
        // validate defensively so malformed input can never create a second
        // cache partition such as "example.com/path" or a host containing
        // whitespace/control characters. IPv6 colons are handled by the caller.
        for (int i = 0; i < host.length(); i++) {
            char c = host.charAt(i);
            if (Character.isWhitespace(c) || Character.isISOControl(c)
                    || c == '/' || c == '\\' || c == '?' || c == '#'
                    || c == '[' || c == ']') {
                return "";
            }
        }

        // Canonicalize Unicode before case-folding so visually identical
        // hostnames such as precomposed and combining-mark forms cannot create
        // separate cache/identity partitions. Minecraft normally supplies ASCII
        // hostnames, but this keeps persisted identity data deterministic.
        host = Normalizer.normalize(host, Normalizer.Form.NFC);
        while (host.endsWith(".") && host.length() > 1) {
            host = host.substring(0, host.length() - 1);
        }
        return host.toLowerCase(Locale.ROOT);
    }

    /**
     * Validates IPv6 syntax without DNS resolution. This prevents malformed
     * values such as "2001:db8::not-an-address" from becoming persistent
     * server identities while still allowing compressed and IPv4-tail forms.
     */
    private static boolean isValidIpv6Literal(String value) {
        if (value == null || value.isBlank() || count(value, ':') < 2) return false;
        int doubleColon = value.indexOf("::");
        // Search from doubleColon + 1 (not + 2) so an overlapping "::" inside a
        // run of three or more consecutive colons (e.g. ":::") is still found.
        if (doubleColon >= 0 && value.indexOf("::", doubleColon + 1) >= 0) return false;

        String[] groups = value.split(":", -1);
        int hextets = 0;
        for (int i = 0; i < groups.length; i++) {
            String group = groups[i];
            if (group.isEmpty()) continue;
            if (group.indexOf('.') >= 0) {
                // An embedded IPv4 form is valid only as the final address
                // component; accepting it earlier would create a malformed
                // identity that merely looks IPv6-like.
                if (i != groups.length - 1 || !isValidIpv4Tail(group)) return false;
                hextets += 2;
                continue;
            }
            if (group.length() > 4) return false;
            for (int j = 0; j < group.length(); j++) {
                char c = group.charAt(j);
                if (Character.digit(c, 16) < 0) return false;
            }
            hextets++;
        }
        return doubleColon >= 0 ? hextets < 8 : hextets == 8;
    }

    private static boolean isValidIpv4Tail(String value) {
        String[] parts = value.split("\\.", -1);
        if (parts.length != 4) return false;
        for (String part : parts) {
            if (part.isEmpty() || part.length() > 3) return false;
            int number = 0;
            for (int i = 0; i < part.length(); i++) {
                char c = part.charAt(i);
                if (c < '0' || c > '9') return false;
                number = number * 10 + (c - '0');
            }
            if (number > 255) return false;
        }
        return true;
    }

    private static int parsePort(String rawPort) {
        if (rawPort == null || rawPort.isBlank()) return -1;
        try {
            return Integer.parseInt(rawPort);
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private static int count(String value, char needle) {
        int result = 0;
        for (int i = 0; i < value.length(); i++) {
            if (value.charAt(i) == needle) result++;
        }
        return result;
    }
}
