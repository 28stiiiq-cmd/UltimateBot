const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

class WebServer {
    constructor(bot, memory, inventory, combat, nether, ender) {
        this.bot = bot;
        this.memory = memory;
        this.inventory = inventory;
        this.combat = combat;
        this.nether = nether;
        this.ender = ender;
        
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server);
        
        this.port = 3000;
        this.clients = new Set();
        
        this.setupRoutes();
        this.setupSocket();
        this.startUpdates();
    }
    
    setupRoutes() {
        this.app.use(express.static(path.join(__dirname, '../web/public')));
        
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '../web/public/index.html'));
        });
        
        this.app.get('/api/stats', async (req, res) => {
            const stats = await this.memory.getOverallStats();
            res.json(stats);
        });
        
        this.app.get('/api/inventory', (req, res) => {
            res.json(this.inventory.getResourceStats());
        });
        
        this.app.get('/api/position', (req, res) => {
            if (!this.bot.entity) {
                res.json({ x: 0, y: 0, z: 0 });
                return;
            }
            res.json({
                x: Math.floor(this.bot.entity.position.x),
                y: Math.floor(this.bot.entity.position.y),
                z: Math.floor(this.bot.entity.position.z)
            });
        });
        
        this.app.get('/api/health', (req, res) => {
            res.json({
                health: this.bot.health || 20,
                food: this.bot.food || 20,
                xp: this.bot.experience?.level || 0
            });
        });
        
        this.app.get('/api/world', (req, res) => {
            const entities = [];
            if (this.bot.entities) {
                for (const [id, entity] of Object.entries(this.bot.entities)) {
                    if (entity === this.bot.entity) continue;
                    if (entity.position) {
                        entities.push({
                            id,
                            name: entity.name,
                            x: Math.floor(entity.position.x),
                            y: Math.floor(entity.position.y),
                            z: Math.floor(entity.position.z)
                        });
                    }
                }
            }
            res.json(entities);
        });
    }
    
    setupSocket() {
        this.io.on('connection', (socket) => {
            console.log('[Web] Клиент подключён');
            this.clients.add(socket);
            
            socket.on('command', async (data) => {
                console.log(`[Web] Команда: ${data.command}`);
                try {
                    switch(data.command) {
                        case 'stop':
                            if (this.bot.pathfinder) this.bot.pathfinder.stop();
                            if (this.combat) this.combat.stopCombat();
                            if (this.bot._goap) this.bot._goap.stop();
                            this.bot.setControlState("forward", false);
                            this.bot.setControlState("sprint", false);
                            this.bot.chat('Стоп');
                            break;
                        case 'go':
                            if (this.bot._goap) this.bot._goap.start();
                            this.bot.chat('Поехали');
                            break;
                        case 'mine':
                            this.bot.chat('Добыча...');
                            if (this.bot._goap?.mining) await this.bot._goap.mining.autoMine();
                            break;
                        case 'fight':
                            if (this.combat) {
                                const t = this.combat.findNearestHostile();
                                if (t) { this.bot.chat(`Атака: ${t.name}`); await this.combat.startCombat(t); }
                                else this.bot.chat('Нет врагов');
                            }
                            break;
                        case 'eat':
                            if (this.inventory) await this.inventory.eat();
                            break;
                        case 'tree':
                            this.bot.chat('Рублю...');
                            if (this.bot._goap?.mining) {
                                const tree = this.bot._goap.mining.findTreeByLeaves() || this.bot._goap.mining.findTree();
                                if (tree) await this.bot._goap.mining.chopTree(tree);
                            }
                            break;
                        case 'smelt':
                            if (this.bot._goap?.smelting) await this.bot._goap.smelting.smeltAll();
                            break;
                        case 'build':
                            if (this.bot._builder) await this.bot._builder.buildHouse();
                            break;
                        case 'home':
                            if (this.bot._builder) await this.bot._builder.goHome();
                            break;
                        case 'chat':
                            if (data.message) this.bot.chat(data.message);
                            break;
                        default:
                            // Try as chat command
                            if (data.command.startsWith('!')) this.bot.chat(data.command);
                    }
                } catch (err) {
                    console.log(`[Web] Ошибка: ${err.message}`);
                }
            });
            
            socket.on('disconnect', () => {
                this.clients.delete(socket);
                console.log('[Web] Клиент отключён');
            });
        });
    }
    
    startUpdates() {
        setInterval(() => {
            if (this.clients.size === 0) return;
            if (!this.bot.entity) return;
            
            const data = {
                position: {
                    x: Math.floor(this.bot.entity.position.x),
                    y: Math.floor(this.bot.entity.position.y),
                    z: Math.floor(this.bot.entity.position.z)
                },
                health: this.bot.health || 20,
                food: this.bot.food || 20,
                xp: this.bot.experience?.level || 0,
                goal: this.bot._goap?.getCurrentGoal()?.id || null,
                timestamp: Date.now()
            };
            
            this.io.emit('update', data);
        }, 1000);
        
        setInterval(() => {
            if (this.clients.size === 0) return;
            
            const resources = this.inventory.getResourceStats();
            const topResources = Object.entries(resources).slice(0, 10);
            this.io.emit('inventory', topResources);
        }, 3000);
        
        setInterval(() => {
            if (this.clients.size === 0) return;
            
            this.io.emit('log', {
                time: Date.now(),
                message: `[${new Date().toLocaleTimeString()}] Статус: ${this.bot.health}/ ${this.bot.food}/`
            });
        }, 2000);
    }
    
    start() {
        this.server.listen(this.port, () => {
            console.log(`[Web] Сервер запущен на http://localhost:${this.port}`);
        });
    }
}

module.exports = WebServer;
