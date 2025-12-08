// map.js - Статичная карта города
const buildings = [];

// Формат: { x: координата, y: координата, w: ширина, h: высота }

// --- 1. ЛЕВЫЙ ВЕРХНИЙ РАЙОН ---
buildings.push({ x: 200, y: 200, w: 600, h: 200 }); // Длинный дом
buildings.push({ x: 200, y: 500, w: 250, h: 250 }); 
buildings.push({ x: 550, y: 500, w: 250, h: 250 });

// --- 2. ПРАВЫЙ ВЕРХНИЙ РАЙОН ---
buildings.push({ x: 1200, y: 200, w: 200, h: 550 }); // Небоскреб
buildings.push({ x: 1500, y: 200, w: 300, h: 250 });
buildings.push({ x: 1500, y: 550, w: 300, h: 200 });

// --- 3. ЛЕВЫЙ НИЖНИЙ РАЙОН ---
buildings.push({ x: 200, y: 1000, w: 250, h: 600 });
buildings.push({ x: 550, y: 1000, w: 250, h: 250 });
buildings.push({ x: 550, y: 1350, w: 250, h: 250 });

// --- 4. ПРАВЫЙ НИЖНИЙ РАЙОН ---
buildings.push({ x: 1200, y: 1000, w: 600, h: 200 });
buildings.push({ x: 1200, y: 1300, w: 250, h: 300 });
buildings.push({ x: 1550, y: 1300, w: 250, h: 300 });



// Экспортируем массив, чтобы server.js мог его прочитать
module.exports = buildings;