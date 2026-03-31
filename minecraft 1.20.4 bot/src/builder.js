const Vec3 = require("vec3");

class Builder {
    constructor(bot, inventory, crafting) {
        this.bot = bot;
        this.inventory = inventory;
        this.crafting = crafting;
        this.homePos = null;       // center of home
        this.homeBlocks = [];      // [{pos, name}] — blocks we placed
        this.hasRoof = false;
        this.hasDoor = false;
        this.chestPos = null;
        this.lastRepairCheck = 0;
    }

    // ========== Random House Plan ==========
    generatePlan() {
        // Random dimensions (each house is unique)
        const w = 5 + Math.floor(Math.random() * 4); // 5-8
        const d = 5 + Math.floor(Math.random() * 4); // 5-8
        const h = 3 + Math.floor(Math.random() * 2); // 3-4

        // Random window pattern
        const windowInterval = 2 + Math.floor(Math.random() * 2); // every 2-3 blocks
        const windowHeight = 1 + Math.floor(Math.random() * 2);   // 1 or 2 from floor
        const doorSide = Math.floor(Math.random() * 4);           // 0=north,1=east,2=south,3=west
        const doorOffset = 1 + Math.floor(Math.random() * (w - 2)); // not at corner

        return { w, d, h, windowInterval, windowHeight, doorSide, doorOffset };
    }

    // ========== Material Selection ==========
    getBuildMaterial() {
        // Use whatever we have most of
        const options = [
            "cobblestone", "oak_planks", "spruce_planks", "birch_planks",
            "stone", "oak_log", "spruce_log", "dirt"
        ];
        let best = null, bestCount = 0;
        for (const name of options) {
            const count = this.crafting?.countItem(name) || 0;
            if (count > bestCount) { best = name; bestCount = count; }
        }
        // Need at least 30 blocks to start building
        return bestCount >= 30 ? best : null;
    }

    getFloorMaterial() {
        for (const name of ["oak_planks", "spruce_planks", "birch_planks", "cobblestone"]) {
            if ((this.crafting?.countItem(name) || 0) >= 10) return name;
        }
        return null;
    }

    // ========== Place single block (human-like) ==========
    async placeAt(pos, materialName) {
        const item = this.crafting?.getItem(materialName);
        if (!item) return false;

        const block = this.bot.blockAt(pos);
        if (block && block.name !== "air") return true;

        // Must be within reach
        const dist = this.bot.entity.position.distanceTo(pos);
        if (dist > 4) {
            const nav = this.bot._nav;
            if (nav) await nav.goto(pos, 3, 5000);
        }
        if (this.bot.entity.position.distanceTo(pos) > 5) return false;

        const faces = [
            { off: new Vec3(0,-1,0), face: new Vec3(0,1,0) },
            { off: new Vec3(0,1,0), face: new Vec3(0,-1,0) },
            { off: new Vec3(1,0,0), face: new Vec3(-1,0,0) },
            { off: new Vec3(-1,0,0), face: new Vec3(1,0,0) },
            { off: new Vec3(0,0,1), face: new Vec3(0,0,-1) },
            { off: new Vec3(0,0,-1), face: new Vec3(0,0,1) }
        ];
        for (const { off, face } of faces) {
            const ref = this.bot.blockAt(pos.plus(off));
            if (ref && ref.name !== "air" && ref.name !== "water") {
                try {
                    await this.bot.equip(item, "hand");
                    await this.bot.lookAt(pos);
                    await this.bot.placeBlock(ref, face);
                    this.homeBlocks.push({ pos: pos.clone(), name: materialName });
                    return true;
                } catch (e) { return false; }
            }
        }
        return false;
    }

    // ========== Find surface build site ==========
    async findBuildSite(width, depth) {
        const bot = this.bot;
        const pos = bot.entity.position.floored();

        // First: make sure we're on the surface (sky visible above)
        // Go up until we see sky
        let surfaceY = pos.y;
        for (let y = pos.y; y < pos.y + 40; y++) {
            const block = bot.blockAt(new Vec3(pos.x, y, pos.z));
            if (!block || block.name === "air") {
                // Check if there's sky above (no more solid blocks for 10 blocks)
                let isSurface = true;
                for (let cy = y + 1; cy < y + 10; cy++) {
                    const above = bot.blockAt(new Vec3(pos.x, cy, pos.z));
                    if (above && above.name !== "air" && above.name !== "water" &&
                        !above.name.includes("leaves") && !above.name.includes("log")) {
                        isSurface = false; break;
                    }
                }
                if (isSurface) { surfaceY = y; break; }
            }
        }

        // Navigate to surface if underground
        if (surfaceY > pos.y + 3) {
            const nav = bot._nav;
            if (nav) await nav.goto(new Vec3(pos.x, surfaceY, pos.z), 3, 20000);
        }

        // Search nearby for flat area
        const searchPos = bot.entity.position.floored();
        const candidates = [];

        for (let dx = -15; dx <= 15; dx += 3) {
            for (let dz = -15; dz <= 15; dz += 3) {
                const cx = searchPos.x + dx;
                const cz = searchPos.z + dz;

                // Find ground level
                let groundY = null;
                for (let y = searchPos.y + 5; y > searchPos.y - 10; y--) {
                    const b = bot.blockAt(new Vec3(cx, y, cz));
                    const above = bot.blockAt(new Vec3(cx, y + 1, cz));
                    if (b && b.name !== "air" && b.name !== "water" &&
                        above && (above.name === "air" || above.name.includes("grass") || above.name.includes("flower"))) {
                        groundY = y + 1;
                        break;
                    }
                }
                if (groundY === null) continue;

                // Check flatness: sample corners
                let flat = true;
                for (const [ox, oz] of [[0,0],[width-1,0],[0,depth-1],[width-1,depth-1],[Math.floor(width/2),Math.floor(depth/2)]]) {
                    let found = false;
                    for (let y = groundY + 2; y >= groundY - 2; y--) {
                        const b = bot.blockAt(new Vec3(cx + ox, y, cz + oz));
                        const a = bot.blockAt(new Vec3(cx + ox, y + 1, cz + oz));
                        if (b && b.name !== "air" && b.name !== "water" && a && a.name === "air") {
                            if (Math.abs(y + 1 - groundY) > 2) { flat = false; break; }
                            found = true; break;
                        }
                    }
                    if (!found) flat = false;
                    if (!flat) break;
                }

                // Check no water/lava
                if (flat) {
                    const groundBlock = bot.blockAt(new Vec3(cx, groundY - 1, cz));
                    if (groundBlock && groundBlock.name !== "water" && groundBlock.name !== "lava") {
                        candidates.push({ pos: new Vec3(cx, groundY, cz), dist: searchPos.distanceTo(new Vec3(cx, groundY, cz)) });
                    }
                }
            }
        }

        if (candidates.length === 0) {
            // Fallback: just use current surface position
            return new Vec3(searchPos.x, surfaceY, searchPos.z);
        }

        // Pick closest flat spot
        candidates.sort((a, b) => a.dist - b.dist);
        const site = candidates[0].pos;

        // Navigate there
        const nav = bot._nav;
        if (nav) await nav.goto(site, 3, 15000);

        console.log(`[Build] Нашёл площадку: ${site.x},${site.y},${site.z}`);
        return site;
    }

    // ========== Build House ==========
    async buildHouse() {
        const material = this.getBuildMaterial();
        if (!material) { console.log("[Build] Нет материалов (нужно 25+)"); return false; }

        const plan = this.generatePlan();

        // Find a good surface location — not underground
        const origin = await this.findBuildSite(plan.w, plan.d);
        if (!origin) { console.log("[Build] Не нашёл место для дома"); return false; }
        this.homePos = origin;

        console.log(`[Build] Строю дом ${plan.w}x${plan.d}x${plan.h} на ${origin.x},${origin.y},${origin.z} из ${material}`);

        // Approach building site
        const nav = this.bot._nav;

        // === Floor ===
        const floorMat = this.getFloorMaterial() || material;
        console.log("[Build] Пол");
        for (let x = 0; x < plan.w; x++) {
            for (let z = 0; z < plan.d; z++) {
                const pos = origin.offset(x, -1, z);
                await this.placeAt(pos, floorMat);
            }
        }

        // === Walls ===
        console.log("[Build] Стены");
        for (let y = 0; y < plan.h; y++) {
            for (let x = 0; x < plan.w; x++) {
                for (let z = 0; z < plan.d; z++) {
                    const isEdge = x === 0 || x === plan.w - 1 || z === 0 || z === plan.d - 1;
                    if (!isEdge) continue;

                    const pos = origin.offset(x, y, z);

                    // Door gap
                    if (this.isDoorPosition(x, z, y, plan)) {
                        this.hasDoor = true;
                        continue;
                    }

                    // Window gaps
                    if (y === plan.windowHeight && isEdge && !this.isCorner(x, z, plan)) {
                        const wallPos = x === 0 || x === plan.w - 1 ? z : x;
                        if (wallPos % plan.windowInterval === 0 && wallPos > 0) {
                            continue; // window hole
                        }
                    }

                    if (!(this.crafting?.getItem(material))) {
                        console.log("[Build] Закончился материал");
                        return true;
                    }
                    await this.placeAt(pos, material);
                }
            }
        }

        // === Roof ===
        console.log("[Build] Крыша");
        // Pillar up inside to reach roof height
        const insidePos = origin.offset(Math.floor(plan.w / 2), 0, Math.floor(plan.d / 2));
        if (nav) await nav.goto(insidePos, 1, 5000);

        // Stack blocks under self to reach roof level
        const pillarMat = this.crafting?.getItem("cobblestone") || this.crafting?.getItem("dirt");
        if (pillarMat && plan.h > 2) {
            for (let py = 0; py < plan.h - 1; py++) {
                try {
                    const pm = this.crafting?.getItem(pillarMat.name);
                    if (!pm) break;
                    this.bot.setControlState("jump", true);
                    await new Promise(r => setTimeout(r, 400));
                    await this.bot.equip(pm, "hand");
                    const below = this.bot.blockAt(this.bot.entity.position.offset(0, -0.5, 0).floored());
                    if (below && below.name !== "air") {
                        await this.bot.placeBlock(below, new Vec3(0, 1, 0));
                    }
                    this.bot.setControlState("jump", false);
                    await new Promise(r => setTimeout(r, 200));
                } catch (e) { break; }
            }
            this.bot.setControlState("jump", false);
        }

        // Now place roof blocks (we're at roof height)
        for (let x = 0; x < plan.w; x++) {
            for (let z = 0; z < plan.d; z++) {
                const pos = origin.offset(x, plan.h, z);
                if (!(this.crafting?.getItem(material))) break;
                await this.placeAt(pos, material);
            }
        }

        // Remove pillar (dig down)
        if (pillarMat) {
            for (let py = plan.h - 2; py >= 0; py--) {
                const pillarBlock = this.bot.blockAt(insidePos.offset(0, py, 0));
                if (pillarBlock && pillarBlock.name === pillarMat.name) {
                    try { await this.bot.dig(pillarBlock); } catch (e) {}
                }
            }
        }

        this.hasRoof = true;

        // === Torch inside ===
        const torch = this.crafting?.getItem("torch");
        if (torch) {
            const torchPos = origin.offset(Math.floor(plan.w / 2), 1, Math.floor(plan.d / 2));
            const floor = this.bot.blockAt(torchPos.offset(0, -1, 0));
            if (floor && floor.name !== "air") {
                try {
                    await this.bot.equip(torch, "hand");
                    await this.bot.placeBlock(floor, new Vec3(0, 1, 0));
                } catch (e) {}
            }
        }

        // === Place chest inside ===
        const chestItem = this.crafting?.getItem("chest");
        if (chestItem) {
            const cp = origin.offset(1, 0, 1);
            if (nav) await nav.goto(cp, 2, 5000);
            const below = this.bot.blockAt(cp.offset(0, -1, 0));
            if (below && below.name !== "air") {
                try {
                    await this.bot.equip(chestItem, "hand");
                    await this.bot.placeBlock(below, new Vec3(0, 1, 0));
                    this.chestPos = cp;
                    console.log("[Build] Сундук поставлен");
                } catch (e) {}
            }
        }

        console.log("[Build] ✓ Дом построен");
        return true;
    }

    isDoorPosition(x, z, y, plan) {
        if (y >= 2) return false;
        const side = plan.doorSide;
        const offset = plan.doorOffset;
        if (side === 0 && z === 0 && x === offset) return true;
        if (side === 1 && x === plan.w - 1 && z === offset) return true;
        if (side === 2 && z === plan.d - 1 && x === offset) return true;
        if (side === 3 && x === 0 && z === offset) return true;
        return false;
    }

    isCorner(x, z, plan) {
        return (x === 0 || x === plan.w - 1) && (z === 0 || z === plan.d - 1);
    }

    // ========== Check and Repair ==========
    async checkAndRepair() {
        if (!this.homePos || this.homeBlocks.length === 0) return false;
        if (Date.now() - this.lastRepairCheck < 60000) return false;
        this.lastRepairCheck = Date.now();

        let repaired = 0;
        const material = this.getBuildMaterial();
        if (!material) return false;

        for (const record of this.homeBlocks) {
            const block = this.bot.blockAt(record.pos);
            if (!block || block.name === "air") {
                // Block was destroyed — repair it
                const dist = this.bot.entity.position.distanceTo(record.pos);
                if (dist > 4) {
                    const nav = this.bot._nav;
                    if (nav) await nav.goto(record.pos, 3, 5000);
                }
                if (await this.placeAt(record.pos, material)) {
                    repaired++;
                }
            }
        }

        if (repaired > 0) console.log(`[Build] Починено ${repaired} блоков`);
        return repaired > 0;
    }

    // ========== Store items in chest ==========
    async storeItems() {
        if (!this.chestPos) return false;

        const chestBlock = this.bot.blockAt(this.chestPos);
        if (!chestBlock || !chestBlock.name.includes("chest")) return false;

        const nav = this.bot._nav;
        if (nav) await nav.goto(this.chestPos, 2, 5000);

        try {
            const chest = await this.bot.openContainer(chestBlock);
            if (!chest) return false;

            // Store valuables
            const toStore = ["diamond", "gold_ingot", "emerald", "lapis_lazuli",
                "iron_ingot", "raw_iron", "raw_gold", "obsidian", "ender_pearl", "blaze_rod"];

            for (const name of toStore) {
                const item = this.crafting?.getItem(name);
                if (item && item.count > 10) {
                    // Keep 10, store the rest
                    const storeCount = item.count - 10;
                    try {
                        await chest.deposit(item.type, null, storeCount);
                        console.log(`[Build] Сохранил ${storeCount}x ${name}`);
                    } catch (e) {}
                }
            }

            chest.close();
            return true;
        } catch (e) { return false; }
    }

    // ========== Improve house gradually ==========
    async improveHouse() {
        if (!this.homePos) return false;
        const nav = this.bot._nav;

        // Add fence around the house
        const fenceItem = this.crafting?.getItem("oak_fence") || this.crafting?.getItem("spruce_fence");
        if (fenceItem) {
            console.log("[Build] Строю забор");
            const plan = { w: 11, d: 11 }; // fence is bigger than house
            const fenceOrigin = this.homePos.offset(-2, 0, -2);
            for (let x = 0; x < plan.w; x++) {
                for (let z = 0; z < plan.d; z++) {
                    if (x > 0 && x < plan.w - 1 && z > 0 && z < plan.d - 1) continue;
                    const pos = fenceOrigin.offset(x, 0, z);
                    const dist = this.bot.entity.position.distanceTo(pos);
                    if (dist > 4 && nav) await nav.goto(pos, 3, 3000);
                    const fi = this.crafting?.getItem(fenceItem.name);
                    if (!fi) break;
                    await this.placeAt(pos, fenceItem.name);
                }
            }
        }

        // Add torches around perimeter
        const torchItem = this.crafting?.getItem("torch");
        if (torchItem && (this.crafting?.countItem("torch") || 0) > 8) {
            console.log("[Build] Факелы вокруг дома");
            for (const off of [[-3,0,-3], [3,0,-3], [-3,0,3], [3,0,3], [0,0,-3], [0,0,3], [-3,0,0], [3,0,0]]) {
                const pos = this.homePos.offset(off[0], 0, off[2]);
                const floor = this.bot.blockAt(pos.offset(0, -1, 0));
                if (floor && floor.name !== "air") {
                    try {
                        const t = this.crafting?.getItem("torch");
                        if (!t) break;
                        await this.bot.equip(t, "hand");
                        await this.bot.placeBlock(floor, new Vec3(0, 1, 0));
                    } catch (e) {}
                }
            }
        }
    }

    // ========== Go Home ==========
    async goHome() {
        if (!this.homePos) return false;
        console.log("[Build] Иду домой");
        const nav = this.bot._nav;
        if (nav) return await nav.goto(this.homePos, 3, 30000);
        return false;
    }

    hasHome() { return !!this.homePos; }
}

module.exports = Builder;
