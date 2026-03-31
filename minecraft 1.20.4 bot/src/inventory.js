const { goals } = require("mineflayer-pathfinder");
const Vec3 = require("vec3");

class Inventory {
    constructor(bot, memory, crafting, mcData) {
        this.bot = bot;
        this.memory = memory;
        this.crafting = crafting;
        this.mcData = mcData;
        this.lastManageTime = 0;
        this.manageCooldown = 5000;

        this.materialPriority = ["netherite", "diamond", "iron", "gold", "chainmail", "leather"];

        this.trash = [
            "dirt", "grass_block", "granite", "diorite", "andesite",
            "tuff", "deepslate", "cobbled_deepslate", "poppy", "dandelion",
            "azure_bluet", "oxeye_daisy", "cornflower", "lily_of_the_valley",
            "dead_bush", "fern", "tall_grass", "seagrass"
        ];

        this.keepAmounts = {
            "cobblestone": 64,
            "sand": 32,
            "gravel": 16,
            "rotten_flesh": 0,
            "spider_eye": 0,
            "bone": 16,
            "string": 16,
            "feather": 16
        };

        this.foodPriority = [
            "enchanted_golden_apple", "golden_apple", "cooked_beef",
            "cooked_porkchop", "cooked_mutton", "cooked_chicken",
            "cooked_salmon", "cooked_cod", "bread", "baked_potato",
            "cooked_rabbit", "apple", "melon_slice", "sweet_berries",
            "carrot", "raw_beef", "raw_porkchop"
        ];
    }

    // === Core helpers ===

    blockId(name) { return this.mcData?.blocksByName?.[name]?.id ?? null; }

    getAllItems() {
        const items = [];
        for (const s of this.bot.inventory.slots) {
            if (s && s.name) items.push(s);
        }
        return items;
    }

    getItem(name) {
        for (const s of this.bot.inventory.slots)
            if (s && s.name === name) return s;
        return null;
    }

    countItem(name) {
        let t = 0;
        for (const s of this.bot.inventory.slots)
            if (s && s.name === name) t += s.count;
        return t;
    }

    hasItem(name, count = 1) {
        return this.countItem(name) >= count;
    }

    getFreeSlots() {
        let free = 0;
        for (let i = 9; i <= 44; i++) {
            if (!this.bot.inventory.slots[i]) free++;
        }
        return free;
    }

    // === Equipment ===

    getBestSword() {
        for (const m of this.materialPriority) {
            const s = this.getItem(`${m}_sword`);
            if (s) return s;
        }
        return null;
    }

    getBestPickaxe() {
        for (const m of this.materialPriority) {
            const p = this.getItem(`${m}_pickaxe`);
            if (p) return p;
        }
        return null;
    }

    getBestAxe() {
        for (const m of this.materialPriority) {
            const a = this.getItem(`${m}_axe`);
            if (a) return a;
        }
        return null;
    }

    getBestTool(type) {
        for (const m of this.materialPriority) {
            const t = this.getItem(`${m}_${type}`);
            if (t) return t;
        }
        return null;
    }

    getBestFood() {
        for (const f of this.foodPriority) {
            const item = this.getItem(f);
            if (item) return item;
        }
        return null;
    }

    // === Actions ===

    async eat() {
        if (this.bot.food >= 18) return false;
        const food = this.getBestFood();
        if (!food) return false;
        try {
            await this.bot.equip(food, "hand");
            await this.bot.consume();
            console.log(`[Inv] Съел ${food.name}, голод: ${this.bot.food}/20`);
            return true;
        } catch (e) {
            return false;
        }
    }

    async equipBestArmor() {
        const slots = { helmet: "head", chestplate: "torso", leggings: "legs", boots: "feet" };
        for (const [type, dest] of Object.entries(slots)) {
            for (const m of this.materialPriority) {
                const item = this.getItem(`${m}_${type}`);
                if (item) {
                    try { await this.bot.equip(item, dest); } catch (e) {}
                    break;
                }
            }
        }
    }

    async equipBestWeapon() {
        const sword = this.getBestSword();
        if (sword) {
            try { await this.bot.equip(sword, "hand"); } catch (e) {}
        }
    }

    async discardTrash() {
        if (this.getFreeSlots() > 5) return;

        for (const name of this.trash) {
            const item = this.getItem(name);
            if (item) {
                try {
                    await this.bot.toss(item.type, null, item.count);
                    console.log(`[Inv] Выбросил ${item.count}x ${name}`);
                } catch (e) {}
            }
        }

        for (const [name, keep] of Object.entries(this.keepAmounts)) {
            const count = this.countItem(name);
            if (count > keep) {
                const item = this.getItem(name);
                if (item) {
                    const toss = Math.min(item.count, count - keep);
                    try { await this.bot.toss(item.type, null, toss); } catch (e) {}
                }
            }
        }
    }

    async sleep() {
        // Only sleep at night
        if (this.bot.time.isDay) return false;

        const bedId = this.blockId("red_bed") || this.blockId("white_bed");
        let bed = null;

        // Find placed bed nearby
        const bedNames = [
            "white_bed", "orange_bed", "magenta_bed", "light_blue_bed",
            "yellow_bed", "lime_bed", "pink_bed", "gray_bed",
            "light_gray_bed", "cyan_bed", "purple_bed", "blue_bed",
            "brown_bed", "green_bed", "red_bed", "black_bed"
        ];

        for (const name of bedNames) {
            const id = this.blockId(name);
            if (id !== null) {
                bed = this.bot.findBlock({ matching: id, maxDistance: 32 });
                if (bed) break;
            }
        }

        if (!bed) {
            // Try to place a bed
            const bedItem = bedNames.map(n => this.getItem(n)).find(i => i);
            if (bedItem) {
                const pos = this.bot.entity.position;
                const floorBlock = this.bot.blockAt(pos.offset(1, -1, 0));
                if (floorBlock && floorBlock.name !== "air") {
                    try {
                        await this.bot.equip(bedItem, "hand");
                        await this.bot.placeBlock(floorBlock, new Vec3(0, 1, 0));
                        await new Promise(r => setTimeout(r, 300));
                        // Find the placed bed
                        for (const name of bedNames) {
                            const id = this.blockId(name);
                            if (id !== null) {
                                bed = this.bot.findBlock({ matching: id, maxDistance: 5 });
                                if (bed) break;
                            }
                        }
                    } catch (e) {}
                }
            }
        }

        if (!bed) return false;

        try {
            const dist = this.bot.entity.position.distanceTo(bed.position);
            if (dist > 3) {
                await this.bot.pathfinder.goto(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2));
            }
            await this.bot.sleep(bed);
            console.log("[Inv] Лёг спать");
            return true;
        } catch (e) {
            return false;
        }
    }

    // === Resource stats ===

    getResourceStats() {
        const stats = {};
        for (const item of this.getAllItems()) {
            stats[item.name] = (stats[item.name] || 0) + item.count;
        }
        return stats;
    }

    getStatus() {
        const stats = this.getResourceStats();
        return {
            freeSlots: this.getFreeSlots(),
            health: Math.floor(this.bot.health),
            food: Math.floor(this.bot.food),
            resources: stats,
            hasDiamondPick: !!this.getItem("diamond_pickaxe"),
            hasIronPick: !!this.getItem("iron_pickaxe"),
            hasStonePick: !!this.getItem("stone_pickaxe")
        };
    }

    // === Auto management ===

    async autoManage() {
        // Verbose mode
        if (Date.now() - this.lastManageTime < this.manageCooldown) return;
        this.lastManageTime = Date.now();

        try {
            // Eat if hungry
            if (this.bot.food < 14) await this.eat();

            // Equip best armor
            await this.equipBestArmor();

            // Discard trash if low on space
            if (this.getFreeSlots() < 5) await this.discardTrash();

            // Sleep if night
            if (!this.bot.time.isDay) await this.sleep();
        } catch (e) {
            console.log(`[Inv] Ошибка autoManage: ${e.message}`);
        }
    }
}

module.exports = Inventory;
