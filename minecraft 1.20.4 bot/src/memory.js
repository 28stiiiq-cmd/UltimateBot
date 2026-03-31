const fs = require("fs");
const path = require("path");

class Memory {
    constructor(bot) {
        this.bot = bot;
        this.dbPath = path.join(process.cwd(), "bot-memory.json");
        this.data = { stats: { deaths: 0, blocks_mined: 0, mobs_killed: 0, chunks_visited: 0, playtime: 0 }, deaths: [], actions: [], resources: {} };
        this.load();
        this.startTime = Date.now();
        console.log("[Memory] База данных инициализирована");
    }

    load() {
        try {
            if (fs.existsSync(this.dbPath)) {
                this.data = JSON.parse(fs.readFileSync(this.dbPath, "utf8"));
            }
        } catch (e) {}
    }

    save() {
        try { fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2)); } catch (e) {}
    }

    close() {
        this.data.stats.playtime += Math.floor((Date.now() - this.startTime) / 1000);
        this.save();
        console.log("[Memory] База данных закрыта");
    }

    getStats() { return this.data.stats; }

    updateStats(deaths, blocks, mobs, chunks) {
        this.data.stats.deaths += deaths;
        this.data.stats.blocks_mined += blocks;
        this.data.stats.mobs_killed += mobs;
        this.data.stats.chunks_visited += chunks;
    }

    addAction(action, details) {
        this.data.actions.push({ action, details, date: new Date().toISOString() });
        if (this.data.actions.length > 500) this.data.actions = this.data.actions.slice(-500);
    }

    getRecentActions(limit = 10) { return this.data.actions.slice(-limit); }

    saveDeath(x, y, z, dimension, items) {
        this.data.deaths.push({ x, y, z, dimension, items, date: new Date().toISOString() });
        this.data.stats.deaths++;
        if (this.data.deaths.length > 50) this.data.deaths = this.data.deaths.slice(-50);
        this.save();
    }

    getRecentDeaths(limit = 5) { return this.data.deaths.slice(-limit); }

    addResource(name, count) { this.data.resources[name] = (this.data.resources[name] || 0) + count; }

    addStat(key) {
        if (!this.data.stats[key]) this.data.stats[key] = 0;
        this.data.stats[key]++;
    }
}

module.exports = Memory;
