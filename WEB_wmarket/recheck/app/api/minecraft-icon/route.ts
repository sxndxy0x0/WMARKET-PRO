import { NextRequest } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

const PRISMARINE_VERSION = '1.21.4';
const GITHUB_VERSION = '1.21.1';

// Real item/block textures extracted directly from the client jar (see
// public/mc-textures/README.md) — checked before any network source.
// Instant, 100% reliable for anything in this set, and works offline.
const LOCAL_TEXTURES_DIR = path.join(process.cwd(), 'public', 'mc-textures');

// Most Minecraft blocks are NOT a single flat icon file — the game
// composites an isometric inventory icon at runtime from separate
// per-face textures (e.g. hay_block has hay_block_side.png and
// hay_block_top.png, but no plain hay_block.png). This is why every
// external mirror 404s for most blocks regardless of version: the file
// genuinely doesn't exist under the item's ID. When there's no exact
// match we fall back to the most "icon-like" face, in this order.
const BLOCK_FACE_SUFFIXES = ['', '_side', '_top', '_front', '_bottom', '_end', '_stage3'];
const MAX_QUERY_LENGTH = 100;
const MAX_REMOTE_IMAGE_BYTES = 512 * 1024;

async function readLocal(relPath: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(LOCAL_TEXTURES_DIR, relPath));
  } catch {
    return null;
  }
}

// Representative animation frames for dial items, keyed by base texture id.
const ANIMATED_DIAL_FRAMES: Record<string, string> = {
  clock: 'clock_32',
};

async function findLocal(ids: string[]): Promise<Buffer | null> {
  for (const id of ids) {
    const item = await readLocal(`item/${id}.png`);
    if (item) return item;
  }
  for (const id of ids) {
    for (const suffix of BLOCK_FACE_SUFFIXES) {
      const block = await readLocal(`block/${id}${suffix}.png`);
      if (block) return block;
    }
  }
  // Animated dial items (clock, compass, recovery_compass) ship in the jar
  // ONLY as frame sequences (`clock_00.png`…`clock_63.png`) — there is no
  // static `clock.png` on disk or on any mirror, which is why every external
  // candidate 404s for them. Serve a representative frame instead. clock_32
  // is the noon dial (the classic golden face); compass_00 points north.
  for (const id of ids) {
    if (!/^(clock|compass|recovery_compass)$/.test(id)) continue;
    const frame = await readLocal(`item/${ANIMATED_DIAL_FRAMES[id] ?? `${id}_00`}.png`);
    if (frame) return frame;
  }
  return null;
}

const ALIASES: Record<string, string> = {
  'diamond sword': 'diamond_sword', 'diamond pickaxe': 'diamond_pickaxe',
  'diamond axe': 'diamond_axe', 'diamond shovel': 'diamond_shovel', 'diamond hoe': 'diamond_hoe',
  'iron sword': 'iron_sword', 'iron pickaxe': 'iron_pickaxe', 'iron axe': 'iron_axe',
  'iron ingot': 'iron_ingot', 'gold ingot': 'gold_ingot', 'netherite ingot': 'netherite_ingot',
  'golden apple': 'golden_apple', 'enchanted golden apple': 'enchanted_golden_apple',
  'cooked beef': 'cooked_beef', 'beef': 'beef', 'bread': 'bread', 'diamond': 'diamond',
  'emerald': 'emerald', 'redstone': 'redstone', 'coal': 'coal', 'stick': 'stick',
  'ender pearl': 'ender_pearl', 'ender eye': 'ender_eye', 'blaze rod': 'blaze_rod',
  'nether star': 'nether_star', 'experience bottle': 'experience_bottle',
};

// The internal block/item ID (what price-sync data actually sends) and the
// current in-game display name have drifted apart for a handful of blocks
// over the years — the ID never changed for backward compatibility, but
// some external sources index files under the *current* name instead.
const RENAMED_IDS: Record<string, string> = {
  hay_block: 'hay_bale',
  grass_path: 'dirt_path',
  magma_block: 'magma', // raw texture file is magma.png, not magma_block.png
  crimson_hyphae: 'crimson_stem', // hyphae is the rotated/all-bark version of the stem texture
  warped_hyphae: 'warped_stem',
};

// A large family of block IDs are cosmetically identical to a *different*
// block and were never given their own texture file — the game just
// reuses the parent block's texture with different geometry (a stair
// shape) or game logic (waxing halts oxidation but doesn't change how
// the block looks). Stripping these structurally, instead of listing
// every "waxed_oxidized_cut_copper_stairs"-style item by hand, is what
// actually covers this family instead of playing whack-a-mole one ID at
// a time.
function structuralVariants(id: string): string[] {
  const out: string[] = [];
  if (id.startsWith('infested_')) out.push(id.slice('infested_'.length));
  if (id.startsWith('waxed_')) out.push(id.slice('waxed_'.length));
  // enchanted_golden_apple has no dedicated texture file on any mirror —
  // it reuses golden_apple's icon with an in-game glow effect applied at
  // render time, so fall back to the base item's texture.
  if (id.startsWith('enchanted_')) out.push(id.slice('enchanted_'.length));
  for (const suffix of ['_wall', '_stairs', '_slab']) {
    if (id.endsWith(suffix)) out.push(id.slice(0, -suffix.length));
  }
  return out;
}

function normalizeId(id: string) {
  return (
    id
      .trim()
      .toLowerCase()
      // Shop plugins append per-shop variant hashes (`potion#variant-…`).
      // No texture ever exists under a fragmented name, and leaving the
      // fragment in would survive the symbol→underscore replacement below
      // as `potion_variant_31e4…`, poisoning every candidate.
      .split('#', 1)[0]
      .replace(/^minecraft:/i, '')
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || ''
  );
}

function slugName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function wikiTitle(value: string) {
  return value.replace(/_/g, ' ').trim().split(/\s+/).map((word) => word ? word[0].toUpperCase() + word.slice(1) : word).join('_');
}

function candidateIds(id: string, name: string) {
  const normalized = normalizeId(id);
  const cleanName = name.trim().toLowerCase();
  const base = Array.from(new Set([normalized, ALIASES[cleanName], slugName(name)])).filter(Boolean);
  const withRenames = base.flatMap((v) => [v, RENAMED_IDS[v]]).filter((v): v is string => Boolean(v));
  const withStructural = withRenames.flatMap((v) => [v, ...structuralVariants(v)]);
  return Array.from(new Set(withStructural));
}

function candidateUrls(ids: string[]) {
  const urls: string[] = [];
  for (const value of ids) {
    urls.push(`https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/data/${PRISMARINE_VERSION}/items/${value}.png`);
    urls.push(`https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/data/${PRISMARINE_VERSION}/blocks/${value}.png`);
    urls.push(`https://minecraft.wiki/images/Invicon_${wikiTitle(value)}.png`);
    urls.push(`https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@${GITHUB_VERSION}/assets/minecraft/textures/item/${value}.png`);
    urls.push(`https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@${GITHUB_VERSION}/assets/minecraft/textures/block/${value}.png`);
    urls.push(`https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/${GITHUB_VERSION}/assets/minecraft/textures/item/${value}.png`);
    urls.push(`https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/${GITHUB_VERSION}/assets/minecraft/textures/block/${value}.png`);
  }
  return Array.from(new Set(urls));
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')?.trim() || '';
  const name = request.nextUrl.searchParams.get('name')?.trim() || id;

  if (!id && !name) return new Response('Missing item id', { status: 400 });
  if (id.length > MAX_QUERY_LENGTH || name.length > MAX_QUERY_LENGTH) {
    return new Response('Item id/name is too long', { status: 400 });
  }

  // Keep the input bounded and filename-like. Unicode display names are
  // accepted, but path/control characters are not allowed to reach the
  // candidate generation logic.
  if (/[%\0-\x1f\x7f]/.test(id) || /[%\0-\x1f\x7f]/.test(name)) {
    return new Response('Invalid item id/name', { status: 400 });
  }

  const ids = candidateIds(id || name, name);

  // 1. Local textures pulled from the actual client jar — instant, no
  // network round-trip, and correct by construction since they came
  // straight from the game rather than a guessed filename on a mirror.
  const local = await findLocal(ids);
  if (local) {
    return new Response(new Uint8Array(local), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  // 2. Fall back to external mirrors for anything not in the local set
  // (e.g. items added by mods, or a newer game version than the jar we
  // shipped with). Race all candidates concurrently instead of trying
  // them one at a time — with dozens of candidate URLs and a timeout
  // each, a sequential loop could take minutes in the worst case.
  async function fetchOne(url: string, signal: AbortSignal): Promise<{ body: ArrayBuffer; contentType: string }> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'WMarket/1.0' },
      cache: 'force-cache',
      signal,
    });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);

    const contentType = response.headers.get('content-type') || '';
    const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
    if (!allowedTypes.has(contentType.split(';', 1)[0].trim().toLowerCase())) {
      throw new Error(`${url}: unsupported image type`);
    }

    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_REMOTE_IMAGE_BYTES) {
      throw new Error(`${url}: image too large`);
    }

    if (!response.body) throw new Error(`${url}: missing response body`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_REMOTE_IMAGE_BYTES) {
          await reader.cancel();
          throw new Error(`${url}: image too large`);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    if (!total) throw new Error(`${url}: empty body`);
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return { body: body.buffer, contentType };
  }

  const urls = candidateUrls(ids);
  const CONCURRENCY = 8;
  const TOTAL_TIMEOUT_MS = 9_000;
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  for (let offset = 0; offset < urls.length; offset += CONCURRENCY) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const batch = urls.slice(offset, offset + CONCURRENCY);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(4_500, remaining));
    try {
      const { body, contentType } = await Promise.any(batch.map((url) => fetchOne(url, controller.signal)));
      controller.abort();
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      // Try the next small batch. Abort the remaining candidates so a single
      // successful response cannot leave losing outbound requests running.
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }

  console.warn(`[minecraft-icon] all ${urls.length} candidate sources failed for id="${id}" name="${name}"`);

  return new Response('Icon not found', {
    status: 404,
    headers: { 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' },
  });
}
