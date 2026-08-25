package com.example.pricesync.parser;

import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.ItemLore;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Turns raw ItemStacks from GuiReader into plain text lines (display name + lore)
 * and a stable identity material that PriceParser can use to keep variants apart.
 *
 * The important rule is that identity is derived from the ItemStack itself, not
 * from a hard-coded list of "special" item ids. Minecraft 26.2 uses data
 * components for many item variants (enchantments, potions, trims, books,
 * custom_data, etc.), so a registry-id-only key is not sufficient.
 */
public class GuiParser {

    public ParsedItem parse(ItemStack stack) {
        String displayName = stack.getHoverName().getString();

        List<String> loreLines = new ArrayList<>();
        ItemLore lore = stack.get(DataComponents.LORE);
        if (lore != null) {
            for (var line : lore.lines()) {
                loreLines.add(line.getString());
            }
        }

        var key = BuiltInRegistries.ITEM.getKey(stack.getItem());
        String registryId = key == null ? "" : key.toString();
        String defaultName = stack.getItemName().getString();

        // Tooltip text is useful for servers that expose custom item identity only
        // through lore. Price/countdown lines are removed so a price refresh does
        // not manufacture a new item identity.
        String tooltipKey = buildTooltipKey(displayName, loreLines);

        // Generic component identity: do NOT maintain a list of special item ids.
        // ItemStack#getComponents() contains the resolved 26.2 data-component state,
        // which covers enchantments, potion contents, tipped arrows, trims, books,
        // custom data, and future component-backed variants without code changes.
        String componentKey = buildComponentKey(stack);

        boolean customDisplayName = !normalize(displayName).equals(normalize(defaultName));

        // Prefer Minecraft's component state as the authoritative identity. A
        // common source of false variants in earlier versions was arbitrary GUI
        // lore such as rank/index/countdown text: two otherwise identical items
        // could get different ids merely because that text changed. Tooltip/lore
        // is only a fallback for servers whose custom item identity is genuinely
        // lore-only and has no component changes.
        boolean componentVariant = !componentKey.isBlank();
        boolean tooltipVariant = componentVariant ? false
                : customDisplayName || !tooltipKey.equals(normalize(defaultName));
        boolean variantRequired = componentVariant || tooltipVariant;

        // Keep the full component identity separately from tooltip identity. This
        // lets PriceParser build one deterministic id without guessing item families.
        String variantKey = (componentVariant ? "#components\n" + componentKey
                : "#tooltip\n" + tooltipKey);
        return new ParsedItem(displayName, registryId, loreLines, variantKey, variantRequired);
    }

    /**
     * Build a deterministic representation of the stack's explicit component
     * changes. This is preferable to serializing the full resolved component map:
     * ordinary items have many default components, while variants are represented
     * by their changes from the item's prototype. LORE is excluded because this
     * server uses it for volatile prices/countdowns.
     */
    private String buildComponentKey(ItemStack stack) {
        List<String> parts = new ArrayList<>();
        for (var entry : stack.getComponentsPatch().entrySet()) {
            if (entry.getKey() == DataComponents.LORE) continue;
            parts.add(entry.getKey().toString() + "=" + String.valueOf(entry.getValue()));
        }
        parts.sort(String::compareTo);
        return String.join("\n", parts);
    }

    /** Identity material from visible text, excluding volatile price/countdown lines. */
    private String buildTooltipKey(String displayName, List<String> loreLines) {
        StringBuilder b = new StringBuilder();
        b.append(normalize(displayName));
        for (String line : loreLines) {
            String n = normalize(line);
            if (n.isBlank() || isVolatilePriceLine(n)) continue;
            b.append('\n').append(n);
        }
        return b.toString();
    }

    /**
     * True for GUI text that is expected to change while the same product/page
     * remains open. These lines must not become part of a lore-only variant id
     * or a page fingerprint.
     */
    public static boolean isVolatileIdentityLine(String line) {
        if (line == null) return false;
        String n = normalize(line);
        return n.matches("^(ราคาต่อชิ้น|ราคาต่อสแตค|ราคาขาย|ราคา(?!ต่อ)|มูลค่า|ขายได้|price.*|sell.*|worth.*|value.*)\\s*:?.*[0-9].*$")
                || n.matches("^.*(?:สุ่มราคาใหม่|price refresh|refresh price).*[0-9].*$")
                || n.matches("^.*(?:ขายแล้ว|sold|progress|ความคืบหน้า|ตัวคูณ|multiplier).*[0-9].*$");
    }

    private boolean isVolatilePriceLine(String line) {
        return isVolatileIdentityLine(line);
    }

    /**
     * True when this stack is a navigation/category control rather than a priced
     * product. Category buttons in the observed /sellmulti menu use real item
     * icons, so the check must be based on their menu-specific lore/title markers,
     * not on the Minecraft item id.
     */
    /** True when the item contains the server's strong category-menu markers. */
    public static boolean hasCategoryMarker(ParsedItem item) {
        if (item == null) return false;
        for (String raw : item.loreLines()) {
            String line = normalize(raw);
            if (containsAny(line,
                    "จำนวนไอเท็มหมวดนี้",
                    "ความคืบหน้าตัวคูณ",
                    "สุ่มราคาใหม่อีก")) {
                return true;
            }
        }
        return false;
    }

    public static boolean isNavigationOrCategory(ParsedItem item) {
        if (item == null) return true;

        boolean categoryMarker = hasCategoryMarker(item);
        boolean navigationLabel = false;

        for (String raw : item.loreLines()) {
            String line = normalize(raw);
            if (line.isBlank()) continue;

            if (containsAny(line,
                    "หน้าถัดไป", "หน้าต่อไป", "next page", "previous page",
                    "prev page", "กลับหมวดหมู่", "กลับไปหมวดหมู่")) {
                navigationLabel = true;
            }
        }

        String display = normalize(item.displayName());
        navigationLabel |= containsAny(display,
                "หน้าถัดไป", "หน้าต่อไป", "next page", "previous page",
                "prev page", "กลับหมวดหมู่", "กลับไปหมวดหมู่");

        // A navigation control is never a product. For category buttons, require
        // at least one strong menu marker, but do not suppress a legitimate priced
        // product that happens to contain one generic phrase in its lore.
        if (navigationLabel) return true;
        // One strong category marker is enough. A category icon can also carry
        // a numeric preview price; do not let that turn the navigation control
        // into a product merely because it contains a price-looking line.
        return categoryMarker;
    }

    private static boolean containsAny(String value, String... needles) {
        for (String needle : needles) {
            if (value.contains(needle)) return true;
        }
        return false;
    }

    private static String normalize(String value) {
        if (value == null) return "";
        return value.replaceAll("\\s+", " ").trim().toLowerCase(Locale.ROOT);
    }

    public record ParsedItem(String displayName, String registryId, List<String> loreLines,
                             String variantKey, boolean variantRequired) {
        public ParsedItem(String displayName, String registryId, List<String> loreLines) {
            this(displayName, registryId, loreLines, displayName == null ? "" : displayName, false);
        }
    }
}
