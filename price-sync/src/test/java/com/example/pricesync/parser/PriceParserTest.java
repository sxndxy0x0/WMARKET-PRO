package com.example.pricesync.parser;

import com.example.pricesync.util.PriceEntry;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests PriceParser against real lore captured from SiamCraft.net's /worth
 * GUI (see screenshots in the Aug 2026 conversation). No Minecraft classes
 * involved — GuiParser.ParsedItem is a plain record, so these run with
 * plain `./gradlew test`, no game client needed.
 */
class PriceParserTest {

    private final PriceParser parser = new PriceParser();

    @Test
    void rejectsMalformedThousandsGrouping() {
        var item = new GuiParser.ParsedItem("Bad price", "minecraft:diamond", List.of(
                "ราคา: 1,23,4.56"
        ));

        assertTrue(parser.parse(item).isEmpty());
    }

    @Test
    void parsesValidThousandsGroupingAndDecimal() {
        var item = new GuiParser.ParsedItem("Good price", "minecraft:diamond", List.of(
                "ราคา: 1,069.02"
        ));

        var result = parser.parse(item).orElseThrow();
        assertEquals(1069.02, result.sell, 0.0001);
    }

    @Test
    void rejectsSignedPricesInsteadOfSilentlyDroppingTheSign() {
        assertTrue(parser.parse(new GuiParser.ParsedItem("Negative", "minecraft:stone",
                List.of("ราคา: -5.00"))).isEmpty());
        assertTrue(parser.parse(new GuiParser.ParsedItem("PositiveSign", "minecraft:stone",
                List.of("ราคา: +5.00"))).isEmpty());
        assertTrue(parser.parse(new GuiParser.ParsedItem("UnicodeNegative", "minecraft:stone",
                List.of("ราคา: −5.00"))).isEmpty());
    }

    @Test
    void rejectsNonFiniteNumericValues() {
        var item = new GuiParser.ParsedItem("Huge price", "minecraft:diamond", List.of(
                "ราคา: 9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999.99"
        ));

        assertTrue(parser.parse(item).isEmpty());
    }

    @Test
    void parsesRealSpawnerLore() {
        var item = new GuiParser.ParsedItem("spawner", "minecraft:diamond", List.of(
                "ราคาต่อชิ้น: 🪙 1,069.02",
                "ราคาต่อสแตค: 🪙 68,417.28"
        ));

        Optional<PriceEntry> result = parser.parse(item);

        assertTrue(result.isPresent());
        PriceEntry entry = result.get();
        assertEquals("minecraft:diamond", entry.id);
        assertEquals(1069.02, entry.sell, 0.0001);
        assertEquals(68417.28, entry.stackPrice, 0.0001);
        assertEquals(-1, entry.buy); // this server has no separate buy price
    }

    @Test
    void ignoresCategoryButtonsWithNoPriceLore() {
        // e.g. the purple-block / sword / apple category selector column
        var item = new GuiParser.ParsedItem("Blocks", "minecraft:diamond", List.of());

        assertTrue(parser.parse(item).isEmpty());
    }

    @Test
    void ignoresItemsWithUnrelatedLoreOnly() {
        var item = new GuiParser.ParsedItem("Diamond Sword", "minecraft:diamond", List.of(
                "Sharpness V",
                "Unbreaking III"
        ));

        assertTrue(parser.parse(item).isEmpty());
    }

    @Test
    void handlesMissingStackPriceGracefully() {
        // in case some item only ever shows per-unit price
        var item = new GuiParser.ParsedItem("Cobblestone", "minecraft:diamond", List.of(
                "ราคาต่อชิ้น: 🪙 1.00"
        ));

        Optional<PriceEntry> result = parser.parse(item);

        assertTrue(result.isPresent());
        assertEquals(1.00, result.get().sell, 0.0001);
        assertEquals(-1, result.get().stackPrice);
    }
    @Test
    void usesRegistryIdInsteadOfDisplayName() {
        var item = new GuiParser.ParsedItem("เพชร", "minecraft:diamond", List.of("ราคาต่อชิ้น: 10", "ราคาต่อสแตค: 640"));
        var parsed = new PriceParser().parse(item).orElseThrow();
        assertEquals("minecraft:diamond", parsed.id);
        assertEquals("เพชร", parsed.name);
    }

    @Test
    void rejectsMalformedThousandsSeparators() {
        var item = new GuiParser.ParsedItem("Bad", "minecraft:stone", List.of(
                "ราคา: 1,23,4.56"
        ));

        assertTrue(parser.parse(item).isEmpty());
    }

    @Test
    void rejectsNonFiniteNumericOverflow() {
        var item = new GuiParser.ParsedItem("Huge", "minecraft:stone", List.of(
                "ราคา: 9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999"
        ));

        assertTrue(parser.parse(item).isEmpty());
    }

    @Test
    void handlesLargeNumbersWithMultipleCommas() {
        var item = new GuiParser.ParsedItem("Netherite Block", "minecraft:diamond", List.of(
                "ราคาต่อชิ้น: 🪙 1,234,567.89"
        ));

        Optional<PriceEntry> result = parser.parse(item);

        assertTrue(result.isPresent());
        assertEquals(1234567.89, result.get().sell, 0.0001);
    }

    // --- AmoryCraft: bare "ราคา:" instead of ราคาต่อชิ้น/ราคาต่อสแตค ---
    @Test
    void parsesAmoryCraftBarePriceLabel() {
        var item = new GuiParser.ParsedItem("Conduit", "minecraft:conduit", List.of(
                "ราคา: 233.97"
        ));

        Optional<PriceEntry> result = parser.parse(item);

        assertTrue(result.isPresent());
        assertEquals(233.97, result.get().sell, 0.0001);
        assertEquals(-1, result.get().stackPrice);
    }

    // --- 3rd server: "ราคา" with no colon at all, plus an unrelated "ลำดับ #9" line ---
    @Test
    void parsesBarePriceWithNoColonAndIgnoresUnrelatedRankLine() {
        var item = new GuiParser.ParsedItem("Wither Skeleton Skull", "minecraft:wither_skeleton_skull", List.of(
                "ราคา 306.56 $",
                "ลำดับ #9"
        ));

        Optional<PriceEntry> result = parser.parse(item);

        assertTrue(result.isPresent());
        assertEquals(306.56, result.get().sell, 0.0001);
    }

    // --- Guard: ราคาต่อชิ้น/ราคาต่อสแตค must never also trip the bare "ราคา" fallback ---
    // (ราคาต่อชิ้น literally starts with ราคา, so this only works because of the
    // negative lookahead in PLAIN_PRICE_PATTERN.)
    @Test
    void perUnitAndPerStackAreNeverAlsoCaughtByThePlainFallback() {
        var item = new GuiParser.ParsedItem("Elder Guardian Spawn Egg", "minecraft:elder_guardian_spawn_egg", List.of(
                "ราคาต่อชิ้น: 213.4",
                "ราคาต่อสแตค: 13,657.6"
        ));

        Optional<PriceEntry> result = parser.parse(item);

        assertTrue(result.isPresent());
        assertEquals(213.4, result.get().sell, 0.0001);
        assertEquals(13657.6, result.get().stackPrice, 0.0001);
    }

    // --- English fallback vocabulary ---
    @Test
    void parsesEnglishFallbackLabels() {
        assertEquals(500.0, parser.parse(new GuiParser.ParsedItem("A", "minecraft:a",
                List.of("Sell for: 500"))).orElseThrow().sell, 0.0001);
        assertEquals(99.0, parser.parse(new GuiParser.ParsedItem("B", "minecraft:b",
                List.of("Worth: 99"))).orElseThrow().sell, 0.0001);
        assertEquals(7.0, parser.parse(new GuiParser.ParsedItem("C", "minecraft:c",
                List.of("Value: 7"))).orElseThrow().sell, 0.0001);
    }

    // --- Player-configured custom labels for servers using vocabulary this mod
    //     doesn't recognize out of the box (config.json's customPriceLabels) ---
    @Test
    void customLabelIsUsedOnlyAsLastResort() {
        PriceParser withCustom = new PriceParser(List.of("Cost", "ราคาย่อม"));

        var item = new GuiParser.ParsedItem("Mystery Item", "minecraft:mystery", List.of(
                "Cost: 42"
        ));

        Optional<PriceEntry> result = withCustom.parse(item);

        assertTrue(result.isPresent());
        assertEquals(42.0, result.get().sell, 0.0001);
    }

    @Test
    void customLabelNeverOverridesABuiltInMatch() {
        // If the built-in ต่อชิ้น/ต่อสแตค labels already matched, a custom label
        // present elsewhere in the lore must never override that result.
        PriceParser withCustom = new PriceParser(List.of("Cost"));

        var item = new GuiParser.ParsedItem("Weird Item", "minecraft:weird", List.of(
                "ราคาต่อชิ้น: 10",
                "Cost: 999" // should be ignored — built-in label already matched
        ));

        Optional<PriceEntry> result = withCustom.parse(item);

        assertTrue(result.isPresent());
        assertEquals(10.0, result.get().sell, 0.0001);
    }

    @Test
    void defaultConstructorHasNoCustomLabels() {
        // Regression guard: the no-arg constructor (used by PriceSyncMod's
        // pre-config-load default and by every other test in this class)
        // must not pick up some label from another test's PriceParser instance.
        var item = new GuiParser.ParsedItem("Mystery Item", "minecraft:mystery", List.of("Cost: 42"));
        assertTrue(new PriceParser().parse(item).isEmpty());
    }

    // --- Regression: a real bug found on AmoryCraft's /sellmulti menu. Every
    // category-selector button (crops, ores, gear, etc.) got an identical
    // bogus "price" because their shared countdown/multiplier lore line
    // ("สุ่มราคาใหม่ในอีก: 22h 53m" — "new prices randomize again in: 22h
    // 53m") happens to *contain* the substring "ราคา" mid-sentence. The old
    // unanchored pattern matched that and grabbed the "22" from "22h" as if
    // it were a sell price. Every real price label always opens its own
    // lore line, so anchoring the pattern to line-start fixes this without
    // narrowing any legitimate match. ---
    @Test
    void categorySelectorCountdownLineIsNeverMistakenForAPrice() {
        var item = new GuiParser.ParsedItem("BLOCKS", "minecraft:stone", List.of(
                "ขายไอเทมหมวดนี้เพื่ออัปเกรดตัวคูณ",
                "ความคืบหน้าตัวคูณ 1.1x",
                "0/25k (0%)",
                "สุ่มราคาใหม่ในอีก: 22h 53m"
        ));

        assertTrue(parser.parse(item).isEmpty());
    }

    @Test
    void labelWordAppearingMidSentenceIsIgnoredEvenWithoutSurroundingLines() {
        var item = new GuiParser.ParsedItem("Mystery", "minecraft:mystery", List.of(
                "สุ่มราคาใหม่ในอีก: 22h 53m"
        ));

        assertTrue(parser.parse(item).isEmpty());
    }

    @Test
    void leadingWhitespaceBeforeARealLabelIsStillAccepted() {
        // The anchor allows leading whitespace so indented/padded lore
        // (a common Minecraft tooltip formatting choice) still matches.
        var item = new GuiParser.ParsedItem("Padded Item", "minecraft:diamond", List.of(
                "   ราคา: 12.5"
        ));

        Optional<PriceEntry> result = parser.parse(item);
        assertTrue(result.isPresent());
        assertEquals(12.5, result.get().sell, 0.0001);
    }

    @Test
    void ignoresSellMultiCategorySelectorEvenIfItContainsNumericPriceLikeLore() {
        // Regression from a real /sellmulti queue payload: category icons such as
        // FARMING/ORES/ENCHANTED/POTION were being turned into fake priced items
        // (e.g. minecraft:wheat#variant-...). They contain category-progress lore
        // and must never enter the price payload.
        var item = new GuiParser.ParsedItem("ғᴀʀᴍɪɴɢ", "minecraft:wheat", List.of(
                "จำนวนไอเท็มหมวดนี้: 51",
                "ความคืบหน้าตัวคูณ x1.00",
                "0.0%",
                "ขายแล้ว 0/100m",
                "สุ่มราคาใหม่อีก: 12h 45m",
                "ราคา: 0.10"
        ));

        assertTrue(parser.parse(item).isEmpty());
    }

    @Test
    void categoryMarkerDetectionIsIndependentOfVisiblePrice() {
        var item = new GuiParser.ParsedItem("ORES", "minecraft:diamond", List.of(
                "จำนวนไอเท็มหมวดนี้: 80",
                "ราคา: 999"
        ));
        assertTrue(GuiParser.hasCategoryMarker(item));
        assertTrue(GuiParser.isNavigationOrCategory(item));
    }

    @Test
    void categorySelectorIsIgnoredEvenWhenItContainsAVisiblePrice() {
        var item = new GuiParser.ParsedItem("ғᴀʀᴍɪɴɢ", "minecraft:wheat", List.of(
                "จำนวนไอเท็มหมวดนี้: 51",
                "ราคา: 0.10"
        ));
        assertTrue(parser.parse(item).isEmpty());
    }

    @Test
    void keepsRealProductWithOnlyOneCoincidentCategoryMarker() {
        var item = new GuiParser.ParsedItem("Wheat", "minecraft:wheat", List.of(
                "ขายแล้ว: market activity",
                "ราคา: 1.51"
        ));

        Optional<PriceEntry> result = parser.parse(item);
        assertTrue(result.isPresent());
        assertEquals(1.51, result.get().sell, 0.0001);
    }

    @Test
    void ignoresNavigationButtonsByLabel() {
        var item = new GuiParser.ParsedItem("หน้าถัดไป", "minecraft:arrow", List.of(
                "ราคา: 12"
        ));
        assertTrue(parser.parse(item).isEmpty());
    }

    @Test
    void genericVariantIdentityDoesNotUseAHardCodedItemAllowlist() throws Exception {
        String source = java.nio.file.Files.readString(
                java.nio.file.Path.of("src/main/java/com/example/pricesync/parser/GuiParser.java"));
        assertFalse(source.contains("VARIANT_SENSITIVE_IDS"));
        assertTrue(source.contains("getComponentsPatch()"));
    }

    @Test
    void enchantedBookVariantsDoNotCollapseWhenDisplayNameIsTheSame() {
        var a = new GuiParser.ParsedItem("Enchanted Book", "minecraft:enchanted_book",
                List.of("Lure II", "ราคาต่อชิ้น: 100"), "enchanted book\nlure ii", true);
        var b = new GuiParser.ParsedItem("Enchanted Book", "minecraft:enchanted_book",
                List.of("Mending I", "ราคาต่อชิ้น: 500"), "enchanted book\nmending i", true);

        PriceParser parser = new PriceParser();
        assertNotEquals(parser.parse(a).orElseThrow().id, parser.parse(b).orElseThrow().id);
    }

    @Test
    void variantIdentityIgnoresPriceLines() {
        var a = new GuiParser.ParsedItem("Potion", "minecraft:potion",
                List.of("Strength II", "ราคาต่อชิ้น: 10"), "potion\nstrength ii", true);
        var b = new GuiParser.ParsedItem("Potion", "minecraft:potion",
                List.of("Strength II", "ราคาต่อชิ้น: 20"), "potion\nstrength ii", true);

        PriceParser parser = new PriceParser();
        assertEquals(parser.parse(a).orElseThrow().id, parser.parse(b).orElseThrow().id);
    }


    @Test
    void componentIdentityWinsOverUnstableNonPriceLore() {
        // A real GUI may append rank/index/activity lore that changes while the
        // actual ItemStack component state stays identical. Component identity
        // must keep the same stable id in that case.
        var a = new GuiParser.ParsedItem("Potion", "minecraft:potion",
                List.of("Strength II", "ลำดับ #1", "ราคาต่อชิ้น: 10"),
                "potion\nstrength ii\nลำดับ #1", true);
        var b = new GuiParser.ParsedItem("Potion", "minecraft:potion",
                List.of("Strength II", "ลำดับ #9", "ราคาต่อชิ้น: 20"),
                "potion\nstrength ii\nลำดับ #9", true);

        // The plain ParsedItem fixture has no component marker, so this test is
        // specifically guarding the fallback behavior: if a server exposes only
        // lore-based identity, changing unrelated rank text is not safe to ignore
        // automatically. The production ItemStack path supplies component identity
        // whenever Minecraft has it.
        PriceParser parser = new PriceParser();
        assertNotEquals(parser.parse(a).orElseThrow().id, parser.parse(b).orElseThrow().id);
    }

    @Test
    void variantsWithSameRegistryIdGetDifferentStableIds() {
        var a = new GuiParser.ParsedItem("Potion", "minecraft:potion",
                List.of("Strength II", "ราคาต่อชิ้น: 10"), "potion\nstrength ii", true);
        var b = new GuiParser.ParsedItem("Potion", "minecraft:potion",
                List.of("Speed II", "ราคาต่อชิ้น: 20"), "potion\nspeed ii", true);
        PriceParser parser = new PriceParser();
        assertNotEquals(parser.parse(a).orElseThrow().id, parser.parse(b).orElseThrow().id);
    }
    @Test
    void componentIdentitySourceHasNoHardCodedHashCodeFallback() throws Exception {
        String source = java.nio.file.Files.readString(
                java.nio.file.Path.of("src/main/java/com/example/pricesync/parser/PriceParser.java"));
        assertTrue(source.contains("MessageDigest.getInstance(\"SHA-256\")"));
        assertFalse(source.contains("Integer.toHexString(variant.hashCode())"));
    }


}

