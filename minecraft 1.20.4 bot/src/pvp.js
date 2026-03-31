const { goals } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');

class PvPSystem {
    constructor(bot, combat, inventory, crafting) {
        this.bot = bot;
        this.combat = combat;
        this.inventory = inventory;
        this.crafting = crafting;
        
        this.inPvP = false;
        this.currentTarget = null;
        this.lastDamage = 0;
        this.comboHits = 0;
        
        // Паттерны PVP (как у реальных игроков)
        this.pvpPatterns = {
            'w-tap': () => this.wTap(),
            's-tap': () => this.sTap(),
            'strafe': () => this.strafe(),
            'jump_crit': () => this.jumpCrit(),
            'block_hit': () => this.blockHit(),
            'rod_combo': () => this.rodCombo(),
            'lava_bucket': () => this.lavaBucket(),
            'water_bucket': () => this.waterBucket(),
            'pearl_escape': () => this.pearlEscape(),
            'bow_spam': () => this.bowSpam()
        };
        
        this.pvpCooldown = 0;
        this.lastAction = '';
    }
    
    // Найти ближайшего игрока для PVP
    findNearestPlayer() {
        let nearest = null;
        let nearestDist = 20;
        
        for (const [name, player] of Object.entries(this.bot.players)) {
            if (name === this.bot.username) continue;
            if (!player.entity) continue;
            
            const dist = this.bot.entity.position.distanceTo(player.entity.position);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = { entity: player.entity, name };
            }
        }
        
        return nearest;
    }
    
    // Начать PVP
    async startPvP(targetPlayer) {
        if (this.inPvP) return;
        
        this.inPvP = true;
        this.currentTarget = targetPlayer;
        
        console.log(`[PVP] Начинаю бой с ${targetPlayer.name}`);
        
        // Подготовка к PVP
        await this.prepareForPvP();
        
        // Основной цикл PVP
        this.pvpInterval = setInterval(async () => {
            if (!this.currentTarget || !this.currentTarget.entity || !this.currentTarget.entity.isValid) {
                this.endPvP(true);
                return;
            }
            
            const currentHealth = this.bot.health;
            const currentDist = this.bot.entity.position.distanceTo(this.currentTarget.entity.position);
            
            // Паника при низком здоровье
            if (currentHealth < 6) {
                await this.escape();
                return;
            }
            
            // Лечение
            if (currentHealth < 12 && Math.random() < 0.2) {
                await this.heal();
            }
            
            // Выбор стратегии на основе дистанции
            if (currentDist > 5) {
                await this.rangedAttack();
            } else {
                await this.meleeAttack();
            }
            
            // Случайный паттерн
            if (Math.random() < 0.3) {
                await this.applyRandomPattern();
            }
            
        }, 300);
    }
    
    async prepareForPvP() {
        // Лучшая броня
        await this.inventory.equipBestArmor();
        
        // Лучший меч
        const sword = this.inventory.getBestSword();
        if (sword) await this.bot.equip(sword, 'hand');
        
        // Щит
        const shield = this.crafting.getItem('shield');
        if (shield) await this.bot.equip(shield, 'off-hand');
        
        // Голден яблоки
        const goldenApple = this.crafting.getItem('golden_apple');
        if (goldenApple) await this.bot.equip(goldenApple, 'hand');
        
        console.log('[PVP] Готов к бою');
    }
    
    async meleeAttack() {
        const target = this.currentTarget.entity;
        const dist = this.bot.entity.position.distanceTo(target.position);
        
        if (dist > 3.5) {
            this.bot.pathfinder.setGoal(new goals.GoalFollow(target, 2));
            return;
        }
        
        this.bot.pathfinder.stop();
        await this.bot.lookAt(target.position);
        
        // Критический удар с прыжка
        if (this.bot.entity.onGround && Math.random() < 0.3) {
            this.bot.setControlState('jump', true);
            setTimeout(() => this.bot.setControlState('jump', false), 100);
        }
        
        try {
            await this.bot.attack(target);
            this.comboHits++;
            console.log(`[PVP] Нанесён удар! Комбо: ${this.comboHits}`);
        } catch(err) {}
    }
    
    async rangedAttack() {
        const target = this.currentTarget.entity;
        
        // Лук
        const bow = this.crafting.getItem('bow');
        const arrows = this.crafting.countItem('arrow');
        
        if (bow && arrows > 0) {
            await this.bot.equip(bow, 'hand');
            await this.bot.lookAt(target.position);
            
            // Предугадывание движения
            const predicted = {
                x: target.position.x + (target.velocity?.x || 0) * 2,
                y: target.position.y + 1.5,
                z: target.position.z + (target.velocity?.z || 0) * 2
            };
            
            await this.bot.lookAt(predicted);
            await this.bot.activateItem();
            await new Promise(r => setTimeout(r, 300));
            this.bot.deactivateItem();
        }
        
        // Сноуболлы
        const snowball = this.crafting.getItem('snowball');
        if (snowball) {
            await this.bot.equip(snowball, 'hand');
            await this.bot.lookAt(target.position);
            await this.bot.activateItem();
        }
    }
    
    // W-Tap (сброс спринта для knockback)
    async wTap() {
        this.bot.setControlState('sprint', true);
        await new Promise(r => setTimeout(r, 50));
        this.bot.setControlState('sprint', false);
        await new Promise(r => setTimeout(r, 100));
        this.bot.setControlState('sprint', true);
        
        console.log('[PVP] W-Tap!');
    }
    
    // S-Tap (отступление после удара)
    async sTap() {
        this.bot.setControlState('back', true);
        await new Promise(r => setTimeout(r, 100));
        this.bot.setControlState('back', false);
        
        console.log('[PVP] S-Tap!');
    }
    
    // Стрейф (движение в стороны)
    async strafe() {
        const direction = Math.random() > 0.5 ? 'left' : 'right';
        this.bot.setControlState(direction, true);
        await new Promise(r => setTimeout(r, 200));
        this.bot.setControlState(direction, false);
        
        console.log('[PVP] Стрейф!');
    }
    
    // Критический удар с прыжка
    async jumpCrit() {
        this.bot.setControlState('jump', true);
        await new Promise(r => setTimeout(r, 100));
        
        if (this.currentTarget) {
            await this.bot.attack(this.currentTarget.entity);
        }
        
        this.bot.setControlState('jump', false);
        console.log('[PVP] Критический удар!');
    }
    
    // Block-hitting (блок и удар одновременно)
    async blockHit() {
        const shield = this.crafting.getItem('shield');
        if (shield) {
            await this.bot.equip(shield, 'off-hand');
            await new Promise(r => setTimeout(r, 100));
            
            if (this.currentTarget) {
                await this.bot.attack(this.currentTarget.entity);
            }
            
            await this.bot.equip(null, 'off-hand');
        }
        
        console.log('[PVP] Block-hit!');
    }
    
    // Род-комбо (удер палкой для контроля дистанции)
    async rodCombo() {
        const fishingRod = this.crafting.getItem('fishing_rod');
        if (fishingRod && this.currentTarget) {
            await this.bot.equip(fishingRod, 'hand');
            await this.bot.lookAt(this.currentTarget.entity.position);
            await this.bot.activateItem();
            await new Promise(r => setTimeout(r, 100));
            this.bot.deactivateItem();
            
            // Быстрый удар после рода
            const sword = this.inventory.getBestSword();
            if (sword) {
                await this.bot.equip(sword, 'hand');
                await this.bot.attack(this.currentTarget.entity);
            }
        }
        
        console.log('[PVP] Rod combo!');
    }
    
    // Лава для контроля территории
    async lavaBucket() {
        const lavaBucket = this.crafting.getItem('lava_bucket');
        if (lavaBucket && this.currentTarget) {
            const targetPos = this.currentTarget.entity.position;
            const groundPos = new Vec3(
                Math.floor(targetPos.x),
                Math.floor(targetPos.y) - 1,
                Math.floor(targetPos.z)
            );
            
            await this.bot.equip(lavaBucket, 'hand');
            await this.bot.lookAt(groundPos);
            await this.bot.placeBlock(groundPos);
            
            console.log('[PVP] Поставил лаву!');
        }
    }
    
    // Вода для защиты
    async waterBucket() {
        const waterBucket = this.crafting.getItem('water_bucket');
        if (waterBucket) {
            const below = this.bot.blockAt(new Vec3(
                Math.floor(this.bot.entity.position.x),
                Math.floor(this.bot.entity.position.y) - 1,
                Math.floor(this.bot.entity.position.z)
            ));
            
            if (below && below.name === 'air') {
                await this.bot.equip(waterBucket, 'hand');
                await this.bot.placeBlock(below.position);
                console.log('[PVP] Поставил воду для защиты');
            }
        }
    }
    
    // Эскейп с перлами
    async pearlEscape() {
        const enderPearl = this.crafting.getItem('ender_pearl');
        if (enderPearl) {
            const escapePos = new Vec3(
                this.bot.entity.position.x + (Math.random() - 0.5) * 20,
                this.bot.entity.position.y,
                this.bot.entity.position.z + (Math.random() - 0.5) * 20
            );
            
            await this.bot.equip(enderPearl, 'hand');
            await this.bot.lookAt(escapePos);
            await this.bot.activateItem();
            
            console.log('[PVP] Сбежал с перлом!');
            this.endPvP(false);
        }
    }
    
    // Спам из лука
    async bowSpam() {
        const bow = this.crafting.getItem('bow');
        const arrows = this.crafting.countItem('arrow');
        
        if (bow && arrows > 0 && this.currentTarget) {
            await this.bot.equip(bow, 'hand');
            
            for (let i = 0; i < 5; i++) {
                await this.bot.lookAt(this.currentTarget.entity.position);
                await this.bot.activateItem();
                await new Promise(r => setTimeout(r, 200));
                this.bot.deactivateItem();
            }
            
            console.log('[PVP] Bow spam!');
        }
    }
    
    async applyRandomPattern() {
        const patterns = Object.keys(this.pvpPatterns);
        const pattern = patterns[Math.floor(Math.random() * patterns.length)];
        await this.pvpPatterns[pattern]();
    }
    
    async heal() {
        // Золотые яблоки
        const goldenApple = this.crafting.getItem('golden_apple');
        if (goldenApple) {
            await this.bot.equip(goldenApple, 'hand');
            await this.bot.consume();
            await new Promise(r => setTimeout(r, 1000));
            console.log('[PVP] Съел золотое яблоко');
            return;
        }
        
        // Обычная еда
        const food = this.inventory.getBestFood();
        if (food) {
            await this.bot.equip(food, 'hand');
            await this.bot.consume();
            await new Promise(r => setTimeout(r, 500));
            console.log('[PVP] Поел');
        }
    }
    
    async escape() {
        console.log('[PVP] Убегаю!');
        
        // Перл
        const pearl = this.crafting.getItem('ender_pearl');
        if (pearl) {
            await this.pearlEscape();
            return;
        }
        
        // Просто бежим
        this.bot.setControlState('sprint', true);
        this.bot.setControlState('forward', true);
        
        setTimeout(() => {
            this.bot.setControlState('sprint', false);
            this.bot.setControlState('forward', false);
        }, 3000);
        
        this.endPvP(false);
    }
    
    endPvP(victory) {
        if (this.pvpInterval) {
            clearInterval(this.pvpInterval);
            this.pvpInterval = null;
        }
        
        this.inPvP = false;
        this.currentTarget = null;
        this.comboHits = 0;
        
        console.log(`[PVP] Бой окончен. ${victory ? 'Победа!' : 'Поражение...'}`);
    }
    
    async checkAndEngage() {
        if (this.inPvP) return;
        
        const player = this.findNearestPlayer();
        if (player && player.entity) {
            const dist = this.bot.entity.position.distanceTo(player.entity.position);
            
            // Агрессивный режим
            if (dist < 10 && Math.random() < 0.3) {
                await this.startPvP(player);
                return true;
            }
        }
        return false;
    }
    
    // Реакция на получение урона от игрока
    onDamage(source) {
        if (source && source.type === 'player') {
            console.log(`[PVP] Атакован игроком ${source.name || 'неизвестным'}!`);
            
            if (!this.inPvP) {
                const player = this.findNearestPlayer();
                if (player) {
                    this.startPvP(player);
                }
            }
        }
    }
    
    getPvPStats() {
        return {
            inPvP: this.inPvP,
            comboHits: this.comboHits,
            target: this.currentTarget?.name || null
        };
    }
}

module.exports = PvPSystem;
