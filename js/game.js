// ============================================================
//  game.js — 游戏核心逻辑 (Ultimate Edition)
// ============================================================

import {
  $, THEMES, COLS, ROWS, DIFF, FOOD_TYPES, POWERUP_TYPES, ACHIEVEMENTS,
  state, canvasToScreen, getBest, saveBest, showBest
} from './config.js';
import { playEat, playBonusEat, playGold, playPowerup, playDie, playCombo, playAchieve, updateBGM } from './audio.js';
import { spawnP, spawnText, spawnRipple, spawnSparks, spawnTrail } from './particles.js';
import { draw, updateHUD, resetRendererState, notifyFoodEaten, triggerScorePop } from './renderer.js';

// ===== 额外成就 =====
export const EXTRA_ACHIEVEMENTS = [
  { id: 'speed_demon',   icon: '\u{1F47F}', name: '速度恶魔', desc: '在极速模式存活 120 秒' },
  { id: 'pacifist',      icon: '\u{1F54A}\uFE0F', name: '和平主义', desc: '禅模式得分 500+' },
  { id: 'survivor',      icon: '\u{1F3D5}\uFE0F', name: '幸存者', desc: '生存模式存活 180 秒' },
  { id: 'boss_killer',   icon: '\u{1F409}', name: '屠龙者', desc: '击败 Boss 食物' },
  { id: 'evolution_max', icon: '\u{1F31F}', name: '究极进化', desc: '蛇长度达到 50' },
  { id: 'daily_done',    icon: '\u{1F4C5}', name: '每日打卡', desc: '完成一次每日挑战' },
  { id: 'ghost_beater',  icon: '\u{1F47B}', name: '超越自我', desc: '击败自己的幽灵记录' },
];

const ALL_ACHIEVEMENTS = [...ACHIEVEMENTS, ...EXTRA_ACHIEVEMENTS];

// ===== 成就 =====
function getUnlocked() {
  return JSON.parse(localStorage.getItem('snake_ach') || '[]');
}

export function unlockAch(id) {
  const list = getUnlocked();
  if (list.includes(id)) return;
  list.push(id);
  localStorage.setItem('snake_ach', JSON.stringify(list));
  const a = ALL_ACHIEVEMENTS.find(a => a.id === id);
  if (!a) return;
  playAchieve();
  const popup = $('#achievement-popup');
  if (!popup) return;
  popup.querySelector('.ach-icon').textContent = a.icon;
  popup.querySelector('.ach-title').textContent = a.name;
  popup.querySelector('.ach-desc').textContent = a.desc;
  popup.style.display = 'block';
  setTimeout(() => popup.style.display = 'none', 3000);
}

export function renderAchPanel() {
  const unlocked = getUnlocked();
  const list = $('#ach-list');
  if (!list) return;
  list.innerHTML = '';
  for (const a of ALL_ACHIEVEMENTS) {
    const done = unlocked.includes(a.id);
    list.innerHTML += `<div class="ach-item ${done ? '' : 'locked'}"><div class="ach-i">${done ? a.icon : '\u{1F512}'}</div><div class="ach-info"><div class="ach-name">${a.name}</div><div class="ach-d">${a.desc}</div></div></div>`;
  }
}

// ===== 带种子的伪随机数生成器 =====
function seededRNG(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  return function() {
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  };
}

// ===== DFS 迷宫生成 =====
function generateDFSMaze(rng) {
  const random = rng || Math.random.bind(Math);
  // Cell grid: each cell is 2x2 in the game grid, with walls between
  const cellCols = Math.floor((COLS - 1) / 2);
  const cellRows = Math.floor((ROWS - 1) / 2);
  const visited = Array.from({ length: cellCols }, () => Array(cellRows).fill(false));
  const wallSet = new Set();
  const add = (x, y) => {
    if (x >= 0 && x < COLS && y >= 0 && y < ROWS) wallSet.add(x * ROWS + y);
  };

  // Start with all walls
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      add(x, y);
    }
  }

  // Remove walls via DFS
  const remove = (x, y) => wallSet.delete(x * ROWS + y);
  const cellToGrid = (cx, cy) => ({ x: cx * 2 + 1, y: cy * 2 + 1 });

  const stack = [];
  const startCX = 0, startCY = 0;
  visited[startCX][startCY] = true;
  const sg = cellToGrid(startCX, startCY);
  remove(sg.x, sg.y);
  stack.push({ cx: startCX, cy: startCY });

  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  while (stack.length > 0) {
    const cur = stack[stack.length - 1];
    const neighbors = [];
    for (const [ddx, ddy] of dirs) {
      const nx = cur.cx + ddx, ny = cur.cy + ddy;
      if (nx >= 0 && nx < cellCols && ny >= 0 && ny < cellRows && !visited[nx][ny]) {
        neighbors.push({ cx: nx, cy: ny, dx: ddx, dy: ddy });
      }
    }
    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }
    const next = neighbors[Math.floor(random() * neighbors.length)];
    visited[next.cx][next.cy] = true;
    // Remove wall between cur and next
    const curG = cellToGrid(cur.cx, cur.cy);
    const nextG = cellToGrid(next.cx, next.cy);
    remove(nextG.x, nextG.y);
    remove(curG.x + next.dx, curG.y + next.dy);
    stack.push({ cx: next.cx, cy: next.cy });
  }

  // Clear area around center for snake spawn
  const cx = Math.floor(COLS / 2), cy = Math.floor(ROWS / 2);
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      wallSet.delete((cx + dx) * ROWS + (cy + dy));
    }
  }

  return wallSet;
}

// ===== 传统迷宫（保留） =====
function generatePatternMaze() {
  const wallSet = new Set();
  const add = (x, y) => wallSet.add(x * ROWS + y);
  const patterns = [
    () => { for (let i = 6; i < 14; i++) { add(10, i); add(i, 10); }},
    () => { for (let i = 3; i < 7; i++) for (let j = 3; j < 7; j++) { add(i, j); add(COLS-1-i, j); add(i, ROWS-1-j); add(COLS-1-i, ROWS-1-j); }},
    () => { for (let i = 4; i < 16; i++) { add(i, 5); add(i, 14); add(5, i); add(14, i); }},
    () => { for (let i = 0; i < 30; i++) { const x = 2 + Math.floor(Math.random()*(COLS-4)); const y = 2 + Math.floor(Math.random()*(ROWS-4)); if (Math.abs(x-10) > 2 || Math.abs(y-10) > 2) add(x, y); }},
  ];
  patterns[Math.floor(Math.random() * patterns.length)]();
  return wallSet;
}

function generateMaze(rng) {
  // 20% chance DFS maze, 80% pattern maze (unless rng given, then always DFS)
  if (rng || Math.random() < 0.2) {
    return generateDFSMaze(rng);
  }
  return generatePatternMaze();
}

function isWall(x, y) {
  return state.mazeWalls && state.mazeWalls.has(x * ROWS + y);
}

// ===== 食物 =====
function pickFoodType(rng) {
  const random = rng || Math.random.bind(Math);
  const total = FOOD_TYPES.reduce((s, f) => s + f.weight, 0);
  let r = random() * total;
  for (const f of FOOD_TYPES) { r -= f.weight; if (r <= 0) return f; }
  return FOOD_TYPES[0];
}

function placeFood(rng) {
  clearTimeout(state.foodTimer);
  // Daily challenge uses predetermined food sequence
  if (state.dailyFoodSequence && state.dailyFoodIndex < state.dailyFoodSequence.length) {
    const df = state.dailyFoodSequence[state.dailyFoodIndex++];
    state.foodType = df.type;
    state.food = df.pos;
    state.foodPulse = 0;
    return;
  }
  state.foodType = pickFoodType(rng);
  let pos, attempts = 0;
  const random = rng || Math.random.bind(Math);
  do {
    pos = { x: Math.floor(random() * COLS), y: Math.floor(random() * ROWS) };
    attempts++;
  } while ((state.snake.some(s => s.x === pos.x && s.y === pos.y) || isWall(pos.x, pos.y) || isOutOfBounds(pos.x, pos.y)) && attempts < 500);
  state.food = pos;
  state.foodPulse = 0;
  if (state.foodType.type === 'gold') {
    state.foodTimer = setTimeout(() => { if (!state.gameOver) placeFood(); }, state.foodType.duration);
  }
}

// ===== Boss 食物 =====
function placeBossFood() {
  let pos, attempts = 0;
  do {
    pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    attempts++;
  } while ((state.snake.some(s => s.x === pos.x && s.y === pos.y) || isWall(pos.x, pos.y) || isOutOfBounds(pos.x, pos.y) || (state.food && pos.x === state.food.x && pos.y === state.food.y)) && attempts < 500);
  state.bossFood = { x: pos.x, y: pos.y, hitsLeft: 3, maxHits: 3 };
}

// ===== 道具 =====
function placePowerup() {
  if (state.powerup || Math.random() > 0.15) return;
  const pw = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
  let pos, attempts = 0;
  do {
    pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    attempts++;
  } while ((state.snake.some(s => s.x === pos.x && s.y === pos.y) || isWall(pos.x, pos.y) || isOutOfBounds(pos.x, pos.y) || (state.food && pos.x === state.food.x && pos.y === state.food.y)) && attempts < 500);
  state.powerup = { ...pw, ...pos };
  setTimeout(() => { if (state.powerup && state.powerup.x === pos.x && state.powerup.y === pos.y) state.powerup = null; }, 10000);
}

function activatePowerup(pw) {
  state.totalPowerupsCollected++;
  if (state.totalPowerupsCollected >= 5) unlockAch('powerup_5');
  playPowerup();
  const sp = canvasToScreen(pw.x, pw.y);
  spawnP(sp.x, sp.y, pw.color, 20, [3, 6]);
  spawnText(sp.x, sp.y - 20, pw.desc, pw.color);

  if (pw.type === 'shrink_pw') {
    const removeCount = Math.min(5, state.snake.length - 1);
    for (let i = 0; i < removeCount; i++) state.snake.pop();
    return;
  }

  if (state.activePowerups[pw.type]) clearTimeout(state.powerupTimers[pw.type]);
  state.activePowerups[pw.type] = true;
  state.powerupTimers[pw.type] = setTimeout(() => { state.activePowerups[pw.type] = false; }, pw.duration);

  if (pw.type === 'slow') {
    state.speed = Math.min(state.speed + 40, 200);
    clearInterval(state.timer);
    state.timer = setInterval(update, state.speed);
  }
}

// ===== Combo =====
function getComboMultiplier() {
  if (state.combo < 2) return 1;
  if (state.combo < 5) return 1.5;
  if (state.combo < 10) return 2;
  return 3;
}

function addCombo() {
  const now = Date.now();
  if (now - state.lastEatTime < 2500) {
    state.combo++;
    playCombo();
    if (state.combo >= 3) unlockAch('combo_3');
    if (state.combo >= 5) unlockAch('combo_5');
    if (state.combo >= 10) unlockAch('combo_10');
  } else {
    state.combo = 1;
  }
  state.lastEatTime = now;
  clearTimeout(state.comboTimer);
  state.comboTimer = setTimeout(() => { state.combo = 0; updateHUD(); }, 2500);
}

// ===== 边界检查（生存模式缩圈） =====
function isOutOfBounds(x, y) {
  if (state.shrinkBounds) {
    return x < state.shrinkBounds.left || x >= state.shrinkBounds.right ||
           y < state.shrinkBounds.top || y >= state.shrinkBounds.bottom;
  }
  return false;
}

// ===== 生存模式缩圈 =====
function startShrinkTimer() {
  if (state.shrinkInterval) clearInterval(state.shrinkInterval);
  state.shrinkInterval = setInterval(() => {
    if (state.paused || state.gameOver || !state.running) return;
    const b = state.shrinkBounds;
    const width = b.right - b.left;
    const height = b.bottom - b.top;
    if (width <= 4 || height <= 4) return; // Stop shrinking at 4x4

    // Set warning line positions before shrinking
    state.shrinkWarning = {
      top: b.top + 1, left: b.left + 1,
      bottom: b.bottom - 1, right: b.right - 1,
      time: Date.now()
    };

    // Shrink after a brief warning
    setTimeout(() => {
      if (state.gameOver) return;
      b.top += 1;
      b.left += 1;
      b.bottom -= 1;
      b.right -= 1;
      state.shrinkWarning = null;

      // Kill snake if now outside bounds
      const head = state.snake[0];
      if (head && isOutOfBounds(head.x, head.y)) {
        triggerDeath();
      }
    }, 2000);
  }, 30000);
}

// ===== 禅模式计时器 =====
function startZenTimer() {
  state.zenTimeLeft = 120;
  state.zenTimer = setInterval(() => {
    if (state.paused || state.gameOver || !state.running) return;
    state.zenTimeLeft--;
    if (state.zenTimeLeft <= 0) {
      clearInterval(state.zenTimer);
      // Zen mode ends: calculate final score
      state.gameOver = true;
      state.running = false;
      clearInterval(state.timer);
      clearTimeout(state.foodTimer);
      saveBest(state.score);
      showBest();
      saveGhost();
      updateStats();
      if (state.score >= 500) unlockAch('pacifist');
      const msgEl = $('#msg');
      if (msgEl) msgEl.textContent = '\u7985\u6A21\u5F0F\u7ED3\u675F\uFF01R \u91CD\u65B0\u5F00\u59CB \u00B7 ESC \u8FD4\u56DE\u83DC\u5355';
    }
  }, 1000);
}

// ===== 蛇进化系统 =====
function updateEvolution() {
  const len = state.snake.length;
  if (len >= 50) {
    state.snakeEvolution = 3;
    unlockAch('evolution_max');
  } else if (len >= 30) {
    state.snakeEvolution = 2;
  } else if (len >= 15) {
    state.snakeEvolution = 1;
  } else {
    state.snakeEvolution = 0;
  }
}

// ===== 幽灵回放 =====
function saveGhost() {
  if (!state.moveHistory || state.moveHistory.length === 0) return;
  const mode = state.selectedMode;
  const bestScore = getBest(mode);
  if (state.score >= bestScore) {
    try {
      localStorage.setItem(`snake_ghost_${mode}`, JSON.stringify(state.moveHistory));
    } catch (e) {
      // localStorage full, ignore
    }
  }
}

function loadGhost() {
  const mode = state.selectedMode;
  try {
    const data = localStorage.getItem(`snake_ghost_${mode}`);
    if (data) {
      state.ghostMoves = JSON.parse(data);
      state.ghostIndex = 0;
      state.ghostSnake = [{ x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) }];
      state.ghostDir = { x: 0, y: 0 };
    }
  } catch (e) {
    state.ghostMoves = null;
  }
}

function updateGhost() {
  if (!state.ghostMoves || !state.ghostSnake) return;
  if (state.ghostIndex >= state.ghostMoves.length) {
    state.ghostSnake = null; // Ghost finished
    return;
  }
  const move = state.ghostMoves[state.ghostIndex];
  if (!move) return;
  state.ghostDir = move.dir;
  if (move.dir.x === 0 && move.dir.y === 0) {
    state.ghostIndex++;
    return;
  }
  const head = {
    x: state.ghostSnake[0].x + move.dir.x,
    y: state.ghostSnake[0].y + move.dir.y
  };
  // Wrap for nowalls/speed
  if (state.selectedMode === 'nowalls' || state.selectedMode === 'speed') {
    head.x = (head.x + COLS) % COLS;
    head.y = (head.y + ROWS) % ROWS;
  }
  state.ghostSnake.unshift(head);
  if (move.ate) {
    // Ghost "ate" food, keep the tail
  } else {
    state.ghostSnake.pop();
  }
  state.ghostIndex++;
}

// ===== 统计系统 =====
function loadStats() {
  try {
    return JSON.parse(localStorage.getItem('snake_stats') || '{}');
  } catch (e) {
    return {};
  }
}

function saveStats(stats) {
  try {
    localStorage.setItem('snake_stats', JSON.stringify(stats));
  } catch (e) {
    // ignore
  }
}

function updateStats() {
  const stats = loadStats();
  stats.totalGames = (stats.totalGames || 0) + 1;
  stats.totalFoodEaten = (stats.totalFoodEaten || 0) + (state.foodEatenThisGame || 0);
  stats.longestSnake = Math.max(stats.longestSnake || 0, state.snake.length);
  const elapsed = state.running || state.gameOver ? Math.floor((Date.now() - state.startTime) / 1000) : 0;
  stats.totalPlayTime = (stats.totalPlayTime || 0) + elapsed;
  stats.highestCombo = Math.max(stats.highestCombo || 0, state.maxComboThisGame || 0);
  saveStats(stats);
  state.stats = stats;
}

export function getStats() {
  return loadStats();
}

// ===== 每日挑战 =====
export function getDailyChallenge() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const rng = seededRNG(today);

  // Generate fixed maze
  const maze = generateDFSMaze(rng);

  // Generate fixed food sequence (first 50 foods)
  const foodSeq = [];
  for (let i = 0; i < 50; i++) {
    const foodType = pickFoodType(rng);
    const pos = {
      x: Math.floor(rng() * COLS),
      y: Math.floor(rng() * ROWS)
    };
    foodSeq.push({ type: foodType, pos });
  }

  return {
    date: today,
    mode: 'maze',
    maze,
    foodSequence: foodSeq,
    seed: today
  };
}

function saveDailyScore(score) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `snake_daily_${today}`;
  const best = parseInt(localStorage.getItem(key) || '0', 10);
  if (score > best) {
    localStorage.setItem(key, score.toString());
  }
  unlockAch('daily_done');
}

// ===== 死亡处理 =====
function triggerDeath() {
  state.gameOver = true;
  state.running = false;
  clearInterval(state.timer);
  clearTimeout(state.foodTimer);
  if (state.shrinkInterval) clearInterval(state.shrinkInterval);
  if (state.zenTimer) clearInterval(state.zenTimer);
  saveBest(state.score);
  showBest();
  saveGhost();
  updateStats();
  if (state.isDaily) saveDailyScore(state.score);
  playDie();
  state.screenShake = 15;
  const wrap = $('#game-wrap');
  if (wrap) {
    wrap.classList.add('shake');
    setTimeout(() => wrap.classList.remove('shake'), 300);
  }
  const theme = THEMES[state.currentTheme];
  const sp = canvasToScreen(state.snake[0].x, state.snake[0].y);
  spawnP(sp.x, sp.y, theme.food, 40, [2, 7], [1, 5]);
  for (let i = 0; i < Math.min(state.snake.length, 10); i++) {
    const s = canvasToScreen(state.snake[i].x, state.snake[i].y);
    setTimeout(() => spawnP(s.x, s.y, `hsl(${theme.snake[0]}, 80%, 50%)`, 5), i * 30);
  }
  const msgEl = $('#msg');
  if (msgEl) msgEl.textContent = 'R \u91CD\u65B0\u5F00\u59CB \u00B7 ESC \u8FD4\u56DE\u83DC\u5355';

  // Mode-specific achievements on death
  if (state.selectedMode === 'nowalls' && state.score >= 200) unlockAch('nowalls_win');
  if (state.selectedMode === 'maze' && state.score >= 200) unlockAch('maze_win');
  if (state.selectedMode === 'speed' && state.score >= 200) unlockAch('speed_win');

  // Haptic feedback
  if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
}

// ===== 游戏更新 =====
export function update() {
  if (state.paused || state.gameOver) return;

  // 保存当前位置作为插值起点
  state.prevSnake = state.snake.map(s => ({x: s.x, y: s.y}));
  state.lerpT = 0;

  // Consume direction from input queue
  if (state.dirQueue && state.dirQueue.length > 0) {
    const next = state.dirQueue.shift();
    if (next && !(next.x === -state.dir.x && next.y === -state.dir.y && state.snake.length > 1)) {
      state.nextDir = next;
    }
  }

  state.dir = { ...state.nextDir };

  // Record move for ghost replay
  if (state.moveHistory) {
    state.moveHistory.push({ dir: { ...state.dir }, ate: false });
  }

  let head = { x: state.snake[0].x + state.dir.x, y: state.snake[0].y + state.dir.y };

  // Wrap modes (nowalls, speed, zen)
  const wrapMode = state.selectedMode === 'nowalls' || state.selectedMode === 'speed' || state.selectedMode === 'zen';
  if (wrapMode) {
    head.x = (head.x + COLS) % COLS;
    head.y = (head.y + ROWS) % ROWS;
  }

  // Survival mode boundary check
  if (state.selectedMode === 'survival' && state.shrinkBounds) {
    const b = state.shrinkBounds;
    if (head.x < b.left || head.x >= b.right || head.y < b.top || head.y >= b.bottom) {
      if (!state.activePowerups.invincible) {
        triggerDeath();
        return;
      }
      // Bounce back if invincible
      head.x = Math.max(b.left, Math.min(b.right - 1, head.x));
      head.y = Math.max(b.top, Math.min(b.bottom - 1, head.y));
      state.nextDir = { x: -state.dir.x, y: -state.dir.y };
      state.dir = { ...state.nextDir };
      head = { x: state.snake[0].x + state.dir.x, y: state.snake[0].y + state.dir.y };
    }
  }

  // Standard collision
  const hitWall = head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS;
  const hitSelf = state.snake.some(s => s.x === head.x && s.y === head.y);
  const hitMaze = isWall(head.x, head.y);

  // Zen mode: no death
  if (state.selectedMode === 'zen') {
    if (hitWall) {
      head.x = (head.x + COLS) % COLS;
      head.y = (head.y + ROWS) % ROWS;
    }
    if (hitSelf) {
      // Just pass through self in zen mode
      // Don't die, just move
    }
    // No maze in zen mode, but just in case
  } else if (hitWall || hitSelf || hitMaze) {
    if (state.activePowerups.invincible) {
      unlockAch('invincible');
      if (hitWall) {
        head.x = Math.max(0, Math.min(COLS - 1, head.x));
        head.y = Math.max(0, Math.min(ROWS - 1, head.y));
        state.nextDir = { x: -state.dir.x, y: -state.dir.y };
        state.dir = { ...state.nextDir };
        head = { x: state.snake[0].x + state.dir.x, y: state.snake[0].y + state.dir.y };
      } else if (hitSelf || hitMaze) {
        return;
      }
    } else {
      triggerDeath();
      return;
    }
  }

  state.snake.unshift(head);

  let ateFood = false;

  // Boss food check
  if (state.bossFood && head.x === state.bossFood.x && head.y === state.bossFood.y) {
    state.bossFood.hitsLeft--;
    const pts = 100;
    state.score += pts;
    $('#score').textContent = state.score;
    const sp = canvasToScreen(head.x, head.y);
    spawnP(sp.x, sp.y, '#ff4500', 25, [3, 7]);
    spawnText(sp.x, sp.y - 20, `+${pts} BOSS!`, '#ff4500');
    playGold();
    if (state.bossFood.hitsLeft <= 0) {
      state.bossFood = null;
      unlockAch('boss_killer');
      spawnText(sp.x, sp.y - 40, 'BOSS DEFEATED!', '#ffd700');
    }
    ateFood = true;
    state.foodEatenThisGame = (state.foodEatenThisGame || 0) + 1;
  }

  // Regular food check
  if (head.x === state.food.x && head.y === state.food.y) {
    addCombo();
    if (state.combo > (state.maxComboThisGame || 0)) state.maxComboThisGame = state.combo;
    let pts = state.foodType.points;
    pts = Math.round(pts * getComboMultiplier());
    if (state.activePowerups.double) pts *= 2;

    const prevScore = state.score;
    state.score += pts;
    $('#score').textContent = state.score;

    const sp = canvasToScreen(state.food.x, state.food.y);
    if (state.foodType.type === 'gold') {
      playGold();
      spawnP(sp.x, sp.y, '#ffd700', 30, [3, 8]);
      unlockAch('gold_eat');
    } else if (state.foodType.type === 'bonus') {
      playBonusEat();
      spawnP(sp.x, sp.y, '#00ff88', 20, [2, 6]);
    } else {
      playEat();
      spawnP(sp.x, sp.y, THEMES[state.currentTheme].food, 12);
    }

    spawnText(sp.x, sp.y - 20, `+${pts}`, '#fff');
    spawnRipple(sp.x, sp.y, THEMES[state.currentTheme].food);
    triggerScorePop();
    notifyFoodEaten();
    if (state.combo >= 2) {
      spawnText(sp.x, sp.y - 40, `${state.combo} COMBO!`, '#f0a500');
      spawnSparks(sp.x, sp.y, '#f0a500', state.combo);
    }

    if (state.foodType.type === 'shrink' && state.snake.length > 3) {
      for (let i = 0; i < 3; i++) state.snake.pop();
    }

    if (state.foodType.type === 'speed_food' && state.selectedMode !== 'zen') {
      state.speed = Math.max(state.speed - 10, DIFF[state.selectedDiff].min);
      clearInterval(state.timer);
      state.timer = setInterval(update, state.speed);
    }

    placeFood();
    placePowerup();

    // Check boss food spawn (every 500 points)
    if (Math.floor(state.score / 500) > Math.floor(prevScore / 500) && !state.bossFood) {
      placeBossFood();
    }

    // Acceleration (not in zen mode)
    if (state.selectedMode !== 'zen') {
      const diff = DIFF[state.selectedDiff];
      const accel = state.selectedMode === 'speed' ? diff.accel * 2 : diff.accel;
      if (state.speed > diff.min) {
        state.speed -= accel;
        clearInterval(state.timer);
        state.timer = setInterval(update, state.speed);
      }
    }

    ateFood = true;
    state.foodEatenThisGame = (state.foodEatenThisGame || 0) + 1;

    // Update BGM layers based on score
    updateBGM(state.score, state.speed);

    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate(50);

    // Achievements
    unlockAch('first_blood');
    if (state.score >= 100) unlockAch('score_100');
    if (state.score >= 500) unlockAch('score_500');
    if (state.score >= 1000) unlockAch('score_1000');
    if (state.snake.length >= 30) unlockAch('long_snake');
    if (state.snake.length >= 50) unlockAch('evolution_max');
  } else if (!ateFood) {
    state.snake.pop();
  }

  // Update ghost move record (mark if ate)
  if (state.moveHistory && state.moveHistory.length > 0 && ateFood) {
    state.moveHistory[state.moveHistory.length - 1].ate = true;
  }

  // Update ghost snake
  updateGhost();

  // Check if ghost beaten
  if (state.ghostMoves && state.ghostSnake === null && state.score > 0) {
    const ghostBest = getBest(state.selectedMode);
    if (state.score > ghostBest) {
      unlockAch('ghost_beater');
    }
  }

  // Combo haptic
  if (state.combo >= 2 && navigator.vibrate) navigator.vibrate(30);

  // Update evolution
  updateEvolution();

  // Powerup pickup
  if (state.powerup && head.x === state.powerup.x && head.y === state.powerup.y) {
    activatePowerup(state.powerup);
    state.powerup = null;
  }
}

// ===== 方向控制 =====
export function handleDir(nd) {
  if (!nd || state.gameOver) return;
  if (nd.x === -state.dir.x && nd.y === -state.dir.y && state.snake.length > 1) return;

  // Use direction queue instead of direct assignment
  if (!state.dirQueue) state.dirQueue = [];
  if (state.dirQueue.length < 2) {
    // Check against last queued direction or current direction
    const lastDir = state.dirQueue.length > 0 ? state.dirQueue[state.dirQueue.length - 1] : state.dir;
    if (!(nd.x === -lastDir.x && nd.y === -lastDir.y) && !(nd.x === lastDir.x && nd.y === lastDir.y)) {
      state.dirQueue.push(nd);
    } else if (state.dirQueue.length === 0) {
      // Allow same direction if queue is empty (for game start)
      state.dirQueue.push(nd);
    }
  }

  state.nextDir = nd;
  if (!state.running) {
    state.running = true;
    state.startTime = Date.now();
    const msgEl = $('#msg');
    if (msgEl) msgEl.textContent = '';
    state.timer = setInterval(update, state.speed);

    // Start mode-specific timers
    if (state.selectedMode === 'survival') startShrinkTimer();
    if (state.selectedMode === 'zen') startZenTimer();
  }
}

// ===== 初始化 =====
export function init(dailyConfig) {
  cancelAnimationFrame(state.animFrame);
  clearInterval(state.timer);
  clearTimeout(state.foodTimer);
  if (state.shrinkInterval) clearInterval(state.shrinkInterval);
  if (state.zenTimer) clearInterval(state.zenTimer);

  const diff = DIFF[state.selectedDiff];

  state.snake = [{ x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) }];
  state.dir = { x: 0, y: 0 };
  state.nextDir = { x: 0, y: 0 };
  state.dirQueue = [];
  state.score = 0;
  state.combo = 0;
  state.lastEatTime = 0;
  state.running = false;
  state.gameOver = false;
  state.paused = false;
  state.speed = state.selectedMode === 'speed' ? Math.max(diff.speed - 30, 40) : diff.speed;
  state.activePowerups = {};
  state.powerupTimers = {};
  state.powerup = null;
  state.totalPowerupsCollected = 0;
  state.screenShake = 0;
  state.startTime = Date.now();

  // New systems
  state.moveHistory = [];
  state.foodEatenThisGame = 0;
  state.maxComboThisGame = 0;
  state.snakeEvolution = 0;
  state.bossFood = null;
  state.shrinkWarning = null;
  state.stats = loadStats();

  // Survival mode
  if (state.selectedMode === 'survival') {
    state.shrinkBounds = { top: 0, left: 0, bottom: ROWS, right: COLS };
    state.shrinkTimer = null;
  } else {
    state.shrinkBounds = null;
  }

  // Zen mode
  if (state.selectedMode === 'zen') {
    state.zenTimer = null;
    state.zenTimeLeft = 120;
    state.speed = diff.speed; // No acceleration in zen
  } else {
    state.zenTimeLeft = 0;
  }

  // Daily challenge
  state.isDaily = false;
  state.dailyFoodSequence = null;
  state.dailyFoodIndex = 0;
  if (dailyConfig) {
    state.isDaily = true;
    state.selectedMode = dailyConfig.mode;
    state.mazeWalls = dailyConfig.maze;
    state.dailyFoodSequence = dailyConfig.foodSequence;
    state.dailyFoodIndex = 0;
  } else {
    state.mazeWalls = state.selectedMode === 'maze' ? generateMaze() : null;
  }

  // Ghost replay
  state.ghostMoves = null;
  state.ghostSnake = null;
  state.ghostIndex = 0;
  state.ghostDir = { x: 0, y: 0 };
  loadGhost();

  // Direction indicator (for input.js touch gesture feedback)
  state.dirIndicator = null;

  // 运动插值
  state.lerpT = 1;
  state.prevSnake = [];
  state._lastFrameTime = 0;

  resetRendererState();
  $('#score').textContent = '0';
  showBest();
  const msgEl = $('#msg');
  if (msgEl) {
    if (state.isDaily) {
      msgEl.textContent = '\u{1F4C5} \u6BCF\u65E5\u6311\u6218 \u00B7 \u6309\u65B9\u5411\u952E\u5F00\u59CB';
    } else if (state.selectedMode === 'survival') {
      msgEl.textContent = '\u{1F3D5}\uFE0F \u751F\u5B58\u6A21\u5F0F \u00B7 \u6309\u65B9\u5411\u952E\u5F00\u59CB';
    } else if (state.selectedMode === 'zen') {
      msgEl.textContent = '\u{1F54A}\uFE0F \u7985\u6A21\u5F0F (120s) \u00B7 \u6309\u65B9\u5411\u952E\u5F00\u59CB';
    } else {
      msgEl.textContent = '\u6309\u65B9\u5411\u952E\u5F00\u59CB';
    }
  }
  placeFood();
  draw();
  updateHUD();
}

// ===== 动画循环 =====
export function animLoop() {
  const now = performance.now();
  const dt = now - (state._lastFrameTime || now);
  state._lastFrameTime = now;

  // 插值进度递增
  if (state.lerpT < 1) {
    state.lerpT += dt / state.speed;
    if (state.lerpT > 1) state.lerpT = 1;
  }

  // Poll gamepad (stored on state by input.js to avoid circular import)
  if (state._pollGamepad) state._pollGamepad();

  draw();
  updateHUD();
  if (state.running && !state.gameOver && !state.paused) {
    const alive = (Date.now() - state.startTime) / 1000;
    if (alive >= 60) unlockAch('survive_60');
    if (alive >= 180) unlockAch('survive_180');

    // Mode-specific achievements
    if (state.selectedMode === 'speed' && alive >= 120) unlockAch('speed_demon');
    if (state.selectedMode === 'survival' && alive >= 180) unlockAch('survivor');
  }
  state.animFrame = requestAnimationFrame(animLoop);
}
