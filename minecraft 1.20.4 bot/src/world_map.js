const fs = require('fs');
const path = require('path');

class WorldMap {
    constructor(bot) {
        this.bot = bot;
        this.mapPath = path.join(__dirname, '../data/world_map.json');
        this.chunks = new Map();
        this.waypoints = [];
        this.deathPoints = [];
        
        this.load();
    }
    
    load() {
        try {
            if (fs.existsSync(this.mapPath)) {
                const data = JSON.parse(fs.readFileSync(this.mapPath, 'utf8'));
                this.chunks = new Map(Object.entries(data.chunks || {}));
                this.waypoints = data.waypoints || [];
                this.deathPoints = data.deathPoints || [];
                console.log(`[WorldMap] Загружена карта: ${this.chunks.size} чанков`);
            }
        } catch (err) {
            console.log('[WorldMap] Ошибка загрузки карты:', err.message);
        }
    }
    
    save() {
        try {
            const data = {
                chunks: Object.fromEntries(this.chunks),
                waypoints: this.waypoints,
                deathPoints: this.deathPoints
            };
            fs.writeFileSync(this.mapPath, JSON.stringify(data, null, 2));
        } catch (err) {
            console.log('[WorldMap] Ошибка сохранения карты:', err.message);
        }
    }
    
    recordChunk(x, z) {
        const key = `${x},${z}`;
        if (!this.chunks.has(key)) {
            this.chunks.set(key, {
                x, z,
                firstVisit: Date.now(),
                lastVisit: Date.now(),
                visits: 1
            });
            this.save();
            return true;
        } else {
            const chunk = this.chunks.get(key);
            chunk.lastVisit = Date.now();
            chunk.visits++;
            this.chunks.set(key, chunk);
            return false;
        }
    }
    
    addWaypoint(name, x, y, z, type = 'general') {
        this.waypoints.push({
            name, x, y, z, type,
            createdAt: Date.now()
        });
        this.save();
        console.log(`[WorldMap] Добавлена точка: ${name} (${x}, ${y}, ${z})`);
    }
    
    findNearestWaypoint(type = null, maxDistance = 100) {
        if (!this.bot || !this.bot.entity) return null;
        
        let nearest = null;
        let nearestDist = maxDistance;
        const pos = this.bot.entity.position;
        
        for (const wp of this.waypoints) {
            if (type && wp.type !== type) continue;
            const dist = Math.sqrt(
                Math.pow(wp.x - pos.x, 2) +
                Math.pow(wp.z - pos.z, 2)
            );
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = wp;
            }
        }
        return nearest;
    }
    
    recordDeath(x, y, z) {
        this.deathPoints.push({
            x, y, z,
            time: Date.now()
        });
        
        if (this.deathPoints.length > 50) {
            this.deathPoints.shift();
        }
        this.save();
        console.log(`[WorldMap] Записана смерть на (${x}, ${y}, ${z})`);
    }
    
    getLastDeath() {
        if (this.deathPoints.length === 0) return null;
        return this.deathPoints[this.deathPoints.length - 1];
    }
    
    getExplorationStats() {
        return {
            chunksExplored: this.chunks.size,
            waypointsCount: this.waypoints.length,
            deaths: this.deathPoints.length
        };
    }
    
    setHome() {
        if (!this.bot || !this.bot.entity) return false;
        const pos = this.bot.entity.position;
        this.addWaypoint('home', Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z), 'home');
        return true;
    }
    
    async goHome() {
        const home = this.findNearestWaypoint('home');
        if (!home) {
            console.log('[WorldMap] Дом не установлен');
            return false;
        }
        
        console.log(`[WorldMap] Возвращаюсь домой (${home.x}, ${home.y}, ${home.z})`);
        const { goals } = require('mineflayer-pathfinder');
        await this.bot.pathfinder.goto(new goals.GoalNear(home.x, home.y, home.z, 3));
        return true;
    }
    
    update() {
        if (!this.bot || !this.bot.entity) return;
        
        const pos = this.bot.entity.position;
        const chunkX = Math.floor(pos.x / 16);
        const chunkZ = Math.floor(pos.z / 16);
        
        this.recordChunk(chunkX, chunkZ);
    }
    
    getMapData(centerX, centerZ, radius = 5) {
        const data = [];
        
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const chunkX = Math.floor(centerX / 16) + dx;
                const chunkZ = Math.floor(centerZ / 16) + dz;
                const key = `${chunkX},${chunkZ}`;
                
                data.push({
                    x: chunkX,
                    z: chunkZ,
                    explored: this.chunks.has(key),
                    visits: this.chunks.get(key)?.visits || 0
                });
            }
        }
        
        return {
            chunks: data,
            waypoints: this.waypoints,
            deaths: this.deathPoints.slice(-10),
            stats: this.getExplorationStats()
        };
    }
}

module.exports = WorldMap;
