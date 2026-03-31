const { goals } = require("mineflayer-pathfinder");
const Vec3 = require("vec3");

class NetherManager {
    constructor(bot, memory, crafting, inventory, combat, potions, enchanting) {
        this.bot = bot; this.crafting = crafting; this.inventory = inventory; this.combat = combat;
        this.progress = {portal_built:false, hasFortress:false, blazeRods:0};
    }

    async placeBlockAt(pos, itemName) {
        const item = this.crafting?.getItem(itemName);
        if (!item) return false;
        // Find an adjacent solid block to place against
        const offsets = [
            new Vec3(0,-1,0), new Vec3(0,1,0), new Vec3(-1,0,0),
            new Vec3(1,0,0), new Vec3(0,0,-1), new Vec3(0,0,1)
        ];
        for (const off of offsets) {
            const refPos = pos.plus(off);
            const refBlock = this.bot.blockAt(refPos);
            if (refBlock && refBlock.name !== "air" && refBlock.name !== "lava" && refBlock.name !== "water") {
                const faceVec = off.scaled(-1); // face towards target from reference
                await this.bot.equip(item, "hand");
                try {
                    await this.bot.placeBlock(refBlock, faceVec);
                    await new Promise(r=>setTimeout(r,200));
                    return true;
                } catch(e) { continue; }
            }
        }
        return false;
    }

    async buildPortal() {
        const obs = this.crafting?.countItem("obsidian") || 0;
        if (obs < 10) { console.log(`[Nether] Нужно 10 обсидиана, есть: ${obs}`); return false; }

        const p = this.bot.entity.position;
        const px = Math.floor(p.x) + 2, py = Math.floor(p.y), pz = Math.floor(p.z);

        // Approach build location
        try { await this.bot.pathfinder.goto(new goals.GoalNear(px, py, pz, 3)); } catch(e) {}

        console.log("[Nether] Строю портал...");

        // Bottom row
        for (let x=0; x<4; x++) await this.placeBlockAt(new Vec3(px+x, py, pz), "obsidian");
        // Left column
        for (let y=1; y<4; y++) await this.placeBlockAt(new Vec3(px, py+y, pz), "obsidian");
        // Right column
        for (let y=1; y<4; y++) await this.placeBlockAt(new Vec3(px+3, py+y, pz), "obsidian");
        // Top row
        for (let x=0; x<4; x++) await this.placeBlockAt(new Vec3(px+x, py+4, pz), "obsidian");

        this.progress.portal_built = true;
        console.log("[Nether] Портал построен");
        return true;
    }

    async lightPortal() {
        const fl = this.crafting?.getItem("flint_and_steel");
        if (!fl) { console.log("[Nether] Нет огнива"); return false; }
        await this.bot.equip(fl, "hand");

        // Find obsidian and click INSIDE the frame
        const obsId = this.bot.mcData?.blocksByName?.["obsidian"]?.id;
        if (!obsId) return false;
        const obs = this.bot.findBlock({ matching: obsId, maxDistance: 5 });
        if (obs) {
            try {
                // Look at the inner part of the bottom obsidian
                const inner = obs.position.offset(1, 1, 0);
                await this.bot.lookAt(inner);
                // Right-click on obsidian block with flint_and_steel
                await this.bot.activateBlock(obs);
                await new Promise(r => setTimeout(r, 1000));
                console.log("[Nether] Портал зажжён");
                return true;
            } catch (e) {
                console.log(`[Nether] Ошибка зажигания: ${e.message}`);
                return false;
            }
        }
        return false;
    }

    async enterPortal() {
        const portalId = this.bot.mcData?.blocksByName?.["nether_portal"]?.id;
        if (!portalId) return false;
        const po = this.bot.findBlock({matching: portalId, maxDistance: 10});
        if (po) {
            await this.bot.pathfinder.goto(new goals.GoalNear(po.position.x, po.position.y, po.position.z, 1));
            this.bot.setControlState("forward", true);
            await new Promise(r => setTimeout(r, 4000));
            this.bot.setControlState("forward", false);
            return true;
        }
        return false;
    }

    async returnToOverworld() { return await this.enterPortal(); }

    async exploreNether() {
        await this.buildPortal();
        await this.lightPortal();
        await this.enterPortal();
        return true;
    }

    async equipGoldenArmor() {
        const h = this.crafting?.getItem("golden_helmet");
        const c = this.crafting?.getItem("golden_chestplate");
        if (h) await this.bot.equip(h, "head");
        if (c) await this.bot.equip(c, "torso");
    }
}
module.exports = NetherManager;
