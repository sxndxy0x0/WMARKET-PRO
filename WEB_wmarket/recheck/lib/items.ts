/**
 * Item identity helpers for the WMarket frontend.
 *
 * Real-world shop plugins don't send clean data: item ids arrive with
 * variant fragments (`minecraft:potion#variant-31e407df…`) and display
 * names carry legacy formatting codes (`§r`) plus private-use glyphs from
 * server resource packs. Nothing downstream (tables, charts, icon lookup,
 * search) should have to deal with that, so everything funnels through
 * the three helpers below.
 */

/** Characters used by Minecraft's legacy formatting codes (`§0`-`§f`, `§k`-`§o`). */
const SECTION_CODE_RE = /§./g;
/** Private Use Area planes — resource-pack glyph fonts render as tofu on the web. */
const PUA_CHARS_RE = /[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu;
/** Zero-width / invisible separators left behind by name generators. */
const INVISIBLE_CHARS_RE = /[\u{200B}-\u{200F}\u{2060}\u{FEFF}]/gu;

/**
 * Turn a raw mod-provided name into something safe and pleasant to render:
 * strips formatting codes, private-use glyphs, control characters and
 * collapsed whitespace. Returns the empty string when nothing readable
 * remains (callers decide their own fallback).
 */
export function sanitizeItemName(rawName: string): string {
  if (typeof rawName !== 'string') return '';
  const cleaned = rawName
    .replace(SECTION_CODE_RE, '')
    .replace(PUA_CHARS_RE, '')
    .replace(INVISIBLE_CHARS_RE, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

/**
 * The stable identity of an item across syncs. Shop plugins append
 * per-shop variant hashes after `#`; two rows sharing a base id and a
 * sanitized name are the same market listing seen twice.
 */
export function baseItemId(itemId: string): string {
  if (typeof itemId !== 'string') return '';
  return itemId.split('#', 1)[0] ?? itemId;
}

export type DedupeInput = {
  id: string;
  name: string;
  updated_at?: number;
};

/**
 * Collapse duplicate listings, keeping every genuinely distinct variant.
 *
 * Rows are grouped by (base id + sanitized name). Inside a group:
 *  - At most ONE distinct `#fragment` across all members = the same listing
 *    seen twice (the plugin's plain row plus its `#variant` twin): collapse
 *    into one row, preferring the plain id and merging numeric extras.
 *  - Two or more DISTINCT fragments = different market items sharing a
 *    registry id (e.g. amory's Enchanted Book per enchantment+level): keep
 *    them all so nothing disappears.
 */
export function dedupeBy<T extends DedupeInput & Record<string, unknown>>(
  items: T[],
  mergeExtras?: (kept: T, dropped: T) => Partial<T>
): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = `${baseItemId(item.id)}|${sanitizeItemName(item.name)}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  const result: T[] = [];
  for (const group of groups.values()) {
    let distinctFragments = 0;
    for (const item of group) {
      const hashIndex = item.id.indexOf('#');
      if (hashIndex >= 0 && item.id.slice(hashIndex + 1).length > 0) distinctFragments++;
      if (distinctFragments > 1) break;
    }
    // A single shared fragment (or none at all) means every member is a
    // duplicate listing of the SAME item -> pick the canonical row.
    if (group.length === 1 || distinctFragments <= 1) {
      const canonical =
        group.length === 1
          ? group[0]
          : group.find((item) => !item.id.includes('#')) ??
            group.reduce((newest, item) =>
              (item.updated_at ?? 0) >= (newest.updated_at ?? 0) ? item : newest
            );
      let merged = canonical;
      for (const other of group) {
        if (other === canonical) continue;
        // Pass the running `merged` (not the original canonical) so chained
        // merges like Math.max see values picked up from earlier twins.
        merged = { ...merged, ...(mergeExtras?.(merged, other) as Partial<T> | undefined) };
      }
      result.push(merged);
      continue;
    }
    result.push(...group);
  }
  return result;
}
