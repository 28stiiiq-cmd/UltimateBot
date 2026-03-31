const { goals } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');

class ChestManager {
    constructor(bot, inventory, crafting) {
        this.bot = bot;
        this.inventory = inventory;
        this.crafting = crafting;
        this.chests = new Map();
    }
    
    // Найти ближайший сундук
    findNearestChest(maxDistance = 20) {
        const mcData = require('minecraft-data')(this.bot.version);
        const ids = ['chest', 'trapped_chest', 'ender_chest']
            .map(n => mcData?.blocksByName?.[n]?.id).filter(id => id !== undefined);
        if (ids.length === 0) return null;
        return this.bot.findBlock({ matching: ids, maxDistance });
    }
    
    // Открыть сундук
    async openChest(chestBlock) {
        if (!chestBlock) return null;
        
        await this.bot.lookAt(chestBlock.position);
        await this.bot.activateBlock(chestBlock);
        await new Promise(r => setTimeout(r, 500));
        
        return this.bot.currentWindow;
    }
    
    // Положить предметы в сундук
    async depositItems(itemsToDeposit) {
        const chest = this.findNearestChest();
        if (!chest) {
            console.log('[Chest] Нет сундука рядом');
            return false;
        }
        
        const window = await this.openChest(chest);
        if (!window) return false;
        
        let deposited = 0;
        for (const itemName of itemsToDeposit) {
            const item = this.inventory.getItem(itemName);
            if (item && item.count > 64) {
                // Оставляем стак в инвентаре
                const toDeposit = item.count - 64;
                await this.bot.clickWindow(item.slot, 0, 0);
                await this.bot.clickWindow(-999, 0, 0); // Выкинуть в сундук
                deposited += toDeposit;
                console.log(`[Chest] Положил ${toDeposit}x ${itemName}`);
            } else if (item && item.count <= 64) {
                await this.bot.clickWindow(item.slot, 0, 0);
                await this.bot.clickWindow(-999, 0, 0);
                deposited += item.count;
                console.log(`[Chest] Положил ${item.count}x ${itemName}`);
            }
        }
        
        this.bot.closeWindow(window);
        console.log(`[Chest] Всего положено: ${deposited} предметов`);
        return deposited > 0;
    }
    
    // Забрать предметы из сундука
    async withdrawItems(itemsToWithdraw) {
        const chest = this.findNearestChest();
        if (!chest) {
            console.log('[Chest] Нет сундука рядом');
            return false;
        }
        
        const window = await this.openChest(chest);
        if (!window) return false;
        
        let withdrawn = 0;
        for (let i = 0; i < window.containerItems.length; i++) {
            const item = window.containerItems[i];
            if (item && itemsToWithdraw.includes(item.name)) {
                const freeSlots = this.inventory.getFreeSlots();
                if (freeSlots > 0) {
                    await this.bot.clickWindow(i, 0, 0);
                    await this.bot.clickWindow(-999, 0, 0);
                    withdrawn += item.count;
                    console.log(`[Chest] Забрал ${item.count}x ${item.name}`);
                } else {
                    console.log('[Chest] Инвентарь полон');
                    break;
                }
            }
        }
        
        this.bot.closeWindow(window);
        console.log(`[Chest] Всего забрано: ${withdrawn} предметов`);
        return withdrawn > 0;
    }
    
    // Организовать хранение (сортировка по сундукам)
    async organizeStorage() {
        const chest = this.findNearestChest();
        if (!chest) return false;
        
        const categories = {
            ores: ['coal', 'iron_ore', 'gold_ore', 'diamond', 'emerald', 'lapis_lazuli', 'redstone'],
            ingots: ['iron_ingot', 'gold_ingot', 'copper_ingot', 'netherite_ingot'],
            blocks: ['cobblestone', 'stone', 'dirt', 'sand', 'gravel', 'obsidian'],
            wood: ['oak_log', 'spruce_log', 'birch_log', 'oak_planks', 'stick'],
            food: ['bread', 'apple', 'cooked_beef', 'cooked_porkchop', 'carrot', 'potato'],
            tools: ['pickaxe', 'axe', 'sword', 'shovel', 'hoe'],
            valuable: ['diamond', 'emerald', 'netherite_scrap', 'nether_star', 'elytra']
        };
        
        // Простая сортировка: всё в один сундук
        await this.depositItems(Object.values(categories).flat());
        return true;
    }
}

module.exports = ChestManager;
