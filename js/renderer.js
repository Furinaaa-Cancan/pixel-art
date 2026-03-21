// ============================================================
//  renderer.js — Canvas 渲染（slither.io 风格）
// ============================================================

import { $, THEMES, COLS, ROWS, POWERUP_TYPES, state, getBest } from './config.js';

const canvas = $('#game');
const ctx = canvas.getContext('2d');

// ===== 内部状态 =====
let _time = 0;
let _deathTime = 0;
let _deathFade = 0;
let _deathZoom = 1;
let _scorePop = 0;
let _prevScore = 0;
let _foodEaten = 0;
let _deathExploded = false;

// ===== 缓存 =====
let _bgGradientCache = null;
let _bgCacheW = 0;
let _bgCacheH = 0;

// ===== 导出函数 =====
export function resetRendererState() {
  _foodEaten = 0;
  _deathTime = 0;
  _deathFade = 0;
  _deathZoom = 1;
  _deathExploded = false;
  _prevScore = 0;
  _scorePop = 0;
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
  // 清除背景缓存以便重建
  _bgGradientCache = null;
}

// ===== 背景：纯深色 + 微弱径向渐变 + 微弱网格点 =====
function drawBackground() {
  const w = canvas.width, h = canvas.height;
  const GRID = state.GRID;

  // 缓存径向渐变
  if (!_bgGradientCache || _bgCacheW !== w || _bgCacheH !== h) {
    _bgGradientCache = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
    _bgGradientCache.addColorStop(0, '#1a1a2e');
    _bgGradientCache.addColorStop(1, '#0f0f1a');
    _bgCacheW = w;
    _bgCacheH = h;
  }

  ctx.fillStyle = _bgGradientCache;
  ctx.fillRect(0, 0, w, h);

  // 微弱网格点（在每个格子交叉点画小圆点）
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let x = 0; x <= COLS; x++) {
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath();
      ctx.arc(x * GRID, y * GRID, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ===== 迷宫墙壁：圆角小方块 + 微弱发光 =====
function drawMaze(theme) {
  if (!state.mazeWalls) return;
  const GRID = state.GRID;
  const r = GRID * 0.15; // 圆角半径

  ctx.shadowColor = 'rgba(255,255,255,0.4)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';

  for (const key of state.mazeWalls) {
    const wx = Math.floor(key / ROWS);
    const wy = key % ROWS;
    const x = wx * GRID + 1;
    const y = wy * GRID + 1;
    const s = GRID - 2;

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
  ctx.shadowBlur = 0;
}

// ===== 食物：发光圆球 =====
function drawFood(theme) {
  if (!state.food) return;
  const GRID = state.GRID;
  state.foodPulse += 0.05;

  const fColor = state.foodType.color || theme.food;
  const fx = state.food.x * GRID + GRID / 2;
  const fy = state.food.y * GRID + GRID / 2;
  const type = state.foodType.type;

  // 微弱脉冲：半径 ±1px
  const pulse = Math.sin(state.foodPulse) * 1;
  const baseR = GRID * 0.3 + pulse;
  const isGold = type === 'gold';
  const r = isGold ? baseR * 1.3 : baseR;

  // 光晕
  ctx.shadowColor = fColor;
  ctx.shadowBlur = isGold ? 16 : 10;

  // 内部渐变球
  const grad = ctx.createRadialGradient(fx - r * 0.2, fy - r * 0.2, r * 0.1, fx, fy, r);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.3, fColor);
  grad.addColorStop(1, fColor);
  ctx.fillStyle = grad;

  ctx.beginPath();
  ctx.arc(fx, fy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

// ===== Boss 食物：大发光球 + 脉冲光环 =====
function drawBossFood(theme) {
  if (!state.bossFood) return;
  const GRID = state.GRID;
  const bx = state.bossFood.x * GRID + GRID / 2;
  const by = state.bossFood.y * GRID + GRID / 2;
  const hitsLeft = state.bossFood.hitsLeft;
  const maxHits = state.bossFood.maxHits;
  const progress = 1 - hitsLeft / maxHits;

  const pulse = Math.sin(_time * 0.005) * 2;
  const baseR = GRID * 0.5;

  // 脉冲光环
  const ringPhase = (_time * 0.003) % 1;
  ctx.strokeStyle = '#ff4500';
  ctx.lineWidth = 2;
  ctx.globalAlpha = 1 - ringPhase;
  ctx.beginPath();
  ctx.arc(bx, by, baseR + ringPhase * 20, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 进度环
  ctx.strokeStyle = 'rgba(255,69,0,0.5)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(bx, by, baseR + 6 + pulse, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - progress));
  ctx.stroke();

  // 主体发光球
  ctx.shadowColor = '#ff4500';
  ctx.shadowBlur = 18 + pulse;
  const grad = ctx.createRadialGradient(bx - baseR * 0.15, by - baseR * 0.15, baseR * 0.1, bx, by, baseR);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.3, '#ff6633');
  grad.addColorStop(1, '#ff4500');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(bx, by, baseR, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // 剩余次数
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${GRID * 0.45}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(hitsLeft.toString(), bx, by);
  ctx.textBaseline = 'alphabetic';
}

// ===== 道具：发光圆球 + emoji 图标 =====
function drawPowerup() {
  if (!state.powerup) return;
  const GRID = state.GRID;
  const px = state.powerup.x * GRID + GRID / 2;
  const py = state.powerup.y * GRID + GRID / 2;
  const color = state.powerup.color;
  const r = GRID * 0.38;

  // 外圈脉冲光晕
  const pulse = Math.sin(_time * 0.004) * 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.3 + 0.2 * Math.sin(_time * 0.005);
  ctx.beginPath();
  ctx.arc(px, py, r + 6 + pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 主体发光球
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  const grad = ctx.createRadialGradient(px - r * 0.2, py - r * 0.2, r * 0.1, px, py, r);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.35, color);
  grad.addColorStop(1, color);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // 中心 emoji 图标
  ctx.fillStyle = '#000';
  ctx.font = `${GRID * 0.4}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(state.powerup.icon, px, py);
  ctx.textBaseline = 'alphabetic';
}

// ===== 蛇：slither.io 风格重叠圆 =====
function drawSnake(theme) {
  const GRID = state.GRID;
  const snake = state.snake;
  if (snake.length === 0) return;

  const isInvincible = state.activePowerups && state.activePowerups.invincible;
  const snakeHue = theme.snake[0];
  const snakeSat = theme.snake[1];

  // 从尾到头绘制（头在最上层）
  for (let i = snake.length - 1; i >= 0; i--) {
    const t = i / Math.max(snake.length - 1, 1); // 0=头 1=尾
    const seg = snake[i];
    const x = seg.x * GRID + GRID / 2;
    const y = seg.y * GRID + GRID / 2;

    // 半径：头大尾小
    const radius = GRID * 0.45 * (1 - t * 0.35);

    // 颜色
    let hue, sat, light;
    if (isInvincible) {
      // 柔和彩虹色缓慢过渡
      hue = ((_time * 0.05) + i * 12) % 360;
      sat = 70;
      light = 55;
    } else {
      hue = snakeHue + t * 20;
      sat = snakeSat;
      light = 48 + (1 - t) * 12;
    }

    const bodyColor = `hsl(${hue}, ${sat}%, ${light}%)`;
    const glowColor = `hsla(${hue}, ${sat}%, ${light + 15}%, 0.6)`;

    // 外发光（越靠近头越亮）
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 7 * (1 - t * 0.5);

    // 身体圆：渐变球
    const grad = ctx.createRadialGradient(
      x - radius * 0.2, y - radius * 0.2, radius * 0.05,
      x, y, radius
    );
    const lightColor = `hsl(${hue}, ${sat}%, ${light + 12}%)`;
    grad.addColorStop(0, lightColor);
    grad.addColorStop(0.7, bodyColor);
    grad.addColorStop(1, `hsl(${hue}, ${sat}%, ${light - 8}%)`);
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // 蛇头眼睛
  if (snake.length > 0) {
    const head = snake[0];
    const hx = head.x * GRID + GRID / 2;
    const hy = head.y * GRID + GRID / 2;
    const headR = GRID * 0.45;
    const dir = state.dir;

    // 计算眼睛位置（根据方向偏移）
    const eyeOffsetForward = headR * 0.3;
    const eyeOffsetSide = headR * 0.35;
    const eyeR = headR * 0.22;
    const pupilR = eyeR * 0.55;

    let eye1x, eye1y, eye2x, eye2y;
    let pupilDx = dir.x * pupilR * 0.3;
    let pupilDy = dir.y * pupilR * 0.3;

    if (dir.x === 1) { // 右
      eye1x = hx + eyeOffsetForward; eye1y = hy - eyeOffsetSide;
      eye2x = hx + eyeOffsetForward; eye2y = hy + eyeOffsetSide;
    } else if (dir.x === -1) { // 左
      eye1x = hx - eyeOffsetForward; eye1y = hy - eyeOffsetSide;
      eye2x = hx - eyeOffsetForward; eye2y = hy + eyeOffsetSide;
    } else if (dir.y === -1) { // 上
      eye1x = hx - eyeOffsetSide; eye1y = hy - eyeOffsetForward;
      eye2x = hx + eyeOffsetSide; eye2y = hy - eyeOffsetForward;
    } else { // 下或默认
      eye1x = hx - eyeOffsetSide; eye1y = hy + eyeOffsetForward;
      eye2x = hx + eyeOffsetSide; eye2y = hy + eyeOffsetForward;
    }

    // 白色眼白
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(eye1x, eye1y, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(eye2x, eye2y, eyeR, 0, Math.PI * 2);
    ctx.fill();

    // 黑色瞳孔
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(eye1x + pupilDx, eye1y + pupilDy, pupilR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(eye2x + pupilDx, eye2y + pupilDy, pupilR, 0, Math.PI * 2);
    ctx.fill();
  }
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
  ctx.globalAlpha = 0.15;

  for (let i = state.ghostSnake.length - 1; i >= 0; i--) {
    const seg = state.ghostSnake[i];
    const t = i / Math.max(state.ghostSnake.length - 1, 1);
    const r = GRID * 0.35 * (1 - t * 0.3);
    ctx.fillStyle = `hsl(${theme.snake[0]}, ${theme.snake[1]}%, 50%)`;
    ctx.beginPath();
    ctx.arc(seg.x * GRID + GRID / 2, seg.y * GRID + GRID / 2, r, 0, Math.PI * 2);
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

  // 进化1: 皇冠 emoji
  if (state.snakeEvolution >= 1) {
    ctx.font = `${GRID * 0.45}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u{1F451}', hx, hy - GRID * 0.1);
    ctx.textBaseline = 'alphabetic';
  }

  // 进化3: 光环
  if (state.snakeEvolution >= 3) {
    ctx.strokeStyle = `hsla(${theme.snake[0]}, 80%, 65%, ${0.25 + 0.15 * Math.sin(_time * 0.003)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hx, hy + GRID / 2, GRID * 0.7, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ===== 模式专属 HUD =====
function drawModeHUD(theme) {
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
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(-10, -10, canvas.width + 20, canvas.height + 20);

  ctx.fillStyle = '#f0a500';
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('暂停', canvas.width / 2, canvas.height / 2 - 10);

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

  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(-10, -10, canvas.width + 20, canvas.height + 20);

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  ctx.fillStyle = '#eee';
  ctx.font = 'bold 38px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('游戏结束', cx, cy - 55);

  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 80, cy - 35);
  ctx.lineTo(cx + 80, cy - 35);
  ctx.stroke();

  ctx.fillStyle = '#fff';
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
    ctx.fillText('\u{1F3C6} 新纪录！', cx, cy + 75);
  }

  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#666';
  ctx.fillText('R 重开 · ESC 菜单', cx, cy + 100);
}

// ===== 主绘制函数 =====
export function draw() {
  _time = Date.now();
  ctx.save();

  ctx.imageSmoothingEnabled = true;

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

  drawBackground();
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
