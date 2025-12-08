const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// --- ПОДКЛЮЧАЕМ КАРТУ ИЗ ФАЙЛА ---
let buildings = [];
try {
    buildings = require('./map');
    console.log("Карта загружена из map.js");
} catch (e) {
    console.error("ОШИБКА: Не найден файл map.js! Создайте его рядом с server.js");
    process.exit(1); // Остановить сервер, чтобы ты увидел ошибку
}

app.use(express.static('public'));

// --- КОНСТАНТЫ ---
const MAP_WIDTH = 2000;
const MAP_HEIGHT = 2000;
const TARGET_PLAYERS = 10; 
const ROUND_DURATION = 180 * 1000;
const WARMUP_DURATION = 5000;

const PLAYER_START_HP = 300; 
const MAX_LEVEL = 25;
const HP_PER_LEVEL = 100;
const MAX_HP = MAX_LEVEL * HP_PER_LEVEL;

const ZOMBIE_HP = 30;
const ZOMBIE_DAMAGE = 2;

const WEAPONS = {
    rifle: { damage: 10, speed: 12, range: 600, spread: 0.1, color: 'yellow', cooldown: 250 },
    sniper: { damage: 80, speed: 25, range: 1200, spread: 0.005, color: 'white', cooldown: 1500 },
    machinegun: { damage: 6, speed: 14, range: 700, spread: 0.35, color: 'orange', cooldown: 90 },
    rpg: { damage: 100, speed: 9, range: 800, spread: 0.1, color: 'red', cooldown: 2000, type: 'rocket' }
};

const FULL_SQUAD_ROSTER = [
    'rifle', 'rifle', 'rifle', 'rifle', 'rifle', 
    'sniper', 
    'rifle', 'rifle', 'rifle', 
    'machinegun', 
    'rifle', 'rifle', 'rifle', 'rifle', 'rifle', 'rifle', 'rifle', 
    'rpg', 
    'rifle', 'rifle', 'rifle', 'rifle', 'rifle', 
    'rpg', 
    'machinegun'
];

let players = {};
let zombies = {};
let bullets = [];
let loot = {};
// buildings уже загружен сверху

let zombieIdCounter = 0;
let lootIdCounter = 0;
let botIdCounter = 0;

let gameState = 'waiting'; 
let roundEndTime = 0;
let endRoundTimeout;

// --- СЕТЬ ---
io.on('connection', (socket) => {
    console.log('Подключился:', socket.id);
    socket.emit('map_data', buildings);
    
    // ВХОД В ИГРУ
    socket.on('join_game', (nickname) => {
        let cleanName = (nickname || "Player").substring(0, 12);
        
        // Удаляем лишнего бота, если сервер полон
        const botIds = Object.keys(players).filter(id => players[id].isBot);
        if (Object.keys(players).length >= TARGET_PLAYERS && botIds.length > 0) {
            delete players[botIds[0]];
        }

        const startDead = (gameState === 'running' || gameState === 'ended');
        spawnPlayer(socket.id, false, startDead, cleanName);
        
        if (gameState === 'waiting' && !startDead) {
            startWarmup();
        }
    });

    socket.on('force_restart', () => {
        console.log("Игрок запросил рестарт");
        if (gameState !== 'waiting') {
            endRound("Сброс");
            clearTimeout(endRoundTimeout);
            resetGame();
        }
    });

    socket.on('movement', (data) => {
        handleMovement(socket.id, data);
    });

    socket.on('shoot', (target) => {
        if (gameState !== 'running') return;
        handleShooting(socket.id, target);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        if (Object.keys(players).length === 0) {
            gameState = 'waiting';
            console.log("Все вышли. Ожидание.");
        }
    });
});

// --- ЛОГИКА ФАЗ ---
function startWarmup() {
    console.log("Разминка...");
    gameState = 'warmup';
    roundEndTime = Date.now() + WARMUP_DURATION;
    fillBots(); // Спавним ботов сразу
    setTimeout(() => { 
        if (gameState === 'warmup') startGame(); 
    }, WARMUP_DURATION);
}

function startGame() {
    console.log("СТАРТ!");
    gameState = 'running';
    roundEndTime = Date.now() + ROUND_DURATION;
}

function fillBots() {
    const activePlayers = Object.values(players).filter(p => !p.isBot).length;
    const botsNeeded = TARGET_PLAYERS - activePlayers;
    for (let i = 0; i < botsNeeded; i++) {
        botIdCounter++;
        spawnPlayer('bot_' + botIdCounter, true, false, "Бот " + botIdCounter);
    }
}

function checkGameOver() {
    // Пока отключено
}

function endRound(winnerName) {
    if (gameState === 'ended') return;
    gameState = 'ended';
    io.sockets.emit('state', { players, zombies, bullets, loot, timeLeft: 0, isOver: true });
    
    endRoundTimeout = setTimeout(() => {
        resetGame();
    }, 5000);
}

function resetGame() {
    players = {}; zombies = {}; bullets = []; loot = {};
    botIdCounter = 0;
    
    // Карта статичная, не генерируем заново
    
    io.sockets.sockets.forEach((socket) => {
        socket.emit('map_data', buildings);
        socket.emit('game_restarted'); 
    });

    gameState = 'waiting';
}

// --- ФИЗИКА ---
function checkCircleRect(cx, cy, r, rect) {
    let tx=cx, ty=cy;
    if(cx<rect.x) tx=rect.x; else if(cx>rect.x+rect.w) tx=rect.x+rect.w;
    if(cy<rect.y) ty=rect.y; else if(cy>rect.y+rect.h) ty=rect.y+rect.h;
    let dx=cx-tx, dy=cy-ty;
    return (dx*dx+dy*dy)<=(r*r);
}
function lineRect(x1, y1, x2, y2, rx, ry, rw, rh) {
    const left = lineLine(x1,y1,x2,y2, rx,ry,rx, ry+rh);
    const right = lineLine(x1,y1,x2,y2, rx+rw,ry, rx+rw,ry+rh);
    const top = lineLine(x1,y1,x2,y2, rx,ry, rx+rw,ry);
    const bottom = lineLine(x1,y1,x2,y2, rx,ry+rh, rx+rw,ry+rh);
    return left || right || top || bottom;
}
function lineLine(x1, y1, x2, y2, x3, y3, x4, y4) {
    const uA = ((x4-x3)*(y1-y3) - (y4-y3)*(x1-x3)) / ((y4-y3)*(x2-x1) - (x4-x3)*(y2-y1));
    const uB = ((x2-x1)*(y1-y3) - (y2-y1)*(x1-x3)) / ((y4-y3)*(x2-x1) - (x4-x3)*(y2-y1));
    return (uA >= 0 && uA <= 1 && uB >= 0 && uB <= 1);
}
function hasWallBetween(x1, y1, x2, y2) {
    for (let b of buildings) {
        if (lineRect(x1, y1, x2, y2, b.x, b.y, b.w, b.h)) return true;
    }
    return false;
}
function getUnitOffset(index) {
    if (index === 0) return { x: 0, y: 0 };
    const radius = 18 + (index * 2); 
    const angle = index * 1.5; 
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function spawnPlayer(id, isBot, startDead, nickname) {
    let safeX, safeY, attempts = 0;
    do {
        safeX = 100 + Math.random() * (MAP_WIDTH - 200);
        safeY = 100 + Math.random() * (MAP_HEIGHT - 200);
        attempts++;
        let c = false;
        for (let b of buildings) { if (checkCircleRect(safeX, safeY, 50, b)) { c=true; break; } }
        if (!c) break;
    } while (attempts < 50);

    players[id] = {
        id: id, isBot: isBot, dead: startDead,
        nickname: nickname || "Unknown",
        x: safeX, y: safeY,
        color: isBot ? '#999' : '#' + Math.floor(Math.random()*16777215).toString(16),
        hp: PLAYER_START_HP, 
        level: 3, 
        maxLevel: 3, // <--- НОВОЕ: Запоминаем рекорд
        score: 0,
        weaponCooldowns: {},
        botState: 'roam', targetX: 0, targetY: 0
    };
}

function handleMovement(id, data) {
    const player = players[id];
    if (!player || player.dead) return;
    const squadSize = Math.ceil(player.hp / 100);
    const colliderRadius = 20 + (squadSize * 2.5); 
    let speed = 6 - (squadSize * 0.1); 
    if (player.level >= 10) speed += 0.5;
    let dx = 0, dy = 0;
    if (data.left) dx = -speed; if (data.up) dy = -speed;
    if (data.right) dx = speed; if (data.down) dy = speed;
    if (dx !== 0 && dy !== 0) { dx /= 1.414; dy /= 1.414; }
    let nextX = player.x + dx; let nextY = player.y + dy;
    if (nextX < colliderRadius) nextX = colliderRadius;
    if (nextX > MAP_WIDTH - colliderRadius) nextX = MAP_WIDTH - colliderRadius;
    if (nextY < colliderRadius) nextY = colliderRadius;
    if (nextY > MAP_HEIGHT - colliderRadius) nextY = MAP_HEIGHT - colliderRadius;
    let hitBuilding = false;
    for (let b of buildings) { if (checkCircleRect(nextX, nextY, colliderRadius, b)) { hitBuilding = true; break; } }
    if (hitBuilding) {
        let hitX = false;
        for (let b of buildings) { if (checkCircleRect(nextX, player.y, colliderRadius, b)) { hitX = true; break; } }
        if (!hitX) { player.x = nextX; return; }
        let hitY = false;
        for (let b of buildings) { if (checkCircleRect(player.x, nextY, colliderRadius, b)) { hitY = true; break; } }
        if (!hitY) { player.y = nextY; return; }
    } else { player.x = nextX; player.y = nextY; }
}

function handleShooting(id, target) {
    // ГЛАВНОЕ ИСПРАВЛЕНИЕ: Если игра не 'running', стрельба запрещена полностью
    if (gameState !== 'running') return; 

    const player = players[id];
    if (!player || player.dead) return;
    const squadCount = Math.ceil(player.hp / 100);
    const now = Date.now();

    for (let i = 0; i < squadCount; i++) {
        const weaponType = FULL_SQUAD_ROSTER[i] || 'rifle';
        const stats = WEAPONS[weaponType];
        if (!player.weaponCooldowns[i]) player.weaponCooldowns[i] = 0;

        if (now - player.weaponCooldowns[i] >= stats.cooldown) {
            player.weaponCooldowns[i] = now;
            const offset = getUnitOffset(i);
            const unitX = player.x + offset.x;
            const unitY = player.y + offset.y;
            const angleToTarget = Math.atan2(target.y - unitY, target.x - unitX);
            const spread = (Math.random() - 0.5) * stats.spread;
            
            bullets.push({
                x: unitX, 
                y: unitY, 
                angle: angleToTarget + spread,
                speed: stats.speed, 
                damage: stats.damage, 
                range: stats.range,
                color: stats.color, 
                type: stats.type || 'bullet',
                ownerId: id, 
                traveled: 0
            });
        }
    }
}

function createExplosion(x, y, damage, ownerId) {
    io.sockets.emit('explosion', {x, y});
    for (let zId in zombies) {
        let z = zombies[zId];
        let dist = Math.sqrt((x - z.x)**2 + (y - z.y)**2);
        if (dist < 100) {
            z.hp -= damage;
            if (z.hp <= 0) { dropLoot(z.x, z.y, 40, 1); delete zombies[zId]; }
        }
    }
    for (let pId in players) {
        let p = players[pId];
        if (p.dead) continue;
        let dist = Math.sqrt((x - p.x)**2 + (y - p.y)**2);
        if (dist < 100) {
			if (pId !== ownerId) {
                p.hp -= damage;
                p.level = Math.ceil(p.hp / HP_PER_LEVEL);
                if (p.hp <= 0) { 
                    p.dead = true; 
                    
                    // <--- НОВАЯ ЛОГИКА ДРОПА
                    let dropVal = p.score;
                    if(p.isBot) {
                        // Бот дропает: (Макс Уровень * 75)
                        // Пример: Уровень 3 -> 225 XP (2 бутылки)
                        // Пример: Уровень 10 -> 750 XP (7 бутылок)
                        dropVal = Math.max(p.score, p.maxLevel * 75);
                    }
                    
                    dropLoot(p.x, p.y, dropVal, 5); 
                    if (p.isBot) delete players[pId]; 
                }
            }
        }
    }
}

function gainXp(player, amount) {
    if (player.dead) return;
    player.score += amount;
    if (player.hp >= MAX_HP) return;
    
    player.hp += amount;
    if (player.hp > MAX_HP) player.hp = MAX_HP;
    player.level = Math.ceil(player.hp / HP_PER_LEVEL);
    
    if (player.level > player.maxLevel) {
        player.maxLevel = player.level;
    }
}

function dropLoot(x, y, totalXp, count) {
    const xpPerItem = Math.floor(totalXp / count);
    if (xpPerItem <= 0) return;
    for (let i = 0; i < count; i++) {
        let lx, ly, attempts = 0;
        do {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * 40; 
            lx = x + Math.cos(angle) * dist;
            ly = y + Math.sin(angle) * dist;
            attempts++;
            let hit = false;
            for (let b of buildings) { if (checkCircleRect(lx, ly, 10, b)) { hit = true; break; } }
            if (!hit) break;
        } while (attempts < 5);
        lootIdCounter++;
        loot[lootIdCounter] = { x: lx, y: ly, value: xpPerItem, radius: 10 };
    }
}

function updateBots() {
    const EDGE_MARGIN = 200; 
    for (let id in players) {
        const bot = players[id];
        if (!bot.isBot || bot.dead) continue;
        let nearestLoot = null, minLootDist = 400; 
        let nearestEnemy = null, minEnemyDist = 900; 
        let nearestZombie = null, minZombieDist = 300; 
        for (let lId in loot) {
             let l = loot[lId];
             let d = Math.sqrt((l.x - bot.x)**2 + (l.y - bot.y)**2);
             if (d < minLootDist && !hasWallBetween(bot.x, bot.y, l.x, l.y)) { minLootDist = d; nearestLoot = l; }
        }
        for (let pId in players) {
            if (pId === id || players[pId].dead) continue;
            let p = players[pId];
            let d = Math.sqrt((p.x - bot.x)**2 + (p.y - bot.y)**2);
            if (d < minEnemyDist) { minEnemyDist = d; nearestEnemy = p; }
        }
        for (let zId in zombies) {
            let z = zombies[zId];
            let d = Math.sqrt((z.x - bot.x)**2 + (z.y - bot.y)**2);
            if (d < minZombieDist) { minZombieDist = d; nearestZombie = z; }
        }
        let moveTarget = null;
        let shootTarget = null;
        if (nearestEnemy && !hasWallBetween(bot.x, bot.y, nearestEnemy.x, nearestEnemy.y)) shootTarget = nearestEnemy;
        else if (nearestZombie && !hasWallBetween(bot.x, bot.y, nearestZombie.x, nearestZombie.y)) shootTarget = nearestZombie;

        if (bot.x < EDGE_MARGIN) moveTarget = { x: bot.x + 200, y: bot.y };
        else if (bot.x > MAP_WIDTH - EDGE_MARGIN) moveTarget = { x: bot.x - 200, y: bot.y };
        else if (bot.y < EDGE_MARGIN) moveTarget = { x: bot.x, y: bot.y + 200 };
        else if (bot.y > MAP_HEIGHT - EDGE_MARGIN) moveTarget = { x: bot.x, y: bot.y - 200 };
        
        if (!moveTarget) {
            if (minZombieDist < 120) {
                 let angle = Math.atan2(bot.y - nearestZombie.y, bot.x - nearestZombie.x);
                 moveTarget = { x: bot.x + Math.cos(angle) * 150, y: bot.y + Math.sin(angle) * 150 };
            } else if (nearestEnemy) {
                const stronger = bot.level >= nearestEnemy.level;
                const healthy = bot.hp > bot.maxHp * 0.6;
                if (stronger && healthy) {
                    if (nearestLoot && minLootDist < 250) moveTarget = nearestLoot;
                    else moveTarget = nearestEnemy; 
                } else {
                    if (minEnemyDist < 300) {
                        let angle = Math.atan2(bot.y - nearestEnemy.y, bot.x - nearestEnemy.x);
                        moveTarget = { x: bot.x + Math.cos(angle) * 150, y: bot.y + Math.sin(angle) * 150 };
                    } else if (nearestLoot) moveTarget = nearestLoot;
                }
            } else if (nearestLoot) moveTarget = nearestLoot;
            else {
                 if (Math.random() < 0.02) {
                     bot.targetX = 200 + Math.random() * (MAP_WIDTH - 400);
                     bot.targetY = 200 + Math.random() * (MAP_HEIGHT - 400);
                 }
                 moveTarget = { x: bot.targetX, y: bot.targetY };
            }
        }
        if (moveTarget) {
            const inputs = { left: false, right: false, up: false, down: false };
            if (moveTarget.x < bot.x - 20) inputs.left = true;
            if (moveTarget.x > bot.x + 20) inputs.right = true;
            if (moveTarget.y < bot.y - 20) inputs.up = true;
            if (moveTarget.y > bot.y + 20) inputs.down = true;
            handleMovement(id, inputs);
        }

        // ИСПРАВЛЕНИЕ: Добавили проверку gameState === 'running'
        if (shootTarget && Math.random() < 0.15 && gameState === 'running') { 
            if (!hasWallBetween(bot.x, bot.y, shootTarget.x, shootTarget.y)) {
                const aimErrorX = (Math.random() - 0.5) * 40;
                const aimErrorY = (Math.random() - 0.5) * 40;
                handleShooting(id, { x: shootTarget.x + aimErrorX, y: shootTarget.y + aimErrorY });
            }
        }
    }
}

// --- СПАВНЕРЫ ---
setInterval(() => {
    if (gameState !== 'running') return;
    if (Object.keys(zombies).length < 60) {
        let zx, zy, attempts = 0;
        do {
            zx = Math.random() * MAP_WIDTH; zy = Math.random() * MAP_HEIGHT;
            attempts++;
            let hit = false;
            for(let b of buildings) { if(checkCircleRect(zx, zy, 20, b)) { hit=true; break; } }
            if(!hit) break;
        } while(attempts < 10);
        zombieIdCounter++;
        zombies[zombieIdCounter] = { x: zx, y: zy, hp: ZOMBIE_HP, maxHp: ZOMBIE_HP, speed: 1.5 + Math.random(), radius: 15 };
    }
}, 1000);

setInterval(() => {
    if (gameState !== 'running') return;
    let centerX, centerY, attempts = 0;
    do {
        centerX = Math.random() * MAP_WIDTH; centerY = Math.random() * MAP_HEIGHT;
        attempts++;
        let hitBuilding = false;
        for(let b of buildings) { if(checkCircleRect(centerX, centerY, 150, b)) { hitBuilding=true; break; } }
        if (hitBuilding) continue;
        let hitPlayer = false;
        for(let id in players) {
            let p = players[id];
            if (!p.dead) {
                let d = Math.sqrt((centerX - p.x)**2 + (centerY - p.y)**2);
                if (d < 400) { hitPlayer = true; break; } 
            }
        }
        if (!hitPlayer) break;
    } while(attempts < 20);
    const hordeSize = 5 + Math.floor(Math.random() * 8); 
    for(let i=0; i<hordeSize; i++) {
        zombieIdCounter++;
        zombies[zombieIdCounter] = { x: centerX + (Math.random() - 0.5) * 200, y: centerY + (Math.random() - 0.5) * 200, hp: ZOMBIE_HP, maxHp: ZOMBIE_HP, speed: 2 + Math.random(), radius: 15 };
    }
}, 10000);

setInterval(() => {
    if (gameState !== 'running') return;
    if (Object.keys(loot).length < 60) {
        dropLoot(Math.random() * MAP_WIDTH, Math.random() * MAP_HEIGHT, 15, 1);
    }
}, 5000);

// --- ГЛАВНЫЙ ЦИКЛ ---
setInterval(() => {
    let timeLeftToSend = 0;
    if (gameState === 'waiting') {
        io.sockets.emit('state', { players, zombies, bullets, loot, timeLeft: 0, isOver: false, status: 'WAITING' });
        return;
    } 
    if (gameState === 'warmup') {
        timeLeftToSend = roundEndTime - Date.now();
        updateBots();
        io.sockets.emit('state', { players, zombies, bullets, loot, timeLeft: timeLeftToSend, isOver: false, status: 'WARMUP' });
        if (timeLeftToSend <= 0) startGame();
        return;
    }
    if (gameState === 'ended') {
        io.sockets.emit('state', { players, zombies, bullets, loot, timeLeft: 0, isOver: true, status: 'ENDED' });
        return;
    }

    // RUNNING
    timeLeftToSend = roundEndTime - Date.now();
    if (timeLeftToSend <= 0) {
        let winnerName = "Никто"; let maxScore = -1;
        for (let id in players) {
            if (!players[id].dead && players[id].score > maxScore) {
                maxScore = players[id].score;
                winnerName = players[id].isBot ? players[id].nickname : players[id].nickname; 
            }
        }
        endRound(winnerName);
        return;
    }

    checkGameOver();
    updateBots();

    for (let zId in zombies) {
        let z = zombies[zId];
        let nearestPlayer = null; let minDist = 999999;
        for (let pId in players) {
            let p = players[pId];
            if (p.dead) continue; 
            let dist = Math.sqrt((p.x - z.x)**2 + (p.y - z.y)**2);
            if (dist < 30) { 
                p.hp -= ZOMBIE_DAMAGE;
                p.level = Math.ceil(p.hp / HP_PER_LEVEL);
                if (p.hp <= 0) {
                    p.dead = true; 
                    let dropVal = p.score;
                    if(p.isBot) dropVal = Math.max(p.score, p.level * 100);
                    dropLoot(p.x, p.y, dropVal, 3);
                    if (p.isBot) delete players[pId];
                }
            }
            if (dist < 600 && dist < minDist) { minDist = dist; nearestPlayer = p; }
        }
        if (nearestPlayer) {
            let dx = nearestPlayer.x - z.x; let dy = nearestPlayer.y - z.y;
            let dist = Math.sqrt(dx*dx + dy*dy);
            let nextZX = z.x + (dx / dist) * z.speed; let nextZY = z.y + (dy / dist) * z.speed;
            let hitWall = false;
            for(let b of buildings) { if(checkCircleRect(nextZX, nextZY, 15, b)) { hitWall = true; break; } }
            if(hitWall) {
                let hitX = false;
                for(let b of buildings) { if(checkCircleRect(nextZX, z.y, 15, b)) { hitX = true; break; } }
                if(!hitX) { z.x = nextZX; } 
                else {
                    let hitY = false;
                    for(let b of buildings) { if(checkCircleRect(z.x, nextZY, 15, b)) { hitY = true; break; } }
                    if (!hitY) { z.y = nextZY; }
                }
            } else { z.x = nextZX; z.y = nextZY; }
        }
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.x += Math.cos(b.angle) * b.speed; b.y += Math.sin(b.angle) * b.speed; b.traveled += b.speed;
        if (b.traveled > b.range || b.x < 0 || b.x > MAP_WIDTH || b.y < 0 || b.y > MAP_HEIGHT) { bullets.splice(i, 1); continue; }
        let hitWall = false;
        for (let w of buildings) { if (b.x > w.x && b.x < w.x + w.w && b.y > w.y && b.y < w.y + w.h) { hitWall = true; break; } }
        if (hitWall) { if (b.type === 'rocket') createExplosion(b.x, b.y, b.damage, b.ownerId); bullets.splice(i, 1); continue; }

        let hit = false;
        for (let zId in zombies) {
            let z = zombies[zId];
            let dist = Math.sqrt((b.x - z.x)**2 + (b.y - z.y)**2);
            if (dist < z.radius) {
                if (b.type === 'rocket') { createExplosion(b.x, b.y, b.damage, b.ownerId); } 
                else { z.hp -= b.damage; if (z.hp <= 0) { dropLoot(z.x, z.y, 40, 1); delete zombies[zId]; } }
                hit = true; break;
            }
        }
        if (!hit) {
            for (let pId in players) {
                if (pId === b.ownerId) continue; 
                let p = players[pId];
                if (p.dead) continue; 
                let squadRadius = 20 + (Math.ceil(p.hp/100) * 2.5); 
                let dist = Math.sqrt((b.x - p.x)**2 + (b.y - p.y)**2);
                if (dist < squadRadius) {
                    if (b.type === 'rocket') { createExplosion(b.x, b.y, b.damage, b.ownerId); } 
                    else {
                        p.hp -= b.damage; 
                        p.level = Math.ceil(p.hp / HP_PER_LEVEL);
                        
                        if (p.hp <= 0) {
                            p.dead = true; 
                            
                            // <--- НОВАЯ ЛОГИКА ДРОПА
                            let dropVal = p.score;
                            if(p.isBot) {
                                dropVal = Math.max(p.score, p.maxLevel * 75);
                            }
                            
                            dropLoot(p.x, p.y, dropVal, 5);
                            if (p.isBot) delete players[pId];
                        }
                    }
                    hit = true; break;
                }
            }
        }
        if (hit) bullets.splice(i, 1);
    }

    for (let lId in loot) {
        let item = loot[lId];
        for (let pId in players) {
            let p = players[pId];
            if (p.dead) continue;
            let dist = Math.sqrt((p.x - item.x)**2 + (p.y - item.y)**2);
            if (dist < 30 + item.radius) { gainXp(p, item.value); delete loot[lId]; break; }
        }
    }

    io.sockets.emit('state', { players, zombies, bullets, loot, timeLeft: timeLeftToSend, isOver: false, status: 'RUNNING' });
}, 1000 / 60);

const PORT = 3000;
server.listen(PORT, () => { console.log(`Zombie Hanter Server running on http://localhost:${PORT}`); });