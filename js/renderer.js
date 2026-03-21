// ============================================================
//  renderer.js — Canvas 渲染（运动插值 + 高级感）
// ============================================================

import { $, THEMES, COLS, ROWS, POWERUP_TYPES, state, getBest } from './config.js';

const canvas = $('#game');
const ctx = canvas.getContext('2d');

// ===== 内部状态 =====
let _time = 0;
let _deathTime = 0;
let _deathFade = 0;
let _scorePop = 0;
let _prevScore = 0;
let _foodEaten = 0;

// ===== 运动插值 =====
let _prevSnake = [];
let _lastSnakeStr = '';

// ===== 背景缓存 =====
let _bgCache = null;
let _bgCacheW = 0;
let _bgCacheH = 0;

// ===== 食物颜色映射 =====
const FOOD_COLORS = {
  normal: null,  // 使用 accent
  bonus: '#34d399',
  gold: '#fbbf24',
  shrink: '#f472b6',
  speed_food: '#38bdf8',
};

// ===== 导出函数 =====
export function resetRendererState() {
  _foodEaten = 0;
  _deathTime = 0;
  _deathFade = 0;
  _prevScore = 0;
  _scorePop = 0;
  _prevSnake = [];
  _lastSnakeStr = '';
}

export function notifyFoodEaten() {
  _foodEaten++;
}

export function triggerScorePop() {
  const el = $('#score');
  if (el) {
    el.classList.remove('score-pop');
    void el.offsetWidth;
    el.classList.add('score-pop');
  }
}

export function resizeCanvas() {
  const maxW = Math.min(window.innerWidth * 0.92, 600);
  const maxH = window.innerHeight * 0.55;
  const maxSize = Math.min(maxW, maxH);
  state.GRID = Math.floor(maxSize / COLS);
  canvas.width = state.GRID * COLS;
  canvas.height = state.GRID * ROWS;
  ctx.imageSmoothingEnabled = true;
  $('#hud').style.width = canvas.width + 'px';
  _bgCache = null;
}

// ===== 运动插值核心 =====
function syncPrevSnake() {
  const snake = state.snake;
  const str = snake.map(s => s.x + ',' + s.y).join('|');
  if (str !== _lastSnakeStr) {
    // 蛇位置变化了，保存旧位置
    _prevSnake = _lastSnakeStr
      ? _lastSnakeStr.split('|').map(p => { const [x, y] = p.split(','); return { x: +x, y: +y }; })
      : snake.map(s => ({ x: s.x, y: s.y }));
    _lastSnakeStr = str;
  }
}

function getInterpolatedPositions() {
  const t = state.lerpT != null ? state.lerpT : 1;
  const snake = state.snake;
  const result = [];
  for (let i = 0; i < snake.length; i++) {
    const prev = _prevSnake[i] || snake[i];
    const dx = Math.abs(snake[i].x - prev.x);
    const dy = Math.abs(snake[i].y - prev.y);
    // 穿墙时跳过插值（delta > 1格说明穿越了边界）
    if (dx > 1 || dy > 1) {
      result.push({ x: snake[i].x, y: snake[i].y });
    } else {
      result.push({
        x: prev.x + (snake[i].x - prev.x) * t,
        y: prev.y + (snake[i].y - prev.y) * t,
      });
    }
  }
  return result;
}

// ===== 背景：纯色 + 微弱网格点 =====
function drawBackground() {
  const w = canvas.width, h = canvas.height;
  const GRID = state.GRID;

  // 缓存到 offscreen canvas
  if (!_bgCache || _bgCacheW !== w || _bgCacheH !== h) {
    _bgCache = document.createElement('canvas');
    _bgCache.width = w;
    _bgCache.height = h;
    const bctx = _bgCache.getContext('2d');

    // 纯色背景
    bctx.fillStyle = '#0a0a0f';
    bctx.fillRect(0, 0, w, h);

    // 网格交叉点圆点
    bctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let x = 0; x <= COLS; x++) {
      for (let y = 0; y <= ROWS; y++) {
        bctx.beginPath();
        bctx.arc(x * GRID, y * GRID, 0.5, 0, Math.PI * 2);
        bctx.fill();
      }
    }
    _bgCacheW = w;
    _bgCacheH = h;
  }

  ctx.drawImage(_bgCache, 0, 0);
}

// ===== 迷宫墙壁 =====
function drawMaze() {
  if (!state.mazeWalls) return;
  const GRID = state.GRID;

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (const key of state.mazeWalls) {
    const wx = Math.floor(key / ROWS);
    const wy = key % ROWS;
    const x = wx * GRID + 1;
    const y = wy * GRID + 1;
    const s = GRID - 2;
    const r = 2;

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + s - r, y);
    ctx.quadraticCurveTo(x + s, y, x + s, y + r);
    ctx.lineTo(x + s, y + s - r);
    ctx.quadraticCurveTo(x + s, y + s, x + s - r, y + s);
    ctx.lineTo(x + r, y + s);
    ctx.quadraticCurveTo(x, y + s, x, y + s - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
  }
}

// ===== 食物 =====
function drawFood(theme) {
  if (!state.food) return;
  const GRID = state.GRID;
  const type = state.foodType.type;
  const fColor = FOOD_COLORS[type] || theme.accent;
  const fx = state.food.x * GRID + GRID / 2;
  const fy = state.food.y * GRID + GRID / 2;

  // 脉冲：±0.5px，周期2秒
  const pulse = Math.sin(_time * 0.00314) * 0.5; // 2π / 2000ms ≈ 0.00314
  const baseR = GRID * 0.3 + pulse;
  const isGold = type === 'gold';
  const r = isGold ? baseR * 1.3 : baseR;

  // 光晕层（更大、半透明）
  ctx.fillStyle = fColor;
  ctx.globalAlpha = 0.08;
  ctx.beginPath();
  ctx.arc(fx, fy, r * 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // 主体
  ctx.fillStyle = fColor;
  ctx.beginPath();
  ctx.arc(fx, fy, r, 0, Math.PI * 2);
  ctx.fill();
}

// ===== Boss 食物 =====
function drawBossFood() {
  if (!state.bossFood) return;
  const GRID = state.GRID;
  const bx = state.bossFood.x * GRID + GRID / 2;
  const by = state.bossFood.y * GRID + GRID / 2;
  const hitsLeft = state.bossFood.hitsLeft;
  const r = GRID * 0.45;
  const color = '#ef4444';

  // 光晕
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.08;
  ctx.beginPath();
  ctx.arc(bx, by, r * 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // 主体（1.5x大）
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(bx, by, r, 0, Math.PI * 2);
  ctx.fill();

  // 数字
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${GRID * 0.4}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(hitsLeft.toString(), bx, by);
  ctx.textBaseline = 'alphabetic';
}

// ===== 道具 =====
function drawPowerup() {
  if (!state.powerup) return;
  const GRID = state.GRID;
  const px = state.powerup.x * GRID + GRID / 2;
  const py = state.powerup.y * GRID + GRID / 2;
  const color = state.powerup.color;
  const r = GRID * 0.36;

  // 光晕
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.08;
  ctx.beginPath();
  ctx.arc(px, py, r * 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // 主体（1.2x）
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();

  // Emoji 图标
  ctx.fillStyle = '#fff';
  ctx.font = `${GRID * 0.38}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(state.powerup.icon, px, py);
  ctx.textBaseline = 'alphabetic';
}

// ===== 蛇 =====
function drawSnake(theme) {
  const GRID = state.GRID;
  const snake = state.snake;
  if (snake.length === 0) return;

  const isInvincible = state.activePowerups && state.activePowerups.invincible;
  const snakeHue = theme.snake[0];
  const snakeSat = theme.snake[1];

  // 获取插值后的位置
  const positions = getInterpolatedPositions();

  // === Pass 1: 柔和发光层（从尾到头）===
  for (let i = snake.length - 1; i >= 0; i--) {
    const t = i / Math.max(snake.length - 1, 1); // 0=头 1=尾
    const pos = positions[i];
    if (!pos) continue;
    const x = pos.x * GRID + GRID / 2;
    const y = pos.y * GRID + GRID / 2;

    const headR = GRID * 0.42;
    const tailR = GRID * 0.18;
    const radius = headR + (tailR - headR) * t;
    const glowR = radius * 1.4;

    let hue;
    if (isInvincible) {
      hue = ((_time * 0.03) + i * 15) % 360;
    } else {
      hue = snakeHue + t * 20;
    }
    const sat = isInvincible ? 70 : snakeSat;
    const light = isInvincible ? 55 : (48 + (1 - t) * 14);

    ctx.fillStyle = `hsla(${hue}, ${sat}%, ${light}%, 0.06)`;
    ctx.beginPath();
    ctx.arc(x, y, glowR, 0, Math.PI * 2);
    ctx.fill();
  }

  // === Pass 2: 蛇身圆（从尾到头）===
  for (let i = snake.length - 1; i >= 0; i--) {
    const t = i / Math.max(snake.length - 1, 1);
    const pos = positions[i];
    if (!pos) continue;
    const x = pos.x * GRID + GRID / 2;
    const y = pos.y * GRID + GRID / 2;

    const headR = GRID * 0.42;
    const tailR = GRID * 0.18;
    const radius = headR + (tailR - headR) * t;

    let hue;
    if (isInvincible) {
      hue = ((_time * 0.03) + i * 15) % 360;
    } else {
      hue = snakeHue + t * 20;
    }
    const sat = isInvincible ? 70 : snakeSat;
    const light = isInvincible ? 55 : (48 + (1 - t) * 14);

    ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // === 蛇头眼睛 ===
  const headPos = positions[0];
  if (headPos) {
    const hx = headPos.x * GRID + GRID / 2;
    const hy = headPos.y * GRID + GRID / 2;
    const headR = GRID * 0.42;
    const dir = state.dir;

    const eyeOffsetForward = headR * 0.35;
    const eyeOffsetSide = headR * 0.35;

    let eye1x, eye1y, eye2x, eye2y;
    if (dir.x === 1) {
      eye1x = hx + eyeOffsetForward; eye1y = hy - eyeOffsetSide;
      eye2x = hx + eyeOffsetForward; eye2y = hy + eyeOffsetSide;
    } else if (dir.x === -1) {
      eye1x = hx - eyeOffsetForward; eye1y = hy - eyeOffsetSide;
      eye2x = hx - eyeOffsetForward; eye2y = hy + eyeOffsetSide;
    } else if (dir.y === -1) {
      eye1x = hx - eyeOffsetSide; eye1y = hy - eyeOffsetForward;
      eye2x = hx + eyeOffsetSide; eye2y = hy - eyeOffsetForward;
    } else {
      eye1x = hx - eyeOffsetSide; eye1y = hy + eyeOffsetForward;
      eye2x = hx + eyeOffsetSide; eye2y = hy + eyeOffsetForward;
    }

    // 白色眼白 (2px)
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(eye1x, eye1y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(eye2x, eye2y, 2, 0, Math.PI * 2);
    ctx.fill();

    // 黑色瞳孔 (1px)
    const pupilDx = dir.x * 0.5;
    const pupilDy = dir.y * 0.5;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(eye1x + pupilDx, eye1y + pupilDy, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(eye2x + pupilDx, eye2y + pupilDy, 1, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ===== 缩圈边界（survival 模式）=====
function drawShrinkBounds() {
  if (!state.shrinkBounds || state.selectedMode !== 'survival') return;
  const GRID = state.GRID;
  const b = state.shrinkBounds;

  ctx.strokeStyle = 'rgba(255,100,100,0.3)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(b.left * GRID, b.top * GRID, (b.right - b.left) * GRID, (b.bottom - b.top) * GRID);
  ctx.setLineDash([]);
}

// ===== 幽灵蛇 =====
function drawGhostSnake(theme) {
  if (!state.ghostSnake || state.ghostSnake.length === 0) return;
  const GRID = state.GRID;
  const snakeHue = theme.snake[0];
  const snakeSat = theme.snake[1];

  ctx.globalAlpha = 0.12;
  for (let i = state.ghostSnake.length - 1; i >= 0; i--) {
    const seg = state.ghostSnake[i];
    const t = i / Math.max(state.ghostSnake.length - 1, 1);
    const headR = GRID * 0.42;
    const tailR = GRID * 0.18;
    const r = headR + (tailR - headR) * t;
    ctx.fillStyle = `hsl(${snakeHue}, ${snakeSat}%, 50%)`;
    ctx.beginPath();
    ctx.arc(seg.x * GRID + GRID / 2, seg.y * GRID + GRID / 2, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ===== 蛇进化特效 =====
function drawEvolutionEffects() {
  if (!state.snakeEvolution || state.snakeEvolution < 1 || state.snake.length === 0) return;
  const GRID = state.GRID;

  // 使用插值位置
  const positions = getInterpolatedPositions();
  const headPos = positions[0];
  if (!headPos) return;
  const hx = headPos.x * GRID + GRID / 2;
  const hy = headPos.y * GRID;

  // 进化1+: 皇冠 emoji
  ctx.font = `${GRID * 0.4}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('\u{1F451}', hx, hy - GRID * 0.15);
  ctx.textBaseline = 'alphabetic';
}

// ===== 禅模式计时器 =====
function drawModeHUD() {
  if (state.selectedMode === 'zen' && state.zenTimeLeft > 0 && state.running && !state.gameOver) {
    const min = Math.floor(state.zenTimeLeft / 60);
    const sec = state.zenTimeLeft % 60;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = state.zenTimeLeft <= 10 ? '#ff4444' : '#aaa';
    ctx.font = '200 14px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${min}:${sec.toString().padStart(2, '0')}`, canvas.width - 10, 18);
    ctx.textAlign = 'center';
    ctx.globalAlpha = 1;
  }
}

// ===== 暂停覆层 =====
function drawPaused() {
  if (!state.paused || state.gameOver) return;

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#fff';
  ctx.font = '200 28px sans-serif';
  ctx.letterSpacing = '6px';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2);
  ctx.letterSpacing = '0px';
  ctx.textBaseline = 'alphabetic';
}

// ===== 游戏结束 =====
function drawGameOver() {
  if (!state.gameOver) return;

  if (_deathTime === 0) _deathTime = Date.now();
  const elapsed = Date.now() - _deathTime;
  _deathFade = Math.min(elapsed / 400, 1);

  ctx.fillStyle = `rgba(0,0,0,${0.6 * _deathFade})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (_deathFade < 1) return;

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  // 分数（大号）
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 42px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(state.score.toString(), cx, cy - 10);

  // 提示（小字）
  ctx.fillStyle = '#666';
  ctx.font = '200 13px sans-serif';
  ctx.fillText('R\u91CD\u5F00 \u00B7 ESC\u83DC\u5355', cx, cy + 25);
  ctx.textBaseline = 'alphabetic';
}

// ===== 主绘制函数 =====
export function draw() {
  _time = Date.now();

  // 同步插值状态
  syncPrevSnake();

  ctx.save();

  if (state.score !== _prevScore) {
    if (state.score > _prevScore && _prevScore >= 0) {
      triggerScorePop();
    }
    _prevScore = state.score;
  }

  if (!state.gameOver) {
    _deathTime = 0;
    _deathFade = 0;
  }

  if (state.screenShake > 0) {
    const sx = (Math.random() - 0.5) * state.screenShake;
    const sy = (Math.random() - 0.5) * state.screenShake;
    ctx.translate(sx, sy);
    state.screenShake *= 0.85;
    if (state.screenShake < 0.5) state.screenShake = 0;
  }

  ctx.clearRect(-10, -10, canvas.width + 20, canvas.height + 20);

  const theme = THEMES[state.currentTheme];

  drawBackground();
  drawMaze();
  drawShrinkBounds();
  drawPowerup();
  drawBossFood();
  drawFood(theme);
  drawGhostSnake(theme);
  drawSnake(theme);
  drawEvolutionEffects();
  drawModeHUD();
  drawPaused();
  drawGameOver();

  ctx.restore();
}

export function updateHUD() {
  const scoreEl = $('#score');
  if (scoreEl) scoreEl.textContent = state.score;
}

export function getCanvas() { return canvas; }
