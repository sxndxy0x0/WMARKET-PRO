package com.example.pricesync.parser;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/** Regression guard: identity must be generic, not a hard-coded item-family allowlist. */
public class GuiParserVariantIdentitySourceTest {
    @Test
    void variantIdentityDoesNotDependOnHardCodedSensitiveItemIds() throws Exception {
        String source = Files.readString(Path.of("src/main/java/com/example/pricesync/parser/GuiParser.java"));
        assertFalse(source.contains("VARIANT_SENSITIVE_IDS"));
        assertTrue(source.contains("stack.getComponentsPatch()"));
        assertTrue(source.contains("entry.getKey()"));
        assertTrue(source.contains("entry.getValue()"));
    }

    @Test
    void volatilePriceLoreIsExcludedFromIdentity() throws Exception {
        String source = Files.readString(Path.of("src/main/java/com/example/pricesync/parser/GuiParser.java"));
        assertTrue(source.contains("isVolatilePriceLine"));
        assertTrue(source.contains("ราคาต่อชิ้น"));
        assertTrue(source.contains("สุ่มราคาใหม่"));
    }

    @Test
    void pageFingerprintCanIgnoreVolatileLoreThroughPublicHelper() {
        assertTrue(GuiParser.isVolatileIdentityLine("ขายแล้ว 1/100m"));
        assertTrue(GuiParser.isVolatileIdentityLine("สุ่มราคาใหม่อีก: 12h 45m"));
        assertTrue(!GuiParser.isVolatileIdentityLine("Lure II"));
    }

}
