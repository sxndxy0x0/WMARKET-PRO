package com.example.pricesync.util;

import java.util.Objects;

/** One row of a server price GUI: an item with its price. */
public class PriceEntry {
    public String id;
    public String name;
    /** Stable identity for variants that share the same Minecraft registry id. */
    public String variantKey;
    // NOTE: server shows decimal prices (e.g. "1,069.02"), not whole numbers —
    // these must be double, not long/int.
    public double buy = -1;  // -1 = not shown by this server (this GUI appears to be sell-only)
    public double sell = -1; // "ราคาต่อชิ้น" (price per unit)
    public double stackPrice = -1; // "ราคาต่อสแตค" (price per full stack) — extra, not in original JSON spec

    public PriceEntry() {}

    public PriceEntry(String id, String name, double buy, double sell) {
        this.id = id;
        this.name = name;
        this.buy = buy;
        this.sell = sell;
    }

    /** Used by CacheManager to detect price changes, ignoring name/id-only diffs. */
    public boolean pricesEqual(PriceEntry other) {
        if (other == null) return false;
        return Double.compare(this.buy, other.buy) == 0
                && Double.compare(this.sell, other.sell) == 0
                && Double.compare(this.stackPrice, other.stackPrice) == 0;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof PriceEntry that)) return false;
        return Double.compare(buy, that.buy) == 0
                && Double.compare(sell, that.sell) == 0
                && Double.compare(stackPrice, that.stackPrice) == 0
                && Objects.equals(id, that.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id, buy, sell, stackPrice);
    }
}
