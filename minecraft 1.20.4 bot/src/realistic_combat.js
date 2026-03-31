const { goals } = require("mineflayer-pathfinder");

class Combat {
    constructor(bot, memory, crafting, inventory) {
        this.bot = bot;
        this.memory = memory;
        this.crafting = crafting;
        this.inventory = inventory;
        this.nav = null;
        this.inCombat = false;
        this.currentTarget = null;
        this.combatLoop = null;
        this.lastAttack = 0;
        this.attackCooldown = 625;
        this.kills = 0;
        this.hostileMobs = ["zombie","skeleton","spider","cave_spider","creeper","enderman","witch","pillager","vindicator","blaze","ghast","hoglin","piglin_brute","warden","guardian","phantom","drowned","husk","stray","wither_skeleton","magma_cube","slime"];
        this.rangedMobs = ["skeleton","stray","pillager","blaze","ghast","witch"];
        this.fleeFromMobs = ["creeper","warden"];
    }

    findNearestHostile(maxDist = 16) {
        let nearest = null, nearestDist = maxDist;
        for (const id in this.bot.entities) {
            const e = this.bot.entities[id];
            if (!e || e === this.bot.entity || !e.position) continue;
            if (!this.hostileMobs.includes(e.name)) continue;
            const d = this.bot.entity.position.distanceTo(e.position);
            if (d < nearestDist) { nearestDist = d; nearest = e; }
        }
        return nearest;
    }

    async equipBestSword() {
        for (const s of ["netherite_sword","diamond_sword","iron_sword","stone_sword","wooden_sword"]) {
            const item = this.crafting?.getItem(s);
            if (item) { await this.bot.equip(item, "hand"); return true; }
        }
        return false;
    }

    async equipShield() {
        const shield = this.crafting?.getItem("shield");
        if (shield) { try { await this.bot.equip(shield, "off-hand"); return true; } catch (e) {} }
        return false;
    }

    async equipBow() {
        const bow = this.crafting?.getItem("bow");
        if (bow && (this.crafting?.countItem("arrow") || 0) > 0) { await this.bot.equip(bow, "hand"); return true; }
        return false;
    }

    // ========== Human-like melee ==========
    async meleeAttack(target) {
        if (!target?.isValid) return false;
        const now = Date.now();
        if (now - this.lastAttack < this.attackCooldown) return false;
        const dist = this.bot.entity.position.distanceTo(target.position);

        if (dist > 3.5) {
            try { this.bot.pathfinder.setGoal(new goals.GoalFollow(target, 2)); } catch (e) {}
            return false;
        }

        try { this.bot.pathfinder.stop(); } catch (e) {}

        // Face target naturally (not instant snap)
        const human = this.bot._human;
        if (human) await human.lookAt(target.position.offset(0, target.height * 0.8, 0));
        else await this.bot.lookAt(target.position.offset(0, target.height * 0.8, 0));

        // Pick combat technique
        const technique = Math.random();
        if (technique < 0.30 && this.bot.entity.onGround) {
            // CRIT: jump + hit while falling
            this.bot.setControlState("jump", true);
            await new Promise(r => setTimeout(r, 120 + Math.random() * 50));
            this.bot.setControlState("jump", false);
            await new Promise(r => setTimeout(r, 60 + Math.random() * 40));
        } else if (technique < 0.55) {
            // W-TAP: release W, re-press with sprint
            this.bot.setControlState("forward", false);
            this.bot.setControlState("sprint", false);
            await new Promise(r => setTimeout(r, 30 + Math.random() * 40));
            this.bot.setControlState("forward", true);
            this.bot.setControlState("sprint", true);
            await new Promise(r => setTimeout(r, 80 + Math.random() * 50));
        } else if (technique < 0.70) {
            // Sprint reset
            this.bot.setControlState("sprint", true);
            this.bot.setControlState("forward", true);
            await new Promise(r => setTimeout(r, 60 + Math.random() * 40));
        }

        try {
            await this.bot.attack(target);
            this.lastAttack = now;

            // Post-hit: human movement
            if (human) await human.combatTick(target);
            else {
                // Basic post-hit strafe
                if (Math.random() < 0.4) {
                    const dir = Math.random() > 0.5 ? "left" : "right";
                    this.bot.setControlState(dir, true);
                    setTimeout(() => this.bot.setControlState(dir, false), 200 + Math.random() * 200);
                }
            }

            // Reset sprint
            setTimeout(() => {
                this.bot.setControlState("sprint", false);
                this.bot.setControlState("forward", false);
            }, 300);

            return true;
        } catch (e) { return false; }
    }

    async bowAttack(target) {
        if (!target?.isValid) return false;
        if (!(await this.equipBow())) return false;

        // Predict target position
        const dist = this.bot.entity.position.distanceTo(target.position);
        const vx = target.velocity?.x || 0;
        const vz = target.velocity?.z || 0;
        const ft = dist / 30;
        const predicted = {
            x: target.position.x + vx * ft * 20,
            y: target.position.y + target.height * 0.7,
            z: target.position.z + vz * ft * 20
        };

        // Look at predicted position naturally
        if (this.bot._human) await this.bot._human.lookAt(predicted);
        else await this.bot.lookAt(predicted);

        try {
            this.bot.activateItem();
            await new Promise(r => setTimeout(r, 800 + Math.random() * 300)); // draw
            await this.bot.lookAt(predicted); // re-aim
            this.bot.deactivateItem(); // release
            this.lastAttack = Date.now();
            return true;
        } catch (e) { return false; }
    }

    async shieldBlock(ms = 500) {
        try {
            await this.equipShield();
            this.bot.activateItem(true);
            setTimeout(() => { try { this.bot.deactivateItem(); } catch (e) {} }, ms);
        } catch (e) {}
    }

    async flee(target) {
        if (!target?.position) return;
        const pos = this.bot.entity.position;
        const dx = pos.x - target.position.x;
        const dz = pos.z - target.position.z;
        const len = Math.sqrt(dx*dx + dz*dz) || 1;

        // Face AWAY from target (run forward, not backward)
        const fleeYaw = Math.atan2(dx / len, dz / len);
        await this.bot.look(fleeYaw, 0, true);

        this.bot.setControlState("forward", true);
        this.bot.setControlState("sprint", true);
        await new Promise(r => setTimeout(r, 2500 + Math.random() * 1500));
        this.bot.setControlState("forward", false);
        this.bot.setControlState("sprint", false);
    }

    async eatInCombat() {
        if (this.bot.food >= 18) return;
        const food = this.inventory?.getBestFood();
        if (!food) return;
        try { await this.bot.equip(food, "hand"); await this.bot.consume(); } catch (e) {}
        await this.equipBestSword();
    }

    // ========== Main combat ==========
    async startCombat(target) {
        if (this.inCombat) return;
        if (!target?.isValid) return;

        if (this.bot.health < 6) {
            console.log(`[Combat] HP ${Math.floor(this.bot.health)}, убегаю`);
            await this.flee(target);
            return;
        }

        this.inCombat = true;
        this.currentTarget = target;
        console.log(`[Combat] Бой: ${target.name || "entity"}`);

        if (this.fleeFromMobs.includes(target.name)) {
            console.log(`[Combat] Убегаю от ${target.name}!`);
            await this.flee(target);
            this.stopCombat();
            return;
        }

        if (this.bot.food < 12) await this.eatInCombat();
        await this.equipBestSword();
        await this.equipShield();
        const isRanged = this.rangedMobs.includes(target.name);

        this.combatLoop = setInterval(async () => {
            if (!this.currentTarget?.isValid) {
                this.kills++;
                console.log(`[Combat] Убил (всего: ${this.kills})`);
                if (this.bot._human) this.bot._human.reactTo("kill");
                this.stopCombat();
                return;
            }

            const hp = this.bot.health;
            const dist = this.bot.entity.position.distanceTo(this.currentTarget.position);

            if (hp < 6) {
                console.log(`[Combat] HP ${Math.floor(hp)}, отступаю`);
                await this.flee(this.currentTarget);
                await this.eatInCombat();
                this.stopCombat();
                return;
            }

            if (hp < 12 && dist > 5) await this.eatInCombat();

            if (isRanged && dist > 4 && dist < 16) {
                if (Math.random() < 0.25) await this.shieldBlock(400);
                if (await this.equipBow()) {
                    await this.bowAttack(this.currentTarget);
                    await this.equipBestSword();
                } else {
                    try { this.bot.pathfinder.setGoal(new goals.GoalFollow(this.currentTarget, 2)); } catch (e) {}
                }
                return;
            }

            if (dist <= 4) {
                await this.equipBestSword();
                await this.meleeAttack(this.currentTarget);
            } else {
                try { this.bot.pathfinder.setGoal(new goals.GoalFollow(this.currentTarget, 2)); } catch (e) {}
            }
        }, this.attackCooldown);
    }

    stopCombat() {
        if (this.combatLoop) { clearInterval(this.combatLoop); this.combatLoop = null; }
        try { this.bot.pathfinder.stop(); } catch (e) {}
        for (const d of ["forward","sprint","left","right","back"]) this.bot.setControlState(d, false);
        this.inCombat = false;
        this.currentTarget = null;
    }

    async autoCombat() {
        if (this.inCombat) return true;
        const t = this.findNearestHostile(12);
        if (t) { await this.startCombat(t); return true; }
        return false;
    }
}

module.exports = Combat;
