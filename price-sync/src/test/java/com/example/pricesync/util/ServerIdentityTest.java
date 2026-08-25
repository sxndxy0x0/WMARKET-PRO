package com.example.pricesync.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ServerIdentityTest {

    @Test
    void normalizesHostnameCaseTrailingDotAndDefaultPort() {
        assertEquals("play.siam.example:25565", ServerIdentity.normalize("PLAY.SIAM.EXAMPLE."));
        assertEquals("play.siam.example:25565", ServerIdentity.normalize("Play.Siam.Example:25565"));
    }

    @Test
    void preservesNonDefaultPort() {
        assertEquals("play.siam.example:25566", ServerIdentity.normalize("Play.Siam.Example:25566"));
    }

    @Test
    void normalizesBracketedIpv6() {
        assertEquals("[2001:db8::1]:25565", ServerIdentity.normalize("[2001:DB8::1]"));
        assertEquals("[2001:db8::1]:25566", ServerIdentity.normalize("[2001:DB8::1]:25566"));
    }

    @Test
    void canonicalizesUnbracketedIpv6() {
        assertEquals("[2001:db8::1]:25565", ServerIdentity.normalize("2001:DB8::1"));
    }

    @Test
    void rejectsMalformedAddresses() {
        assertNull(ServerIdentity.normalize(null));
        assertNull(ServerIdentity.normalize("   "));
        assertNull(ServerIdentity.normalize("example.com:notaport"));
        assertNull(ServerIdentity.normalize("example.com:0"));
        assertNull(ServerIdentity.normalize("example.com:65536"));
        assertNull(ServerIdentity.normalize("[2001:db8::1"));
        assertNull(ServerIdentity.normalize("example.com/path"));
        assertNull(ServerIdentity.normalize("example.com\\path"));
        assertNull(ServerIdentity.normalize("example.com:25565/path"));
        assertNull(ServerIdentity.normalize("example.com 25565"));
        assertNull(ServerIdentity.normalize("https://user:pass@example.com"));
        assertNull(ServerIdentity.normalize("[2001:db8::not-an-ip]"));
        assertNull(ServerIdentity.normalize("2001:db8::zzzz"));
        assertNull(ServerIdentity.normalize("192.0.2.1::1"));
        assertEquals("[2001:db8::192.0.2.1]:25565", ServerIdentity.normalize("[2001:db8::192.0.2.1]"));
        assertNull(ServerIdentity.normalize("[2001:db8:192.0.2.1::1]"));
        assertNull(ServerIdentity.normalize("[2001:db8::192.0.2.999]"));
        assertNull(ServerIdentity.normalize("[2001:db8:::1]"));
    }
    @Test
    void sourceNormalizesUnicodeHostnames() throws Exception {
        String source = java.nio.file.Files.readString(java.nio.file.Path.of("src/main/java/com/example/pricesync/util/ServerIdentity.java"));
        assertTrue(source.contains("Normalizer.normalize(host, Normalizer.Form.NFC)"));
    }

}

