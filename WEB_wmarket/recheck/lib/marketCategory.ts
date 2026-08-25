import { PriceItem } from './api';

/** The 9 filter-chip categories shown on the market dashboard (distinct from
 * the 5-bucket taxonomy in lib/categories.ts, which powers the /categories
 * page and uses a different grouping). Kept in one place so the filter
 * chips and the per-item category badge can never disagree again.
 *
 * v19 ordering rules — first match wins, so specificity matters:
 *   1. POTIONS / ENCHANT (very distinctive prefixes)
 *   2. FISHING (incl. fish SPECIES — 'salmon'/'cod' contain no 'fish'!)
 *   3. GEAR before ORES (an 'iron_helmet' is gear, not an ore)
 *   4. ORES
 *   5. MOB drops (phantom membrane, gunpowder, …)
 *   6. CROPS (cultivated/farmable plants — berries are foraged → NATURAL)
 *   7. NATURAL (foraged/world-found materials)
 *   8. BLOCK fallback
 */
export type MarketCategory =
  | 'POTIONS'
  | 'ENCHANT'
  | 'FISHING'
  | 'ORES'
  | 'CROPS'
  | 'GEAR'
  | 'MOB'
  | 'NATURAL'
  | 'BLOCK';

// BEGIN OVERRIDES — exact-id pins win over every regex below.
const OVERRIDES: Record<string, MarketCategory> = {
  'minecraft:acacia_log': 'NATURAL',
  'minecraft:allium': 'NATURAL',
  'minecraft:amethyst_block': 'ORES',
  'minecraft:amethyst_shard': 'ORES',
  'minecraft:ancient_debris': 'ORES',
  'minecraft:armadillo_scute': 'MOB',
  'minecraft:arrow': 'GEAR',
  'minecraft:azalea': 'NATURAL',
  'minecraft:azure_bluet': 'NATURAL',
  'minecraft:baked_potato': 'CROPS',
  'minecraft:bamboo': 'CROPS',
  'minecraft:bamboo_block': 'NATURAL',
  'minecraft:beetroot': 'CROPS',
  'minecraft:beetroot_seeds': 'CROPS',
  'minecraft:big_dripleaf': 'NATURAL',
  'minecraft:birch_log': 'NATURAL',
  'minecraft:blaze_rod': 'MOB',
  'minecraft:blue_ice': 'NATURAL',
  'minecraft:blue_orchid': 'NATURAL',
  'minecraft:bone': 'MOB',
  'minecraft:bone_block': 'MOB',
  'minecraft:bone_meal': 'MOB',
  'minecraft:bow': 'GEAR',
  'minecraft:breeze_rod': 'MOB',
  'minecraft:brown_mushroom': 'NATURAL',
  'minecraft:cactus': 'CROPS',
  'minecraft:cake': 'CROPS',
  'minecraft:carrot': 'CROPS',
  'minecraft:carrot_on_a_stick': 'GEAR',
  'minecraft:carved_pumpkin': 'CROPS',
  'minecraft:chainmail_boots': 'GEAR',
  'minecraft:chainmail_chestplate': 'GEAR',
  'minecraft:chainmail_helmet': 'GEAR',
  'minecraft:chainmail_leggings': 'GEAR',
  'minecraft:charcoal': 'ORES',
  'minecraft:cherry_log': 'NATURAL',
  'minecraft:chorus_fruit': 'CROPS',
  'minecraft:clay': 'NATURAL',
  'minecraft:clay_ball': 'NATURAL',
  'minecraft:coal': 'ORES',
  'minecraft:coal_block': 'ORES',
  'minecraft:coal_ore': 'ORES',
  'minecraft:coarse_dirt': 'NATURAL',
  'minecraft:cobweb': 'NATURAL',
  'minecraft:cocoa_beans': 'CROPS',
  'minecraft:cod': 'FISHING',
  'minecraft:cooked_cod': 'FISHING',
  'minecraft:cooked_salmon': 'FISHING',
  'minecraft:copper_block': 'ORES',
  'minecraft:copper_ingot': 'ORES',
  'minecraft:copper_ore': 'ORES',
  'minecraft:cornflower': 'NATURAL',
  'minecraft:crimson_fungus': 'NATURAL',
  'minecraft:crimson_stem': 'NATURAL',
  'minecraft:crossbow': 'GEAR',
  'minecraft:dandelion': 'NATURAL',
  'minecraft:dark_oak_log': 'NATURAL',
  'minecraft:dead_bush': 'NATURAL',
  'minecraft:deepslate_coal_ore': 'ORES',
  'minecraft:deepslate_copper_ore': 'ORES',
  'minecraft:deepslate_diamond_ore': 'ORES',
  'minecraft:deepslate_emerald_ore': 'ORES',
  'minecraft:deepslate_gold_ore': 'ORES',
  'minecraft:deepslate_iron_ore': 'ORES',
  'minecraft:deepslate_lapis_ore': 'ORES',
  'minecraft:deepslate_redstone_ore': 'ORES',
  'minecraft:diamond': 'ORES',
  'minecraft:diamond_axe': 'GEAR',
  'minecraft:diamond_block': 'ORES',
  'minecraft:diamond_boots': 'GEAR',
  'minecraft:diamond_chestplate': 'GEAR',
  'minecraft:diamond_helmet': 'GEAR',
  'minecraft:diamond_hoe': 'GEAR',
  'minecraft:diamond_leggings': 'GEAR',
  'minecraft:diamond_ore': 'ORES',
  'minecraft:diamond_pickaxe': 'GEAR',
  'minecraft:diamond_shovel': 'GEAR',
  'minecraft:diamond_sword': 'GEAR',
  'minecraft:dirt': 'NATURAL',
  'minecraft:dragon_egg': 'MOB',
  'minecraft:dried_kelp_block': 'CROPS',
  'minecraft:echo_shard': 'MOB',
  'minecraft:egg': 'NATURAL',
  'minecraft:elytra': 'GEAR',
  'minecraft:emerald': 'ORES',
  'minecraft:emerald_block': 'ORES',
  'minecraft:emerald_ore': 'ORES',
  'minecraft:ender_pearl': 'MOB',
  'minecraft:feather': 'MOB',
  'minecraft:fern': 'NATURAL',
  'minecraft:fire_charge': 'MOB',
  'minecraft:fishing_rod': 'FISHING',
  'minecraft:flint_and_steel': 'GEAR',
  'minecraft:flowering_azalea': 'NATURAL',
  'minecraft:frogspawn': 'MOB',
  'minecraft:ghast_tear': 'MOB',
  'minecraft:glow_berries': 'NATURAL',
  'minecraft:glow_ink_sac': 'FISHING',
  'minecraft:glow_lichen': 'NATURAL',
  'minecraft:gold_block': 'ORES',
  'minecraft:gold_ingot': 'ORES',
  'minecraft:gold_ore': 'ORES',
  'minecraft:golden_axe': 'GEAR',
  'minecraft:golden_boots': 'GEAR',
  'minecraft:golden_chestplate': 'GEAR',
  'minecraft:golden_helmet': 'GEAR',
  'minecraft:golden_hoe': 'GEAR',
  'minecraft:golden_leggings': 'GEAR',
  'minecraft:golden_pickaxe': 'GEAR',
  'minecraft:golden_shovel': 'GEAR',
  'minecraft:golden_sword': 'GEAR',
  'minecraft:gravel': 'NATURAL',
  'minecraft:gunpowder': 'MOB',
  'minecraft:hanging_roots': 'NATURAL',
  'minecraft:hay_block': 'CROPS',
  'minecraft:heart_of_the_sea': 'FISHING',
  'minecraft:honey_bottle': 'CROPS',
  'minecraft:honeycomb': 'MOB',
  'minecraft:ice': 'NATURAL',
  'minecraft:ink_sac': 'FISHING',
  'minecraft:iron_axe': 'GEAR',
  'minecraft:iron_block': 'ORES',
  'minecraft:iron_boots': 'GEAR',
  'minecraft:iron_chestplate': 'GEAR',
  'minecraft:iron_helmet': 'GEAR',
  'minecraft:iron_hoe': 'GEAR',
  'minecraft:iron_ingot': 'ORES',
  'minecraft:iron_leggings': 'GEAR',
  'minecraft:iron_ore': 'ORES',
  'minecraft:iron_pickaxe': 'GEAR',
  'minecraft:iron_shovel': 'GEAR',
  'minecraft:iron_sword': 'GEAR',
  'minecraft:jungle_log': 'NATURAL',
  'minecraft:kelp': 'NATURAL',
  'minecraft:lapis_block': 'ORES',
  'minecraft:lapis_lazuli': 'ORES',
  'minecraft:lapis_ore': 'ORES',
  'minecraft:large_fern': 'NATURAL',
  'minecraft:lead': 'GEAR',
  'minecraft:leather': 'MOB',
  'minecraft:leather_boots': 'GEAR',
  'minecraft:leather_chestplate': 'GEAR',
  'minecraft:leather_helmet': 'GEAR',
  'minecraft:leather_horse_armor': 'NATURAL',
  'minecraft:leather_leggings': 'GEAR',
  'minecraft:lilac': 'NATURAL',
  'minecraft:lily_of_the_valley': 'NATURAL',
  'minecraft:lily_pad': 'FISHING',
  'minecraft:mace': 'GEAR',
  'minecraft:magma_cream': 'MOB',
  'minecraft:mangrove_log': 'NATURAL',
  'minecraft:mangrove_propagule': 'NATURAL',
  'minecraft:melon': 'CROPS',
  'minecraft:melon_seeds': 'CROPS',
  'minecraft:melon_slice': 'CROPS',
  'minecraft:moss_block': 'NATURAL',
  'minecraft:moss_carpet': 'NATURAL',
  'minecraft:mud': 'NATURAL',
  'minecraft:name_tag': 'GEAR',
  'minecraft:nautilus_shell': 'FISHING',
  'minecraft:nether_gold_ore': 'ORES',
  'minecraft:nether_quartz_ore': 'ORES',
  'minecraft:nether_star': 'MOB',
  'minecraft:nether_wart': 'CROPS',
  'minecraft:netherite_axe': 'GEAR',
  'minecraft:netherite_block': 'ORES',
  'minecraft:netherite_boots': 'GEAR',
  'minecraft:netherite_chestplate': 'GEAR',
  'minecraft:netherite_helmet': 'GEAR',
  'minecraft:netherite_hoe': 'GEAR',
  'minecraft:netherite_ingot': 'ORES',
  'minecraft:netherite_leggings': 'GEAR',
  'minecraft:netherite_pickaxe': 'GEAR',
  'minecraft:netherite_scrap': 'ORES',
  'minecraft:netherite_shovel': 'GEAR',
  'minecraft:netherite_sword': 'GEAR',
  'minecraft:netherite_upgrade_smithing_template': 'ORES',
  'minecraft:oak_log': 'NATURAL',
  'minecraft:orange_tulip': 'NATURAL',
  'minecraft:oxeye_daisy': 'NATURAL',
  'minecraft:packed_ice': 'NATURAL',
  'minecraft:packed_mud': 'NATURAL',
  'minecraft:pale_oak_log': 'NATURAL',
  'minecraft:peony': 'NATURAL',
  'minecraft:phantom_membrane': 'MOB',
  'minecraft:pink_petals': 'NATURAL',
  'minecraft:pink_tulip': 'NATURAL',
  'minecraft:podzol': 'NATURAL',
  'minecraft:poisonous_potato': 'CROPS',
  'minecraft:poppy': 'NATURAL',
  'minecraft:potato': 'CROPS',
  'minecraft:prismarine_crystals': 'MOB',
  'minecraft:prismarine_shard': 'MOB',
  'minecraft:pufferfish': 'FISHING',
  'minecraft:pumpkin': 'CROPS',
  'minecraft:pumpkin_seeds': 'CROPS',
  'minecraft:quartz': 'ORES',
  'minecraft:quartz_block': 'ORES',
  'minecraft:rabbit_foot': 'MOB',
  'minecraft:rabbit_hide': 'MOB',
  'minecraft:raw_copper': 'ORES',
  'minecraft:raw_gold': 'ORES',
  'minecraft:raw_iron': 'ORES',
  'minecraft:red_mushroom': 'NATURAL',
  'minecraft:red_sand': 'NATURAL',
  'minecraft:red_tulip': 'NATURAL',
  'minecraft:redstone': 'ORES',
  'minecraft:redstone_block': 'ORES',
  'minecraft:redstone_ore': 'ORES',
  'minecraft:rooted_dirt': 'NATURAL',
  'minecraft:rose_bush': 'NATURAL',
  'minecraft:rotten_flesh': 'MOB',
  'minecraft:saddle': 'GEAR',
  'minecraft:salmon': 'FISHING',
  'minecraft:sand': 'NATURAL',
  'minecraft:sea_pickle': 'NATURAL',
  'minecraft:seagrass': 'NATURAL',
  'minecraft:shears': 'GEAR',
  'minecraft:shield': 'GEAR',
  'minecraft:short_grass': 'NATURAL',
  'minecraft:shulker_shell': 'MOB',
  'minecraft:slime_ball': 'MOB',
  'minecraft:small_dripleaf': 'NATURAL',
  'minecraft:sniffer_egg': 'MOB',
  'minecraft:snow': 'NATURAL',
  'minecraft:snow_block': 'NATURAL',
  'minecraft:snowball': 'NATURAL',
  'minecraft:spectral_arrow': 'GEAR',
  'minecraft:spider_eye': 'MOB',
  'minecraft:sponge': 'NATURAL',
  'minecraft:spore_blossom': 'NATURAL',
  'minecraft:spruce_log': 'NATURAL',
  'minecraft:stone_axe': 'GEAR',
  'minecraft:stone_hoe': 'GEAR',
  'minecraft:stone_pickaxe': 'GEAR',
  'minecraft:stone_shovel': 'GEAR',
  'minecraft:stone_sword': 'GEAR',
  'minecraft:string': 'MOB',
  'minecraft:sugar_cane': 'CROPS',
  'minecraft:sunflower': 'NATURAL',
  'minecraft:sweet_berries': 'NATURAL',
  'minecraft:terracotta': 'NATURAL',
  'minecraft:tipped_arrow': 'GEAR',
  'minecraft:torchflower': 'NATURAL',
  'minecraft:totem_of_undying': 'MOB',
  'minecraft:trident': 'GEAR',
  'minecraft:tropical_fish': 'FISHING',
  'minecraft:turtle_egg': 'MOB',
  'minecraft:turtle_helmet': 'GEAR',
  'minecraft:turtle_scute': 'NATURAL',
  'minecraft:vine': 'NATURAL',
  'minecraft:warped_fungus': 'NATURAL',
  'minecraft:warped_fungus_on_a_stick': 'GEAR',
  'minecraft:warped_stem': 'NATURAL',
  'minecraft:wet_sponge': 'NATURAL',
  'minecraft:wheat': 'CROPS',
  'minecraft:wheat_seeds': 'CROPS',
  'minecraft:white_tulip': 'NATURAL',
  'minecraft:wither_rose': 'NATURAL',
  'minecraft:wolf_armor': 'MOB',
  'minecraft:wooden_axe': 'GEAR',
  'minecraft:wooden_hoe': 'GEAR',
  'minecraft:wooden_pickaxe': 'GEAR',
  'minecraft:wooden_shovel': 'GEAR',
  'minecraft:wooden_sword': 'GEAR',

// END OVERRIDES
};

export function marketCategoryOf(id: string, name = ''): MarketCategory {
  const cleanId = id.toLowerCase().replace(/^minecraft:/, '').split('#')[0];
  const pinned = OVERRIDES[cleanId];
  if (pinned) return pinned;
  const cleanName = name.toLowerCase();
  const hay = `${cleanId} ${cleanName}`;

  if (/potion|tipped_arrow/.test(hay)) return 'POTIONS';
  if (/enchanted|enchant/.test(hay)) return 'ENCHANT';

  if (/fishing_rod|fishing|fish|salmon|cod|puffer|squid|nautilus|trident|tropical/.test(cleanId)) return 'FISHING';

  if (/sword|axe|pickaxe|shovel|hoe|helmet|chestplate|leggings|boots|armor|bow|crossbow|shield|elytra|mace|trim|shears|flint_and_steel/.test(hay))
    return 'GEAR';

  if (/ore|raw_|ancient_debris|netherite|diamond|emerald|gold|iron|copper|coal|lapis|redstone|quartz|amethyst_shard/.test(cleanId))
    return 'ORES';

  if (/membrane|spawn_egg|head|skull|pearl|blaze|ghast|slime|magma_cream|gunpowder|rotten|bone|spider_eye|string|leather|feather|arrow|scute|shulker_shell|echo_shard|totem|nether_star|fire_charge|prismarine|ink_sac|phosphor|rabbit_foot|rabbit_hide|honeycomb/.test(cleanId))
    return 'MOB';

  if (/apple|bread|carrot|potato|beetroot|wheat|melon|pumpkin|cocoa|seed|crop|sugar|nether_wart|chorus|cactus|bamboo|honey_bottle|cake|cookie|stew|soup|rabbit_stew|dried_kelp/.test(hay))
    return 'CROPS';

  if (/berry|log|wood|planks|leaves|sapling|flower|grass|vine|moss|dirt|sand|gravel|clay|coral|honeycomb|snowball|snow_|ice|egg|kelp|seagrass|lily_pad|sponge|slime_ball|poppy|dandelion|orchid|allium|bluet|tulip|daisy|cornflower|lily_of_the_valley|wither_rose|rose_bush|peony|lilac|sunflower|pitcher_plant|torchflower|azalea|propagule|spore_blossom|dripleaf|hanging_roots|pumpkin_seeds|melon_seeds|dead_bush|bush|fern|short_grass/.test(hay))
    return 'NATURAL';

  return 'BLOCK';
}

export function marketCategoryOfItem(item: PriceItem): MarketCategory {
  return marketCategoryOf(item.id, item.name);
}
