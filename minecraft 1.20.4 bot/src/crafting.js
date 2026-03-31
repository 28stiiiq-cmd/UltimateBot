const { goals } = require("mineflayer-pathfinder");
const Vec3 = require("vec3");

class Crafting {
    constructor(bot, mcData) {
        this.bot = bot;
        this.mcData = mcData;
        this.lastCraftTime = 0;
        this.recipesByName = {};

        this.deps = {
            "oak_planks": { "oak_log": 1 }, "spruce_planks": { "spruce_log": 1 },
            "birch_planks": { "birch_log": 1 }, "jungle_planks": { "jungle_log": 1 },
            "acacia_planks": { "acacia_log": 1 }, "dark_oak_planks": { "dark_oak_log": 1 },
            "stick": { "#planks": 2 }, "crafting_table": { "#planks": 4 },
            "wooden_pickaxe": { "#planks": 3, "stick": 2, "#table": true },
            "wooden_axe": { "#planks": 3, "stick": 2, "#table": true },
            "wooden_sword": { "#planks": 2, "stick": 1, "#table": true },
            "stone_pickaxe": { "cobblestone": 3, "stick": 2, "#table": true },
            "stone_axe": { "cobblestone": 3, "stick": 2, "#table": true },
            "stone_sword": { "cobblestone": 2, "stick": 1, "#table": true },
            "iron_pickaxe": { "iron_ingot": 3, "stick": 2, "#table": true },
            "iron_axe": { "iron_ingot": 3, "stick": 2, "#table": true },
            "iron_sword": { "iron_ingot": 2, "stick": 1, "#table": true },
            "diamond_pickaxe": { "diamond": 3, "stick": 2, "#table": true },
            "diamond_axe": { "diamond": 3, "stick": 2, "#table": true },
            "diamond_sword": { "diamond": 2, "stick": 1, "#table": true },
            "iron_helmet": { "iron_ingot": 5, "#table": true },
            "iron_chestplate": { "iron_ingot": 8, "#table": true },
            "iron_leggings": { "iron_ingot": 7, "#table": true },
            "iron_boots": { "iron_ingot": 4, "#table": true },
            "diamond_helmet": { "diamond": 5, "#table": true },
            "diamond_chestplate": { "diamond": 8, "#table": true },
            "diamond_leggings": { "diamond": 7, "#table": true },
            "diamond_boots": { "diamond": 4, "#table": true },
            "golden_helmet": { "gold_ingot": 5, "#table": true },
            "golden_chestplate": { "gold_ingot": 8, "#table": true },
            "furnace": { "cobblestone": 8, "#table": true },
            "chest": { "#planks": 8, "#table": true },
            "torch": { "coal": 1, "stick": 1 },
            "bucket": { "iron_ingot": 3, "#table": true },
            "shield": { "#planks": 6, "iron_ingot": 1, "#table": true },
            "bow": { "stick": 3, "string": 3, "#table": true },
            "arrow": { "flint": 1, "stick": 1, "feather": 1, "#table": true },
            "flint_and_steel": { "iron_ingot": 1, "flint": 1 },
            "golden_apple": { "gold_ingot": 8, "apple": 1, "#table": true },
            "ender_eye": { "ender_pearl": 1, "blaze_powder": 1 },
            "blaze_powder": { "blaze_rod": 1 },
            "shears": { "iron_ingot": 2, "#table": true },
            "enchanting_table": { "diamond": 2, "obsidian": 4, "book": 1, "#table": true },
            "anvil": { "iron_block": 3, "iron_ingot": 4, "#table": true },
            "iron_block": { "iron_ingot": 9, "#table": true },
            "brewing_stand": { "blaze_rod": 1, "cobblestone": 3, "#table": true }
        };
    }

    hasItem(n, c = 1) { return this.countItem(n) >= c; }
    countItem(n) { let t = 0; for (const s of this.bot.inventory.slots) if (s && s.name === n) t += s.count; return t; }
    getItem(n) { for (const s of this.bot.inventory.slots) if (s && s.name === n) return s; return null; }
    blockId(n) { return this.mcData?.blocksByName?.[n]?.id ?? null; }
    itemId(n) { return this.mcData?.itemsByName?.[n]?.id ?? null; }

    totalPlanksCount() {
        let t = 0;
        for (const w of ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak"]) t += this.countItem(`${w}_planks`);
        return t;
    }
    getAvailablePlanks() {
        for (const t of ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak"]) {
            if (this.hasItem(`${t}_planks`)) return `${t}_planks`;
            if (this.hasItem(`${t}_log`)) return `${t}_planks`;
        }
        return "oak_planks";
    }
    getAvailableLog() {
        for (const l of ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log"])
            if (this.hasItem(l)) return l;
        return null;
    }

    async findOrPlaceCraftingTable() {
        const tableId = this.blockId("crafting_table");
        if (tableId !== null) {
            const existing = this.bot.findBlock({ matching: tableId, maxDistance: 32 });
            if (existing) {
                const dist = this.bot.entity.position.distanceTo(existing.position);
                if (dist > 4) {
                    try { await this.bot.pathfinder.goto(new goals.GoalNear(existing.position.x, existing.position.y, existing.position.z, 2)); } catch (e) {}
                }
                return existing;
            }
        }
        if (!this.hasItem("crafting_table")) {
            console.log(`[Craft:table] Крафчу верстак (досок: ${this.totalPlanksCount()}, логов: ${this.getAvailableLog() || "нет"})`);
            while (this.totalPlanksCount() < 4) {
                const log = this.getAvailableLog();
                if (!log) { console.log("[Craft:table] Нет логов для досок"); return null; }
                if (!(await this.craftDirect(log.replace("_log", "_planks"), 1, null))) return null;
            }
            if (!(await this.craftDirect("crafting_table", 1, null))) return null;
        }
        if (!this.hasItem("crafting_table")) return null;

        const item = this.getItem("crafting_table");
        const pos = this.bot.entity.position;

        // Try all positions including diagonals and above
        const offsets = [
            new Vec3(1,0,0), new Vec3(-1,0,0), new Vec3(0,0,1), new Vec3(0,0,-1),
            new Vec3(1,0,1), new Vec3(-1,0,-1), new Vec3(-1,0,1), new Vec3(1,0,-1),
            new Vec3(0,1,0) // above
        ];
        for (const off of offsets) {
            const tp = pos.plus(off).floored();
            const target = this.bot.blockAt(tp);
            const below = this.bot.blockAt(tp.offset(0, -1, 0));
            if (target && target.name === "air" && below && below.name !== "air") {
                try {
                    await this.bot.equip(item, "hand");
                    await this.bot.placeBlock(below, new Vec3(0, 1, 0));
                    await new Promise(r => setTimeout(r, 300));
                    if (tableId !== null) {
                        const placed = this.bot.findBlock({ matching: tableId, maxDistance: 5 });
                        if (placed) { console.log("[Craft:table] Верстак поставлен"); return placed; }
                    }
                } catch (e) {}
            }
        }

        // If still can't place — we're probably in a hole. Dig out first.
        console.log("[Craft:table] Не могу поставить, выкапываюсь");
        const pick = this.getItem("diamond_pickaxe") || this.getItem("iron_pickaxe") || this.getItem("stone_pickaxe") || this.getItem("wooden_pickaxe");
        if (pick) {
            await this.bot.equip(pick, "hand");
            // Dig 3 blocks up to get out of any hole
            for (let dy = 1; dy <= 3; dy++) {
                const above = this.bot.blockAt(pos.offset(0, dy, 0).floored());
                if (above && above.name !== "air" && above.name !== "bedrock") {
                    try { await this.bot.dig(above); } catch (e) {}
                }
            }
            // Jump out
            this.bot.setControlState("jump", true);
            await new Promise(r => setTimeout(r, 500));
            this.bot.setControlState("jump", false);
            await new Promise(r => setTimeout(r, 300));

            // Walk out a bit
            this.bot.setControlState("forward", true);
            await new Promise(r => setTimeout(r, 1000));
            this.bot.setControlState("forward", false);

            // Retry placement
            const newPos = this.bot.entity.position;
            for (const off of [new Vec3(1,0,0), new Vec3(-1,0,0), new Vec3(0,0,1), new Vec3(0,0,-1)]) {
                const tp = newPos.plus(off).floored();
                const target = this.bot.blockAt(tp);
                const below = this.bot.blockAt(tp.offset(0, -1, 0));
                if (target && target.name === "air" && below && below.name !== "air") {
                    try {
                        const tbl = this.getItem("crafting_table");
                        if (!tbl) return null;
                        await this.bot.equip(tbl, "hand");
                        await this.bot.placeBlock(below, new Vec3(0, 1, 0));
                        await new Promise(r => setTimeout(r, 300));
                        if (tableId !== null) {
                            const placed = this.bot.findBlock({ matching: tableId, maxDistance: 5 });
                            if (placed) { console.log("[Craft:table] Верстак поставлен после выкапывания"); return placed; }
                        }
                    } catch (e) {}
                }
            }
        }

        console.log("[Craft:table] Не удалось поставить верстак");
        return null;
    }

    async craftDirect(name, count, craftingTable) {
        const id = this.itemId(name);
        if (id === null) { console.log(`[Craft] Неизвестный предмет: ${name}`); return false; }
        try {
            const recipes = this.bot.recipesFor(id, null, 1, craftingTable);
            if (!recipes || recipes.length === 0) {
                console.log(`[Craft] Нет рецепта для ${name} (table=${!!craftingTable})`);
                return false;
            }
            await this.bot.craft(recipes[0], count, craftingTable);
            console.log(`[Craft] ✓ ${count}x ${name}`);
            return true;
        } catch (e) {
            console.log(`[Craft] ✗ ${name}: ${e.message}`);
            return false;
        }
    }

    async craftWithPlanning(name, count = 1) {
        console.log(`[Craft:plan] ${name} x${count}`);
        const deps = this.deps[name];
        if (!deps) {
            const table = await this.findOrPlaceCraftingTable();
            return await this.craftDirect(name, count, table);
        }
        const needsTable = deps["#table"] === true;

        for (const [dep, needed] of Object.entries(deps)) {
            if (dep.startsWith("#")) continue;
            const totalNeeded = needed * count;
            const have = this.countItem(dep);
            if (have < totalNeeded && this.deps[dep]) {
                console.log(`[Craft:plan] Нужен ${dep}: ${have}/${totalNeeded}`);
                if (!(await this.craftWithPlanning(dep, totalNeeded - have))) return false;
            }
        }

        if (deps["#planks"]) {
            const needed = deps["#planks"] * count;
            while (this.totalPlanksCount() < needed) {
                const log = this.getAvailableLog();
                if (!log) { console.log(`[Craft:plan] Нет логов для досок (нужно ${needed})`); return false; }
                if (!(await this.craftDirect(log.replace("_log", "_planks"), 1, null))) return false;
            }
        }

        let table = null;
        if (needsTable) {
            table = await this.findOrPlaceCraftingTable();
            if (!table) { console.log(`[Craft:plan] Нет верстака для ${name}`); return false; }
        }
        return await this.craftDirect(name, count, table);
    }

    async craftTorches(count = 4) {
        if (!this.hasItem("stick")) await this.craftWithPlanning("stick", 4);
        if (!this.hasItem("coal") && !this.hasItem("charcoal")) return false;
        // Torch doesn't need crafting table
        let ok = await this.craftDirect("torch", count, null);
        if (!ok) {
            // Try with table as fallback
            const table = await this.findOrPlaceCraftingTable();
            ok = await this.craftDirect("torch", count, table);
        }
        return ok;
    }

    async craftEnderEye() { return await this.craftWithPlanning("ender_eye", 1); }

    getAvailableCrafts() {
        const available = [];
        for (const name of Object.keys(this.deps)) {
            if (name.startsWith("#")) continue;
            const d = this.deps[name];
            let canCraft = true;
            for (const [dep, needed] of Object.entries(d)) {
                if (dep.startsWith("#")) continue;
                if (!this.hasItem(dep, needed)) { canCraft = false; break; }
            }
            if (canCraft) available.push(name);
        }
        return available;
    }

    async autoCraft() {
        if (Date.now() - this.lastCraftTime < 8000) return false;
        this.lastCraftTime = Date.now();
        const hasWood = !!this.getAvailableLog() || this.totalPlanksCount() >= 4;

        const priorities = [
            { name: "crafting_table", cond: () => !this.hasItem("crafting_table") && hasWood },
            { name: "wooden_pickaxe", cond: () => hasWood && !this.hasItem("wooden_pickaxe") && !this.hasItem("stone_pickaxe") && !this.hasItem("iron_pickaxe") && !this.hasItem("diamond_pickaxe") },
            { name: "stone_pickaxe", cond: () => this.hasItem("cobblestone", 3) && !this.hasItem("stone_pickaxe") && !this.hasItem("iron_pickaxe") && !this.hasItem("diamond_pickaxe") },
            { name: "stone_sword", cond: () => this.hasItem("cobblestone", 2) && !this.hasItem("stone_sword") && !this.hasItem("iron_sword") && !this.hasItem("diamond_sword") },
            { name: "stone_axe", cond: () => this.hasItem("cobblestone", 3) && !this.hasItem("stone_axe") && !this.hasItem("iron_axe") },
            { name: "iron_pickaxe", cond: () => this.hasItem("iron_ingot", 3) && !this.hasItem("iron_pickaxe") && !this.hasItem("diamond_pickaxe") },
            { name: "iron_sword", cond: () => this.hasItem("iron_ingot", 2) && !this.hasItem("iron_sword") && !this.hasItem("diamond_sword") },
            { name: "iron_axe", cond: () => this.hasItem("iron_ingot", 3) && !this.hasItem("iron_axe") },
            { name: "shield", cond: () => !this.hasItem("shield") && this.hasItem("iron_ingot", 1) && this.totalPlanksCount() >= 6 },
            { name: "bucket", cond: () => !this.hasItem("bucket") && !this.hasItem("water_bucket") && this.hasItem("iron_ingot", 3) },
            { name: "iron_helmet", cond: () => this.hasItem("iron_ingot", 5) && !this.hasItem("iron_helmet") && !this.hasItem("diamond_helmet") },
            { name: "iron_chestplate", cond: () => this.hasItem("iron_ingot", 8) && !this.hasItem("iron_chestplate") && !this.hasItem("diamond_chestplate") },
            { name: "iron_leggings", cond: () => this.hasItem("iron_ingot", 7) && !this.hasItem("iron_leggings") && !this.hasItem("diamond_leggings") },
            { name: "iron_boots", cond: () => this.hasItem("iron_ingot", 4) && !this.hasItem("iron_boots") && !this.hasItem("diamond_boots") },
            { name: "diamond_pickaxe", cond: () => this.hasItem("diamond", 3) && !this.hasItem("diamond_pickaxe") },
            { name: "diamond_sword", cond: () => this.hasItem("diamond", 2) && !this.hasItem("diamond_sword") && this.hasItem("diamond_pickaxe") },
            { name: "furnace", cond: () => !this.hasItem("furnace") && this.hasItem("cobblestone", 8) },
            { name: "torch", cond: () => this.countItem("torch") < 16 && (this.hasItem("coal") || this.hasItem("charcoal")) && this.hasItem("stick") },
            { name: "bow", cond: () => !this.hasItem("bow") && this.hasItem("string", 3) },
            { name: "arrow", cond: () => this.countItem("arrow") < 32 && this.hasItem("flint") && this.hasItem("feather") },
            { name: "flint_and_steel", cond: () => !this.hasItem("flint_and_steel") && this.hasItem("iron_ingot") && this.hasItem("flint") },
            { name: "golden_helmet", cond: () => this.hasItem("gold_ingot", 5) && !this.hasItem("golden_helmet") },
            { name: "blaze_powder", cond: () => this.hasItem("blaze_rod") && this.countItem("blaze_powder") < 12 },
            { name: "ender_eye", cond: () => this.hasItem("ender_pearl") && this.hasItem("blaze_powder") && this.countItem("ender_eye") < 12 },
            { name: "golden_apple", cond: () => this.hasItem("gold_ingot", 8) && this.hasItem("apple") && this.countItem("golden_apple") < 4 }
        ];

        for (const p of priorities) {
            if (p.cond()) {
                console.log(`[Craft:auto] → ${p.name}`);
                const ok = await this.craftWithPlanning(p.name, 1);
                if (ok) return true;
            }
        }
        return false;
    }
}
module.exports = Crafting;
