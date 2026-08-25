// One-shot generator: pins exact categories for every known vanilla item that
// exists in the live catalog. Regex stays as fallback for anything unpinned.
import { writeFileSync } from 'node:fs';

const C = {
  FISHING: ['cod','cooked_cod','salmon','cooked_salmon','tropical_fish','pufferfish','fishing_rod','nautilus_shell','heart_of_the_sea','ink_sac','glow_ink_sac','lily_pad'],
  GEAR: ['bow','crossbow','arrow','spectral_arrow','tipped_arrow','shield','elytra','mace','trident','shears','flint_and_steel','carrot_on_a_stick','warped_fungus_on_a_stick',
    'wooden_sword','stone_sword','iron_sword','golden_sword','diamond_sword','netherite_sword','wooden_pickaxe','stone_pickaxe','iron_pickaxe','golden_pickaxe','diamond_pickaxe','netherite_pickaxe',
    'wooden_axe','stone_axe','iron_axe','golden_axe','diamond_axe','netherite_axe','wooden_shovel','stone_shovel','iron_shovel','golden_shovel','diamond_shovel','netherite_shovel',
    'wooden_hoe','stone_hoe','iron_hoe','golden_hoe','diamond_hoe','netherite_hoe',
    'leather_helmet','leather_chestplate','leather_leggings','leather_boots','chainmail_helmet','chainmail_chestplate','chainmail_leggings','chainmail_boots',
    'iron_helmet','iron_chestplate','iron_leggings','iron_boots','golden_helmet','golden_chestplate','golden_leggings','golden_boots',
    'diamond_helmet','diamond_chestplate','diamond_leggings','diamond_boots','netherite_helmet','netherite_chestplate','netherite_leggings','netherite_boots',
    'turtle_helmet','horse_armor','lead','saddle','name_tag'],
  ORES: ['coal','charcoal','raw_iron','raw_copper','raw_gold','iron_ingot','copper_ingot','gold_ingot','netherite_ingot','netherite_scrap','netherite_upgrade_smithing_template',
    'diamond','emerald','lapis_lazuli','redstone','redstone_dust','quartz','amethyst_shard','coal_block','iron_block','gold_block','diamond_block','emerald_block','lapis_block','redstone_block','copper_block','netherite_block','quartz_block','amethyst_block',
    'coal_ore','deepslate_coal_ore','iron_ore','deepslate_iron_ore','copper_ore','deepslate_copper_ore','gold_ore','deepslate_gold_ore','nether_gold_ore','diamond_ore','deepslate_diamond_ore','emerald_ore','deepslate_emerald_ore','lapis_ore','deepslate_lapis_ore','redstone_ore','deepslate_redstone_ore','nether_quartz_ore','ancient_debris'],
  MOB: ['phantom_membrane','blaze_rod','blaze_powder','breeze_rod','ghast_tear','slime_ball','magma_cream','gunpowder','rotten_flesh','bone','bone_meal','bone_block','spider_eye','string','leather','feather','rabbit_foot','rabbit_hide','shulker_shell','echo_shard','ender_pearl','ender_eye','dragon_breath','dragon_egg','totem_of_undying','nether_star','fire_charge','prismarine_shard','prismarine_crystals','scute','armadillo_scute','wolf_armor','sniffer_egg','turtle_egg','frogspawn','honeycomb'],
  CROPS: ['wheat','wheat_seeds','bread','cookie','cake','pumpkin_pie','carrot','golden_carrot','potato','baked_potato','poisonous_potato','beetroot','beetroot_soup','beetroot_seeds','melon','melon_slice','melon_seeds','pumpkin','carved_pumpkin','pumpkin_seeds','sugar','sugar_cane','cocoa_beans','nether_wart','chorus_fruit','popped_chorus_fruit','cactus','bamboo','honey_bottle','mushroom_stew','rabbit_stew','beetroot_seeds','sweet_berries_pipe','dried_kelp_block','hay_block'],
  NATURAL: ['sweet_berries','glow_berries','apple','golden_apple','enchanted_golden_apple','kelp','seagrass','sea_pickle','dead_bush','short_grass','fern','large_fern','snowball','snow_block','ice','packed_ice','blue_ice','egg','turtle_scute',
    'oak_log','spruce_log','birch_log','jungle_log','acacia_log','dark_oak_log','mangrove_log','cherry_log','pale_oak_log','crimson_stem','warped_stem','bamboo_block',
    'poppy','dandelion','blue_orchid','allium','azure_bluet','red_tulip','orange_tulip','white_tulip','pink_tulip','oxeye_daisy','cornflower','lily_of_the_valley','wither_rose','torchflower','sunflower','lilac','rose_bush','peony','pitcher_plant','flowering_azalea','azalea','spore_blossom','big_dripleaf','small_dripleaf','hanging_roots','mangrove_propagule','pink_petals',
    'brown_mushroom','red_mushroom','crimson_fungus','warped_fungus','vine','glow_lichen','moss_block','moss_carpet','pumpkin_seeds','melon_seeds','cobweb','sponge','wet_sponge','clay_ball','clay','terracotta','gravel','flint','sand','red_sand','dirt','coarse_dirt','rooted_dirt','podzol','mud','packed_mud','snow','feather','leather_horse_armor'],
};

const catOf = {};
for (const [cat, items] of Object.entries(C)) for (const it of items) if (!(it in catOf)) catOf[it] = cat;

const res = await fetch('http://localhost:3000/api/prices?server=' + encodeURIComponent('play.minedream.city:25565'));
const arr = await res.json();
const ids = [...new Set(arr.map((x) => String(x.id).toLowerCase().replace(/^minecraft:/, '').split('#')[0]))].sort();

const pinned = ids.filter((id) => id in catOf);
const body = pinned.map((id) => `  'minecraft:${id}': '${catOf[id]}',`).join('\n');

const file = new URL('../lib/marketCategory.ts', import.meta.url);
const fs = await import('node:fs');
let src = fs.readFileSync(file, 'utf8');
src = src.replace(/(\/\/ BEGIN OVERRIDES[\s\S]*?\n)([\s\S]*?)(\n\/\/ END OVERRIDES)/, `$1${body}\n$3`);
fs.writeFileSync(file, src);
console.log('catalog ids:', ids.length, '| pinned:', pinned.length, '| left to regex:', ids.length - pinned.length);
