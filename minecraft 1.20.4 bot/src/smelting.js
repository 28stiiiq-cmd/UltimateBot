const { goals } = require("mineflayer-pathfinder");
const Vec3 = require("vec3");

class Smelting {
    constructor(bot, mcData) {
        this.bot = bot;
        this.mcData = mcData;
        this.isSmelting = false;
        this.smeltables = {
            "iron_ore": "iron_ingot",
            "deepslate_iron_ore": "iron_ingot",
            "gold_ore": "gold_ingot",
            "deepslate_gold_ore": "gold_ingot",
            "copper_ore": "copper_ingot",
            "deepslate_copper_ore": "copper_ingot",
            "raw_iron": "iron_ingot",
            "raw_gold": "gold_ingot",
            "raw_copper": "copper_ingot",
            "sand": "glass",
            "cobblestone": "stone",
            "oak_log": "charcoal",
            "spruce_log": "charcoal",
            "birch_log": "charcoal",
            "clay_ball": "brick",
            "ancient_debris": "netherite_scrap"
        };
        this.fuels = [
            "coal", "charcoal", "oak_planks", "spruce_planks", "birch_planks",
            "jungle_planks", "acacia_planks", "dark_oak_planks", "stick",
            "oak_log", "spruce_log", "birch_log", "lava_bucket", "coal_block",
            "blaze_rod"
        ];
    }

    blockId(name) {
        return this.mcData?.blocksByName?.[name]?.id ?? null;
    }

    countItem(name) {
        let t = 0;
        for (const s of this.bot.inventory.slots)
            if (s && s.name === name) t += s.count;
        return t;
    }

    getItem(name) {
        for (const s of this.bot.inventory.slots)
            if (s && s.name === name) return s;
        return null;
    }

    getBestFuel() {
        for (const f of this.fuels) {
            const item = this.getItem(f);
            if (item) return item;
        }
        return null;
    }

    findFurnace() {
        const id = this.blockId("furnace");
        if (id === null) return null;
        return this.bot.findBlock({ matching: id, maxDistance: 32 });
    }

    async placeFurnace() {
        const furnaceItem = this.getItem("furnace");
        if (!furnaceItem) return false;

        const pos = this.bot.entity.position;
        const offsets = [
            new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
            new Vec3(0, 0, 1), new Vec3(0, 0, -1)
        ];

        for (const off of offsets) {
            const targetPos = pos.plus(off).floored();
            const targetBlock = this.bot.blockAt(targetPos);
            const belowBlock = this.bot.blockAt(targetPos.offset(0, -1, 0));

            if (targetBlock && targetBlock.name === "air" &&
                belowBlock && belowBlock.name !== "air") {
                await this.bot.equip(furnaceItem, "hand");
                try {
                    await this.bot.placeBlock(belowBlock, new Vec3(0, 1, 0));
                    await new Promise(r => setTimeout(r, 300));
                    return true;
                } catch (e) {
                    console.log(`[Smelt] Ошибка установки печи: ${e.message}`);
                }
            }
        }
        return false;
    }

    async smelt(inputName, count = 1) {
        if (this.isSmelting) return false;

        const inputItem = this.getItem(inputName);
        if (!inputItem) {
            console.log(`[Smelt] Нет ${inputName} для плавки`);
            return false;
        }

        const fuel = this.getBestFuel();
        if (!fuel) {
            console.log("[Smelt] Нет топлива");
            return false;
        }

        let furnaceBlock = this.findFurnace();
        if (!furnaceBlock) {
            if (this.getItem("furnace")) {
                const placed = await this.placeFurnace();
                if (!placed) return false;
                furnaceBlock = this.findFurnace();
                if (!furnaceBlock) return false;
            } else {
                console.log("[Smelt] Нет печи в инвентаре и нет поблизости");
                return false;
            }
        }

        this.isSmelting = true;
        console.log(`[Smelt] Плавка ${toSmelt||count}x ${inputName}, печь: ${furnaceBlock.position}`);
        try {
            // Approach furnace
            const dist = this.bot.entity.position.distanceTo(furnaceBlock.position);
            if (dist > 3) {
                await this.bot.pathfinder.goto(
                    new goals.GoalNear(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2)
                );
            }

            // Open furnace
            const furnace = await this.bot.openFurnace(furnaceBlock);
            if (!furnace) {
                console.log("[Smelt] Не удалось открыть печь");
                return false;
            }

            const toSmelt = Math.min(count, inputItem.count, 8);

            // FIRST: Clear furnace - take any existing output AND input
            const existingOutput = furnace.outputItem();
            if (existingOutput) {
                await furnace.takeOutput();
                console.log(`[Smelt] Забрал: ${existingOutput.count}x ${existingOutput.name}`);
                await new Promise(r => setTimeout(r, 300));
            }

            // Check if input slot already has something different
            const existingInput = furnace.inputItem();
            if (existingInput && existingInput.name !== inputName) {
                // Can't mix — close and skip
                furnace.close();
                console.log(`[Smelt] Печь занята: ${existingInput.name}`);
                return false;
            }

            // Put fuel
            if (!furnace.fuelItem()) {
                const fuelItem = this.getItem(fuel.name);
                if (fuelItem) {
                    const fuelCount = Math.min(fuelItem.count, Math.ceil(toSmelt / 8) + 1);
                    try {
                        await furnace.putFuel(fuelItem.type, null, fuelCount);
                        await new Promise(r => setTimeout(r, 300));
                    } catch (e) {
                        console.log(`[Smelt] Ошибка топлива: ${e.message}`);
                    }
                }
            }

            // Put input
            try {
                await furnace.putInput(inputItem.type, null, toSmelt);
            } catch (e) {
                // If still "destination full", take output again and retry once
                if (e.message?.includes("destination full")) {
                    const out = furnace.outputItem();
                    if (out) { await furnace.takeOutput(); await new Promise(r => setTimeout(r, 300)); }
                    try { await furnace.putInput(inputItem.type, null, toSmelt); }
                    catch (e2) { furnace.close(); return false; }
                } else { furnace.close(); return false; }
            }
            await new Promise(r => setTimeout(r, 200));

            // Wait for smelting (10 seconds per item)
            const waitTime = toSmelt * 10000 + 2000;
            console.log(`[Smelt] Плавлю ${toSmelt}x ${inputName}, ожидание ${Math.ceil(waitTime / 1000)}с`);

            await new Promise(r => setTimeout(r, Math.min(waitTime, 60000)));

            // Take output
            const output = furnace.outputItem();
            if (output) {
                await furnace.takeOutput();
                console.log(`[Smelt] Получено: ${output.count}x ${output.name}`);
            }

            furnace.close();
            return true;
        } catch (e) {
            console.log(`[Smelt] Ошибка: ${e.message}`);
            return false;
        } finally {
            this.isSmelting = false;
        }
    }

    // Smelt all raw ores in inventory
    async smeltAll() {
        let smelted = false;
        for (const [input, output] of Object.entries(this.smeltables)) {
            const count = this.countItem(input);
            if (count > 0 && this.getBestFuel()) {
                const result = await this.smelt(input, count);
                if (result) smelted = true;
            }
        }
        return smelted;
    }

    // Check if we have anything to smelt
    hasSmeltable() {
        for (const input of Object.keys(this.smeltables)) {
            if (this.countItem(input) > 0) return true;
        }
        return false;
    }

    // Cook raw meat
    async cookFood() {
        const rawFoods = ["raw_beef", "raw_porkchop", "raw_chicken", "raw_mutton", "raw_rabbit", "raw_cod", "raw_salmon"];
        for (const food of rawFoods) {
            const count = this.countItem(food);
            if (count > 0 && this.getBestFuel()) {
                await this.smelt(food, count);
            }
        }
    }
}

module.exports = Smelting;
