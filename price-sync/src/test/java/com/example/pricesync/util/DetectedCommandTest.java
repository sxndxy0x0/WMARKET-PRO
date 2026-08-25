package com.example.pricesync.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class DetectedCommandTest {
    @Test
    void normalizesDetectedCommandLiteral() {
        assertEquals("/worth", new DetectedCommand("worth").literal());
        assertEquals("/sellmulti", new DetectedCommand("sellmulti").literal());
    }

    @Test
    void literalsAreStable() {
        assertEquals("worth", new DetectedCommand("worth").name());
        assertEquals("sellmulti", new DetectedCommand("sellmulti").name());
    }

    @Test
    void preservesServerAdvertisedCaseForSending() {
        assertEquals("/Worth", new DetectedCommand("Worth").literal());
    }
}
