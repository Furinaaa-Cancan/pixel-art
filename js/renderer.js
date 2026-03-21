// ============================================================
//  renderer.js — Canvas 渲染（像素风 SVG 素材版）
// ============================================================

import { $, THEMES, COLS, ROWS, POWERUP_TYPES, state, getBest } from './config.js';

const canvas = $('#game');
const ctx = canvas.getContext('2d');

// ===== 素材预加载系统 =====
const SPRITES = {};
const SPRITE_LIST = [
  'snake-head-right', 'snake-head-up', 'snake-head-down', 'snake-head-left',
  'snake-body-h', 'snake-body-v',
  'snake-body-tl', 'snake-body-tr', 'snake-body-bl', 'snake-body-br',
  'snake-tail-right', 'snake-tail-up', 'snake-tail-down', 'snake-tail-left',
  'snake-crown',
  'food-normal', 'food-bonus', 'food-gold', 'food-shrink', 'food-speed', 'food-boss',
  'powerup-double', 'powerup-slow', 'powerup-shield', 'powerup-scissors',
  'wall', 'bg-tile', 'bg-tile-alt'
];

let _spritesLoaded = 0;
function loadSprites() {
  for (const name of SPRITE_LIST) {
    const img = new Image();
    img.onload = () => { _spritesLoaded++; };
    img.src = `assets/${name}.svg`;
    SPRITES[name] = img;
  }
}
loadSprites();

/** Check if a sprite is ready to draw */
function spriteReady(name) {
  const img = SPRITES[name];
  return img && img.complete && img.naturalWidth > 0;
}

/** Draw a sprite into a grid cell, with optional padding */
function drawSprite(name, gx, gy, padding) {
  const GRID = state.GRID;
  const p = padding || 0;
  if (spriteReady(name)) {
    ctx.drawImage(SPRITES[name], gx * GRID + p, gy * GRID + p, GRID - p * 2, GRID - p * 2);
  } else {
    // fallback: colored square
    ctx.fillStyle = '#555';
    ctx.fillRect(gx * GRID + 1, gy * GRID + 1, GRID - 2, GRID - 2);
  }
}

/** Draw a sprite centered at pixel coords with a given size */
function drawSpriteAt(name, cx, cy, size) {
  const half = size / 2;
  if (spriteReady(name)) {
    ctx.drawImage(SPRITES[name], cx - half, cy - half, size, size);
  }
}

// ===== 内部状态 =====
let _time = 0;
let _deathTime = 0;
let _deathFade = 0;
let _deathZoom = 1;
let _scorePop = 0;
let _prevScore = 0;
let _stars = [];
let _tonguePhase = 0;
let _foodEaten = 0;
let _deathExploded = false;

// 初始化星空
function initStars() {
  _stars = [];
  for (let i = 0; i < 60; i++) {
    _stars.push({
      x: Math.random(),
      y: Math.random(),
      size: 0.5 + Math.random() * 1.5,
      speed: 0.0001 + Math.random() * 0.0003,
      brightness: 0.3 + Math.random() * 0.7
    });
  }
}
initStars();

// ===== 导出：重置食物计数 =====
export function resetRendererState() {
  _foodEaten = 0;
  _deathTime = 0;
  _deathFade = 0;
  _deathZoom = 1;
  _deathExploded = false;
  _prevScore = 0;
  _scorePop = 0;
}

// ===== 导出：食物计数 +1 =====
export function notifyFoodEaten() {
  _foodEaten++;
}

// ===== 导出：触发分数弹跳 =====
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
  ctx.imageSmoothingEnabled = false; // 关键！保持像素锐利
  $('#hud').style.width = canvas.width + 'px';
}

// ===== 绘制动态星空背景 =====
function drawStarfield() {
  const w = canvas.width, h = canvas.height;
  for (const s of _stars) {
    s.x += s.speed;
    s.y -= s.speed * 0.3;
    if (s.x > 1) s.x -= 1;
    if (s.y < 0) s.y += 1;
    const flicker = 0.5 + 0.5 * Math.sin(_time * 0.002 + s.x * 50);
    ctx.globalAlpha = s.brightness * flicker * 0.6;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ===== 绘制棋盘格背景（bg-tile / bg-tile-alt） =====
function drawGrid() {
  const GRID = state.GRID;
  const hasTiles = spriteReady('bg-tile') && spriteReady('bg-tile-alt');

  if (hasTiles) {
    for (let x = 0; x < COLS; x++) {
      for (let y = 0; y < ROWS; y++) {
        const isAlt = (x + y) % 2 === 1;
        const name = isAlt ? 'bg-tile-alt' : 'bg-tile';
        ctx.drawImage(SPRITES[name], x * GRID, y * GRID, GRID, GRID);
      }
    }
  } else {
    // fallback: subtle grid lines
    const breath = 0.03 + 0.015 * Math.sin(_time * 0.0015);
    ctx.strokeStyle = `rgba(255,255,255,${breath})`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let i = 0; i <= COLS; i++) {
      ctx.moveTo(i * GRID, 0);
      ctx.lineTo(i * GRID, ROWS * GRID);
    }
    for (let j = 0; j <= ROWS; j++) {
      ctx.moveTo(0, j * GRID);
      ctx.lineTo(COLS * GRID, j * GRID);
    }
    ctx.stroke();
  }
}

// ===== 绘制迷宫墙壁 =====
function drawMaze(theme) {
  if (!state.mazeWalls) return;
  const GRID = state.GRID;
  const hasWall = spriteReady('wall');

  ctx.shadowColor = theme.accent;
  ctx.shadowBlur = 6;
  for (const key of state.mazeWalls) {
    const wx = Math.floor(key / ROWS);
    const wy = key % ROWS;
    if (hasWall) {
      ctx.drawImage(SPRITES['wall'], wx * GRID, wy * GRID, GRID, GRID);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(wx * GRID + 1, wy * GRID + 1, GRID - 2, GRID - 2);
    }
  }
  ctx.shadowBlur = 0;
}

// ===== 绘制道具 =====
function drawPowerup() {
  if (!state.powerup) return;
  const GRID = state.GRID;
  const px = state.powerup.x * GRID + GRID / 2;
  const py = state.powerup.y * GRID + GRID / 2;
  const pulse = Math.sin(_time * 0.004) * 2;

  // 道具类型到精灵名的映射
  const spriteMap = {
    double: 'powerup-double',
    slow: 'powerup-slow',
    invincible: 'powerup-shield',
    shrink_pw: 'powerup-scissors'
  };

  const spriteName = spriteMap[state.powerup.type];

  // 外圈光晕（保留效果）
  ctx.strokeStyle = state.powerup.color;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.3 + 0.2 * Math.sin(_time * 0.005);
  ctx.beginPath();
  ctx.arc(px, py, GRID / 2 + 4 + pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (spriteName && spriteReady(spriteName)) {
    // 用精灵图渲染
    const size = GRID - 2;
    ctx.shadowColor = state.powerup.color;
    ctx.shadowBlur = 14;
    drawSpriteAt(spriteName, px, py, size);
    ctx.shadowBlur = 0;
  } else {
    // fallback: 原始圆形 + 文字
    ctx.fillStyle = state.powerup.color;
    ctx.shadowColor = state.powerup.color;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(px, py, GRID / 2 - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#000';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(state.powerup.icon, px, py);
    ctx.textBaseline = 'alphabetic';
  }
}

// ===== 绘制食物（像素风精灵版） =====
function drawFood(theme) {
  if (!state.food) return;
  const GRID = state.GRID;
  state.foodPulse += 0.08;
  const pulse = Math.sin(state.foodPulse) * 2.5;
  const fColor = state.foodType.color || theme.food;
  const fx = state.food.x * GRID + GRID / 2;
  const fy = state.food.y * GRID + GRID / 2;
  const baseR = Math.max(GRID / 2 - 2 + pulse, 3);

  const type = state.foodType.type;

  // 食物类型到精灵名的映射
  const spriteMap = {
    normal: 'food-normal',
    bonus: 'food-bonus',
    gold: 'food-gold',
    shrink: 'food-shrink',
    speed_food: 'food-speed'
  };

  const spriteName = spriteMap[type];
  const hasSprite = spriteName && spriteReady(spriteName);

  // 特效层（在精灵下方/上方绘制）
  if (type === 'gold') {
    // 旋转光晕效果叠加
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(_time * 0.003);
    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, baseR + 6);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.4, '#ffd700');
    grad.addColorStop(1, 'rgba(255,215,0,0)');
    ctx.fillStyle = grad;
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 18 + pulse * 3;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r1 = baseR + 3;
      const r2 = baseR + 8 + pulse;
      if (i === 0) ctx.moveTo(Math.cos(a) * r2, Math.sin(a) * r2);
      else ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      const a2 = ((i + 0.5) / 6) * Math.PI * 2;
      ctx.lineTo(Math.cos(a2) * r1, Math.sin(a2) * r1);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.25;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  } else if (type === 'bonus') {
    // 脉冲光环
    const ringPhase = (_time * 0.005) % 1;
    ctx.strokeStyle = fColor;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 1 - ringPhase;
    ctx.beginPath();
    ctx.arc(fx, fy, baseR + ringPhase * 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (type === 'shrink') {
    // 收缩波纹
    for (let r = 0; r < 3; r++) {
      const ringPhase = ((_time * 0.004 + r * 0.33) % 1);
      ctx.strokeStyle = fColor;
      ctx.lineWidth = 1;
      ctx.globalAlpha = (1 - ringPhase) * 0.5;
      ctx.beginPath();
      ctx.arc(fx, fy, baseR + 12 * (1 - ringPhase), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // 主体：精灵图或 fallback
  if (hasSprite) {
    // 脉冲动画：通过缩放精灵实现
    const scale = 1 + pulse / (GRID / 2) * 0.3;
    const size = (GRID - 4) * scale;
    ctx.shadowColor = fColor;
    ctx.shadowBlur = 10 + pulse * 3;
    drawSpriteAt(spriteName, fx, fy, size);
    ctx.shadowBlur = 0;
  } else {
    // fallback: 圆形
    ctx.fillStyle = fColor;
    ctx.shadowColor = fColor;
    ctx.shadowBlur = 10 + pulse * 3;
    ctx.beginPath();
    ctx.arc(fx, fy, baseR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

// ===== Boss 食物 =====
function drawBossFood(theme) {
  if (!state.bossFood) return;
  const GRID = state.GRID;
  const bx = state.bossFood.x * GRID + GRID / 2;
  const by = state.bossFood.y * GRID + GRID / 2;
  const pulse = Math.sin(_time * 0.005) * 3;
  const hitsLeft = state.bossFood.hitsLeft;
  const maxHits = state.bossFood.maxHits;
  const progress = 1 - hitsLeft / maxHits;

  const hasSprite = spriteReady('food-boss');

  // 外圈旋转
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(_time * 0.002);
  ctx.strokeStyle = '#ff4500';
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5 + 0.3 * Math.sin(_time * 0.004);
  ctx.beginPath();
  ctx.arc(0, 0, GRID * 0.7 + pulse, 0, Math.PI * 2 * (1 - progress));
  ctx.stroke();
  ctx.restore();

  // 主体
  if (hasSprite) {
    // 闪烁效果
    const flash = Math.sin(_time * 0.008) > 0.3;
    if (flash) {
      ctx.globalAlpha = 0.7 + 0.3 * Math.sin(_time * 0.006);
    }
    ctx.shadowColor = '#ff4500';
    ctx.shadowBlur = 15 + pulse;
    drawSpriteAt('food-boss', bx, by, GRID + 4);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = '#ff4500';
    ctx.shadowColor = '#ff4500';
    ctx.shadowBlur = 15 + pulse;
    ctx.beginPath();
    ctx.arc(bx, by, GRID / 2 + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // 显示剩余次数
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${GRID * 0.5}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(hitsLeft.toString(), bx, by);
  ctx.textBaseline = 'alphabetic';
}

// ===== 蛇身辅助函数 =====

/** 获取方向向量：从 segment a 到 segment b */
function getDir(a, b) {
  return { x: b.x - a.x, y: b.y - a.y };
}

/** 根据方向获取蛇头精灵名 */
function getHeadSprite(dir) {
  if (dir.x === 1) return 'snake-head-right';
  if (dir.x === -1) return 'snake-head-left';
  if (dir.y === -1) return 'snake-head-up';
  if (dir.y === 1) return 'snake-head-down';
  return 'snake-head-right'; // default
}

/** 根据方向获取蛇尾精灵名（尾巴朝向 = 从倒数第二节指向尾节的方向） */
function getTailSprite(dir) {
  if (dir.x === 1) return 'snake-tail-right';
  if (dir.x === -1) return 'snake-tail-left';
  if (dir.y === -1) return 'snake-tail-up';
  if (dir.y === 1) return 'snake-tail-down';
  return 'snake-tail-right';
}

/**
 * 根据前后段位置关系选择身体精灵名
 * prev -> current -> next
 */
function getBodySprite(prev, curr, next) {
  const fromDir = { x: curr.x - prev.x, y: curr.y - prev.y };
  const toDir = { x: next.x - curr.x, y: next.y - curr.y };

  // 直线
  if (fromDir.x !== 0 && toDir.x !== 0) return 'snake-body-h'; // 水平直线
  if (fromDir.y !== 0 && toDir.y !== 0) return 'snake-body-v'; // 垂直直线

  // 转弯 — 根据入方向和出方向判断拐角类型
  // tl = 从右来向上走 或 从下来向左走
  // tr = 从左来向上走 或 从下来向右走
  // bl = 从右来向下走 或 从上来向左走
  // br = 从左来向下走 或 从上来向右走

  // 用 (fromDir, toDir) 组合判断
  const fx = fromDir.x, fy = fromDir.y;
  const tx = toDir.x, ty = toDir.y;

  // 从右进(fx=1)，向上出(ty=-1) => tl（右上拐角 = 从右到上 = 右上弯，蛇身在 bottom-right 区域）
  // 从下进(fy=1)，向左出(tx=-1) => tl
  if ((fx === 1 && ty === -1) || (fy === 1 && tx === -1)) return 'snake-body-tl';

  // 从左进(fx=-1)，向上出(ty=-1) => tr
  // 从下进(fy=1)，向右出(tx=1) => tr
  if ((fx === -1 && ty === -1) || (fy === 1 && tx === 1)) return 'snake-body-tr';

  // 从右进(fx=1)，向下出(ty=1) => bl
  // 从上进(fy=-1)，向左出(tx=-1) => bl
  if ((fx === 1 && ty === 1) || (fy === -1 && tx === -1)) return 'snake-body-bl';

  // 从左进(fx=-1)，向下出(ty=1) => br
  // 从上进(fy=-1)，向右出(tx=1) => br
  if ((fx === -1 && ty === 1) || (fy === -1 && tx === 1)) return 'snake-body-br';

  // fallback
  return 'snake-body-h';
}

// ===== 绘制蛇（像素风精灵版） =====
function drawSnake(theme) {
  const GRID = state.GRID;
  const snake = state.snake;
  if (snake.length === 0) return;

  const isInvincible = state.activePowerups && state.activePowerups.invincible;
  const dir = state.dir;

  // 无敌模式 hue-rotate 效果
  if (isInvincible) {
    const hueVal = (Date.now() / 4) % 360;
    ctx.filter = `hue-rotate(${hueVal}deg) brightness(1.3)`;
  }

  if (snake.length === 1) {
    // 只有一节：画蛇头
    const headSprite = getHeadSprite(dir);
    if (spriteReady(headSprite)) {
      ctx.drawImage(SPRITES[headSprite], snake[0].x * GRID, snake[0].y * GRID, GRID, GRID);
    } else {
      // fallback
      const snakeHue = theme.snake[0];
      ctx.fillStyle = isInvincible
        ? `hsl(${(Date.now() / 10) % 360}, 100%, 60%)`
        : `hsl(${snakeHue}, ${theme.snake[1]}%, 55%)`;
      ctx.fillRect(snake[0].x * GRID + 1, snake[0].y * GRID + 1, GRID - 2, GRID - 2);
    }
    // 重置 filter
    if (isInvincible) ctx.filter = 'none';
    return;
  }

  // 多节蛇身：从尾到头绘制，让头在最上面
  for (let i = snake.length - 1; i >= 0; i--) {
    const seg = snake[i];

    if (i === 0) {
      // === 蛇头 ===
      const headSprite = getHeadSprite(dir);
      if (spriteReady(headSprite)) {
        ctx.drawImage(SPRITES[headSprite], seg.x * GRID, seg.y * GRID, GRID, GRID);
      } else {
        const snakeHue = theme.snake[0];
        ctx.fillStyle = `hsl(${snakeHue}, ${theme.snake[1]}%, 55%)`;
        ctx.fillRect(seg.x * GRID + 1, seg.y * GRID + 1, GRID - 2, GRID - 2);
      }
    } else if (i === snake.length - 1) {
      // === 蛇尾 ===
      const prev = snake[i - 1];
      // 尾巴方向：从前一节指向尾节
      const tailDir = getDir(prev, seg);
      const tailSprite = getTailSprite(tailDir);
      if (spriteReady(tailSprite)) {
        ctx.drawImage(SPRITES[tailSprite], seg.x * GRID, seg.y * GRID, GRID, GRID);
      } else {
        const t = 1 - i / snake.length;
        const snakeHue = theme.snake[0];
        const light = 28 + t * 32;
        ctx.fillStyle = `hsl(${snakeHue + (1 - t) * 25}, ${theme.snake[1]}%, ${light}%)`;
        ctx.fillRect(seg.x * GRID + 1, seg.y * GRID + 1, GRID - 2, GRID - 2);
      }
    } else {
      // === 身体段 ===
      const prev = snake[i - 1]; // 靠近头的方向
      const next = snake[i + 1]; // 靠近尾的方向
      const bodySprite = getBodySprite(prev, seg, next);
      if (spriteReady(bodySprite)) {
        ctx.drawImage(SPRITES[bodySprite], seg.x * GRID, seg.y * GRID, GRID, GRID);
      } else {
        const t = 1 - i / snake.length;
        const snakeHue = theme.snake[0];
        const light = 28 + t * 32;
        ctx.fillStyle = `hsl(${snakeHue + (1 - t) * 25}, ${theme.snake[1]}%, ${light}%)`;
        ctx.fillRect(seg.x * GRID + 1, seg.y * GRID + 1, GRID - 2, GRID - 2);
      }
    }
  }

  // 重置 filter
  if (isInvincible) ctx.filter = 'none';
}

// ===== 缩圈警告线（生存模式） =====
function drawShrinkBounds() {
  if (!state.shrinkBounds || state.selectedMode !== 'survival') return;
  const GRID = state.GRID;
  const b = state.shrinkBounds;

  ctx.strokeStyle = 'rgba(255,100,100,0.4)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(b.left * GRID, b.top * GRID, (b.right - b.left) * GRID, (b.bottom - b.top) * GRID);
  ctx.setLineDash([]);

  if (state.shrinkWarning) {
    const w = state.shrinkWarning;
    const flash = Math.sin(_time * 0.01) > 0;
    if (flash) {
      ctx.strokeStyle = 'rgba(255,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeRect(w.left * GRID, w.top * GRID, (w.right - w.left) * GRID, (w.bottom - w.top) * GRID);
    }
  }
}

// ===== 幽灵蛇 =====
function drawGhostSnake(theme) {
  if (!state.ghostSnake || state.ghostSnake.length === 0) return;
  const GRID = state.GRID;
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = `hsl(${theme.snake[0]}, ${theme.snake[1]}%, 50%)`;
  for (const seg of state.ghostSnake) {
    ctx.beginPath();
    ctx.arc(seg.x * GRID + GRID / 2, seg.y * GRID + GRID / 2, GRID * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ===== 蛇进化特效 =====
function drawEvolutionEffects(theme) {
  if (!state.snakeEvolution || state.snakeEvolution < 1 || state.snake.length === 0) return;
  const GRID = state.GRID;
  const head = state.snake[0];
  const hx = head.x * GRID + GRID / 2;
  const hy = head.y * GRID;

  // 进化1: 皇冠（用精灵图）
  if (state.snakeEvolution >= 1) {
    const crownSize = GRID * 0.6;
    if (spriteReady('snake-crown')) {
      drawSpriteAt('snake-crown', hx, hy - crownSize * 0.2, crownSize);
    } else {
      ctx.font = `${GRID * 0.5}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('\u{1F451}', hx, hy);
    }
  }

  // 进化3: 光环
  if (state.snakeEvolution >= 3) {
    ctx.strokeStyle = `hsla(${theme.snake[0]}, 100%, 70%, ${0.3 + 0.2 * Math.sin(_time * 0.003)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hx, hy + GRID / 2, GRID * 0.8, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ===== 模式专属 HUD =====
function drawModeHUD(theme) {
  const GRID = state.GRID;

  if (state.selectedMode === 'zen' && state.zenTimeLeft > 0 && state.running && !state.gameOver) {
    const min = Math.floor(state.zenTimeLeft / 60);
    const sec = state.zenTimeLeft % 60;
    ctx.fillStyle = state.zenTimeLeft <= 10 ? '#ff4444' : '#aaa';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${min}:${sec.toString().padStart(2, '0')}`, canvas.width - 8, 20);
    ctx.textAlign = 'center';
  }

  if (state.selectedMode === 'survival' && state.shrinkBounds && state.running && !state.gameOver) {
    const b = state.shrinkBounds;
    const size = `${b.right - b.left}x${b.bottom - b.top}`;
    ctx.fillStyle = '#ff6666';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`区域: ${size}`, canvas.width - 8, 20);
    ctx.textAlign = 'center';
  }
}

// ===== 暂停画面 =====
function drawPaused() {
  if (!state.paused || state.gameOver) return;
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(-10, -10, canvas.width + 20, canvas.height + 20);
  ctx.fillStyle = '#f0a500';
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#f0a500';
  ctx.shadowBlur = 20;
  ctx.fillText('暂停', canvas.width / 2, canvas.height / 2 - 10);
  ctx.shadowBlur = 0;
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#888';
  ctx.fillText('按空格继续', canvas.width / 2, canvas.height / 2 + 25);
}

// ===== 游戏结束画面 =====
function drawGameOver(theme) {
  if (!state.gameOver) return;

  if (_deathTime === 0) _deathTime = Date.now();
  const elapsed = Date.now() - _deathTime;
  _deathFade = Math.min(elapsed / 600, 1);
  if (elapsed < 200) {
    _deathZoom = 1 - (elapsed / 200) * 0.03;
  } else if (elapsed < 500) {
    _deathZoom = 0.97 + ((elapsed - 200) / 300) * 0.03;
  } else {
    _deathZoom = 1;
  }

  if (_deathFade < 1) {
    ctx.save();
    const cw = canvas.width, ch = canvas.height;
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(_deathZoom, _deathZoom);
    ctx.translate(-cw / 2, -ch / 2);
    ctx.fillStyle = `rgba(0,0,0,${_deathFade * 0.7})`;
    ctx.fillRect(-10, -10, cw + 20, ch + 20);
    ctx.restore();
    return;
  }

  ctx.fillStyle = 'rgba(0,0,0,.75)';
  ctx.fillRect(-10, -10, canvas.width + 20, canvas.height + 20);

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  ctx.shadowColor = theme.accent;
  ctx.shadowBlur = 30;
  ctx.fillStyle = theme.accent;
  ctx.font = 'bold 42px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('游戏结束', cx, cy - 55);
  ctx.shadowBlur = 0;

  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 80, cy - 35);
  ctx.lineTo(cx + 80, cy - 35);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#eee';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText(`${state.score} 分`, cx, cy - 5);

  const alive = state.startTime ? Math.floor(((_deathTime || Date.now()) - state.startTime) / 1000) : 0;
  const min = Math.floor(alive / 60);
  const sec = alive % 60;
  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#aaa';
  ctx.fillText(`存活 ${min > 0 ? min + '分' : ''}${sec}秒  ·  吃到 ${_foodEaten} 个食物`, cx, cy + 25);

  ctx.fillText(`最终长度: ${state.snake.length}`, cx, cy + 47);

  if (state.score > 0 && state.score >= getBest()) {
    ctx.fillStyle = '#f0a500';
    ctx.font = 'bold 20px sans-serif';
    ctx.shadowColor = '#f0a500';
    ctx.shadowBlur = 10;
    ctx.fillText('\u{1F3C6} 新纪录！', cx, cy + 75);
    ctx.shadowBlur = 0;
  }

  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#666';
  ctx.fillText('R 重开 · ESC 菜单', cx, cy + 100);
}

// ===== 主绘制函数 =====
export function draw() {
  _time = Date.now();
  const GRID = state.GRID;
  ctx.save();

  // 确保像素风设置（防止被外部重置）
  ctx.imageSmoothingEnabled = false;

  if (state.score !== _prevScore) {
    if (state.score > _prevScore && _prevScore >= 0) {
      triggerScorePop();
    }
    _prevScore = state.score;
  }

  if (!state.gameOver) {
    _deathTime = 0;
    _deathFade = 0;
    _deathZoom = 1;
    _deathExploded = false;
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

  drawStarfield();
  drawGrid();
  drawMaze(theme);
  drawPowerup();
  drawBossFood(theme);
  drawFood(theme);
  drawShrinkBounds();
  drawGhostSnake(theme);
  drawSnake(theme);
  drawEvolutionEffects(theme);
  drawModeHUD(theme);
  drawPaused();
  drawGameOver(theme);

  ctx.restore();
}

export function updateHUD() {
  const comboEl = $('#combo-display');
  if (state.combo >= 2) {
    const mult = state.combo < 5 ? 1.5 : state.combo < 10 ? 2 : 3;
    comboEl.textContent = `${state.combo}连击 x${mult}`;
    comboEl.classList.add('visible');
  } else {
    comboEl.classList.remove('visible');
  }

  const pwEl = $('#powerup-display');
  const active = Object.entries(state.activePowerups).filter(([k, v]) => v).map(([k]) => {
    const pw = POWERUP_TYPES.find(p => p.type === k);
    return pw ? pw.icon : '';
  });
  pwEl.textContent = active.join(' ');
}

export function getCanvas() { return canvas; }
