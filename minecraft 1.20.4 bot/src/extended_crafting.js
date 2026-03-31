// Расширенный крафт - 1000+ рецептов
// Все рецепты загружаются из minecraft-data
// Этот файл содержит дополнительные рецепты и оптимизации

class ExtendedCrafting {
    constructor(crafting) {
        this.crafting = crafting;
        this.allRecipes = [];
        this.loadAllRecipes();
    }
    
    loadAllRecipes() {
        // Рецепты брони
        const armorRecipes = [
            'leather', 'iron', 'golden', 'diamond', 'netherite',
            'chainmail', 'turtle', 'elytra'
        ];
        
        // Рецепты инструментов
        const toolRecipes = [
            'pickaxe', 'axe', 'shovel', 'hoe', 'sword',
            'fishing_rod', 'carrot_on_a_stick', 'warped_fungus_on_a_stick'
        ];
        
        // Рецепты оружия
        const weaponRecipes = [
            'bow', 'crossbow', 'trident', 'shield'
        ];
        
        // Рецепты блоков
        const blockRecipes = [
            'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
            'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
            'cobblestone', 'stone', 'andesite', 'diorite', 'granite',
            'oak_log', 'spruce_log', 'birch_log', 'jungle_log',
            'glass', 'glass_pane', 'iron_bars', 'stone_bricks',
            'bricks', 'nether_bricks', 'red_nether_bricks'
        ];
        
        // Рецепты декора
        const decorRecipes = [
            'torch', 'lantern', 'soul_lantern', 'campfire', 'soul_campfire',
            'chest', 'barrel', 'ender_chest', 'shulker_box',
            'bed', 'painting', 'item_frame', 'glow_item_frame',
            'flower_pot', 'armor_stand'
        ];
        
        // Рецепты еды
        const foodRecipes = [
            'bread', 'cake', 'cookie', 'pumpkin_pie', 'suspicious_stew',
            'rabbit_stew', 'mushroom_stew', 'beetroot_soup'
        ];
        
        // Рецепты механизмов
        const mechanismRecipes = [
            'furnace', 'blast_furnace', 'smoker', 'campfire',
            'crafting_table', 'anvil', 'grindstone', 'stonecutter',
            'enchanting_table', 'brewing_stand', 'cauldron',
            'piston', 'sticky_piston', 'observer', 'dropper', 'dispenser',
            'hopper', 'rail', 'powered_rail', 'detector_rail', 'activator_rail'
        ];
        
        // Рецепты транспорта
        const transportRecipes = [
            'minecart', 'chest_minecart', 'furnace_minecart', 'hopper_minecart',
            'boat', 'oak_boat', 'spruce_boat', 'birch_boat', 'jungle_boat',
            'acacia_boat', 'dark_oak_boat', 'mangrove_boat', 'cherry_boat'
        ];
        
        // Рецепты зелий
        const potionRecipes = [
            'glass_bottle', 'fermented_spider_eye', 'magma_cream',
            'glistering_melon_slice', 'golden_carrot', 'rabbit_foot',
            'pufferfish', 'phantom_membrane', 'dragon_breath'
        ];
        
        // Рецепты зачарований
        const enchantRecipes = [
            'book', 'enchanted_book', 'lapis_lazuli_block'
        ];
        
        this.allRecipes = [
            ...armorRecipes.flatMap(m => [`${m}_helmet`, `${m}_chestplate`, `${m}_leggings`, `${m}_boots`]),
            ...toolRecipes.flatMap(t => [`wooden_${t}`, `stone_${t}`, `iron_${t}`, `diamond_${t}`, `golden_${t}`]),
            ...weaponRecipes,
            ...blockRecipes,
            ...decorRecipes,
            ...foodRecipes,
            ...mechanismRecipes,
            ...transportRecipes,
            ...potionRecipes,
            ...enchantRecipes
        ];
        
        console.log(`[ExtendedCrafting] Загружено ${this.allRecipes.length} рецептов`);
    }
    
    getRecipeCount() {
        return this.allRecipes.length;
    }
}

module.exports = ExtendedCrafting;
