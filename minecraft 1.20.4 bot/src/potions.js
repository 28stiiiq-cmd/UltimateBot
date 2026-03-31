class Potions {
    constructor(bot, memory, crafting, inventory) {
        this.bot = bot;
        this.memory = memory;
        this.crafting = crafting;
        this.inventory = inventory;
        
        this.brewingStand = null;
        this.enchantingTable = null;
        
        // Рецепты зелий
        this.potionRecipes = {
            'awkward': { base: 'water_bottle', ingredient: 'nether_wart', result: 'awkward_potion' },
            'mundane': { base: 'water_bottle', ingredient: 'glowstone_dust', result: 'mundane_potion' },
            'thick': { base: 'water_bottle', ingredient: 'glowstone_dust', result: 'thick_potion' },
            
            // Основные зелья
            'fire_resistance': { base: 'awkward_potion', ingredient: 'magma_cream', result: 'potion_fire_resistance', duration: 180 },
            'speed': { base: 'awkward_potion', ingredient: 'sugar', result: 'potion_speed', duration: 180 },
            'strength': { base: 'awkward_potion', ingredient: 'blaze_powder', result: 'potion_strength', duration: 180 },
            'healing': { base: 'awkward_potion', ingredient: 'glistering_melon_slice', result: 'potion_healing', duration: 0 },
            'night_vision': { base: 'awkward_potion', ingredient: 'golden_carrot', result: 'potion_night_vision', duration: 180 },
            'invisibility': { base: 'night_vision_potion', ingredient: 'fermented_spider_eye', result: 'potion_invisibility', duration: 180 },
            'leaping': { base: 'awkward_potion', ingredient: 'rabbit_foot', result: 'potion_leaping', duration: 180 },
            'water_breathing': { base: 'awkward_potion', ingredient: 'pufferfish', result: 'potion_water_breathing', duration: 180 },
            'slow_falling': { base: 'awkward_potion', ingredient: 'phantom_membrane', result: 'potion_slow_falling', duration: 180 },
            
            // Усилители
            'glowstone': { modifier: 'glowstone_dust', effect: 'extended', durationMultiplier: 0.5, levelMultiplier: 2 },
            'redstone': { modifier: 'redstone', effect: 'duration', durationMultiplier: 2, levelMultiplier: 1 }
        };
    }
    
    // Найти стойку для зелий
    findBrewingStand() {
        const stand = this.bot.findBlock({
            matching: require('minecraft-data')(this.bot.version)?.blocksByName?.['brewing_stand']?.id || 0,
            maxDistance: 10
        });
        if (stand) {
            this.brewingStand = stand.position;
            return true;
        }
        return false;
    }
    
    // Поставить стойку для зелий
    async placeBrewingStand() {
        if (this.crafting.hasItem('brewing_stand')) {
            const pos = this.bot.entity.position;
            const targetPos = { x: Math.floor(pos.x) + 1, y: Math.floor(pos.y), z: Math.floor(pos.z) };
            const block = this.bot.blockAt(targetPos);
            
            if (block && block.name === 'air') {
                const stand = this.crafting.getItem('brewing_stand');
                await this.bot.equip(stand, 'hand');
                await this.bot.placeBlock(targetPos);
                this.brewingStand = targetPos;
                return true;
            }
        }
        return false;
    }
    
    // Сварить зелье
    async brewPotion(potionType, count = 1) {
        const recipe = this.potionRecipes[potionType];
        if (!recipe) {
            console.log(`[Potions] Рецепт ${potionType} не найден`);
            return false;
        }
        
        // Найти или поставить стойку
        if (!this.brewingStand && !this.findBrewingStand()) {
            await this.placeBrewingStand();
        }
        
        if (!this.brewingStand) {
            console.log('[Potions] Нет стойки для зелий');
            return false;
        }
        
        // Проверить ингредиенты
        const baseCount = this.crafting.countItem(recipe.base);
        const ingredientCount = this.crafting.countItem(recipe.ingredient);
        
        if (baseCount < count || ingredientCount < count) {
            console.log(`[Potions] Не хватает ингредиентов: ${recipe.base} x${count}, ${recipe.ingredient} x${count}`);
            return false;
        }
        
        // Открыть стойку
        const standBlock = this.bot.blockAt(this.brewingStand);
        await this.bot.lookAt(this.brewingStand);
        await this.bot.activateBlock(standBlock);
        await new Promise(r => setTimeout(r, 500));
        
        try {
            const window = this.bot.currentWindow;
            if (!window) return false;
            
            // Слоты: 0-2 для бутылок, 3 для ингредиента, 4 для топлива (blaze powder)
            for (let i = 0; i < count && i < 3; i++) {
                const bottle = this.crafting.getItem(recipe.base);
                if (bottle) {
                    await this.bot.clickWindow(bottle.slot, 0, 0);
                    await this.bot.clickWindow(i, 0, 0);
                }
            }
            
            const ingredient = this.crafting.getItem(recipe.ingredient);
            if (ingredient) {
                await this.bot.clickWindow(ingredient.slot, 0, 0);
                await this.bot.clickWindow(3, 0, 0);
            }
            
            // Добавить огненный порошок если нет
            const blazePowder = this.crafting.getItem('blaze_powder');
            if (!this.bot.currentWindow.slots[4] && blazePowder) {
                await this.bot.clickWindow(blazePowder.slot, 0, 0);
                await this.bot.clickWindow(4, 0, 0);
            }
            
            // Ждём варки
            await new Promise(r => setTimeout(r, 20000));
            
            // Забираем результат
            for (let i = 0; i < 3; i++) {
                if (window.slots[i]) {
                    await this.bot.clickWindow(i, 0, 0);
                }
            }
            
            this.bot.closeWindow(window);
            console.log(`[Potions] Сварено ${count} зелья ${potionType}`);
            return true;
            
        } catch(err) {
            console.log(`[Potions] Ошибка варки: ${err.message}`);
            if (this.bot.currentWindow) this.bot.closeWindow(this.bot.currentWindow);
            return false;
        }
    }
    
    // Использовать зелье
    async drinkPotion(potionType) {
        const potionName = this.potionRecipes[potionType]?.result || potionType;
        const potion = this.crafting.getItem(potionName);
        
        if (!potion) {
            console.log(`[Potions] Нет зелья ${potionType}`);
            return false;
        }
        
        await this.bot.equip(potion, 'hand');
        await this.bot.consume();
        console.log(`[Potions] Выпито зелье ${potionType}`);
        return true;
    }
}

module.exports = Potions;
