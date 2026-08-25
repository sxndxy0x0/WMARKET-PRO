import { PriceItem } from './api';

export type ItemCategory = 'block' | 'gear' | 'food' | 'shop' | 'misc';

export type CategoryMeta = {
  id: ItemCategory;
  label: string;
  icon: string;
  description: string;
};

export const CATEGORIES: CategoryMeta[] = [
  { id: 'block', label: 'BLOCK', icon: 'grass_block', description: 'Building blocks & materials' },
  { id: 'gear', label: 'GEAR & ENCHAN', icon: 'diamond_sword', description: 'Tools, armor & enchanting' },
  { id: 'food', label: 'FOOD & POTION', icon: 'golden_apple', description: 'Food & brewing' },
  { id: 'shop', label: 'COINS SHOP', icon: 'emerald', description: 'Purchasable shop items' },
  { id: 'misc', label: 'MISC', icon: 'chest', description: 'Everything else' },
];

const SHOP_EXACT = new Set([
  'spawner',
  'nether_star',
  'conduit',
  'totem_of_undying',
  'elytra',
  'heavy_core',
  'beacon',
  'enchanted_golden_apple',
  'trial_key',
  'ominous_trial_key',
  'heart_of_the_sea',
  'nautilus_shell',
  'trident',
  'mace',
]);

const SHOP_SUFFIXES = ['_spawn_egg', '_skull', '_head'];
const SHOP_PREFIXES = ['music_disc_'];

const GEAR_SUFFIXES = [
  '_pickaxe',
  '_axe',
  '_shovel',
  '_hoe',
  '_sword',
  '_helmet',
  '_chestplate',
  '_leggings',
  '_boots',
];

const GEAR_EXACT = new Set([
  'bow',
  'crossbow',
  'shield',
  'fishing_rod',
  'shears',
  'flint_and_steel',
  'brush',
  'carrot_on_a_stick',
  'warped_fungus_on_a_stick',
  'enchanted_book',
  'book',
  'anvil',
  'enchanting_table',
  'grindstone',
  'smithing_table',
  'experience_bottle',
  'name_tag',
  'lead',
  'saddle',
]);

const FOOD_EXACT = new Set([
  'apple',
  'golden_apple',
  'bread',
  'cookie',
  'cake',
  'melon',
  'melon_slice',
  'pumpkin_pie',
  'chorus_fruit',
  'honey_bottle',
  'milk_bucket',
  'beetroot_soup',
  'rabbit_stew',
  'suspicious_stew',
  'mushroom_stew',
  'beef',
  'cooked_beef',
  'porkchop',
  'cooked_porkchop',
  'chicken',
  'cooked_chicken',
  'mutton',
  'cooked_mutton',
  'rabbit',
  'cooked_rabbit',
  'cod',
  'cooked_cod',
  'salmon',
  'cooked_salmon',
  'tropical_fish',
  'pufferfish',
  'potato',
  'baked_potato',
  'poisonous_potato',
  'carrot',
  'golden_carrot',
  'beetroot',
  'wheat',
  'egg',
  'kelp',
  'dried_kelp',
  'sweet_berries',
  'glow_berries',
  'spider_eye',
  'fermented_spider_eye',
  'glistering_melon_slice',
  'pitcher_pod',
  'torchflower',
  'beetroot_seeds',
  'wheat_seeds',
  'melon_seeds',
  'pumpkin_seeds',
  'cocoa_beans',
  'sugar',
  'potion',
  'splash_potion',
  'lingering_potion',
  'tipped_arrow',
  'dragon_breath',
  'nether_wart',
  'blaze_powder',
  'ghast_tear',
  'magma_cream',
  'rabbit_foot',
  'phantom_membrane',
  'turtle_scute',
  'brewing_stand',
  'cauldron',
  'glass_bottle',
  'gunpowder',
  'glowstone_dust',
  'redstone',
  'brown_mushroom',
  'red_mushroom',
  'crimson_fungus',
  'warped_fungus',
  'honeycomb',
  'goat_horn',
]);

const FOOD_SUFFIXES = ['_stew', '_soup', '_pie'];

const BLOCK_SUFFIXES = [
  '_block',
  '_slab',
  '_stairs',
  '_wall',
  '_planks',
  '_log',
  '_wood',
  '_leaves',
  '_sapling',
  '_door',
  '_trapdoor',
  '_fence',
  '_fence_gate',
  '_gate',
  '_sign',
  '_button',
  '_pressure_plate',
  '_boat',
  '_raft',
  '_chest_boat',
  '_chest_raft',
  '_ore',
  '_raw_block',
  '_ingot',
  '_nugget',
  '_shard',
  '_cluster',
  '_bud',
  '_stained_glass',
  '_stained_glass_pane',
  '_concrete',
  '_concrete_powder',
  '_glazed_terracotta',
  '_terracotta',
  '_wool',
  '_carpet',
  '_bed',
  '_banner',
  '_candle',
  '_shulker_box',
  '_hanging_sign',
  '_mosaic_slab',
  '_mosaic_stairs',
];

const BLOCK_EXACT = new Set([
  'stone',
  'cobblestone',
  'deepslate',
  'netherrack',
  'obsidian',
  'basalt',
  'blackstone',
  'sandstone',
  'prismarine',
  'quartz',
  'terracotta',
  'glass',
  'sand',
  'gravel',
  'dirt',
  'grass_block',
  'clay',
  'mud',
  'snow',
  'ice',
  'barrel',
  'beehive',
  'bee_nest',
  'bell',
  'lantern',
  'torch',
  'campfire',
  'furnace',
  'blast_furnace',
  'smoker',
  'hopper',
  'dispenser',
  'dropper',
  'piston',
  'sticky_piston',
  'observer',
  'repeater',
  'comparator',
  'lever',
  'rail',
  'powered_rail',
  'detector_rail',
  'activator_rail',
  'target',
  'note_block',
  'jukebox',
  'lectern',
  'bookshelf',
  'scaffolding',
  'ladder',
  'chain',
  'iron_bars',
  'ancient_debris',
  'hay_bale',
  'bone_block',
  'coal_block',
  'iron_block',
  'gold_block',
  'diamond_block',
  'emerald_block',
  'lapis_block',
  'redstone_block',
  'copper_block',
  'raw_iron_block',
  'raw_gold_block',
  'raw_copper_block',
  'respawn_anchor',
  'lodestone',
  'crying_obsidian',
  'end_stone',
  'purpur_block',
  'magma_block',
  'glowstone',
  'sea_lantern',
  'soul_sand',
  'soul_soil',
  'tnt',
  'sponge',
  'wet_sponge',
  'slime_block',
  'honey_block',
  'sculk',
  'sculk_catalyst',
  'sculk_shrieker',
  'sculk_sensor',
  'calibrated_sculk_sensor',
  'amethyst_block',
  'calcite',
  'tuff',
  'dripstone_block',
  'pointed_dripstone',
  'moss_block',
  'moss_carpet',
  'rooted_dirt',
  'podzol',
  'mycelium',
  'farmland',
  'dirt_path',
  'crafting_table',
  'chest',
  'trapped_chest',
  'ender_chest',
  'shulker_box',
]);

function matchesSuffix(id: string, suffixes: string[]) {
  return suffixes.some((suffix) => id.endsWith(suffix));
}

function matchesPrefix(id: string, prefixes: string[]) {
  return prefixes.some((prefix) => id.startsWith(prefix));
}

export function categorizeItem(id: string): ItemCategory {
  if (SHOP_EXACT.has(id) || matchesSuffix(id, SHOP_SUFFIXES) || matchesPrefix(id, SHOP_PREFIXES)) {
    return 'shop';
  }

  if (FOOD_EXACT.has(id) || matchesSuffix(id, FOOD_SUFFIXES)) {
    return 'food';
  }

  if (GEAR_EXACT.has(id) || matchesSuffix(id, GEAR_SUFFIXES)) {
    return 'gear';
  }

  if (BLOCK_EXACT.has(id) || matchesSuffix(id, BLOCK_SUFFIXES)) {
    return 'block';
  }

  // Flowers, dyes, pottery, bundles, rails, etc.
  if (
    id.includes('pottery') ||
    id.endsWith('_dye') ||
    id.endsWith('_bundle') ||
    id.endsWith('_flower') ||
    id.endsWith('_sapling') ||
    id.endsWith('_leaves') ||
    id.endsWith('_log') ||
    id.endsWith('_planks')
  ) {
    return 'block';
  }

  return 'misc';
}

export function groupItemsByCategory(items: PriceItem[]) {
  const groups = new Map<ItemCategory, PriceItem[]>(
    CATEGORIES.map((c) => [c.id, [] as PriceItem[]])
  );

  for (const item of items) {
    groups.get(categorizeItem(item.id))!.push(item);
  }

  return groups;
}
