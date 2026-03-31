const { goals } = require("mineflayer-pathfinder");
const Vec3 = require("vec3");

class EnderManager {
    constructor(bot, memory, crafting, inventory, combat, nether, potions, enchanting) {
        this.bot = bot; this.crafting = crafting; this.inventory = inventory; this.combat = combat;
        this.dragonKilled = false;
        this.progress = {hasStronghold:false, portalActivated:false};
    }

    blockId(name) { return this.bot.mcData?.blocksByName?.[name]?.id || null; }

    findDragon() {
        for (const id in this.bot.entities) {
            const e = this.bot.entities[id];
            if (e && e.name === "ender_dragon") return e;
        }
        return null;
    }

    async findStronghold() {
        const eyeCount = this.crafting?.countItem("ender_eye") || 0;
        if (eyeCount < 3) { console.log(`[Ender] Нужно минимум 3 ока, есть: ${eyeCount}`); return false; }

        console.log("[Ender] Ищу крепость с помощью очей Эндера...");

        // Throw eye, watch where it goes, move in that direction, repeat
        for (let attempt = 0; attempt < 8; attempt++) {
            const eye = this.crafting?.getItem("ender_eye");
            if (!eye) break;

            await this.bot.equip(eye, "hand");
            const startPos = this.bot.entity.position.clone();
            await this.bot.activateItem();
            await new Promise(r => setTimeout(r, 2000));

            // Check if portal frame is nearby now
            const frameId = this.blockId("end_portal_frame");
            if (frameId !== null) {
                const pf = this.bot.findBlock({matching: frameId, maxDistance: 50});
                if (pf) {
                    this.progress.hasStronghold = true;
                    console.log(`[Ender] Крепость найдена на ${pf.position}`);
                    await this.bot.pathfinder.goto(new goals.GoalNear(pf.position.x, pf.position.y, pf.position.z, 3));
                    return true;
                }
            }

            // Move forward in the direction we're facing
            this.bot.setControlState("sprint", true);
            this.bot.setControlState("forward", true);
            await new Promise(r => setTimeout(r, 5000));
            this.bot.setControlState("sprint", false);
            this.bot.setControlState("forward", false);
        }

        // Final check
        const frameId = this.blockId("end_portal_frame");
        if (frameId !== null) {
            const pf = this.bot.findBlock({matching: frameId, maxDistance: 100});
            this.progress.hasStronghold = !!pf;
        }
        return this.progress.hasStronghold;
    }

    async activateEndPortal() {
        const frameId = this.blockId("end_portal_frame");
        if (frameId === null) return false;

        const frames = this.bot.findBlocks({matching: frameId, maxDistance: 30, count: 12});
        if (frames.length < 12) {
            console.log(`[Ender] Найдено ${frames.length} рамок (нужно 12)`);
            return false;
        }

        for (const fPos of frames) {
            const block = this.bot.blockAt(fPos);
            if (!block) continue;
            // metadata check: if eye is not inserted (bit 0x4 not set in properties)
            const hasEye = block.getProperties?.()?.eye === "true";
            if (!hasEye) {
                const eye = this.crafting?.getItem("ender_eye");
                if (!eye) { console.log("[Ender] Не хватает очей"); return false; }
                await this.bot.equip(eye, "hand");
                await this.bot.lookAt(fPos);
                try { await this.bot.activateBlock(block); } catch(e) {}
                await new Promise(r => setTimeout(r, 500));
            }
        }

        const portalId = this.blockId("end_portal");
        if (portalId !== null) {
            const po = this.bot.findBlock({matching: portalId, maxDistance: 10});
            this.progress.portalActivated = !!po;
        }
        console.log(`[Ender] Портал ${this.progress.portalActivated ? "активирован" : "не активирован"}`);
        return this.progress.portalActivated;
    }

    async enterEnd() {
        const portalId = this.blockId("end_portal");
        if (portalId === null) return false;
        const po = this.bot.findBlock({matching: portalId, maxDistance: 10});
        if (po) {
            await this.bot.pathfinder.goto(new goals.GoalNear(po.position.x, po.position.y, po.position.z, 1));
            this.bot.setControlState("forward", true);
            await new Promise(r => setTimeout(r, 3000));
            this.bot.setControlState("forward", false);
            return true;
        }
        return false;
    }

    async destroyCrystals() {
        const crystals = [];
        for (const id in this.bot.entities) {
            const e = this.bot.entities[id];
            if (e && e.name === "end_crystal") crystals.push(e);
        }
        if (crystals.length === 0) return;

        console.log(`[Ender] Уничтожаю ${crystals.length} кристаллов`);

        const bow = this.crafting?.getItem("bow");
        const arrows = this.crafting?.countItem("arrow") || 0;

        for (const crystal of crystals) {
            if (!crystal.isValid) continue;
            const dist = this.bot.entity.position.distanceTo(crystal.position);

            if (bow && arrows > 0 && dist > 5) {
                await this.bot.equip(bow, "hand");
                await this.bot.lookAt(crystal.position);
                this.bot.activateItem();
                await new Promise(r => setTimeout(r, 1000)); // Full draw
                await this.bot.lookAt(crystal.position); // Re-aim
                this.bot.deactivateItem();
                await new Promise(r => setTimeout(r, 500));
            } else if (dist <= 5) {
                try { await this.bot.attack(crystal); } catch(e) {}
                await new Promise(r => setTimeout(r, 300));
            }
        }
    }

    async fightDragon() {
        let dr = this.findDragon();
        if (!dr) { console.log("[Ender] Дракон не найден"); return false; }

        console.log("[Ender] Бой с драконом!");

        // Step 1: Destroy crystals
        await this.destroyCrystals();

        // Step 2: Eat golden apple
        const ga = this.crafting?.getItem("golden_apple") || this.crafting?.getItem("enchanted_golden_apple");
        if (ga) {
            await this.bot.equip(ga, "hand");
            try { await this.bot.consume(); } catch(e) {}
            await new Promise(r => setTimeout(r, 1000));
        }

        // Step 3: Shoot with bow when dragon is far
        const bow = this.crafting?.getItem("bow");
        if (bow && (this.crafting?.countItem("arrow") || 0) > 0) {
            await this.bot.equip(bow, "hand");
            for (let i = 0; i < 30; i++) {
                dr = this.findDragon();
                if (!dr) break;
                await this.bot.lookAt(dr.position.offset(0, 2, 0));
                this.bot.activateItem();
                await new Promise(r => setTimeout(r, 800));
                await this.bot.lookAt(dr.position.offset(0, 2, 0));
                this.bot.deactivateItem();
                await new Promise(r => setTimeout(r, 500));
            }
        }

        // Step 4: Melee when dragon is perching
        const sw = this.crafting?.getItem("diamond_sword") || this.crafting?.getItem("iron_sword") || this.crafting?.getItem("netherite_sword");
        if (sw) {
            await this.bot.equip(sw, "hand");
            for (let i = 0; i < 60; i++) {
                dr = this.findDragon();
                if (!dr) break;
                if (dr.position.y < 70) {
                    try {
                        await this.bot.lookAt(dr.position);
                        await this.bot.attack(dr);
                    } catch(e) {}
                }
                await new Promise(r => setTimeout(r, 600));

                // Heal if low
                if (this.bot.health < 10) {
                    const food = this.crafting?.getItem("golden_apple") || this.crafting?.getItem("cooked_beef") || this.crafting?.getItem("bread");
                    if (food) { await this.bot.equip(food, "hand"); try { await this.bot.consume(); } catch(e) {} await new Promise(r=>setTimeout(r,1000)); }
                    if (sw) await this.bot.equip(sw, "hand");
                }
            }
        }

        this.dragonKilled = !this.findDragon();
        console.log(`[Ender] Дракон ${this.dragonKilled ? "убит!" : "жив..."}`);
        return this.dragonKilled;
    }

    async collectElytra() {
        const purpurId = this.blockId("purpur_block");
        if (purpurId === null) return false;
        const ec = this.bot.findBlock({matching: purpurId, maxDistance: 100});
        return !!ec;
    }
}
module.exports = EnderManager;
