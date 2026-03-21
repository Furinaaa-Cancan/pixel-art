// ============================================================
//  renderer.js — Canvas 渲染（Premium Snake 风格：简洁 fillRect）
// ============================================================

import { $, THEMES, COLS, ROWS, state, getBest } from './config.js';

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
  normal: '#ff0033',
  bonus: '#00ff88',
  gold: '#ffd700',
  shrink: '#ff69b4',
  speed_food: '#00bfff',
};

// ===== 圆角矩形辅助 =====
function roundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

// ===== HSL 转 hex 辅助 =====
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

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

// ===== 背景：深色 + 淡色网格线（缓存到 offscreen canvas）=====
function drawBackground() {
  const w = canvas.width, h = canvas.height;
  const GRID = state.GRID;

  if (!_bgCache || _bgCacheW !== w || _bgCacheH !== h) {
    _bgCache = document.createElement('canvas');
    _bgCache.width = w;
    _bgCache.height = h;
    const bctx = _bgCache.getContext('2d');

    // 深色背景
    bctx.fillStyle = '#0d1117';
    bctx.fillRect(0, 0, w, h);

    // 淡色网格线
    bctx.strokeStyle = 'rgba(255,255,255,0.03)';
    bctx.lineWidth = 0.5;
    for (let x = 0; x <= COLS; x++) {
      bctx.beginPath();
      bctx.moveTo(x * GRID, 0);
      bctx.lineTo(x * GRID, h);
      bctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      bctx.beginPath();
      bctx.moveTo(0, y * GRID);
      bctx.lineTo(w, y * GRID);
      bctx.stroke();
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
  const r = 3;

  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  for (const key of state.mazeWalls) {
    const wx = Math.floor(key / ROWS);
    const wy = key % ROWS;
    const x = wx * GRID + 1;
    const y = wy * GRID + 1;
    const s = GRID - 2;
    roundRect(ctx, x, y, s, s, r);
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

  // 微弱脉冲：±1px，周期2秒
  const pulse = Math.sin(_time * 0.00314) * 1;
  const r = GRID / 2.5 + pulse;

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

  // 1.5x 大圆，红色
  const r = GRID * 0.45;

  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(bx, by, r, 0, Math.PI * 2);
  ctx.fill();

  // 剩余次数
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

  // 圆形底
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();

  // Emoji 图标
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

  const positions = getInterpolatedPositions();
  const gap = 1; // 段间间隙
  const cornerR = 4; // 圆角半径
  const segSize = GRID - gap * 2;

  // 从尾到头绘制
  for (let i = snake.length - 1; i >= 0; i--) {
    const pos = positions[i];
    if (!pos) continue;
    const x = pos.x * GRID + gap;
    const y = pos.y * GRID + gap;

    const isHead = i === 0;
    const t = i / Math.max(snake.length - 1, 1); // 0=头 1=尾

    let fillColor;
    if (isInvincible) {
      // 彩虹色循环
      const hue = ((_time * 0.1) + i * 25) % 360;
      fillColor = `hsl(${hue}, 70%, 55%)`;
    } else if (isHead) {
      // 蛇头更亮
      fillColor = hslToHex(snakeHue, snakeSat, 65);
    } else {
      // 蛇身稍暗，尾部更暗
      const light = 45 - t * 10;
      fillColor = hslToHex(snakeHue, snakeSat, light);
    }

    // 填充圆角方块
    ctx.fillStyle = fillColor;
    roundRect(ctx, x, y, segSize, segSize, cornerR);
    ctx.fill();

    // 边框用背景色，制造分隔感
    ctx.strokeStyle = '#161b22';
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, segSize, segSize, cornerR);
    ctx.stroke();
  }

  // === 蛇头眼睛 ===
  const headPos = positions[0];
  if (headPos) {
    const hx = headPos.x * GRID + GRID / 2;
    const hy = headPos.y * GRID + GRID / 2;
    const dir = state.dir;

    const eyeForward = GRID * 0.18;
    const eyeSide = GRID * 0.16;
    const eyeR = 2;

    let eye1x, eye1y, eye2x, eye2y;
    if (dir.x === 1) {
      eye1x = hx + eyeForward; eye1y = hy - eyeSide;
      eye2x = hx + eyeForward; eye2y = hy + eyeSide;
    } else if (dir.x === -1) {
      eye1x = hx - eyeForward; eye1y = hy - eyeSide;
      eye2x = hx - eyeForward; eye2y = hy + eyeSide;
    } else if (dir.y === -1) {
      eye1x = hx - eyeSide; eye1y = hy - eyeForward;
      eye2x = hx + eyeSide; eye2y = hy - eyeForward;
    } else {
      eye1x = hx - eyeSide; eye1y = hy + eyeForward;
      eye2x = hx + eyeSide; eye2y = hy + eyeForward;
    }

    // 白色眼睛
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(eye1x, eye1y, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(eye2x, eye2y, eyeR, 0, Math.PI * 2);
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
  const gap = 1;
  const segSize = GRID - gap * 2;
  const cornerR = 4;

  ctx.globalAlpha = 0.15;
  const color = hslToHex(snakeHue, snakeSat, 45);

  for (let i = state.ghostSnake.length - 1; i >= 0; i--) {
    const seg = state.ghostSnake[i];
    const x = seg.x * GRID + gap;
    const y = seg.y * GRID + gap;

    ctx.fillStyle = color;
    roundRect(ctx, x, y, segSize, segSize, cornerR);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ===== 蛇进化特效 =====
function drawEvolutionEffects() {
  if (!state.snakeEvolution || state.snakeEvolution < 1 || state.snake.length === 0) return;
  const GRID = state.GRID;

  const positions = getInterpolatedPositions();
  const headPos = positions[0];
  if (!headPos) return;
  const hx = headPos.x * GRID + GRID / 2;
  const hy = headPos.y * GRID;

  // 皇冠 emoji
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

  // 分数
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 42px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(state.score.toString(), cx, cy - 10);

  // 提示
  ctx.fillStyle = '#666';
  ctx.font = '200 13px sans-serif';
  ctx.fillText('R\u91CD\u5F00 \u00B7 ESC\u83DC\u5355', cx, cy + 25);
  ctx.textBaseline = 'alphabetic';
}

// ===== 主绘制函数 =====
export function draw() {
  _time = Date.now();

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
