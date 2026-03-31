const { goals, Movements } = require("mineflayer-pathfinder");
const Vec3 = require("vec3");

class Navigation {
    constructor(bot, mcData) {
        this.bot = bot;
        this.mcData = mcData;
        this.isNavigating = false;
        this.navTimeout = null;
        this.dangerousDeaths = [];
        this.lastDangerLog = 0;
        this.walkTickInterval = null;
        this.configureMovements();
    }

    configureMovements() {
        const moves = new Movements(this.bot);
        moves.canDig = true;
        moves.allow1by1towers = false;
        moves.allowParkour = true;
        moves.allowSprinting = true;
        moves.scaffoldingBlocks = [];
        moves.blocksToAvoid = new Set();
        for (const name of ["lava", "fire", "soul_fire", "cactus", "sweet_berry_bush", "magma_block", "wither_rose"]) {
            const b = this.mcData?.blocksByName?.[name];
            if (b) moves.blocksToAvoid.add(b.id);
        }
        moves.blocksCantBreak = new Set();
        for (const name of ["chest", "furnace", "crafting_table", "enchanting_table", "anvil", "brewing_stand"]) {
            const b = this.mcData?.blocksByName?.[name];
            if (b) moves.blocksCantBreak.add(b.id);
        }
        moves.liquidCost = 15;
        moves.maxDropDown = 4;
        this.bot.pathfinder.setMovements(moves);
    }

    async goto(pos, range = 2, timeoutMs = 20000) {
        if (!pos || !this.bot.entity) return false;
        const dist = this.bot.entity.position.distanceTo(pos);
        if (dist <= range) return true;

        if (this.isNavigating) {
            try { this.bot.pathfinder.stop(); } catch (e) {}
            await new Promise(r => setTimeout(r, 200));
        }

        // Face direction of travel before starting (human doesn't walk backwards)
        const human = this.bot._human;
        if (human) await human.faceMovementDirection(pos);

        this.isNavigating = true;

        // Human walk ticks during navigation
        this.walkTickInterval = setInterval(() => {
            if (this.bot._human && this.isNavigating) {
                this.bot._human.walkTick();
            }
        }, 2000 + Math.random() * 2000);

        return new Promise((resolve) => {
            this.navTimeout = setTimeout(() => {
                this.cleanupNav();
                const fd = this.bot.entity?.position?.distanceTo(pos) ?? Infinity;
                resolve(fd <= range + 3);
            }, timeoutMs);

            try {
                this.bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, range))
                    .then(() => { this.cleanupNav(); resolve(true); })
                    .catch(() => {
                        this.cleanupNav();
                        const fd = this.bot.entity?.position?.distanceTo(pos) ?? Infinity;
                        resolve(fd <= range + 3);
                    });
            } catch (e) {
                this.cleanupNav();
                resolve(false);
            }
        });
    }

    cleanupNav() {
        if (this.navTimeout) clearTimeout(this.navTimeout);
        if (this.walkTickInterval) clearInterval(this.walkTickInterval);
        this.walkTickInterval = null;
        this.isNavigating = false;
    }

    stop() {
        this.cleanupNav();
        try { this.bot.pathfinder.stop(); } catch (e) {}
        for (const dir of ["forward", "sprint", "back", "left", "right", "jump", "sneak"])
            this.bot.setControlState(dir, false);
    }

    // ========== Safety ==========

    isSafe(pos) {
        if (!pos) return false;
        const fx = Math.floor(pos.x), fy = Math.floor(pos.y), fz = Math.floor(pos.z);
        const below = this.bot.blockAt(new Vec3(fx, fy - 1, fz));
        const at = this.bot.blockAt(new Vec3(fx, fy, fz));
        const danger = ["lava", "fire", "soul_fire", "cactus", "magma_block"];
        if (below && danger.includes(below.name)) return false;
        if (at && danger.includes(at.name)) return false;
        if (!below || below.name === "air") {
            let drop = 0;
            for (let y = fy - 1; y > fy - 15; y--) {
                const b = this.bot.blockAt(new Vec3(fx, y, fz));
                if (b && b.name !== "air") break;
                drop++;
            }
            if (drop > 5) return false;
        }
        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const b = this.bot.blockAt(new Vec3(fx + dx, fy, fz + dz));
            if (b && b.name === "lava") return false;
        }
        return true;
    }

    isNearDeath(pos, radius = 5) {
        for (const dp of this.dangerousDeaths)
            if (Math.abs(dp.x - pos.x) + Math.abs(dp.z - pos.z) < radius) return true;
        return false;
    }

    recordDeath(pos) {
        this.dangerousDeaths.push({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
        if (this.dangerousDeaths.length > 10) this.dangerousDeaths.shift();
    }

    checkCurrentDanger() {
        if (!this.bot.entity) return null;
        const atFeet = this.bot.blockAt(this.bot.entity.position.floored());
        if (atFeet && atFeet.name === "lava") return "lava";
        if (this.bot.entity.onFire) return "fire";
        if (this.bot.isInWater && this.bot.oxygenLevel !== undefined && this.bot.oxygenLevel <= 2) return "drowning";
        return null;
    }

    async escapeDanger(dangerType) {
        if (Date.now() - this.lastDangerLog > 5000) {
            console.log(`[Nav] Опасность: ${dangerType}`);
            this.lastDangerLog = Date.now();
        }
        this.stop();
        if (dangerType === "lava" || dangerType === "fire") {
            this.bot.setControlState("jump", true);
            this.bot.setControlState("forward", true);
            this.bot.setControlState("sprint", true);
            await new Promise(r => setTimeout(r, 2000));
            for (const d of ["jump","forward","sprint"]) this.bot.setControlState(d, false);
        } else if (dangerType === "drowning") {
            this.bot.setControlState("jump", true);
            await new Promise(r => setTimeout(r, 2000));
            this.bot.setControlState("jump", false);
            this.bot.setControlState("forward", true);
            await new Promise(r => setTimeout(r, 1500));
            this.bot.setControlState("forward", false);
        }
    }

    async recoverItems(deathPos) {
        if (!deathPos) return false;
        const pos = new Vec3(deathPos.x, deathPos.y, deathPos.z);
        if (!this.isSafe(pos)) return false;
        return await this.goto(pos, 3, 15000);
    }

    async lookAtHuman(pos) {
        if (this.bot._human) await this.bot._human.lookAt(pos);
        else await this.bot.lookAt(pos);
    }
}

module.exports = Navigation;
