const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const socket = io();

const MAP_WIDTH = 2000;
const MAP_HEIGHT = 2000;

const sprites = {
    player: new Image(),
    zombie: new Image(),
    asphalt: new Image(),
    roof: new Image(),
    loot: new Image()
};

sprites.player.src = 'assets/player.png';
sprites.zombie.src = 'assets/zombie.png';
sprites.asphalt.src = 'assets/asphalt.png';
sprites.roof.src = 'assets/roof.png';

let buildings = [];
socket.on('map_data', (data) => {
    buildings = data;
});

let explosions = [];
socket.on('explosion', (pos) => {
    explosions.push({x: pos.x, y: pos.y, frame: 0});
});

// --- UI ЭЛЕМЕНТЫ ---
const loginScreen = document.getElementById('loginScreen');
const nicknameInput = document.getElementById('nicknameInput');
const playBtn = document.getElementById('playBtn');
const restartBtn = document.getElementById('restartBtn');

playBtn.addEventListener('click', () => {
    const name = nicknameInput.value.trim() || "Player";
    socket.emit('join_game', name);
    loginScreen.style.display = 'none'; 
});

restartBtn.addEventListener('click', () => {
    socket.emit('force_restart');
    restartBtn.style.display = 'none';
});

socket.on('game_restarted', () => {
    loginScreen.style.display = 'flex';
    restartBtn.style.display = 'none';
});

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

const movement = { up: false, down: false, left: false, right: false };
document.addEventListener('keydown', (e) => {
    if(e.code === 'KeyA') movement.left = true;
    if(e.code === 'KeyW') movement.up = true;
    if(e.code === 'KeyD') movement.right = true;
    if(e.code === 'KeyS') movement.down = true;
});
document.addEventListener('keyup', (e) => {
    if(e.code === 'KeyA') movement.left = false;
    if(e.code === 'KeyW') movement.up = false;
    if(e.code === 'KeyD') movement.right = false;
    if(e.code === 'KeyS') movement.down = false;
});
setInterval(() => { socket.emit('movement', movement); }, 1000 / 60);

let myPlayer = null; 
let camX = 0, camY = 0;
let mouseScreenX = 0, mouseScreenY = 0;

canvas.addEventListener('mousemove', (e) => {
    mouseScreenX = e.clientX;
    mouseScreenY = e.clientY;
});
canvas.addEventListener('mousedown', (e) => {
    socket.emit('shoot', { x: e.clientX + camX, y: e.clientY + camY });
});

function drawSprite(img, x, y, size, rotation) {
    if (!img.complete || img.naturalWidth === 0) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(rotation);
        ctx.fillStyle = '#FF00FF'; ctx.fillRect(-size/2, -size/2, size, size);
        ctx.restore(); return;
    }
    ctx.save(); ctx.translate(x, y); ctx.rotate(rotation);
    ctx.drawImage(img, -size/2, -size/2, size, size);
    ctx.restore();
}
function drawHealthBar(x, y, hp, maxHp, width, color) {
    if (hp >= maxHp) return;
    ctx.fillStyle = 'black'; ctx.fillRect(x - width/2, y - 35, width, 5);
    ctx.fillStyle = color;
    const hpWidth = Math.max(0, (hp / maxHp) * width);
    ctx.fillRect(x - width/2, y - 35, hpWidth, 5);
}
function drawSquad(player, isMe) {
    const count = Math.ceil(player.hp / 100);
    let rotation = 0;
    if (isMe) rotation = Math.atan2(mouseScreenY - (player.y - camY), mouseScreenX - (player.x - camX));
    for (let i = 0; i < count; i++) {
        let offsetX = 0, offsetY = 0;
        if (i > 0) {
            const radius = 18 + (i * 2); const angle = i * 1.5; 
            offsetX = Math.cos(angle) * radius; offsetY = Math.sin(angle) * radius;
        }
        drawSprite(sprites.player, player.x + offsetX, player.y + offsetY, 32, rotation);
    }
}
function drawLeaderboard(players) {
    const sortedPlayers = Object.values(players).sort((a, b) => b.score - a.score);
    const boxWidth = 200; const boxX = canvas.width - boxWidth - 10; const boxY = 10;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(boxX, boxY, boxWidth, 30 + (sortedPlayers.length * 25));
    ctx.fillStyle = 'white'; ctx.textAlign = 'center'; ctx.font = 'bold 16px Arial';
    ctx.fillText(`ИГРОКИ (${sortedPlayers.length})`, boxX + boxWidth / 2, boxY + 20);
    ctx.textAlign = 'left'; ctx.font = '14px Arial';
    sortedPlayers.forEach((p, index) => {
        const y = boxY + 45 + (index * 25);
        let name = "";
        if (p.isBot) {
            name = `[BOT] ${p.nickname}`;
            ctx.fillStyle = '#AAAAAA'; 
        } else {
            if (players[socket.id] && p.id === socket.id) { name = `ВЫ (${p.level})`; ctx.fillStyle = '#FFFF00'; } 
            else { name = `${p.nickname} (${p.level})`; ctx.fillStyle = 'white'; }
            if (p.dead) { name += " (RIP)"; ctx.fillStyle = '#FF4444'; }
        }
        ctx.fillText(`${index + 1}. ${name}`, boxX + 10, y);
        ctx.textAlign = 'right'; ctx.fillText(Math.floor(p.score), boxX + boxWidth - 10, y);
        ctx.textAlign = 'left';
    });
}
function formatTime(ms) {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

socket.on('state', (state) => {
    const { players, zombies, bullets, loot, timeLeft, isOver, status } = state;

    myPlayer = players[socket.id] || null;
    
    if (myPlayer && !myPlayer.dead) {
        camX = myPlayer.x - canvas.width / 2;
        camY = myPlayer.y - canvas.height / 2;
        if (camX < 0) camX = 0; if (camY < 0) camY = 0;
        if (camX > MAP_WIDTH - canvas.width) camX = MAP_WIDTH - canvas.width;
        if (camY > MAP_HEIGHT - canvas.height) camY = MAP_HEIGHT - canvas.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(-camX, -camY);

    if (sprites.asphalt.complete && sprites.asphalt.naturalWidth > 0) {
        const pattern = ctx.createPattern(sprites.asphalt, 'repeat');
        ctx.fillStyle = pattern; ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    } else { ctx.fillStyle = '#333'; ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT); }

    let roofPat = null;
    if (sprites.roof.complete && sprites.roof.naturalWidth > 0) roofPat = ctx.createPattern(sprites.roof, 'repeat');
    for (let b of buildings) {
        if (roofPat) ctx.fillStyle = roofPat; else ctx.fillStyle = '#111';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeRect(b.x, b.y, b.w, b.h);
    }

    for (let id in loot) {
        const item = loot[id];
        ctx.fillStyle = '#00FFFF'; ctx.beginPath(); ctx.arc(item.x, item.y, 8, 0, Math.PI*2); ctx.fill();
        ctx.shadowBlur = 10; ctx.shadowColor = '#00FFFF'; ctx.fill(); ctx.shadowBlur = 0;
    }

    for (let id in players) {
        const p = players[id];
        if (p.dead) continue; 
        if (id === socket.id) {
            ctx.save(); ctx.beginPath(); ctx.arc(p.x, p.y, 40, 0, Math.PI*2); 
            ctx.strokeStyle = '#FFFF00'; ctx.lineWidth = 3; ctx.setLineDash([10, 5]); ctx.stroke(); ctx.restore();
        }
        drawSquad(p, id === socket.id);
        ctx.fillStyle = 'white'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center';
        ctx.fillText(`Lvl ${p.level}`, p.x, p.y - 45); 
        drawHealthBar(p.x, p.y - 30, p.hp, p.level * 100, 50, '#00ff00');
    }

    for (let id in zombies) {
        const z = zombies[id];
        drawSprite(sprites.zombie, z.x, z.y, 40, 0); 
        drawHealthBar(z.x, z.y - 25, z.hp, z.maxHp, 30, 'red');
    }

    for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i];
        ctx.fillStyle = b.color || 'yellow';
        if (b.type === 'rocket') {
            ctx.beginPath(); ctx.arc(b.x, b.y, 8, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = 'rgba(255,100,0,0.5)';
            ctx.beginPath(); ctx.arc(b.x - Math.cos(b.angle)*5, b.y - Math.sin(b.angle)*5, 5, 0, Math.PI*2); ctx.fill();
        } else { ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill(); }
    }

    for (let i = explosions.length - 1; i >= 0; i--) {
        let ex = explosions[i]; ex.frame++;
        ctx.fillStyle = `rgba(255, 100, 0, ${1 - ex.frame/20})`; 
        ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.frame * 5, 0, Math.PI*2); ctx.fill();
        if (ex.frame > 20) explosions.splice(i, 1);
    }
    ctx.strokeStyle = 'red'; ctx.lineWidth = 10; ctx.strokeRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    ctx.restore();

    // UI
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'; ctx.fillRect(10, 10, 220, 100); 
    ctx.fillStyle = 'white'; ctx.textAlign = 'left'; ctx.font = '16px Arial';
    
    if (myPlayer && !myPlayer.dead) {
        ctx.fillText(`Уровень: ${myPlayer.level}`, 20, 35);
        ctx.fillText(`Бойцов: ${Math.ceil(myPlayer.hp / 100)} / ${myPlayer.level}`, 20, 60);
        ctx.fillText(`HP: ${Math.floor(myPlayer.hp)} / ${myPlayer.level * 100}`, 20, 85);
    } else {
         ctx.fillStyle = 'red'; ctx.fillText(`ЗРИТЕЛЬ / МЕРТВ`, 20, 50);
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'; ctx.fillRect(canvas.width / 2 - 100, 10, 200, 40);
    ctx.fillStyle = 'white'; ctx.textAlign = 'center'; ctx.font = 'bold 24px Arial';
    if (status === 'WAITING') ctx.fillText("ОЖИДАНИЕ...", canvas.width / 2, 38);
    else if (status === 'WARMUP') ctx.fillText("РАЗМИНКА: " + formatTime(timeLeft), canvas.width / 2, 38);
    else ctx.fillText(formatTime(timeLeft), canvas.width / 2, 38);

    drawLeaderboard(players);

    if (myPlayer && myPlayer.dead && !isOver) {
        restartBtn.style.display = 'block'; 
        ctx.fillStyle = 'rgba(50, 0, 0, 0.4)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'red'; ctx.textAlign = 'center'; ctx.font = 'bold 50px Arial';
        ctx.fillText("ВЫ ПОГИБЛИ", canvas.width / 2, canvas.height / 2 - 50);
    } else {
        restartBtn.style.display = 'none';
    }

    if (isOver) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white'; ctx.textAlign = 'center'; ctx.font = 'bold 60px Arial';
        ctx.fillText("РАУНД ЗАВЕРШЕН", canvas.width / 2, canvas.height / 2);
    }
});