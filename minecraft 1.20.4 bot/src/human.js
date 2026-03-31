const Vec3 = require("vec3");

class HumanBehavior {
    constructor(bot) {
        this.bot = bot;
        this.lastChat = 0;
        this.chatCooldown = 25000;
        this.headYawOffset = 0;
        this.headPitchOffset = 0;

        // Continuous head sway — like a real player always slightly moving mouse
        this.headSwayInterval = setInterval(() => {
            if (!this.bot.entity) return;
            // Smooth random head drift
            this.headYawOffset += (Math.random() - 0.5) * 0.08;
            this.headPitchOffset += (Math.random() - 0.5) * 0.04;
            // Clamp drift
            this.headYawOffset *= 0.9;
            this.headPitchOffset *= 0.9;
            const y = this.bot.entity.yaw + this.headYawOffset;
            const p = Math.max(-1.2, Math.min(1.2, this.bot.entity.pitch + this.headPitchOffset));
            this.bot.look(y, p, true).catch(() => {});
        }, 200);

        // Random inventory fidgeting (switch hotbar slots)
        this.fidgetInterval = setInterval(() => {
            if (!this.bot.entity) return;
            // Don't fidget during mining or combat
            if (this.bot._goapBusy) return;
            if (Math.random() < 0.03) {
                const slot = Math.floor(Math.random() * 9);
                this.bot.setQuickBarSlot(slot);
            }
        }, 5000);
    }

    // ========== Natural look (not instant snap) ==========
    async lookAt(pos) {
        if (!this.bot.entity || !pos) return;
        // Single look with small human jitter (no delay)
        await this.bot.lookAt(new Vec3(
            pos.x + (Math.random() - 0.5) * 0.15,
            pos.y + (Math.random() - 0.5) * 0.1,
            pos.z + (Math.random() - 0.5) * 0.15
        ), true);
    }

    // ========== MINING ==========
    async beforeDig(blockPos) {
        // Look at block (2-step natural)
        await this.lookAt(blockPos);

        // 15% chance: quick glance around before mining
        if (Math.random() < 0.15) {
            const yaw = this.bot.entity.yaw;
            const side = (Math.random() - 0.5) * 1.5;
            await this.bot.look(yaw + side, this.bot.entity.pitch + (Math.random() - 0.5) * 0.3, true);
            await this.wait(150 + Math.random() * 200);
            await this.lookAt(blockPos); // back to block
        }

        // 5% chance: switch to hand briefly then back to tool (fumble)
        if (Math.random() < 0.05) {
            await this.bot.setQuickBarSlot(0);
            await this.wait(100 + Math.random() * 150);
            // Re-equip will happen in mining.js
        }
    }

    async betweenDigs() {
        const r = Math.random();
        if (r < 0.06) {
            // Quick check behind
            const yaw = this.bot.entity.yaw;
            await this.bot.look(yaw + Math.PI * (0.6 + Math.random() * 0.4), 0, true);
            await this.wait(200 + Math.random() * 250);
            await this.bot.look(yaw, this.bot.entity.pitch, true);
        } else if (r < 0.10) {
            // Look at nearby mob/player
            await this.lookAtNearestEntity();
        } else if (r < 0.13) {
            // Tiny strafe (repositioning)
            const dir = Math.random() > 0.5 ? "left" : "right";
            this.bot.setControlState(dir, true);
            await this.wait(100 + Math.random() * 150);
            this.bot.setControlState(dir, false);
        } else if (r < 0.15) {
            // Random jump (restlessness)
            this.bot.setControlState("jump", true);
            await this.wait(100);
            this.bot.setControlState("jump", false);
        }
    }

    // ========== WALKING ==========
    async faceMovementDirection(targetPos) {
        if (!this.bot.entity || !targetPos) return;
        const dx = targetPos.x - this.bot.entity.position.x;
        const dz = targetPos.z - this.bot.entity.position.z;
        const yaw = Math.atan2(-dx, -dz);
        await this.bot.look(yaw, 0, true);
    }

    walkTick() {
        if (!this.bot.entity) return;
        const r = Math.random();
        if (r < 0.06) {
            // Strafe while walking
            const dir = Math.random() > 0.5 ? "left" : "right";
            this.bot.setControlState(dir, true);
            setTimeout(() => this.bot.setControlState(dir, false), 100 + Math.random() * 250);
        } else if (r < 0.10) {
            // Sprint burst
            this.bot.setControlState("sprint", true);
            setTimeout(() => this.bot.setControlState("sprint", false), 400 + Math.random() * 600);
        } else if (r < 0.13) {
            // Jump (over bump or just because)
            this.bot.setControlState("jump", true);
            setTimeout(() => this.bot.setControlState("jump", false), 100);
        } else if (r < 0.17) {
            // Look to the side while walking
            const yaw = this.bot.entity.yaw + (Math.random() > 0.5 ? 1 : -1) * (0.5 + Math.random() * 0.8);
            this.bot.look(yaw, this.bot.entity.pitch + (Math.random() - 0.5) * 0.3, true).catch(() => {});
        } else if (r < 0.19) {
            // Quick look behind while walking
            const yaw = this.bot.entity.yaw;
            this.bot.look(yaw + Math.PI * 0.8, 0, true).catch(() => {});
            setTimeout(() => {
                if (this.bot.entity) this.bot.look(yaw, 0, true).catch(() => {});
            }, 300);
        }
    }

    // ========== COMBAT ==========
    async combatTick(target) {
        if (!this.bot.entity || !target?.position) return;
        const r = Math.random();
        if (r < 0.35) {
            // Strafe (most common PVP movement)
            const dir = Math.random() > 0.5 ? "left" : "right";
            this.bot.setControlState(dir, true);
            await this.wait(150 + Math.random() * 250);
            this.bot.setControlState(dir, false);
        } else if (r < 0.50) {
            // Back-step after hit
            this.bot.setControlState("back", true);
            await this.wait(80 + Math.random() * 120);
            this.bot.setControlState("back", false);
        } else if (r < 0.60) {
            // Circle strafe
            const dir = Math.random() > 0.5 ? "left" : "right";
            this.bot.setControlState("forward", true);
            this.bot.setControlState(dir, true);
            await this.wait(200 + Math.random() * 200);
            this.bot.setControlState("forward", false);
            this.bot.setControlState(dir, false);
        } else if (r < 0.68) {
            // W-tap movement (sprint reset trick)
            this.bot.setControlState("forward", false);
            await this.wait(30);
            this.bot.setControlState("forward", true);
            this.bot.setControlState("sprint", true);
            await this.wait(100);
            this.bot.setControlState("sprint", false);
        }
    }

    // ========== IDLE ==========
    async idle() {
        if (!this.bot.entity) return;
        const r = Math.random();
        if (r < 0.15) await this.lookAroundSlow();
        else if (r < 0.25) await this.walkRandomly();
        else if (r < 0.35) await this.sprintWithJumps();
        else if (r < 0.42) await this.zigzagRun();
        else if (r < 0.48) await this.crouchSpam();
        else if (r < 0.53) await this.circleWalk();
        else if (r < 0.58) await this.jumpAround();
        else if (r < 0.62) await this.lookAtNearestEntity();
        else if (r < 0.65 && Date.now() - this.lastChat > this.chatCooldown) {
            this.bot.chat(["Хм...", "Ладно", "Ну...", "Так", "..."][Math.floor(Math.random() * 5)]);
            this.lastChat = Date.now();
        }
    }

    async tick() {
        if (!this.bot.entity) return;
        if (Math.random() < 0.15) {
            const y = this.bot.entity.yaw + (Math.random() - 0.5) * 0.8;
            const p = this.bot.entity.pitch + (Math.random() - 0.5) * 0.4;
            await this.bot.look(y, Math.max(-1.2, Math.min(1.2, p)), true);
        }
    }

    // ========== Entity awareness (look at mobs/players) ==========
    async lookAtNearestEntity() {
        let nearest = null, nearestDist = 16;
        for (const id in this.bot.entities) {
            const e = this.bot.entities[id];
            if (!e || e === this.bot.entity || !e.position) continue;
            if (!e.name || e.name === "item" || e.name === "experience_orb") continue;
            const d = this.bot.entity.position.distanceTo(e.position);
            if (d < nearestDist) { nearestDist = d; nearest = e; }
        }
        if (nearest) {
            await this.lookAt(nearest.position.offset(0, nearest.height || 1, 0));
            await this.wait(300 + Math.random() * 500);
        }
    }

    // ========== Movement patterns ==========
    async lookAroundSlow() {
        const y = this.bot.entity.yaw;
        await this.bot.look(y - 1.0, (Math.random() - 0.5) * 0.6, true);
        await this.wait(300 + Math.random() * 400);
        await this.bot.look(y + 1.0, (Math.random() - 0.5) * 0.6, true);
        await this.wait(300 + Math.random() * 400);
        await this.bot.look(y, 0, true);
    }

    async walkRandomly() {
        await this.bot.look(this.bot.entity.yaw + (Math.random() - 0.5) * 2.0, 0, true);
        this.bot.setControlState("forward", true);
        if (Math.random() < 0.4) this.bot.setControlState("sprint", true);
        await this.wait(800 + Math.random() * 2000);
        this.stopAll();
    }

    async sprintWithJumps() {
        this.bot.setControlState("forward", true);
        this.bot.setControlState("sprint", true);
        for (let i = 0; i < 5 + Math.floor(Math.random() * 4); i++) {
            if (Math.random() < 0.35) {
                this.bot.setControlState("jump", true);
                await this.wait(100);
                this.bot.setControlState("jump", false);
            }
            await this.wait(200 + Math.random() * 200);
        }
        this.stopAll();
    }

    async zigzagRun() {
        this.bot.setControlState("forward", true);
        this.bot.setControlState("sprint", true);
        for (let i = 0; i < 4 + Math.floor(Math.random() * 3); i++) {
            const dir = i % 2 === 0 ? "left" : "right";
            this.bot.setControlState(dir, true);
            await this.wait(180 + Math.random() * 150);
            this.bot.setControlState(dir, false);
        }
        this.stopAll();
    }

    async crouchSpam() {
        const count = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < count; i++) {
            this.bot.setControlState("sneak", true);
            await this.wait(80 + Math.random() * 80);
            this.bot.setControlState("sneak", false);
            await this.wait(60 + Math.random() * 80);
        }
    }

    async circleWalk() {
        const dir = Math.random() > 0.5 ? "left" : "right";
        this.bot.setControlState("forward", true);
        this.bot.setControlState(dir, true);
        await this.wait(1500 + Math.random() * 1500);
        this.stopAll();
    }

    async jumpAround() {
        for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
            this.bot.setControlState("jump", true);
            if (Math.random() < 0.3) this.bot.setControlState("forward", true);
            await this.wait(100);
            this.bot.setControlState("jump", false);
            await this.wait(200 + Math.random() * 200);
            this.bot.setControlState("forward", false);
        }
    }

    stopAll() {
        for (const d of ["forward","back","left","right","sprint","jump","sneak"])
            this.bot.setControlState(d, false);
    }

    // ========== Reactions ==========
    async reactTo(event, data) {
        if (!this.bot.entity) return;
        switch (event) {
            case "death":
                console.log("[Human] *вздох* Умер...");
                if (Math.random() < 0.4 && Date.now() - this.lastChat > 5000) {
                    this.bot.chat(["Ну и ладно...", "Обидно...", "В следующий раз...", "Блин"][Math.floor(Math.random() * 4)]);
                    this.lastChat = Date.now();
                }
                break;
            case "kill":
                if (Math.random() < 0.3 && Date.now() - this.lastChat > 10000) {
                    this.bot.chat(["Готово!", "Изи", "Gg"][Math.floor(Math.random() * 3)]);
                    this.lastChat = Date.now();
                }
                break;
            case "damage":
                if (data?.amount > 3 && Math.random() < 0.35 && Date.now() - this.lastChat > 3000) {
                    this.bot.chat(["Ой!", "Ай!", "Ох!", "Больно!"][Math.floor(Math.random() * 4)]);
                    this.lastChat = Date.now();
                }
                break;
            case "diamond":
                if (Date.now() - this.lastChat > 8000) {
                    this.bot.chat(["Алмаз!", "Найс!", "О, алмазы!"][Math.floor(Math.random() * 3)]);
                    this.lastChat = Date.now();
                    await this.jumpAround();
                }
                break;
            case "player_nearby":
                if (data?.entity) {
                    await this.lookAt(data.entity.position.offset(0, 1.6, 0));
                    if (Math.random() < 0.2 && Date.now() - this.lastChat > 15000) {
                        this.bot.chat(["Привет!", "Здарова!", "Хай"][Math.floor(Math.random() * 3)]);
                        this.lastChat = Date.now();
                    }
                    // 10% wave (crouch spam)
                    if (Math.random() < 0.1) await this.crouchSpam();
                }
                break;
        }
    }

    wait(ms) { return new Promise(r => setTimeout(r, ms)); }
    start() { console.log("[Human] Поведение интегрировано"); }
    reactToDeath() { this.reactTo("death"); }

    destroy() {
        if (this.headSwayInterval) clearInterval(this.headSwayInterval);
        if (this.fidgetInterval) clearInterval(this.fidgetInterval);
    }
}

module.exports = HumanBehavior;
