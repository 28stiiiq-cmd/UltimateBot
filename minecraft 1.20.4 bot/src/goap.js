const Vec3 = require("vec3");

class GOAP {
    constructor(bot, memory, inventory, crafting, mining, combat, nether, ender, smelting) {
        this.bot = bot;
        this.memory = memory;
        this.inventory = inventory;
        this.crafting = crafting;
        this.mining = mining;
        this.combat = combat;
        this.nether = nether;
        this.ender = ender;
        this.smelting = smelting;
        this.currentGoal = null;
        this.planningInterval = null;
        this.isExecuting = false;
        this.lastGoalTime = {};
        this.goalFailCount = {};
        this.lastLoggedGoal = null;
        this._shelterBuilt = false;

        this.goals = this.buildGoals();
    }

    // ========== Helpers ==========
    count(name) { return this.crafting?.countItem(name) || 0; }
    has(name, c = 1) { return this.count(name) >= c; }
    totalWood() {
        let t = 0;
        for (const w of ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log"])
            t += this.count(w);
        return t;
    }
    totalPlanks() { return this.crafting?.totalPlanksCount?.() || 0; }
    hasPick(tier) { return this.has(`${tier}_pickaxe`); }
    hasAnyPick() { return this.hasPick("diamond") || this.hasPick("iron") || this.hasPick("stone") || this.hasPick("wooden"); }
    hasSword() { return this.has("diamond_sword") || this.has("iron_sword") || this.has("stone_sword") || this.has("wooden_sword"); }

    // ========== Goal Definitions ==========
    buildGoals() {
        return [
            // ===== SURVIVAL (always checked first) =====
            {
                id: "emergency_eat", priority: 250,
                check: () => this.bot.health < 8 && this.inventory?.getBestFood(),
                action: async () => { await this.inventory.eat(); }
            },
            {
                id: "eat", priority: () => {
                    // More hungry = higher priority. food=0→220, food=13→200
                    return 200 + Math.max(0, (14 - this.bot.food) * 1.5);
                },
                check: () => this.bot.food < 14 && this.inventory?.getBestFood(),
                action: async () => { await this.inventory.eat(); }
            },
            {
                id: "hunt_for_food", priority: () => {
                    // food=0→215, food=9→195
                    return 195 + Math.max(0, (10 - this.bot.food) * 2);
                },
                check: () => {
                    if (this.bot.food >= 10) return false;
                    if (this.inventory?.getBestFood()) return false; // have food, just eat
                    return true;
                },
                action: async () => {
                    console.log("[GOAP] Голоден, ищу еду");
                    const mobs = ["cow", "pig", "sheep", "chicken", "rabbit"];
                    const nav = this.mining?.nav;
                    for (const id in this.bot.entities) {
                        const e = this.bot.entities[id];
                        if (!e?.position || !mobs.includes(e.name)) continue;
                        if (this.bot.entity.position.distanceTo(e.position) > 32) continue;
                        console.log(`[GOAP] Охочусь: ${e.name}`);
                        const sword = this.crafting.getItem("diamond_sword") || this.crafting.getItem("iron_sword") || this.crafting.getItem("stone_sword");
                        if (sword) await this.bot.equip(sword, "hand");
                        if (nav) await nav.goto(e.position, 2, 8000);
                        for (let i = 0; i < 10; i++) {
                            if (!e.isValid) break;
                            if (this.bot.entity.position.distanceTo(e.position) < 4) {
                                try { await this.bot.attack(e); } catch (er) {}
                            }
                            await new Promise(r => setTimeout(r, 500));
                        }
                        await this.mining.collectNearbyItems();
                        // Cook if we got raw meat
                        if (this.smelting && this.crafting.hasItem("furnace")) {
                            for (const f of ["raw_beef","raw_porkchop","raw_chicken","raw_mutton"]) {
                                if (this.crafting.countItem(f) > 0) {
                                    await this.smelting.smelt(f, this.crafting.countItem(f));
                                    break;
                                }
                            }
                        }
                        return;
                    }
                    // No animals — try to find berries or apples
                    console.log("[GOAP] Нет животных поблизости");
                }
            },
            {
                id: "combat", priority: () => {
                    const isNight = this.bot.time?.isDay === false;
                    const hp = this.bot.health || 20;
                    // Night: react faster to mobs. Low HP: higher urgency
                    let p = 190;
                    if (isNight) p += 10; // 200 at night
                    if (hp < 10) p += 15; // 205-215 when hurt
                    return p;
                },
                check: () => {
                    const h = this.combat?.findNearestHostile?.();
                    return h && this.bot.entity.position.distanceTo(h.position) < 16;
                },
                action: async () => {
                    const t = this.combat.findNearestHostile();
                    if (t) await this.combat.startCombat(t);
                }
            },
            {
                id: "pvp", priority: 185,
                check: () => {
                    // Only fight players who attacked us (tracked via entityHurt event)
                    return !!this._lastPlayerAttacker && Date.now() - this._lastPlayerAttackerTime < 10000;
                },
                action: async () => {
                    if (this._lastPlayerAttacker?.isValid) {
                        console.log(`[GOAP] PVP: контратака`);
                        await this.combat.startCombat(this._lastPlayerAttacker);
                    }
                    this._lastPlayerAttacker = null;
                }
            },
            {
                id: "sleep_night", priority: () => {
                    const builder = this.bot._builder;
                    if (builder?.hasHome()) {
                        const dist = this.bot.entity.position.distanceTo(builder.homePos);
                        if (dist < 30) return 120; // near home — go sleep in bed
                    }
                    return 95; // far from home — just keep working
                },
                check: () => {
                    if (this.bot.time?.isDay !== false) return false;
                    // Only try to sleep once per 2 minutes
                    const last = this.lastGoalTime["sleep_night"] || 0;
                    if (Date.now() - last < 120000) return false;
                    return true;
                },
                action: async () => {
                    // Try sleeping first
                    const slept = await this.inventory?.sleep();
                    if (slept) return;

                    // No bed — that's fine. Do useful nighttime activities instead:
                    if (this.hasSword() && this.bot.health > 10) {
                        console.log("[GOAP] Ночь: работаю дальше");
                        // Mine underground (safe from mobs)
                        if (this.hasPick("iron") || this.hasPick("diamond")) {
                            await this.mining.startBranchMining();
                        } else {
                            // Craft, smelt, organize
                            await this.crafting.autoCraft();
                            if (this.smelting?.hasSmeltable() && this.has("furnace")) {
                                await this.smelting.smeltAll();
                            }
                        }
                    } else {
                        // Weak — go home or hide briefly
                        if (this.bot._builder?.hasHome()) {
                            await this.bot._builder.goHome();
                        }
                    }
                }
            },

            // ===== EARLY GAME =====
            {
                id: "wood", priority: 100,
                check: () => this.totalWood() < 10 && this.totalPlanks() < 8,
                action: async () => {
                    const tree = this.mining.findTreeByLeaves() || this.mining.findTree();
                    if (tree) await this.mining.chopTree(tree);
                    else console.log("[GOAP] Нет деревьев поблизости");
                }
            },
            {
                id: "craft_basics", priority: 99,
                check: () => (this.totalWood() >= 3 || this.totalPlanks() >= 4) && !this.hasAnyPick(),
                action: async () => { await this.crafting.autoCraft(); }
            },
            {
                id: "cobblestone", priority: 95,
                check: () => this.count("cobblestone") < 20 && this.hasAnyPick(),
                action: async () => { await this.mining.mineStone(); }
            },
            {
                id: "craft_stone_tools", priority: 94,
                check: () => this.count("cobblestone") >= 3 && !this.hasPick("stone") && !this.hasPick("iron") && !this.hasPick("diamond"),
                action: async () => { await this.crafting.autoCraft(); }
            },

            // ===== COAL (optional — don't block progression) =====
            {
                id: "coal", priority: 88,
                check: () => {
                    const coalTotal = this.count("coal") + this.count("charcoal");
                    if (coalTotal >= 8) return false;
                    if (this.count("torch") >= 32) return false; // have enough torches already
                    return this.hasAnyPick() && !!this.mining.findCoal();
                },
                action: async () => {
                    const c = this.mining.findCoal();
                    if (c) await this.mining.mineBlock(c);
                }
            },
            {
                id: "torches", priority: 87,
                check: () => this.count("torch") < 16 && (this.has("coal") || this.has("charcoal")) && this.has("stick"),
                action: async () => { await this.crafting.craftTorches(8); }
            },

            // ===== IRON AGE =====
            {
                id: "iron_ore", priority: () => {
                    const iron = this.count("iron_ingot") + this.count("raw_iron");
                    // Urgent when no iron tools, less urgent later
                    if (!this.hasPick("iron") && !this.hasPick("diamond")) return 88; // need first iron pick urgently
                    if (iron < 8) return 85;   // still need some
                    return 70;                  // have enough, lower priority
                },
                check: () => this.count("iron_ingot") + this.count("raw_iron") < 20 &&
                    (this.hasPick("stone") || this.hasPick("iron") || this.hasPick("diamond")),
                action: async () => {
                    const ir = this.mining.findIron();
                    if (ir) await this.mining.mineBlock(ir);
                    else {
                        // Can't find iron on surface — mine deeper
                        const stone = this.mining.findStone();
                        if (stone) await this.mining.mineBlock(stone);
                    }
                }
            },
            {
                id: "furnace", priority: 84,
                check: () => !this.has("furnace") && this.count("cobblestone") >= 8 &&
                    (this.count("raw_iron") >= 3 || this.count("raw_gold") >= 3),
                action: async () => { await this.crafting.craftWithPlanning("furnace", 1); }
            },
            {
                id: "smelt_iron", priority: 83,
                check: () => this.count("raw_iron") >= 3 && this.has("furnace") && this.smelting,
                action: async () => {
                    await this.smelting.smelt("raw_iron", this.count("raw_iron"));
                }
            },
            {
                id: "iron_tools", priority: 82,
                check: () => this.count("iron_ingot") >= 3 && !this.hasPick("iron") && !this.hasPick("diamond"),
                action: async () => { await this.crafting.autoCraft(); }
            },
            {
                id: "iron_armor", priority: 80,
                check: () => this.count("iron_ingot") >= 5 && !this.has("iron_helmet") && !this.has("diamond_helmet"),
                action: async () => { await this.crafting.autoCraft(); }
            },
            {
                id: "bucket", priority: 79,
                check: () => !this.has("bucket") && !this.has("water_bucket") && this.count("iron_ingot") >= 3,
                action: async () => { await this.crafting.craftWithPlanning("bucket", 1); }
            },
            {
                id: "shield", priority: 78,
                check: () => !this.has("shield") && this.count("iron_ingot") >= 1 && this.totalPlanks() >= 6,
                action: async () => { await this.crafting.craftWithPlanning("shield", 1); }
            },

            // ===== DIAMOND AGE =====
            {
                id: "diamond", priority: 75,
                check: () => this.count("diamond") < 5 && this.hasPick("iron"),
                action: async () => {
                    const di = this.mining.findDiamond();
                    if (di) await this.mining.mineBlock(di);
                    else await this.mining.startBranchMining();
                }
            },
            {
                id: "diamond_pick", priority: 74,
                check: () => this.count("diamond") >= 3 && !this.hasPick("diamond"),
                action: async () => { await this.crafting.craftWithPlanning("diamond_pickaxe", 1); }
            },
            {
                id: "diamond_sword", priority: 73,
                check: () => this.count("diamond") >= 2 && !this.has("diamond_sword") && this.hasPick("diamond"),
                action: async () => { await this.crafting.craftWithPlanning("diamond_sword", 1); }
            },

            // ===== HOME BASE =====
            {
                id: "craft_bed", priority: 92,
                check: () => {
                    if (this.has("white_bed") || this.has("red_bed") || this.has("blue_bed")) return false;
                    // Need 3 wool + 3 planks
                    const wool = ["white","orange","magenta","light_blue","yellow","lime","pink","gray","light_gray","cyan","purple","blue","brown","green","red","black"];
                    let woolCount = 0;
                    for (const c of wool) woolCount += this.count(`${c}_wool`);
                    return woolCount >= 3 && this.totalPlanks() >= 3;
                },
                action: async () => {
                    console.log("[GOAP] Крафт кровати");
                    await this.crafting.craftWithPlanning("bed", 1);
                }
            },
            {
                id: "place_bed_home", priority: 44,
                check: () => {
                    if (!this.bot._builder?.hasHome()) return false;
                    const beds = ["white_bed","red_bed","blue_bed","orange_bed","yellow_bed","lime_bed","pink_bed"];
                    return beds.some(b => this.has(b));
                },
                action: async () => {
                    const builder = this.bot._builder;
                    await builder.goHome();
                    const beds = ["white_bed","red_bed","blue_bed","orange_bed","yellow_bed","lime_bed","pink_bed"];
                    let bedItem = null;
                    for (const b of beds) { bedItem = this.crafting.getItem(b); if (bedItem) break; }
                    if (!bedItem) return;
                    const Vec3 = require("vec3");
                    const pos = builder.homePos.offset(2, 0, 2);
                    const below = this.bot.blockAt(pos.offset(0, -1, 0));
                    if (below && below.name !== "air") {
                        try {
                            await this.bot.equip(bedItem, "hand");
                            await this.bot.placeBlock(below, new Vec3(0, 1, 0));
                            console.log("[GOAP] Кровать поставлена дома");
                        } catch (e) {}
                    }
                }
            },
            {
                id: "flint_from_gravel", priority: 71,
                check: () => {
                    if (this.has("flint")) return false;
                    if (this.has("flint_and_steel")) return false;
                    // Need flint for flint_and_steel for nether portal
                    if (!this.hasPick("diamond")) return false;
                    if (this.count("obsidian") < 10) return false;
                    return true;
                },
                action: async () => {
                    console.log("[GOAP] Добываю гравий для кремня");
                    // Mine gravel until flint drops
                    for (let i = 0; i < 20; i++) {
                        if (this.has("flint")) break;
                        const gravel = this.mining.findNearest(["gravel"], 32);
                        if (gravel) {
                            await this.mining.mineBlock(gravel);
                        } else break;
                    }
                    if (!this.has("flint")) {
                        // No gravel — mine some
                        console.log("[GOAP] Нет гравия поблизости");
                    }
                }
            },
            {
                id: "fill_water_bucket", priority: 72,
                check: () => {
                    if (this.has("water_bucket")) return false;
                    if (!this.has("bucket")) return false;
                    // Need water bucket for obsidian
                    if (!this.hasPick("diamond")) return false;
                    return this.count("obsidian") < 10;
                },
                action: async () => {
                    console.log("[GOAP] Ищу воду для ведра");
                    const waterIds = this.mining.ids(["water"]);
                    if (!waterIds.length) return;
                    // Search wider — rivers, lakes
                    const allWater = this.bot.findBlocks({ matching: waterIds, maxDistance: 64, count: 20 });
                    let sourceBlock = null;
                    for (const pos of allWater) {
                        const b = this.bot.blockAt(pos);
                        if (b && b.metadata === 0) { sourceBlock = b; break; }
                    }
                    if (!sourceBlock && allWater.length > 0) {
                        sourceBlock = this.bot.blockAt(allWater[0]);
                    }
                    if (!sourceBlock) { console.log("[GOAP] Нет воды в радиусе 64"); throw new Error("no water"); }

                    const nav = this.mining?.nav;
                    if (nav) await nav.goto(sourceBlock.position, 3, 15000);
                    const bucket = this.crafting.getItem("bucket");
                    if (!bucket) return;
                    await this.bot.equip(bucket, "hand");
                    await this.bot.lookAt(sourceBlock.position);
                    try { await this.bot.activateBlock(sourceBlock); } catch (e) {
                        try { await this.bot.activateItem(); } catch (e2) {}
                    }
                    await new Promise(r => setTimeout(r, 500));
                    if (this.has("water_bucket")) console.log("[GOAP] ✓ Ведро воды набрано");
                }
            },
            {
                id: "build_home", priority: 93,
                check: () => {
                    if (this.bot._builder?.hasHome()) return false;
                    // Build home early — after getting basic tools and some material
                    if (!this.hasAnyPick()) return false;
                    const mats = this.count("cobblestone") + this.count("oak_planks") + this.count("spruce_planks") +
                                 this.count("birch_planks") + this.count("dirt");
                    return mats >= 25;
                },
                action: async () => {
                    const builder = this.bot._builder;
                    if (builder) await builder.buildHouse();
                }
            },
            {
                id: "go_home_store", priority: 42,
                check: () => {
                    if (!this.bot._builder?.hasHome()) return false;
                    // Go home to store items when inventory is getting full
                    const freeSlots = this.inventory?.getFreeSlots() || 36;
                    return freeSlots < 5 && this.bot._builder.chestPos;
                },
                action: async () => {
                    const builder = this.bot._builder;
                    await builder.goHome();
                    await builder.storeItems();
                    await builder.checkAndRepair();
                }
            },
            {
                id: "repair_home", priority: 41,
                check: () => {
                    if (!this.bot._builder?.hasHome()) return false;
                    // Check every few minutes
                    return Date.now() - (this.bot._builder.lastRepairCheck || 0) > 120000;
                },
                action: async () => {
                    const builder = this.bot._builder;
                    const dist = this.bot.entity.position.distanceTo(builder.homePos);
                    if (dist < 50) {
                        await builder.goHome();
                        await builder.checkAndRepair();
                    }
                }
            },

            // ===== MID-GAME: EXPLORATION & LIFE =====
            {
                id: "explore_and_live", priority: 40,
                check: () => {
                    // Activate when geared up but waiting for nether/ender triggers
                    if (!this.hasSword()) return false;
                    if (!this.hasPick("iron") && !this.hasPick("diamond")) return false;
                    if (this.count("ender_pearl") >= 6) return false;
                    return true;
                },
                action: async () => {
                    const Vec3 = require("vec3");
                    const nav = this.mining?.nav;
                    const actions = ["explore","explore","explore","gather","gather","hunt_animals","build_marker"];
                    const pick = actions[Math.floor(Math.random() * actions.length)];

                    switch (pick) {
                        case "explore": {
                            console.log("[GOAP] Исследую мир");
                            const pos = this.bot.entity.position;
                            const angle = Math.random() * Math.PI * 2;
                            const dist = 50 + Math.random() * 100;
                            const target = new Vec3(pos.x + Math.cos(angle) * dist, pos.y, pos.z + Math.sin(angle) * dist);
                            if (nav) await nav.goto(target, 5, 25000);
                            else {
                                await this.bot.look(angle, 0);
                                this.bot.setControlState("forward", true);
                                this.bot.setControlState("sprint", true);
                                await new Promise(r => setTimeout(r, 10000 + Math.random() * 15000));
                                this.bot.setControlState("forward", false);
                                this.bot.setControlState("sprint", false);
                            }
                            // Check for villages/structures (look for doors, beds, villagers)
                            for (const id in this.bot.entities) {
                                const e = this.bot.entities[id];
                                if (e?.name === "villager" && this.bot.entity.position.distanceTo(e.position) < 32) {
                                    console.log("[GOAP] ★ Нашёл деревню!");
                                    if (nav) await nav.goto(e.position, 3, 10000);
                                    break;
                                }
                            }
                            if (this.bot._human) await this.bot._human.idle();
                            break;
                        }
                        case "gather": {
                            console.log("[GOAP] Собираю ресурсы по пути");
                            for (const ore of ["diamond_ore","deepslate_diamond_ore","gold_ore","iron_ore"]) {
                                const pos = this.mining.findNearest([ore], 32);
                                if (pos) { await this.mining.mineBlock(pos); break; }
                            }
                            if (this.totalWood() < 32) {
                                const tree = this.mining.findTreeByLeaves() || this.mining.findTree();
                                if (tree) await this.mining.chopTree(tree);
                            }
                            break;
                        }
                        case "hunt_animals": {
                            console.log("[GOAP] Охота на животных");
                            const mobs = ["cow","pig","sheep","chicken","rabbit"];
                            for (const id in this.bot.entities) {
                                const e = this.bot.entities[id];
                                if (!e?.position || !mobs.includes(e.name)) continue;
                                if (this.bot.entity.position.distanceTo(e.position) > 20) continue;
                                console.log(`[GOAP] Охочусь: ${e.name}`);
                                const sword = this.crafting.getItem("diamond_sword") || this.crafting.getItem("iron_sword");
                                if (sword) await this.bot.equip(sword, "hand");
                                if (nav) await nav.goto(e.position, 2, 5000);
                                for (let i = 0; i < 8; i++) {
                                    if (!e.isValid) break;
                                    if (this.bot.entity.position.distanceTo(e.position) < 4) {
                                        try { await this.bot.attack(e); } catch (er) {}
                                    }
                                    await new Promise(r => setTimeout(r, 600));
                                }
                                await this.mining.collectNearbyItems();
                                break;
                            }
                            break;
                        }
                        case "build_marker": {
                            console.log("[GOAP] Строю маркер");
                            const mat = this.crafting.getItem("cobblestone") || this.crafting.getItem("dirt");
                            if (!mat) break;
                            await this.bot.equip(mat, "hand");
                            for (let i = 0; i < 3; i++) {
                                try {
                                    this.bot.setControlState("jump", true);
                                    await new Promise(r => setTimeout(r, 400));
                                    const below = this.bot.blockAt(this.bot.entity.position.offset(0, -0.5, 0).floored());
                                    if (below && below.name !== "air") {
                                        const m2 = this.crafting.getItem("cobblestone") || this.crafting.getItem("dirt");
                                        if (m2) { await this.bot.equip(m2, "hand"); await this.bot.placeBlock(below, new Vec3(0, 1, 0)); }
                                    }
                                    this.bot.setControlState("jump", false);
                                    await new Promise(r => setTimeout(r, 200));
                                } catch (e) { break; }
                            }
                            this.bot.setControlState("jump", false);
                            const torch = this.crafting.getItem("torch");
                            if (torch) {
                                try {
                                    await this.bot.equip(torch, "hand");
                                    const top = this.bot.blockAt(this.bot.entity.position.offset(0, -1, 0).floored());
                                    if (top && top.name !== "air") await this.bot.placeBlock(top, new Vec3(0, 1, 0));
                                } catch (e) {}
                            }
                            break;
                        }
                    }
                }
            },

            // ===== NETHER PREP =====
            {
                id: "obsidian", priority: 70,
                check: () => this.count("obsidian") < 10 && this.hasPick("diamond") &&
                    (this.has("bucket") || this.has("water_bucket")),
                action: async () => {
                    // Fill bucket with water if we only have empty bucket
                    if (this.has("bucket") && !this.has("water_bucket")) {
                        const waterIds = this.mining.ids(["water"]);
                        if (waterIds.length > 0) {
                            // Find water source (level 0 = source block)
                            const allWater = this.bot.findBlocks({ matching: waterIds, maxDistance: 32, count: 10 });
                            let sourceBlock = null;
                            for (const pos of allWater) {
                                const b = this.bot.blockAt(pos);
                                if (b && b.metadata === 0) { sourceBlock = b; break; } // metadata 0 = source
                            }
                            if (!sourceBlock) {
                                // Fallback: any water
                                sourceBlock = this.bot.findBlock({ matching: waterIds, maxDistance: 32 });
                            }
                            if (sourceBlock) {
                                console.log("[GOAP] Набираю воду в ведро");
                                const bucket = this.crafting.getItem("bucket");
                                if (bucket) {
                                    const nav = this.mining?.nav;
                                    if (nav) await nav.goto(sourceBlock.position, 3, 10000);
                                    await this.bot.equip(bucket, "hand");
                                    await this.bot.lookAt(sourceBlock.position);
                                    try {
                                        await this.bot.activateBlock(sourceBlock);
                                    } catch (e) {
                                        // Fallback: try activateItem
                                        try { await this.bot.activateItem(); } catch (e2) {}
                                    }
                                    await new Promise(r => setTimeout(r, 500));
                                }
                            } else {
                                console.log("[GOAP] Нет источника воды поблизости");
                                throw new Error("no water source");
                            }
                        }
                    }
                    await this.mining.mineObsidian();
                }
            },
            {
                id: "flint_and_steel", priority: 69,
                check: () => !this.has("flint_and_steel") && this.has("iron_ingot") && this.has("flint"),
                action: async () => { await this.crafting.craftWithPlanning("flint_and_steel", 1); }
            },
            {
                id: "nether_portal", priority: 65,
                check: () => this.count("obsidian") >= 10 && this.has("flint_and_steel") &&
                    !this.nether?.progress?.portal_built,
                action: async () => {
                    await this.nether.buildPortal();
                    await this.nether.lightPortal();
                    await this.nether.enterPortal();
                }
            },

            // ===== ENDER PREP =====
            {
                id: "enderman_hunt", priority: 60,
                check: () => this.count("ender_pearl") < 12 && this.hasSword(),
                action: async () => {
                    const found = await this.mining.huntEnderman();
                    if (!found) throw new Error("no endermen");
                }
            },
            {
                id: "craft_blaze_powder", priority: 58,
                check: () => this.has("blaze_rod") && this.count("blaze_powder") < 12,
                action: async () => { await this.crafting.craftWithPlanning("blaze_powder", this.count("blaze_rod")); }
            },
            {
                id: "craft_ender_eyes", priority: 55,
                check: () => this.count("ender_eye") < 12 && this.has("ender_pearl") && this.has("blaze_powder"),
                action: async () => {
                    const n = Math.min(this.count("ender_pearl"), this.count("blaze_powder"), 12 - this.count("ender_eye"));
                    for (let i = 0; i < n; i++) await this.crafting.craftWithPlanning("ender_eye", 1);
                }
            },
            {
                id: "bow_arrows", priority: 54,
                check: () => !this.has("bow") && this.has("string", 3),
                action: async () => { await this.crafting.craftWithPlanning("bow", 1); }
            },
            {
                id: "craft_arrows", priority: 53,
                check: () => this.count("arrow") < 64 && this.has("flint") && this.has("feather"),
                action: async () => { await this.crafting.craftWithPlanning("arrow", 4); }
            },

            // ===== ENDER =====
            {
                id: "find_stronghold", priority: 50,
                check: () => this.count("ender_eye") >= 12 && !this.ender?.progress?.hasStronghold,
                action: async () => { await this.ender.findStronghold(); }
            },
            {
                id: "activate_portal", priority: 48,
                check: () => this.ender?.progress?.hasStronghold && !this.ender?.progress?.portalActivated,
                action: async () => { await this.ender.activateEndPortal(); }
            },
            {
                id: "fight_dragon", priority: 46,
                check: () => this.ender?.progress?.portalActivated && !this.ender?.dragonKilled,
                action: async () => {
                    await this.ender.enterEnd();
                    await this.ender.fightDragon();
                }
            },

            // ===== IDLE =====
            {
                id: "cook_food", priority: 22,
                check: () => {
                    const rawFoods = ["raw_beef", "raw_porkchop", "raw_chicken", "raw_mutton", "raw_rabbit", "raw_cod", "raw_salmon"];
                    for (const f of rawFoods) if (this.count(f) >= 3) return true;
                    return false;
                },
                action: async () => {
                    if (!this.has("furnace") && this.count("cobblestone") >= 8) {
                        await this.crafting.craftWithPlanning("furnace", 1);
                    }
                    if (this.smelting) {
                        for (const f of ["raw_beef", "raw_porkchop", "raw_chicken", "raw_mutton"]) {
                            if (this.count(f) >= 3) {
                                await this.smelting.smelt(f, this.count(f));
                                break;
                            }
                        }
                    }
                }
            },
            {
                id: "farming", priority: 20,
                check: () => {
                    if (!this.hasPick("iron")) return false;
                    // Farm if we have seeds and low on food
                    const food = this.count("bread") + this.count("cooked_beef") + this.count("cooked_porkchop") + this.count("apple");
                    if (food >= 16) return false;
                    return this.has("wheat_seeds") || this.has("carrot") || this.has("potato");
                },
                action: async () => {
                    const farming = this.bot._farming;
                    if (!farming) return;
                    console.log("[GOAP] Фермерство");
                    // Harvest mature crops first
                    await farming.findAndHarvest();
                    // Plant on empty farmland
                    await farming.plantOnEmptyFarmland();
                }
            },
            {
                id: "enchanting", priority: 18,
                check: () => {
                    if (!this.hasPick("diamond")) return false;
                    if (this.count("diamond") < 2 || this.count("obsidian") < 4) return false;
                    // Only enchant if we have lapis and an un-enchanted diamond tool
                    if (this.count("lapis_lazuli") < 3) return false;
                    const enchanting = this.bot._enchanting;
                    return !!enchanting;
                },
                action: async () => {
                    const enchanting = this.bot._enchanting;
                    if (!enchanting) return;
                    console.log("[GOAP] Зачарование");
                    await enchanting.enchantBestTool();
                }
            },
            {
                id: "brewing", priority: 17,
                check: () => {
                    // Brew potions for dragon fight
                    if (!this.has("blaze_rod")) return false;
                    if (!this.has("nether_wart")) return false;
                    const potions = this.bot._potions;
                    return !!potions;
                },
                action: async () => {
                    const potions = this.bot._potions;
                    if (!potions) return;
                    console.log("[GOAP] Варка зелий");
                    // Brew healing potions
                    if (this.has("glistering_melon_slice")) {
                        await potions.brewPotion("healing", 3);
                    }
                    // Brew strength potions
                    if (this.has("blaze_powder", 2)) {
                        await potions.brewPotion("strength", 3);
                    }
                }
            },
            {
                id: "loot_structures", priority: 16,
                check: () => {
                    // Look for nearby chests to loot (dungeons, villages, etc)
                    const chestId = this.crafting.blockId("chest");
                    if (chestId === null) return false;
                    const chest = this.bot.findBlock({ matching: chestId, maxDistance: 16 });
                    if (!chest) return false;
                    // Don't loot our own chest
                    const builder = this.bot._builder;
                    if (builder?.chestPos) {
                        const dist = chest.position.distanceTo(builder.chestPos);
                        if (dist < 3) return false;
                    }
                    return true;
                },
                action: async () => {
                    const chestId = this.crafting.blockId("chest");
                    const chest = this.bot.findBlock({ matching: chestId, maxDistance: 16 });
                    if (!chest) return;
                    console.log(`[GOAP] Лутаю сундук на ${chest.position}`);
                    const nav = this.mining?.nav;
                    if (nav) await nav.goto(chest.position, 2, 10000);
                    try {
                        const container = await this.bot.openContainer(chest);
                        if (!container) return;
                        // Take everything valuable
                        const valuables = ["diamond", "iron_ingot", "gold_ingot", "emerald",
                            "ender_pearl", "obsidian", "bread", "apple", "golden_apple",
                            "enchanted_golden_apple", "saddle", "iron_horse_armor",
                            "name_tag", "blaze_rod", "nether_wart"];
                        for (const slot of container.containerItems()) {
                            if (valuables.includes(slot.name) || slot.name.includes("diamond") || slot.name.includes("enchanted")) {
                                try { await container.withdraw(slot.type, null, slot.count); } catch (e) {}
                            }
                        }
                        container.close();
                    } catch (e) {}
                }
            },
            {
                id: "go_home_night", priority: () => {
                    if (!this.bot._builder?.hasHome()) return 25;
                    const dist = this.bot.entity.position.distanceTo(this.bot._builder.homePos);
                    // Close to home → go immediately. Far → don't bother
                    if (dist < 50) return 100;  // close enough — go home
                    if (dist < 100) return 50;  // medium distance
                    return 25;                   // too far — not worth it
                },
                check: () => {
                    if (this.bot.time?.isDay !== false) return false;
                    if (!this.bot._builder?.hasHome()) return false;
                    const dist = this.bot.entity.position.distanceTo(this.bot._builder.homePos);
                    return dist > 10; // only if not already home
                },
                action: async () => {
                    console.log("[GOAP] Иду домой на ночь");
                    const builder = this.bot._builder;
                    await builder.goHome();
                    await builder.storeItems();
                    await builder.checkAndRepair();
                    // Try to sleep
                    await this.inventory?.sleep();
                }
            },
            {
                id: "auto_craft", priority: 15,
                check: () => this.crafting.getAvailableCrafts().length > 0,
                action: async () => { await this.crafting.autoCraft(); }
            },
            {
                id: "explore", priority: 10,
                check: () => true,
                action: async () => {
                    if (this.smelting?.hasSmeltable() && this.has("furnace")) {
                        await this.smelting.smeltAll();
                    } else {
                        const mined = await this.mining.autoMine();
                        if (!mined && this.bot._human) {
                            // Nothing to do — idle like a human
                            await this.bot._human.idle();
                        }
                    }
                }
            }
        ];
    }

    // ========== Goal Selection ==========
    selectGoal() {
        const withPriority = this.goals.map(g => ({
            ...g,
            effectivePriority: typeof g.priority === "function" ? g.priority() : g.priority
        }));
        const sorted = withPriority.sort((a, b) => b.effectivePriority - a.effectivePriority);
        for (const g of sorted) {
            try {
                const fails = this.goalFailCount[g.id] || 0;
                if (fails >= 3) {
                    if (Date.now() - (this.lastGoalTime[g.id] || 0) > 60000) {
                        this.goalFailCount[g.id] = 0;
                    } else {
                        continue;
                    }
                }
                if (g.check()) return g;
            } catch (e) {}
        }
        return null;
    }

    // ========== Execution ==========
    async think() {
        if (this.isExecuting) return;
        if (this.combat?.inCombat) return;

        const goal = this.selectGoal();
        if (!goal) return;

        const now = Date.now();
        // Don't repeat same goal too fast (except combat/eat)
        if (goal.priority < 180 && this.lastGoalTime[goal.id] && now - this.lastGoalTime[goal.id] < 5000) return;

        this.currentGoal = goal;
        this.isExecuting = true;
        this.bot._goapBusy = true;
        this.lastGoalTime[goal.id] = now;

        try {
            if (goal.id !== this.lastLoggedGoal) {
                console.log(`[GOAP] → ${goal.id} (pri:${goal.effectivePriority || goal.priority})`);
                this.lastLoggedGoal = goal.id;
            }
            
            // Wrap in timeout — longer for building goals
            const timeoutMs = (goal.id === "build_home" || goal.id === "explore_and_live") ? 300000 : 60000;
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Goal timeout")), timeoutMs)
            );
            
            await Promise.race([goal.action(), timeoutPromise]);
            
            // Human behavior between goals
            if (this.bot._human) await this.bot._human.tick();
            
            // Success — reset fail count
            this.goalFailCount[goal.id] = 0;
        } catch (e) {
            if (e.message !== "Goal timeout") {
                console.log(`[GOAP] Ошибка ${goal.id}: ${e.message}`);
            } else {
                console.log(`[GOAP] Таймаут: ${goal.id}`);
            }
            this.goalFailCount[goal.id] = (this.goalFailCount[goal.id] || 0) + 1;
        } finally {
            this.isExecuting = false;
            this.bot._goapBusy = false;
        }
    }

    // ========== Lifecycle ==========
    start() {
        console.log(`[GOAP] Запущено (${this.goals.length} целей)`);
        this.planningInterval = setInterval(async () => {
            try { await this.think(); } catch (e) {}
        }, 5000);
    }

    stop() {
        if (this.planningInterval) { clearInterval(this.planningInterval); this.planningInterval = null; }
        this.isExecuting = false;
        this.bot._goapBusy = false;
    }

    getCurrentGoal() { return this.currentGoal; }
}

module.exports = GOAP;
