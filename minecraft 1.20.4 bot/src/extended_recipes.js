// Расширенный крафт  добавляем все рецепты через minecraft-data
class ExtendedRecipes {
    constructor(crafting) {
        this.crafting = crafting;
        this.addAllRecipes();
    }
    
    addAllRecipes() {
        // Все цвета шерсти
        const colors = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
        
        // Добавляем рецепты цветной шерсти
        for (const color of colors) {
            this.crafting.recipesByName[`${color}_wool`] = [{
                ingredients: [{ name: 'string', count: 4 }],
                result: `${color}_wool`,
                count: 1,
                requiresTable: true
            }];
        }
        
        // Все виды стекла
        const glassTypes = ['glass', 'glass_pane', 'white_stained_glass', 'orange_stained_glass', 'magenta_stained_glass'];
        for (const glass of glassTypes) {
            if (!this.crafting.recipesByName[glass]) {
                this.crafting.recipesByName[glass] = [{
                    ingredients: glass.includes('stained') ? [{ name: 'glass', count: 8 }, { name: `${glass.split('_')[0]}_dye`, count: 1 }] : [{ name: 'sand', count: 1 }],
                    result: glass,
                    count: glass.includes('pane') ? 16 : 8,
                    requiresTable: true
                }];
            }
        }
        
        // Все виды терракоты
        const terracottaColors = [...colors, 'terracotta'];
        for (const color of terracottaColors) {
            const name = color === 'terracotta' ? 'terracotta' : `${color}_terracotta`;
            if (!this.crafting.recipesByName[name]) {
                this.crafting.recipesByName[name] = [{
                    ingredients: color === 'terracotta' ? [{ name: 'clay', count: 1 }, { name: 'coal', count: 1 }] : [{ name: 'terracotta', count: 8 }, { name: `${color}_dye`, count: 1 }],
                    result: name,
                    count: color === 'terracotta' ? 1 : 8,
                    requiresTable: true
                }];
            }
        }
        
        // Все виды бетона
        for (const color of colors) {
            this.crafting.recipesByName[`${color}_concrete`] = [{
                ingredients: [{ name: 'sand', count: 4 }, { name: 'gravel', count: 4 }, { name: `${color}_dye`, count: 1 }],
                result: `${color}_concrete`,
                count: 8,
                requiresTable: true
            }];
        }
        
        // Все виды красок
        const dyes = {
            'red': ['poppy', 'red_tulip', 'rose_bush', 'beetroot'],
            'yellow': ['dandelion', 'sunflower'],
            'blue': ['cornflower', 'lapis_lazuli'],
            'green': ['cactus'],
            'brown': ['cocoa_beans'],
            'black': ['ink_sac', 'wither_rose'],
            'white': ['bone_meal', 'lily_of_the_valley'],
            'orange': ['orange_tulip'],
            'magenta': ['allium', 'lilac'],
            'pink': ['pink_tulip', 'peony'],
            'light_blue': ['blue_orchid'],
            'lime': ['sea_pickle'],
            'cyan': ['pitcher_plant'],
            'purple': ['chorus_flower'],
            'gray': ['azure_bluet', 'oxeye_daisy']
        };
        
        for (const [color, items] of Object.entries(dyes)) {
            for (const item of items) {
                this.crafting.recipesByName[`${color}_dye`] = [{
                    ingredients: [{ name: item, count: 1 }],
                    result: `${color}_dye`,
                    count: item === 'beetroot' ? 1 : 2,
                    requiresTable: false
                }];
            }
        }
        
        console.log(`[ExtendedRecipes] Добавлено ${Object.keys(this.crafting.recipesByName).length} рецептов`);
    }
}

module.exports = ExtendedRecipes;
