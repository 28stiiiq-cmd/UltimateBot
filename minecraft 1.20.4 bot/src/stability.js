class StabilityManager {
    constructor(bot, memory) {
        this.bot = bot;
        this.memory = memory;
        this.lastPos = null;
        this.stuckCounter = 0;
        this.isReconnecting = false;
        this.errorCount = 0;
        this.lastErrorTime = 0;

        this.setupHandlers();
    }

    setupHandlers() {
        // Only catch truly fatal errors — NOT pathfinder issues
        process.on("uncaughtException", (e) => {
            // Ignore pathfinder-related errors (they're not fatal)
            if (e.message && (
                e.message.includes("isValid") ||
                e.message.includes("Path was stopped") ||
                e.message.includes("goal was changed") ||
                e.message.includes("GoalNear") ||
                e.message.includes("pathfinder")
            )) return;

            console.error(`[Stability] Критическая ошибка: ${e.message}`);
            this.errorCount++;

            // If too many errors in short time, restart
            if (this.errorCount > 10 && Date.now() - this.lastErrorTime < 30000) {
                console.log("[Stability] Слишком много ошибок, перезапуск...");
                this.reconnect();
            }
            this.lastErrorTime = Date.now();
        });

        process.on("unhandledRejection", (e) => {
            const msg = e?.message || String(e);
            // Ignore pathfinder rejections
            if (msg.includes("isValid") || msg.includes("Path was stopped") ||
                msg.includes("goal was changed") || msg.includes("pathfinder")) return;

            console.error(`[Stability] Unhandled rejection: ${msg}`);
        });

        this.bot.on("end", () => this.handleDisconnect());

        // Anti-stuck check every 10 seconds (not 2)
        setInterval(() => this.checkStuck(), 10000);
    }

    checkStuck() {
        if (!this.bot.entity) return;
        const p = this.bot.entity.position;

        if (this.lastPos) {
            const moved = Math.abs(p.x - this.lastPos.x) + Math.abs(p.z - this.lastPos.z);
            if (moved < 0.1) {
                this.stuckCounter++;
                if (this.stuckCounter > 6) { // 60 seconds stuck
                    console.log("[Stability] Застрял, пробую выбраться");
                    this.bot.setControlState("jump", true);
                    setTimeout(() => this.bot.setControlState("jump", false), 500);
                    this.bot.setControlState("back", true);
                    setTimeout(() => {
                        this.bot.setControlState("back", false);
                        // Try random direction
                        const dir = Math.random() > 0.5 ? "left" : "right";
                        this.bot.setControlState(dir, true);
                        setTimeout(() => this.bot.setControlState(dir, false), 1000);
                    }, 1000);
                    this.stuckCounter = 0;
                }
            } else {
                this.stuckCounter = 0;
            }
        }
        this.lastPos = { x: p.x, y: p.y, z: p.z };
    }

    handleDisconnect() {
        console.log("[Stability] Соединение потеряно");
        this.reconnect();
    }

    reconnect() {
        if (this.isReconnecting) return;
        this.isReconnecting = true;
        console.log("[Stability] Переподключение через 5с...");
        setTimeout(() => {
            try { this.bot.end(); } catch (e) {}
            setTimeout(() => process.exit(1), 1000);
        }, 5000);
    }
}

module.exports = StabilityManager;
