package com.example.pricesync.parser;

import com.example.pricesync.util.PriceEntry;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Extracts prices out of a ParsedItem's lore lines.
 *
 * Supports the known Thai format plus common English price labels.
 *   "ราคาต่อชิ้น: <coin-icon> 1,069.02"   (price per unit)
 *   "ราคาต่อสแตค: <coin-icon> 68,417.28"  (price per full stack)
 *
 * Some servers (e.g. AmoryCraft's /sell item list) only ever show a single,
 * unlabeled-as-per-unit price line instead of the ต่อชิ้น/ต่อสแตค pair:
 *   "ราคา: <coin-icon> 233.97"
 * PLAIN_PRICE_PATTERN covers that case (and the English "price:" equivalent)
 * as a fallback, only used when neither per-unit nor per-stack matched.
 * The negative lookahead "(?!ต่อ)" stops it from also matching the ต่อชิ้น/
 * ต่อสแตค lines themselves (ราคาต่อชิ้น literally starts with ราคา).
 *
 * Some server price GUIs only show ONE price (what it pays you per item),
 * not separate buy/sell prices — so we map it to PriceEntry.sell and leave
 * buy at -1 (not applicable). Prices are decimals, not whole numbers.
 *
 * The numeric gap before the digits skips whatever coin icon/symbol glyph
 * sits between the colon and the number — works regardless of what that
 * glyph actually is.
 */
public class PriceParser {

    /** Strict decimal format: plain digits or correctly grouped thousands, with an optional decimal part. */
    private static final String NUMBER = "((?:[0-9]+(?:\\.[0-9]+)?|[0-9]{1,3}(?:,[0-9]{3})+(?:\\.[0-9]+)?))(?![0-9,.])";

    private static final Pattern PER_UNIT_PATTERN =
            Pattern.compile("^\\s*(?:ราคาต่อชิ้น|price\\s*per\\s*(?:item|unit)|sell\\s*price)\\s*:?[^0-9+\\-−]*" + NUMBER, Pattern.CASE_INSENSITIVE);
    private static final Pattern PER_STACK_PATTERN =
            Pattern.compile("^\\s*(?:ราคาต่อสแตค|price\\s*per\\s*stack|stack\\s*price)\\s*:?[^0-9+\\-−]*" + NUMBER, Pattern.CASE_INSENSITIVE);
    // Broadened plain-price fallback: covers common Thai/English economy-server
    // vocab that isn't the ต่อชิ้น/ต่อสแตค pair — still all treated as a single
    // per-unit sell price, same as the original "ราคา:" case.
    //   ราคา (?!ต่อ)  -> bare "ราคา:" but not "ราคาต่อ..." (handled above)
    //   ราคาขาย       -> "sell price" (lit. "sale price")
    //   มูลค่า         -> "value"
    //   ขายได้         -> "sells for"
    //   sell(ing)? for | worth | value  -> common English equivalents
    //
    // IMPORTANT: anchored to the START of the lore line (^\s*, no MULTILINE —
    // each element of loreLines is already exactly one displayed line). Every
    // real price label seen across every tested server always opens its own
    // line; without this anchor, unrelated lore that merely *contains* one of
    // these words mid-sentence — e.g. a "สุ่มราคาใหม่ในอีก: 22h 53m" countdown
    // line on a category-selector button, which literally contains "ราคา" —
    // gets misread as a priced line and grabs whatever unrelated number
    // follows it. That produced identical bogus prices for every category
    // button in a real /sellmulti menu before this fix.
    private static final Pattern PLAIN_PRICE_PATTERN =
            Pattern.compile("^\\s*(?:ราคาขาย|ราคา(?!ต่อ)|มูลค่า|ขายได้|sell(?:ing)?\\s*for|worth|value|price)"
                    + "\\s*:?[^0-9+\\-−]*" + NUMBER, Pattern.CASE_INSENSITIVE);

    /** Extra label words the player has configured for a server this mod doesn't
     *  yet know about, so new servers don't need a code change + rebuild to work.
     *  Compiled the same way as PLAIN_PRICE_PATTERN: matched as a fallback, mapped
     *  to a single per-unit sell price. */
    private final List<Pattern> customPatterns;

    public PriceParser() {
        this(List.of());
    }

    public PriceParser(List<String> customLabels) {
        List<Pattern> compiled = new java.util.ArrayList<>();
        for (String label : customLabels) {
            if (label == null || label.isBlank()) continue;
            compiled.add(Pattern.compile(
                    "^\\s*" + Pattern.quote(label.trim()) + "\\s*:?[^0-9+\\-−]*" + NUMBER,
                    Pattern.CASE_INSENSITIVE));
        }
        this.customPatterns = compiled;
    }

    public Optional<PriceEntry> parse(GuiParser.ParsedItem item) {
        if (item == null || GuiParser.isNavigationOrCategory(item)) {
            return Optional.empty();
        }

        Double perUnit = extract(PER_UNIT_PATTERN, item.loreLines());
        Double perStack = extract(PER_STACK_PATTERN, item.loreLines());

        // Fallback: servers whose price GUI only shows one unlabeled-per-unit
        // price line (e.g. "ราคา: 233.97", "Worth: 233.97") instead of the
        // ต่อชิ้น/ต่อสแตค pair. Only used when the more specific labels above
        // found nothing, so it can never override a real per-unit/per-stack match.
        if (perUnit == null && perStack == null) {
            Double plain = extract(PLAIN_PRICE_PATTERN, item.loreLines());
            if (plain != null) {
                perUnit = plain;
            }
        }

        // Last resort: player-configured custom labels for servers using
        // vocabulary this mod doesn't recognize out of the box.
        if (perUnit == null && perStack == null) {
            for (Pattern custom : customPatterns) {
                Double plain = extract(custom, item.loreLines());
                if (plain != null) {
                    perUnit = plain;
                    break;
                }
            }
        }

        if (perUnit == null && perStack == null) {
            return Optional.empty();
        }

        PriceEntry entry = new PriceEntry();
        entry.id = buildStableId(item);
        entry.name = item.displayName();
        entry.variantKey = item.variantKey();
        entry.sell = perUnit != null ? perUnit : -1;
        entry.stackPrice = perStack != null ? perStack : -1;
        // entry.buy stays -1: the parsed price GUI doesn't show a separate buy price.

        return Optional.of(entry);
    }

    private String buildStableId(GuiParser.ParsedItem item) {
        String base = item.registryId();
        String variant = item.variantKey();
        if (base == null || base.isBlank() || !item.variantRequired()) return base;
        if (variant == null || variant.isBlank()) return base;
        // Keep ordinary items backwards compatible. Only variants that actually
        // carry distinguishing display/lore data receive a deterministic suffix.
        String digest;
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] bytes = md.digest(variant.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(16);
            for (int i = 0; i < 8 && i < bytes.length; i++) hex.append(String.format("%02x", bytes[i]));
            digest = hex.toString();
        } catch (Exception e) {
            // SHA-256 is required by every supported Java runtime; keep a
            // deterministic UTF-8 fallback without depending on process state.
            digest = java.util.HexFormat.of().formatHex(variant.getBytes(StandardCharsets.UTF_8)).substring(0, Math.min(16, variant.length() * 2));
        }
        // Registry id remains visible and searchable; suffix makes all component-backed
        // or tooltip-distinguished variants coexist in cache/API payloads.
        return base + "#variant-" + digest;
    }

    private Double extract(Pattern pattern, List<String> lines) {
        for (String line : lines) {
            Matcher m = pattern.matcher(line);
            if (m.find()) {
                String raw = m.group(1).replace(",", ""); // keep the decimal point!
                try {
                    double value = Double.parseDouble(raw);
                    return Double.isFinite(value) ? value : null;
                } catch (NumberFormatException ignored) {
                    // fall through
                }
            }
        }
        return null;
    }
}
