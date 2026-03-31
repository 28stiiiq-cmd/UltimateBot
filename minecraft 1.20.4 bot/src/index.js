const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");

// Core modules (rewritten, no stubs)
const Memory = require("./memory");
const Crafting = require("./crafting");
const Mining = require("./mining");
const Smelting = require("./smelting");
const Combat = require("./realistic_combat");
const Inventory = require("./inventory");
const Nether = require("./nether");
const Ender = require("./ender");
const GOAP = require("./goap");
const Stability = require("./stability");
const Navigation = require("./navigation");
const WebServer = require("./web");
const Human = require("./human");
const WorldMap = require("./world_map");

// Secondary modules (connected but not critical path)
const Farming = require("./farming");
const Builder = require("./builder");
const Chest = require("./chest");
const Enchanting = require("./enchanting");
const Potions = require("./potions");
const PvP = require("./pvp");
const ExtendedCrafting = require("./extended_crafting");
const ExtendedRecipes = require("./extended_recipes");

// Config
const HOST = process.env.BOT_HOST || "localhost";
const PORT = parseInt(process.env.BOT_PORT) || 25565;
const USERNAME = process.env.BOT_NAME || "UltimateBot";
const VERSION = process.env.BOT_VERSION || "1.20.4";

console.log(`[+] Запуск бота ${USERNAME} → ${HOST}:${PORT} (${VERSION})`);

const bot = mineflayer.createBot({ host: HOST, port: PORT, username: USERNAME, version: VERSION, viewDistance: 8 });
bot.loadPlugin(pathfinder);

const m = {}; // all modules

bot.once("spawn", () => {
    console.log(`[+] Спавн: ${bot.entity.position.floored()}`);

    const mcData = require("minecraft-data")(bot.version);
    bot.mcData = mcData;

    const moves = new Movements(bot);
    moves.canDig = true;
    moves.allow1by1towers = true;
    bot.pathfinder.setMovements(moves);

    // === Init core modules ===
    m.nav = new Navigation(bot, mcData);
    bot._nav = m.nav; // smart pathfinder — replaces raw Movements
    m.memory = new Memory(bot);
    m.crafting = new Crafting(bot, mcData);
    m.smelting = new Smelting(bot, mcData);
    m.inventory = new Inventory(bot, m.memory, m.crafting, mcData);
    m.mining = new Mining(bot, m.memory, m.crafting, mcData);
    m.mining.nav = m.nav; // wire navigation into mining
    m.combat = new Combat(bot, m.memory, m.crafting, m.inventory);
    m.combat.nav = m.nav; // wire navigation into combat
    m.nether = new Nether(bot, m.memory, m.crafting, m.inventory, m.combat, null, null);
    m.ender = new Ender(bot, m.memory, m.crafting, m.inventory, m.combat, m.nether, null, null);
    m.goap = new GOAP(bot, m.memory, m.inventory, m.crafting, m.mining, m.combat, m.nether, m.ender, m.smelting);
    bot._goap = m.goap; // expose for web.js
    m.stability = new Stability(bot, m.memory);
    bot._goap = m.goap; // expose for web panel

    // Cross-references
    m.crafting.mining = m.mining;
    m.crafting.combat = m.combat;
    m.crafting.inventory = m.inventory;
    m.mining.crafting = m.crafting;
    m.mining.combat = m.combat;
    m.mining.inventory = m.inventory;
    m.combat.crafting = m.crafting;
    m.combat.inventory = m.inventory;

    // === Init secondary modules ===
    m.farming = new Farming(bot, m.memory, m.crafting, m.inventory);
    m.builder = new Builder(bot, m.inventory, m.crafting);
    bot._builder = m.builder;
    m.chest = new Chest(bot, m.inventory, m.crafting);
    m.enchanting = new Enchanting(bot, m.memory, m.crafting, m.inventory);
    m.potions = new Potions(bot, m.memory, m.crafting, m.inventory);
    m.pvp = new PvP(bot, m.combat, m.inventory, m.crafting);
    m.worldMap = new WorldMap(bot);
    new ExtendedCrafting(m.crafting);
    new ExtendedRecipes(m.crafting);
    m.human = new Human(bot);
    bot._human = m.human;
    bot._farming = m.farming;
    bot._enchanting = m.enchanting;
    bot._potions = m.potions;
    bot._chest = m.chest;

    // === Start systems ===
    m.web = new WebServer(bot, m.memory, m.inventory, m.combat, m.nether, m.ender);
    m.web.start();
    m.human.start();
    m.goap.start();

    // World map tracking
    setInterval(() => { try { m.worldMap.update(); } catch (e) {} }, 10000);

    // === STATUS LOG every 30s ===
    setInterval(() => {
        if (!bot.entity) return;
        const p = bot.entity.position.floored();
        const inv = m.inventory?.getResourceStats() || {};
        const goal = m.goap?.getCurrentGoal()?.id || "none";
        const items = Object.entries(inv).filter(([k,v]) => v > 0).map(([k,v]) => `${k}:${v}`).join(" ");
        console.log(`[STATUS] HP:${Math.floor(bot.health)} Food:${Math.floor(bot.food)} XYZ:${p.x},${p.y},${p.z} Goal:${goal} | ${items}`);
    }, 30000);

    // Prevent MaxListeners warning
    bot.setMaxListeners(30);
    if (bot._client) bot._client.setMaxListeners(30);

    // Main loop: danger check + inventory + crafting + smelting
    let mainLoopBusy = false;
    setInterval(async () => {
        if (!bot.entity || mainLoopBusy || m.goap?.isExecuting) return;
        mainLoopBusy = true;
        try {
            // Priority 1: escape danger
            if (m.nav) {
                const danger = m.nav.checkCurrentDanger();
                if (danger) { await m.nav.escapeDanger(danger); return; }
            }
            await m.inventory.autoManage();
        } catch (e) {
            // Silently ignore pathfinder conflicts
            if (!e.message?.includes("goal") && !e.message?.includes("Path")) {
                console.log(`[Main] ${e.message}`);
            }
        } finally {
            mainLoopBusy = false;
        }
    }, 10000);

    console.log("[+] Готов! Команды: !pos !stats !stop !mine !tree !craft !fight !goap !farm !build !smelt");
});

// === Chat commands ===
bot.on("chat", async (username, message) => {
    if (username === bot.username) return;
    const args = message.split(" ");
    const cmd = args[0];

    try {
        switch (cmd) {
            case "!pos":
                const p = bot.entity.position.floored();
                bot.chat(`XYZ: ${p.x} ${p.y} ${p.z}`);
                break;
            case "!stats":
                bot.chat(`HP:${Math.floor(bot.health)}/20 Food:${Math.floor(bot.food)}/20 XP:${bot.experience?.level || 0}`);
                break;
            case "!inventory": {
                const status = m.inventory.getStatus();
                bot.chat(`Свободно: ${status.freeSlots} | Pick: ${status.hasDiamondPick ? "💎" : status.hasIronPick ? "🔩" : status.hasStonePick ? "🪨" : "🪵"}`);
                break;
            }
            case "!mine":
                bot.chat("Добыча...");
                await m.mining.autoMine();
                bot.chat("Готово");
                break;
            case "!tree": {
                const tree = m.mining.findTreeByLeaves() || m.mining.findTree();
                if (tree) { bot.chat("Рублю..."); await m.mining.chopTree(tree); bot.chat("✓"); }
                else bot.chat("Нет деревьев");
                break;
            }
            case "!craft":
                if (args[1]) {
                    bot.chat(`Крафт: ${args[1]}`);
                    const ok = await m.crafting.craftWithPlanning(args[1], parseInt(args[2]) || 1);
                    bot.chat(ok ? "✓" : "✗");
                } else {
                    const avail = m.crafting.getAvailableCrafts();
                    bot.chat(`Доступно (${avail.length}): ${avail.slice(0, 8).join(", ")}`);
                }
                break;
            case "!smelt":
                bot.chat("Плавка...");
                await m.smelting.smeltAll();
                bot.chat("✓");
                break;
            case "!fight": {
                const t = m.combat.findNearestHostile();
                if (t) { bot.chat(`Атака: ${t.name}`); await m.combat.startCombat(t); }
                else bot.chat("Врагов нет");
                break;
            }
            case "!goap": {
                const g = m.goap.getCurrentGoal();
                bot.chat(`Цель: ${g?.id || "нет"} (pri:${g?.priority || 0})`);
                break;
            }
            case "!farm":
                bot.chat("Ферма...");
                await m.farming.autoFarm();
                bot.chat("✓");
                break;
            case "!build":
                bot.chat("Строю...");
                await m.builder.buildHouse();
                bot.chat("✓");
                break;
            case "!nether":
                bot.chat("Незер...");
                await m.nether.exploreNether();
                break;
            case "!ender":
                bot.chat("Эндер...");
                await m.ender.findStronghold();
                await m.ender.activateEndPortal();
                await m.ender.enterEnd();
                await m.ender.fightDragon();
                break;
            case "!branch":
                bot.chat("Бранч-майнинг...");
                await m.mining.startBranchMining();
                bot.chat("✓");
                break;
            case "!map": {
                const stats = m.worldMap.getExplorationStats();
                bot.chat(`Карта: ${stats.chunksExplored} чанков`);
                break;
            }
            case "!home":
                if (args[1] === "set") { m.worldMap.setHome(); bot.chat("Дом ✓"); }
                else { bot.chat("Домой..."); await m.worldMap.goHome(); }
                break;
            case "!stop":
                bot.pathfinder.stop();
                m.combat.stopCombat();
                m.goap.stop();
                bot.setControlState("forward", false);
                bot.setControlState("back", false);
                bot.setControlState("sprint", false);
                bot.setControlState("jump", false);
                bot.chat("⏹ Стоп");
                break;
            case "!go":
                m.goap.start();
                bot.chat("▶ Поехали");
                break;
        }
    } catch (e) {
        console.log(`[CMD] ${cmd}: ${e.message}`);
    }
});

// === Events ===
bot.on("death", () => {
    console.log("[!] Смерть");
    m.combat?.stopCombat();
    m.nav?.stop();
    m.human?.reactToDeath?.();
    const pos = bot.entity?.position;
    if (pos) {
        const dp = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
        m.memory?.saveDeath(dp.x, dp.y, dp.z, "overworld", []);
        m.worldMap?.recordDeath(dp.x, dp.y, dp.z);
        m.nav?.recordDeath(pos);
    }
    // Recovery after death — ALWAYS try to get items back
    setTimeout(async () => {
        if (!bot.entity) return;
        const deaths = m.memory?.getRecentDeaths(1);
        if (deaths?.[0] && m.nav) {
            const dp = deaths[0];
            console.log(`[!] Возврат за вещами: ${dp.x} ${dp.y} ${dp.z}`);
            // Go directly — items despawn in 5 min, can't be picky about safety
            const Vec3 = require("vec3");
            const success = await m.nav.goto(new Vec3(dp.x, dp.y, dp.z), 4, 30000);
            if (success) {
                // Collect nearby items
                await m.mining?.collectNearbyItems();
                console.log("[!] Собрал вещи");
            }
        }
    }, 5000);
});

bot.on("health", () => {
    if (bot.health < 8 && m.inventory) {
        m.inventory.eat().catch(() => {});
    }
    // Human reaction to damage
    if (m.human && bot.health < 15) {
        m.human.reactTo("damage", { amount: 20 - bot.health });
    }
});

// Detect nearby players for human reactions
setInterval(() => {
    if (!bot.entity || !m.human) return;
    for (const name in bot.players) {
        if (name === bot.username) continue;
        const p = bot.players[name];
        if (p?.entity && bot.entity.position.distanceTo(p.entity.position) < 12) {
            m.human.reactTo("player_nearby", { entity: p.entity, name });
            break;
        }
    }
}, 5000);

// Track player attacks for PVP self-defense
bot.on("entityHurt", (entity) => {
    if (entity !== bot.entity) return;
    for (const name in bot.players) {
        if (name === bot.username) continue;
        const p = bot.players[name];
        if (!p?.entity) continue;
        if (bot.entity.position.distanceTo(p.entity.position) < 6) {
            if (m.goap) {
                m.goap._lastPlayerAttacker = p.entity;
                m.goap._lastPlayerAttackerTime = Date.now();
                console.log(`[PVP] Атакован игроком: ${name}`);
            }
            break;
        }
    }
});

bot.on("error", (err) => console.error(`[!] ${err.message}`));
bot.on("end", (reason) => {
    console.log(`[!] Отключён: ${reason || "unknown"}`);
    gracefulShutdown(false);
});
process.on("SIGINT", () => gracefulShutdown(true));
process.on("SIGTERM", () => gracefulShutdown(true));

function gracefulShutdown(exit) {
    console.log("[Bot] Завершение...");
    try { m.goap?.stop(); } catch (e) {}
    try { m.combat?.stopCombat(); } catch (e) {}
    try { m.nav?.stop(); } catch (e) {}
    try { m.worldMap?.save?.(); } catch (e) {}
    try { m.memory?.close(); } catch (e) {}
    if (exit) {
        process.exit(0);
    } else {
        // Auto-reconnect
        console.log("[Bot] Переподключение через 5с...");
        setTimeout(() => process.exit(1), 5000);
    }
}
