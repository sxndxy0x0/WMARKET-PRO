package com.example.pricesync.util;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class JsonBuilderTest {

    private PriceEntry priceEntryWithStackPrice(String id, String name, double buy, double sell, double stackPrice) {
        PriceEntry entry = new PriceEntry(id, name, buy, sell);
        entry.stackPrice = stackPrice;
        return entry;
    }

    private PriceEntry entry(String id, double sell) {
        PriceEntry entry = new PriceEntry();
        entry.id = id;
        entry.name = id;
        entry.buy = -1;
        entry.sell = sell;
        entry.stackPrice = -1;
        return entry;
    }

    @Test
    void producesExpectedTopLevelShape() {
        JsonBuilder builder = new JsonBuilder();

        PriceEntry entry = new PriceEntry();
        entry.id = "spawner";
        entry.name = "spawner";
        entry.buy = -1;
        entry.sell = 1069.02;
        entry.stackPrice = 68417.28;

        String json = builder.build("siam.example:25565", "worth", List.of(entry));
        JsonObject root = JsonParser.parseString(json).getAsJsonObject();

        assertEquals("siam.example:25565", root.get("server").getAsString());
        assertEquals(2, root.get("protocol").getAsInt());
        assertTrue(root.has("timestamp"));
        assertEquals("worth", root.get("command").getAsString());
        assertTrue(root.get("timestamp").getAsLong() > 0);
        assertEquals("spawner", root.getAsJsonArray("prices").get(0).getAsJsonObject().get("id").getAsString());
    }

    @Test
    void refusesMissingServerIdentity() {
        JsonBuilder builder = new JsonBuilder();
        PriceEntry entry = new PriceEntry();
        entry.id = "stone";
        assertThrows(IllegalArgumentException.class, () -> builder.build("", "worth", List.of(entry)));
        assertThrows(IllegalArgumentException.class, () -> builder.build(null, "worth", List.of(entry)));
    }

    @Test
    void doesNotInventAPlayerConfiguredServerName() {
        PriceEntry entry = new PriceEntry();
        entry.id = "stone";
        String json = new JsonBuilder().build("siam.example:25565", "worth", List.of(entry));
        JsonObject root = JsonParser.parseString(json).getAsJsonObject();
        assertFalse(root.has("serverName"));
        assertFalse(root.has("name"));
    }

    @Test
    void rejectsInvalidPriceNumbers() {
        PriceEntry entry = new PriceEntry();
        entry.id = "stone";
        entry.sell = Double.NaN;
        assertThrows(IllegalArgumentException.class, () -> new JsonBuilder().build("siam.example:25565", "worth", List.of(entry)));

        entry.sell = Double.POSITIVE_INFINITY;
        assertThrows(IllegalArgumentException.class, () -> new JsonBuilder().build("siam.example:25565", "worth", List.of(entry)));
    }

    @Test
    void rejectsEmptyPriceList() {
        assertThrows(IllegalArgumentException.class, () -> new JsonBuilder().build("siam.example:25565", "worth", List.of()));
    }

    @Test
    void requiresCanonicalServerIdentity() {
        PriceEntry entry = new PriceEntry();
        entry.id = "stone";
        assertThrows(IllegalArgumentException.class, () -> new JsonBuilder().build("SIAM.EXAMPLE", "worth", List.of(entry)));
        assertDoesNotThrow(() -> new JsonBuilder().build("siam.example:25565", "worth", List.of(entry)));
    }
    @Test
    void parsesAcceptedPayloadForCacheCommit() {
        PriceEntry entry = new PriceEntry();
        entry.id = "stone";
        entry.name = "Stone";
        entry.buy = -1;
        entry.sell = 12.5;
        entry.stackPrice = 800;

        JsonBuilder builder = new JsonBuilder();
        String json = builder.build("siam.example:25565", "worth", List.of(entry));
        JsonBuilder.ParsedPayload parsed = builder.parseAcceptedPayload(json);

        assertEquals("siam.example:25565", parsed.server());
        assertEquals("worth", parsed.command());
        assertTrue(parsed.timestamp() > 0);
        assertEquals(1, parsed.entries().size());
        assertEquals(12.5, parsed.entries().get(0).sell, 0.0001);
    }

    @Test
    void rejectsDuplicatePriceIds() {
        PriceEntry a = new PriceEntry(); a.id = "stone"; a.sell = 1;
        PriceEntry b = new PriceEntry(); b.id = "stone"; b.sell = 2;
        assertThrows(IllegalArgumentException.class, () ->
                new JsonBuilder().build("siam.example:25565", "worth", List.of(a, b)));
    }

    @Test
    void normalizesCommandCaseInPayload() {
        PriceEntry entry = new PriceEntry();
        entry.id = "stone";
        String json = new JsonBuilder().build("siam.example:25565", "Worth", List.of(entry));
        JsonObject root = JsonParser.parseString(json).getAsJsonObject();
        assertEquals("worth", root.get("command").getAsString());
    }

    @Test
    void acceptsServerDefinedCommandNames() {
        PriceEntry entry = new PriceEntry();
        entry.id = "stone";
        String json = new JsonBuilder().build("siam.example:25565", "SellValue", List.of(entry));
        JsonObject root = JsonParser.parseString(json).getAsJsonObject();
        assertEquals("sellvalue", root.get("command").getAsString());
    }

    @Test
    void rejectsMalformedCommandNames() {
        PriceEntry entry = new PriceEntry();
        entry.id = "stone";
        assertThrows(IllegalArgumentException.class, () ->
                new JsonBuilder().build("siam.example:25565", "bad command", List.of(entry)));
        assertThrows(IllegalArgumentException.class, () ->
                new JsonBuilder().build("siam.example:25565", "/bad/command", List.of(entry)));
    }

    @Test
    void rejectsNonCanonicalAcceptedPayload() {
        String json = "{\"protocol\":2,\"server\":\"SIAM.EXAMPLE\",\"timestamp\":1,\"prices\":[{\"id\":\"stone\",\"name\":\"Stone\",\"buy\":-1,\"sell\":1,\"stackPrice\":64}]}";
        assertThrows(IllegalArgumentException.class, () -> new JsonBuilder().parseAcceptedPayload(json));
    }


    @Test
    void mergePayloadsCombinesPagesAndKeepsLatestEntryById() {
        JsonBuilder builder = new JsonBuilder();
        PriceEntry first = entry("diamond", 100);
        PriceEntry second = entry("emerald", 50);
        PriceEntry updatedDiamond = entry("diamond", 125);

        String page1 = builder.build("siam:25565", "sellmulti", List.of(first, second));
        String page2 = builder.build("siam:25565", "sellmulti", List.of(updatedDiamond));

        JsonBuilder.ParsedPayload merged = builder.parseAcceptedPayload(
                builder.mergePayloads(List.of(page1, page2)));

        assertEquals(2, merged.entries().size());
        assertEquals(125, merged.entries().stream()
                .filter(e -> "diamond".equals(e.id)).findFirst().orElseThrow().sell);
        assertEquals(50, merged.entries().stream()
                .filter(e -> "emerald".equals(e.id)).findFirst().orElseThrow().sell);
    }

    @Test
    void mergePayloadsRejectsDifferentServerOrCommand() {
        JsonBuilder builder = new JsonBuilder();
        String first = builder.build("siam:25565", "sellmulti", List.of(entry("diamond", 100)));
        String otherServer = builder.build("other:25565", "sellmulti", List.of(entry("emerald", 50)));
        String otherCommand = builder.build("siam:25565", "prices", List.of(entry("emerald", 50)));

        assertThrows(IllegalArgumentException.class, () -> builder.mergePayloads(List.of(first, otherServer)));
        assertThrows(IllegalArgumentException.class, () -> builder.mergePayloads(List.of(first, otherCommand)));
    }
    @Test
    void timestampsAreStrictlyIncreasingForRapidPayloads() {
        JsonBuilder builder = new JsonBuilder();
        long previous = 0;
        for (int i = 0; i < 20; i++) {
            String json = builder.build("siam.example:25565", "sellmulti",
                    List.of(entry("item-" + i, i)));
            long timestamp = JsonParser.parseString(json).getAsJsonObject()
                    .get("timestamp").getAsLong();
            assertTrue(timestamp > previous, "timestamp must increase for payload " + i);
            previous = timestamp;
        }
    }

    @Test
    void mergedPayloadGetsNewerTimestampThanItsInputs() {
        JsonBuilder builder = new JsonBuilder();
        String first = builder.build("siam.example:25565", "sellmulti", List.of(entry("a", 1)));
        String second = builder.build("siam.example:25565", "sellmulti", List.of(entry("b", 2)));
        long firstTs = JsonParser.parseString(first).getAsJsonObject().get("timestamp").getAsLong();
        long secondTs = JsonParser.parseString(second).getAsJsonObject().get("timestamp").getAsLong();

        String merged = builder.mergePayloads(List.of(first, second));
        long mergedTs = JsonParser.parseString(merged).getAsJsonObject().get("timestamp").getAsLong();

        assertTrue(mergedTs > firstTs);
        assertTrue(mergedTs > secondTs);
    }

    @Test
    void constructorNeverStartsBelowPersistedTimestamp() {
        JsonBuilder builder = new JsonBuilder(9_999_999_999L);
        String json = builder.build("siam.example:25565", "sellmulti",
                List.of(priceEntryWithStackPrice("stone", "Stone", -1, 1, 64)));
        long timestamp = JsonParser.parseString(json).getAsJsonObject()
                .get("timestamp").getAsLong();
        assertTrue(timestamp > 9_999_999_999L);
    }

    @Test
    void mergedPayloadIsNewerEvenWhenCreatedByAnotherBuilder() {
        JsonBuilder producer = new JsonBuilder(10_000L);
        JsonBuilder merger = new JsonBuilder(1L);
        String first = producer.build("siam.example:25565", "sellmulti", List.of(entry("a", 1)));
        String second = producer.build("siam.example:25565", "sellmulti", List.of(entry("b", 2)));
        long newestInput = JsonParser.parseString(second).getAsJsonObject().get("timestamp").getAsLong();

        String merged = merger.mergePayloads(List.of(first, second));
        long mergedTimestamp = JsonParser.parseString(merged).getAsJsonObject().get("timestamp").getAsLong();

        assertTrue(mergedTimestamp > newestInput);
    }


}

