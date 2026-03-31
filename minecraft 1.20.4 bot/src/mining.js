const Vec3 = require("vec3");

class Mining {
    constructor(bot, memory, crafting, mcData) {
        this.bot = bot;
        this.memory = memory;
        this.crafting = crafting;
        this.mcData = mcData;
        this.nav = null;
        this.isMining = false;
        this.logBlocks = ["oak_log","spruce_log","birch_log","jungle_log","acacia_log","dark_oak_log","mangrove_log","cherry_log"];
        this.leafBlocks = ["oak_leaves","spruce_leaves","birch_leaves","jungle_leaves","acacia_leaves","dark_oak_leaves"];
        this.stoneBlocks = ["stone","cobblestone","andesite","diorite","granite"];
    }

    ids(names) {
        if (!Array.isArray(names)) names = [names];
        return names.map(n => this.mcData?.blocksByName?.[n]?.id).filter(id => id !== undefined);
    }

    findBlocks(names, maxDist = 64, count = 10) {
        const ids = this.ids(names);
        if (!ids.length) return [];
        const found = this.bot.findBlocks({ matching: ids, maxDistance: maxDist, count });
        if (!found?.length) return [];
        found.sort((a, b) => this.bot.entity.position.distanceTo(a) - this.bot.entity.position.distanceTo(b));
        return found;
    }

    findNearest(names, maxDist = 64) {
        const found = this.findBlocks(names, maxDist, 5);
        return found.length > 0 ? new Vec3(found[0].x, found[0].y, found[0].z) : null;
    }

    async goTo(pos, range = 2) {
        if (!pos) return false;
        if (this.nav) return await this.nav.goto(pos, range, 15000);
        const { goals } = require("mineflayer-pathfinder");
        try {
            await this.bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, range));
            return true;
        } catch (e) { return this.bot.entity.position.distanceTo(pos) <= range + 2; }
    }

    async equipBestPick() {
        for (const p of ["netherite_pickaxe","diamond_pickaxe","iron_pickaxe","stone_pickaxe","wooden_pickaxe"]) {
            const item = this.crafting?.getItem(p);
            if (item) { await this.bot.equip(item, "hand"); return item; }
        }
        return null;
    }

    async equipBestAxe() {
        for (const a of ["netherite_axe","diamond_axe","iron_axe","stone_axe","wooden_axe"]) {
            const item = this.crafting?.getItem(a);
            if (item) { await this.bot.equip(item, "hand"); return item; }
        }
        return null;
    }

    // ========== Core dig — with human-like look-before-dig ==========
    async dig(pos, toolType = "pick") {
        const block = this.bot.blockAt(pos);
        if (!block || block.name === "air" || block.name === "bedrock") return false;
        const dist = this.bot.entity.position.distanceTo(pos);
        if (dist > 4.5) return false;

        // LOS check
        if (dist > 2) {
            const eyePos = this.bot.entity.position.offset(0, 1.62, 0);
            const target = new Vec3(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
            const dir = target.minus(eyePos);
            const len = dir.norm();
            const step = dir.scaled(1 / len);
            const passable = ["air","water","cave_air","snow","tall_grass","fern","vine","dead_bush"];
            for (let d = 1; d < len - 0.5; d += 0.5) {
                const cp = eyePos.plus(step.scaled(d)).floored();
                if (cp.x === Math.floor(pos.x) && cp.y === Math.floor(pos.y) && cp.z === Math.floor(pos.z)) break;
                const between = this.bot.blockAt(cp);
                if (!between) continue;
                if (passable.includes(between.name) || between.name.includes("leaves") || between.name.includes("grass") || between.boundingBox === "empty") continue;
                return false;
            }
        }

        try {
            // ALWAYS equip correct tool before digging
            if (toolType === "axe") await this.equipBestAxe();
            else await this.equipBestPick();

            // Look at block (human-like but fast)
            const human = this.bot._human;
            if (human) await human.lookAt(pos);
            else await this.bot.lookAt(pos);

            await this.bot.dig(block);
            return true;
        } catch (e) { return false; }
    }

    canReach(pos) { return this.bot.entity.position.distanceTo(pos) <= 4.5; }

    async collectNearbyItems() {
        const items = [];
        for (const id in this.bot.entities) {
            const e = this.bot.entities[id];
            if (e && e.name === "item" && e.position && this.bot.entity.position.distanceTo(e.position) < 10)
                items.push(e);
        }
        items.sort((a, b) => this.bot.entity.position.distanceTo(a.position) - this.bot.entity.position.distanceTo(b.position));
        for (const item of items.slice(0, 5)) {
            try { await this.goTo(item.position, 0.5); await new Promise(r => setTimeout(r, 80)); } catch (e) {}
        }
    }

    async mineBlock(pos) {
        if (!pos) return false;
        if (this.nav && !this.nav.isSafe(pos)) return false;
        await this.equipBestPick();

        if (!this.canReach(pos)) { if (!(await this.goTo(pos, 3))) return false; }
        if (!this.canReach(pos)) { if (!(await this.goTo(pos, 1))) return false; }
        if (!this.canReach(pos)) return false;

        let result = await this.dig(pos);

        // Dig through blocking blocks if needed
        if (!result && this.canReach(pos)) {
            await this.equipBestPick();
            const eyePos = this.bot.entity.position.offset(0, 1.62, 0);
            const target = new Vec3(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
            const dir = target.minus(eyePos);
            const len = dir.norm();
            const step = dir.scaled(1 / len);
            for (let d = 0.5; d < len; d += 0.5) {
                const cp = eyePos.plus(step.scaled(d)).floored();
                if (cp.x === Math.floor(pos.x) && cp.y === Math.floor(pos.y) && cp.z === Math.floor(pos.z)) break;
                const between = this.bot.blockAt(cp);
                if (between && between.name !== "air" && between.name !== "water" && between.name !== "cave_air" && between.boundingBox !== "empty") {
                    try { await this.bot.lookAt(cp); await this.bot.dig(between); } catch (e) { break; }
                }
            }
            await this.equipBestPick();
            result = await this.dig(pos);
        }

        if (result) console.log(`[Mine] ✓ ${this.bot.blockAt(pos)?.name || "block"}`);
        await this.collectNearbyItems();
        return result;
    }

    // ========== Trees ==========
    findTree() { return this.findNearest(this.logBlocks); }
    findTreeByLeaves() {
        const found = this.findBlocks(this.leafBlocks, 64, 20);
        for (const leafPos of found) {
            for (let y = leafPos.y; y >= leafPos.y - 8; y--) {
                const p = new Vec3(leafPos.x, y, leafPos.z);
                const b = this.bot.blockAt(p);
                if (b && this.logBlocks.includes(b.name)) return p;
            }
        }
        return null;
    }

    async chopTree(startPos) {
        const logs = [];
        const queue = [startPos];
        const visited = new Set();
        while (queue.length > 0) {
            const p = queue.shift();
            const key = `${p.x},${p.y},${p.z}`;
            if (visited.has(key)) continue;
            visited.add(key);
            const b = this.bot.blockAt(p);
            if (b && this.logBlocks.includes(b.name)) {
                logs.push(p);
                for (let dy = 0; dy <= 1; dy++)
                    for (let dx = -1; dx <= 1; dx++)
                        for (let dz = -1; dz <= 1; dz++) {
                            if (dx === 0 && dy === 0 && dz === 0) continue;
                            queue.push(new Vec3(p.x+dx, p.y+dy, p.z+dz));
                        }
            }
        }
        if (!logs.length) return false;
        logs.sort((a, b) => b.y - a.y);
        await this.equipBestAxe();
        let count = 0;
        for (const pos of logs) {
            const b = this.bot.blockAt(pos);
            if (!b || !this.logBlocks.includes(b.name)) continue;
            if (!this.canReach(pos)) { if (!(await this.goTo(pos, 3))) continue; }
            if (!this.canReach(pos)) continue;
            if (await this.dig(pos, "axe")) count++;
            if (this.nav) {
                const danger = this.nav.checkCurrentDanger();
                if (danger) { await this.nav.escapeDanger(danger); break; }
            }
        }
        await this.collectNearbyItems();
        if (count > 0) console.log(`[Mine] Срублено ${count} бревен`);
        return count > 0;
    }

    // ========== Ores ==========
    findStone() { return this.findNearest(this.stoneBlocks); }
    findIron() { return this.findNearest(["iron_ore","deepslate_iron_ore"]); }
    findCoal() { return this.findNearest(["coal_ore","deepslate_coal_ore"]); }
    findGold() { return this.findNearest(["gold_ore","deepslate_gold_ore"]); }
    findDiamond() { return this.findNearest(["diamond_ore","deepslate_diamond_ore"]); }
    findObsidian() { return this.findNearest(["obsidian"]); }
    async mineStone() { return await this.mineBlock(this.findStone()); }
    async mineIron() { return await this.mineBlock(this.findIron()); }
    async mineCoal() { return await this.mineBlock(this.findCoal()); }

    async mineObsidian() {
        const obs = this.findObsidian();
        if (obs) {
            const dpick = this.crafting?.getItem("diamond_pickaxe");
            if (!dpick) return false;
            await this.bot.equip(dpick, "hand");
            if (!(await this.goTo(obs, 3))) return false;
            return await this.dig(obs);
        }
        const waterBucket = this.crafting?.getItem("water_bucket");
        if (!waterBucket) { console.log("[Mine] Нет ведра воды"); return false; }
        const lavaIds = this.ids(["lava"]);
        const lava = lavaIds.length > 0 ? this.bot.findBlock({ matching: lavaIds, maxDistance: 32 }) : null;
        if (!lava) throw new Error("no lava nearby");
        const safe = this.findSafePositionNear(lava.position, 3);
        if (!safe) return false;
        if (!(await this.goTo(safe, 1))) return false;
        await this.bot.equip(waterBucket, "hand");
        await this.bot.lookAt(lava.position);
        try {
            await this.bot.activateItem();
            await new Promise(r => setTimeout(r, 2000));
            const bucket = this.crafting?.getItem("bucket");
            if (bucket) {
                const wIds = this.ids(["water"]);
                const w = wIds.length > 0 ? this.bot.findBlock({ matching: wIds, maxDistance: 5 }) : null;
                if (w) { await this.bot.equip(bucket, "hand"); await this.bot.lookAt(w.position); await this.bot.activateItem(); await new Promise(r => setTimeout(r, 500)); }
            }
            const newObs = this.findObsidian();
            if (newObs) return await this.mineBlock(newObs);
        } catch (e) {}
        return false;
    }

    findSafePositionNear(dangerPos, dist) {
        for (const off of [new Vec3(dist,0,0),new Vec3(-dist,0,0),new Vec3(0,0,dist),new Vec3(0,0,-dist)]) {
            const pos = dangerPos.plus(off);
            for (let y = pos.y + 3; y > pos.y - 5; y--) {
                const g = this.bot.blockAt(new Vec3(pos.x, y, pos.z));
                const a = this.bot.blockAt(new Vec3(pos.x, y+1, pos.z));
                if (g && g.name !== "air" && g.name !== "lava" && a && a.name === "air") {
                    const sp = new Vec3(pos.x, y+1, pos.z);
                    if (!this.nav || this.nav.isSafe(sp)) return sp;
                }
            }
        }
        return null;
    }

    async huntEnderman() {
        for (const id in this.bot.entities) {
            const e = this.bot.entities[id];
            if (e && e.name === "enderman" && this.bot.entity.position.distanceTo(e.position) < 32) {
                console.log("[Mine] Охота на эндермена");
                const sword = this.crafting?.getItem("diamond_sword") || this.crafting?.getItem("iron_sword");
                if (sword) await this.bot.equip(sword, "hand");
                await this.bot.lookAt(e.position.offset(0, 1.6, 0));
                await new Promise(r => setTimeout(r, 500));
                for (let i = 0; i < 20; i++) {
                    if (!e.isValid) break;
                    if (this.bot.entity.position.distanceTo(e.position) < 4) { try { await this.bot.attack(e); } catch (er) {} }
                    await new Promise(r => setTimeout(r, 500));
                }
                await this.collectNearbyItems();
                return true;
            }
        }
        return false;
    }

    // ========== Branch mining ==========
    async startBranchMining() {
        if (this.isMining) return false;
        this.isMining = true;
        console.log("[Mine] Бранч-майнинг");
        try {
            await this.equipBestPick();
            const targetY = 11;
            if (this.bot.entity.position.y > targetY + 5) {
                let steps = 0;
                while (Math.floor(this.bot.entity.position.y) > targetY + 1 && steps < 60) {
                    await this.equipBestPick();
                    const pos = this.bot.entity.position.floored();
                    const yaw = this.bot.entity.yaw;
                    const dx = Math.round(-Math.sin(yaw));
                    const dz = Math.round(-Math.cos(yaw));
                    await this.dig(pos.offset(dx, 0, dz));
                    await this.dig(pos.offset(dx, -1, dz));
                    const nextFloor = this.bot.blockAt(pos.offset(dx, -2, dz));
                    if (nextFloor && nextFloor.name === "lava") { await this.bot.look(this.bot.entity.yaw + Math.PI/2, 0); continue; }
                    this.bot.setControlState("forward", true);
                    await new Promise(r => setTimeout(r, 300));
                    this.bot.setControlState("forward", false);
                    if (steps % 7 === 0) await this.placeTorch();
                    steps++;
                }
            }
            for (let i = 0; i < 80; i++) {
                if (this.nav) { const d = this.nav.checkCurrentDanger(); if (d) { await this.nav.escapeDanger(d); break; } }
                await this.equipBestPick();
                const yaw = this.bot.entity.yaw;
                const dx = Math.round(-Math.sin(yaw));
                const dz = Math.round(-Math.cos(yaw));
                const pos = this.bot.entity.position.floored();
                const ahead = this.bot.blockAt(pos.offset(dx, 0, dz));
                if (ahead && (ahead.name === "lava" || ahead.name === "water")) break;
                await this.dig(pos.offset(dx, 0, dz));
                await this.dig(pos.offset(dx, 1, dz));
                this.bot.setControlState("forward", true);
                await new Promise(r => setTimeout(r, 50));
                this.bot.setControlState("forward", false);
                if (i % 7 === 0 && i > 0) await this.placeTorch();
                if (i % 10 === 0) await this.collectNearbyItems();
                await this.checkAdjacentOres(pos);
            }
            await this.collectNearbyItems();
            return true;
        } catch (e) { return false; }
        finally { this.isMining = false; this.bot.setControlState("forward", false); }
    }

    async checkAdjacentOres(pos) {
        const oreNames = ["diamond_ore","deepslate_diamond_ore","iron_ore","deepslate_iron_ore","gold_ore","deepslate_gold_ore","coal_ore","deepslate_coal_ore","lapis_ore","deepslate_lapis_ore","redstone_ore","deepslate_redstone_ore","emerald_ore","deepslate_emerald_ore"];
        for (const [ox,oy,oz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,0],[-1,1,0],[0,1,1],[0,1,-1]]) {
            const cp = pos.offset(ox, oy, oz);
            const block = this.bot.blockAt(cp);
            if (block && oreNames.includes(block.name)) {
                if (block.name.includes("diamond") && this.bot._human) await this.bot._human.reactTo("diamond");
                await this.equipBestPick();
                await this.dig(cp);
            }
        }
    }

    async placeTorch() {
        const torch = this.crafting?.getItem("torch");
        if (!torch) return;
        try {
            await this.bot.equip(torch, "hand");
            const pos = this.bot.entity.position.floored();
            const yaw = this.bot.entity.yaw;
            const bx = Math.round(Math.sin(yaw));
            const bz = Math.round(Math.cos(yaw));
            const wallOffsets = [
                new Vec3(bx, 1, bz), new Vec3(bx, 0, bz),
                new Vec3(-bx, 1, -bz),
                new Vec3(1, 1, 0), new Vec3(-1, 1, 0), new Vec3(0, 1, 1), new Vec3(0, 1, -1)
            ];
            for (const off of wallOffsets) {
                const wall = this.bot.blockAt(pos.plus(off));
                if (wall && wall.name !== "air" && wall.name !== "water" && !wall.name.includes("torch")) {
                    const face = new Vec3(off.x ? -Math.sign(off.x) : 0, 0, off.z ? -Math.sign(off.z) : 0);
                    await this.bot.placeBlock(wall, face);
                    return;
                }
            }
        } catch (e) {}
    }

    async autoMine() {
        if (this.isMining) return false;
        this.isMining = true;
        try {
            if (this.nav) { const d = this.nav.checkCurrentDanger(); if (d) { await this.nav.escapeDanger(d); return true; } }
            const wood = ["oak_log","spruce_log","birch_log","jungle_log"].reduce((s,n) => s + (this.crafting?.countItem(n)||0), 0);
            const cobble = this.crafting?.countItem("cobblestone") || 0;
            const iron = this.crafting?.countItem("iron_ingot") || 0;
            const rawIron = this.crafting?.countItem("raw_iron") || 0;
            const diamond = this.crafting?.countItem("diamond") || 0;
            const coal = (this.crafting?.countItem("coal")||0) + (this.crafting?.countItem("charcoal")||0);

            if (wood < 16) { const t = this.findTreeByLeaves() || this.findTree(); if (t) { await this.chopTree(t); return true; } }
            if (coal < 16 && this.crafting?.hasItem("stone_pickaxe")) { const c = this.findCoal(); if (c) { await this.mineBlock(c); return true; } }
            if (cobble < 32) { const s = this.findStone(); if (s) { await this.mineBlock(s); return true; } }
            if ((iron + rawIron) < 16 && (this.crafting?.hasItem("stone_pickaxe") || this.crafting?.hasItem("iron_pickaxe"))) { const ir = this.findIron(); if (ir) { await this.mineBlock(ir); return true; } }
            if (diamond < 5 && this.crafting?.hasItem("iron_pickaxe")) { const di = this.findDiamond(); if (di) { await this.mineBlock(di); return true; } await this.startBranchMining(); return true; }
            const t = this.findTreeByLeaves() || this.findTree(); if (t) { await this.chopTree(t); return true; }
            return false;
        } finally { this.isMining = false; }
    }
}
module.exports = Mining;
