const { goals } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');

class Farming {
    constructor(bot, memory, crafting, inventory) {
        this.bot = bot;
        this.memory = memory;
        this.crafting = crafting;
        this.inventory = inventory;
        this.isFarming = false;
        
        this.crops = {
            'wheat': { seed: 'wheat_seeds', block: 'wheat', maturity: 7 },
            'carrot': { seed: 'carrot', block: 'carrots', maturity: 7 },
            'potato': { seed: 'potato', block: 'potatoes', maturity: 7 },
            'beetroot': { seed: 'beetroot_seeds', block: 'beetroots', maturity: 7 }
        };
        
        this.animals = {
            'cow': { food: 'wheat', product: 'beef', product2: 'leather', breedCooldown: 300000, maxCount: 10 },
            'pig': { food: 'carrot', product: 'porkchop', breedCooldown: 300000, maxCount: 10 },
            'sheep': { food: 'wheat', product: 'mutton', product2: 'wool', breedCooldown: 300000, maxCount: 10 },
            'chicken': { food: 'wheat_seeds', product: 'chicken', product2: 'feather', breedCooldown: 300000, maxCount: 10 },
            'rabbit': { food: 'carrot', product: 'rabbit', product2: 'rabbit_hide', breedCooldown: 300000, maxCount: 10 }
        };
        
        this.lastBreed = {};
    }
    
    findFarmland() {
        const mcData = require('minecraft-data')(this.bot.version);
        const farmlandId = mcData?.blocksByName?.['farmland']?.id;
        if (!farmlandId) return [];
        return this.bot.findBlocks({
            matching: farmlandId,
            maxDistance: 32,
            count: 100
        });
    }
    
    async createFarmland(x, z) {
        const pos = new Vec3(x, Math.floor(this.bot.entity.position.y), z);
        const block = this.bot.blockAt(pos);
        
        if (block && (block.name === 'dirt' || block.name === 'grass_block')) {
            const hoe = this.crafting.getItem('wooden_hoe') || 
                       this.crafting.getItem('stone_hoe') ||
                       this.crafting.getItem('iron_hoe') ||
                       this.crafting.getItem('diamond_hoe');
            
            if (hoe) {
                await this.bot.equip(hoe, 'hand');
                await this.bot.lookAt(pos);
                await this.bot.activateBlock(block);
                return true;
            }
        }
        return false;
    }
    
    async plantSeed(seedType, position) {
        const seed = this.crafting.getItem(seedType);
        if (!seed) return false;
        
        const block = this.bot.blockAt(position);
        if (block && block.name === 'farmland') {
            try {
                await this.bot.equip(seed, 'hand');
                await this.bot.lookAt(position);
                const Vec3 = require('vec3');
                await this.bot.placeBlock(block, new Vec3(0, 1, 0));
                return true;
            } catch (e) { return false; }
        }
        return false;
    }
    
    async harvest(cropType, position) {
        const block = this.bot.blockAt(position);
        if (!block) return false;
        
        const cropData = this.crops[cropType];
        if (cropData && block.metadata >= cropData.maturity) {
            await this.bot.lookAt(position);
            await this.bot.dig(block);
            this.memory.addStat('crops_harvested');
            return true;
        }
        return false;
    }
    
    async findAndHarvest() {
        const farmBlocks = this.findFarmland();
        let harvested = 0;
        
        for (const pos of farmBlocks) {
            const above = new Vec3(pos.x, pos.y + 1, pos.z);
            const block = this.bot.blockAt(above);
            
            if (block) {
                for (const [crop, data] of Object.entries(this.crops)) {
                    if (block.name === data.block) {
                        const success = await this.harvest(crop, above);
                        if (success) harvested++;
                        await new Promise(r => setTimeout(r, 200));
                        break;
                    }
                }
            }
        }
        
        if (harvested > 0) console.log(`[Farming] Собрано ${harvested} культур`);
        return harvested;
    }
    
    async plantOnEmptyFarmland() {
        const farmBlocks = this.findFarmland();
        let planted = 0;
        
        for (const pos of farmBlocks) {
            const above = new Vec3(pos.x, pos.y + 1, pos.z);
            const block = this.bot.blockAt(above);
            
            if (!block || block.name === 'air') {
                let seedType = 'wheat_seeds';
                if (this.crafting.hasItem('carrot')) seedType = 'carrot';
                else if (this.crafting.hasItem('potato')) seedType = 'potato';
                
                const success = await this.plantSeed(seedType, above);
                if (success) planted++;
                await new Promise(r => setTimeout(r, 500));
            }
        }
        
        if (planted > 0) console.log(`[Farming] Посажено ${planted} культур`);
        return planted;
    }
    
    findNearestAnimal(animalType) {
        let nearest = null;
        let nearestDist = 20;
        
        for (const [id, entity] of Object.entries(this.bot.entities)) {
            if (id === this.bot.entity.id) continue;
            if (entity.name === animalType) {
                const dist = this.bot.entity.position.distanceTo(entity.position);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearest = entity;
                }
            }
        }
        return nearest;
    }
    
    countAnimals(animalType) {
        let count = 0;
        for (const [id, entity] of Object.entries(this.bot.entities)) {
            if (entity.name === animalType) count++;
        }
        return count;
    }
    
    async breedAnimal(animalType) {
        const animal = this.findNearestAnimal(animalType);
        if (!animal) return false;
        
        const animalData = this.animals[animalType];
        if (!animalData) return false;
        
        const now = Date.now();
        if (this.lastBreed[animalType] && now - this.lastBreed[animalType] < animalData.breedCooldown) return false;
        
        const food = this.crafting.getItem(animalData.food);
        if (!food) return false;
        
        await this.bot.pathfinder.goto(new goals.GoalNear(animal.position.x, animal.position.y, animal.position.z, 2));
        await this.bot.equip(food, 'hand');
        await this.bot.lookAt(animal.position);
        await this.bot.activateEntity(animal);
        
        this.lastBreed[animalType] = now;
        console.log(`[Farming] Покормил ${animalType}`);
        return true;
    }
    
    async shearSheep(sheep) {
        const shears = this.crafting.getItem('shears');
        if (!shears) return false;
        
        await this.bot.pathfinder.goto(new goals.GoalNear(sheep.position.x, sheep.position.y, sheep.position.z, 2));
        await this.bot.equip(shears, 'hand');
        await this.bot.lookAt(sheep.position);
        await this.bot.activateEntity(sheep);
        console.log('[Farming] Овца подстрижена');
        return true;
    }
    
    async milkCow(cow) {
        const bucket = this.crafting.getItem('bucket');
        if (!bucket) return false;
        
        await this.bot.pathfinder.goto(new goals.GoalNear(cow.position.x, cow.position.y, cow.position.z, 2));
        await this.bot.equip(bucket, 'hand');
        await this.bot.lookAt(cow.position);
        await this.bot.activateEntity(cow);
        console.log('[Farming] Корова подоена');
        return true;
    }
    
    async collectEggs() {
        const eggs = this.crafting.getItem('egg');
        return eggs ? eggs.count : 0;
    }
    
    async createBasicFarm(centerX, centerZ) {
        console.log('[Farming] Создаю ферму...');
        
        const playerY = Math.floor(this.bot.entity.position.y);
        const waterPos = new Vec3(centerX, playerY, centerZ);
        const waterBlock = this.bot.blockAt(waterPos);
        
        if (!waterBlock || waterBlock.name !== 'water') {
            const waterBucket = this.crafting.getItem('water_bucket');
            if (waterBucket) {
                await this.bot.equip(waterBucket, 'hand');
                await this.bot.lookAt(waterPos);
                await this.bot.placeBlock(waterPos);
                console.log('[Farming] Поставил воду');
            } else {
                console.log('[Farming] Нет ведра с водой');
            }
        }
        
        let created = 0;
        for (let dx = -4; dx <= 4; dx++) {
            for (let dz = -4; dz <= 4; dz++) {
                if (dx === 0 && dz === 0) continue;
                const pos = new Vec3(centerX + dx, playerY, centerZ + dz);
                const block = this.bot.blockAt(pos);
                if (block && (block.name === 'dirt' || block.name === 'grass_block')) {
                    const success = await this.createFarmland(pos.x, pos.z);
                    if (success) created++;
                    await new Promise(r => setTimeout(r, 100));
                }
            }
        }
        
        console.log(`[Farming] Создано ${created} грядок`);
        await this.plantOnEmptyFarmland();
        return true;
    }
    
    async createPen(centerX, centerZ) {
        console.log('[Farming] Создаю загон...');
        
        const fences = [];
        const radius = 5;
        const playerY = Math.floor(this.bot.entity.position.y);
        
        for (let x = -radius; x <= radius; x++) {
            for (let z = -radius; z <= radius; z++) {
                if (Math.abs(x) === radius || Math.abs(z) === radius) {
                    fences.push(new Vec3(centerX + x, playerY, centerZ + z));
                }
            }
        }
        
        const fenceItem = this.crafting.getItem('oak_fence');
        if (fenceItem) {
            for (const pos of fences) {
                const block = this.bot.blockAt(pos);
                if (block && block.name === 'air') {
                    await this.bot.equip(fenceItem, 'hand');
                    await this.bot.lookAt(pos);
                    await this.bot.placeBlock(pos);
                    await new Promise(r => setTimeout(r, 100));
                }
            }
        }
        
        console.log(`[Farming] Загон создан`);
        return true;
    }
    
    async leadAnimal(animalType, penPosition) {
        const animal = this.findNearestAnimal(animalType);
        if (!animal) return false;
        
        const lead = this.crafting.getItem('lead');
        if (lead) {
            await this.bot.equip(lead, 'hand');
            await this.bot.lookAt(animal.position);
            await this.bot.useOn(animal);
        }
        
        await this.bot.pathfinder.goto(new goals.GoalNear(penPosition.x, penPosition.y, penPosition.z, 2));
        if (lead) await this.bot.unequip('hand');
        return true;
    }
    
    async autoFarm() {
        if (this.isFarming) return false;
        this.isFarming = true;
        
        try {
            const harvested = await this.findAndHarvest();
            const planted = await this.plantOnEmptyFarmland();
            
            if (this.findFarmland().length === 0) {
                const pos = this.bot.entity.position;
                await this.createBasicFarm(Math.floor(pos.x), Math.floor(pos.z));
            }
            
            for (const animalType of Object.keys(this.animals)) {
                const count = this.countAnimals(animalType);
                if (count < this.animals[animalType].maxCount) {
                    await this.breedAnimal(animalType);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
            
            const sheep = this.findNearestAnimal('sheep');
            if (sheep && this.crafting.hasItem('shears')) await this.shearSheep(sheep);
            
            const cow = this.findNearestAnimal('cow');
            if (cow && this.crafting.hasItem('bucket')) await this.milkCow(cow);
            
            await this.collectEggs();
            
            return harvested > 0 || planted > 0;
        } finally {
            this.isFarming = false;
        }
    }
    
    getFarmStats() {
        const farmBlocks = this.findFarmland();
        let planted = 0;
        let mature = 0;
        
        for (const pos of farmBlocks) {
            const above = new Vec3(pos.x, pos.y + 1, pos.z);
            const block = this.bot.blockAt(above);
            if (block && block.name !== 'air') {
                planted++;
                for (const [crop, data] of Object.entries(this.crops)) {
                    if (block.name === data.block && block.metadata >= data.maturity) {
                        mature++;
                        break;
                    }
                }
            }
        }
        
        const animalCounts = {};
        for (const animalType of Object.keys(this.animals)) {
            animalCounts[animalType] = this.countAnimals(animalType);
        }
        
        return {
            farmlands: farmBlocks.length,
            planted,
            mature,
            animals: animalCounts,
            hasShears: this.crafting.hasItem('shears'),
            hasBucket: this.crafting.hasItem('bucket')
        };
    }
}

module.exports = Farming;


