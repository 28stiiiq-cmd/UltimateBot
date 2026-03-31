class Enchanting {
    constructor(bot, memory, crafting, inventory) {
        this.bot = bot;
        this.memory = memory;
        this.crafting = crafting;
        this.inventory = inventory;
        
        this.enchantingTable = null;
        this.bookshelves = 0;
        
        // Зачарования
        this.enchantments = {
            'protection': { maxLevel: 4, type: 'armor' },
            'sharpness': { maxLevel: 5, type: 'sword' },
            'efficiency': { maxLevel: 5, type: 'tool' },
            'fortune': { maxLevel: 3, type: 'tool' },
            'unbreaking': { maxLevel: 3, type: 'all' },
            'mending': { maxLevel: 1, type: 'all' },
            'fire_aspect': { maxLevel: 2, type: 'sword' },
            'looting': { maxLevel: 3, type: 'sword' },
            'silk_touch': { maxLevel: 1, type: 'tool' },
            'feather_falling': { maxLevel: 4, type: 'boots' },
            'depth_strider': { maxLevel: 3, type: 'boots' },
            'frost_walker': { maxLevel: 2, type: 'boots' }
        };
    }
    
    // Найти стол зачарования
    findEnchantingTable() {
        const table = this.bot.findBlock({
            matching: require('minecraft-data')(this.bot.version)?.blocksByName?.['enchanting_table']?.id || 0,
            maxDistance: 10
        });
        if (table) {
            this.enchantingTable = table.position;
            this.countBookshelves();
            return true;
        }
        return false;
    }
    
    // Поставить стол зачарования
    async placeEnchantingTable() {
        if (this.crafting.hasItem('enchanting_table')) {
            const pos = this.bot.entity.position;
            const targetPos = { x: Math.floor(pos.x) + 1, y: Math.floor(pos.y), z: Math.floor(pos.z) };
            const block = this.bot.blockAt(targetPos);
            
            if (block && block.name === 'air') {
                const table = this.crafting.getItem('enchanting_table');
                await this.bot.equip(table, 'hand');
                await this.bot.placeBlock(targetPos);
                this.enchantingTable = targetPos;
                return true;
            }
        }
        return false;
    }
    
    // Поставить книжные полки
    async placeBookshelves() {
        const pos = this.enchantingTable;
        if (!pos) return false;
        
        let placed = 0;
        const offsets = [
            [-2,0,0], [2,0,0], [0,0,-2], [0,0,2],
            [-2,1,0], [2,1,0], [0,1,-2], [0,1,2],
            [-1,0,-1], [-1,0,1], [1,0,-1], [1,0,1],
            [-1,1,-1], [-1,1,1], [1,1,-1], [1,1,1],
            [-2,0,-1], [-2,0,1], [2,0,-1], [2,0,1],
            [-1,0,-2], [-1,0,2], [1,0,-2], [1,0,2]
        ];
        
        for (const offset of offsets) {
            const shelfPos = { x: pos.x + offset[0], y: pos.y + offset[1], z: pos.z + offset[2] };
            const block = this.bot.blockAt(shelfPos);
            
            if (block && block.name === 'air' && this.crafting.hasItem('bookshelf')) {
                const shelf = this.crafting.getItem('bookshelf');
                await this.bot.equip(shelf, 'hand');
                await this.bot.placeBlock(shelfPos);
                placed++;
                await new Promise(r => setTimeout(r, 100));
                if (placed >= 15) break;
            }
        }
        
        this.countBookshelves();
        console.log(`[Enchanting] Поставлено ${placed} книжных полок`);
        return placed > 0;
    }
    
    countBookshelves() {
        if (!this.enchantingTable) return 0;
        
        let count = 0;
        for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
                for (let dy = 0; dy <= 1; dy++) {
                    if (dx === 0 && dz === 0) continue;
                    const pos = { x: this.enchantingTable.x + dx, y: this.enchantingTable.y + dy, z: this.enchantingTable.z + dz };
                    const block = this.bot.blockAt(pos);
                    if (block && block.name === 'bookshelf') count++;
                }
            }
        }
        this.bookshelves = Math.min(count, 15);
        return this.bookshelves;
    }
    
    // Зачаровать предмет
    async enchantItem(item, level = 30) {
        if (!this.enchantingTable && !this.findEnchantingTable()) {
            await this.placeEnchantingTable();
        }
        
        if (!this.enchantingTable) {
            console.log('[Enchanting] Нет стола зачарования');
            return false;
        }
        
        // Проверить лазурит
        const lapisNeeded = Math.ceil(level / 10);
        if (!this.crafting.hasItem('lapis_lazuli', lapisNeeded)) {
            console.log(`[Enchanting] Не хватает лазурита (нужно ${lapisNeeded})`);
            return false;
        }
        
        // Проверить опыт
        if (this.bot.experience?.level < level) {
            console.log(`[Enchanting] Не хватает опыта (нужно ${level}, есть ${this.bot.experience?.level || 0})`);
            return false;
        }
        
        const tableBlock = this.bot.blockAt(this.enchantingTable);
        await this.bot.lookAt(this.enchantingTable);
        await this.bot.activateBlock(tableBlock);
        await new Promise(r => setTimeout(r, 500));
        
        try {
            const window = this.bot.currentWindow;
            if (!window) return false;
            
            // Положить предмет
            await this.bot.clickWindow(item.slot, 0, 0);
            await this.bot.clickWindow(0, 0, 0);
            
            // Положить лазурит
            const lapis = this.crafting.getItem('lapis_lazuli');
            if (lapis) {
                await this.bot.clickWindow(lapis.slot, 0, 0);
                await this.bot.clickWindow(1, 0, 0);
            }
            
            // Выбрать зачарование (берём лучшее)
            const bestSlot = Math.min(2, Math.floor(level / 10));
            await this.bot.clickWindow(bestSlot, 0, 0);
            
            await new Promise(r => setTimeout(r, 500));
            
            // Забрать результат
            if (window.slots[0]) {
                await this.bot.clickWindow(0, 0, 0);
            }
            
            this.bot.closeWindow(window);
            console.log(`[Enchanting] Предмет зачарован на ${level} уровне`);
            return true;
            
        } catch(err) {
            console.log(`[Enchanting] Ошибка зачарования: ${err.message}`);
            if (this.bot.currentWindow) this.bot.closeWindow(this.bot.currentWindow);
            return false;
        }
    }
    
    // Зачаровать лучший предмет
    async enchantBestTool() {
        const tool = this.inventory.getBestPickaxe() || 
                     this.inventory.getBestSword() || 
                     this.inventory.getBestAxe();
        
        if (!tool) {
            console.log('[Enchanting] Нет предмета для зачарования');
            return false;
        }
        
        const level = Math.min(30, this.bot.experience?.level || 0);
        if (level < 10) {
            console.log('[Enchanting] Слишком мало опыта');
            return false;
        }
        
        return await this.enchantItem(tool, level);
    }
}

module.exports = Enchanting;
