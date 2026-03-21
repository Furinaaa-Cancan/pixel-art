// ============================================================
//  renderer.js — Canvas 渲染（升级版：贝塞尔蛇身、动态背景、特效）
// ============================================================

import { $, THEMES, COLS, ROWS, POWERUP_TYPES, state, getBest } from './config.js';

const canvas = $('#game');
const ctx = canvas.getContext('2d');

// ===== 内部状态 =====
let _time = 0;                    // 全局动画时间
let _deathTime = 0;               // 死亡时间戳
let _deathFade = 0;               // 死亡灰度渐变 0~1
let _deathZoom = 1;               // 死亡缩放
let _scorePop = 0;                // 分数弹跳倒计时
let _prevScore = 0;               // 上一帧分数
let _stars = [];                  // 星空背景粒子
let _tonguePhase = 0;             // 舌头动画相位
let _foodEaten = 0;               // 已吃食物计数（用于结算屏幕）
let _deathExploded = false;       // 是否已触发逐节爆炸

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

// ===== 导出：重置食物计数（可由 game.js 调用） =====
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
    // force reflow
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

// ===== 绘制呼吸网格 =====
function drawGrid() {
  const GRID = state.GRID;
  const breath = 0.03 + 0.015 * Math.sin(_time * 0.0015);
  ctx.strokeStyle = `rgba(255,255,255,${breath})`;
  ctx.lineWidth = 0.5;
  // 画竖线和横线而非每个格子的 strokeRect — 性能更好
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

// ===== 绘制迷宫墙壁 =====
function drawMaze(theme) {
  if (!state.mazeWalls) return;
  const GRID = state.GRID;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.shadowColor = theme.accent;
  ctx.shadowBlur = 6;
  for (const key of state.mazeWalls) {
    const wx = Math.floor(key / ROWS);
    const wy = key % ROWS;
    ctx.fillRect(wx * GRID + 1, wy * GRID + 1, GRID - 2, GRID - 2);
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

  // 外圈光晕
  ctx.strokeStyle = state.powerup.color;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.3 + 0.2 * Math.sin(_time * 0.005);
  ctx.beginPath();
  ctx.arc(px, py, GRID / 2 + 4 + pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

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

// ===== 绘制食物（升级版：不同类型不同效果） =====
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

  if (type === 'gold') {
    // 旋转光晕
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
    // 画星形光芒
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
    // 主体
    ctx.fillStyle = fColor;
    ctx.shadowColor = fColor;
    ctx.shadowBlur = 14 + pulse * 3;
    ctx.beginPath();
    ctx.arc(fx, fy, baseR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
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
    // 主体
    ctx.fillStyle = fColor;
    ctx.shadowColor = fColor;
    ctx.shadowBlur = 12 + pulse * 2;
    ctx.beginPath();
    ctx.arc(fx, fy, baseR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  } else if (type === 'shrink') {
    // 收缩波纹（多圈）
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
    ctx.fillStyle = fColor;
    ctx.shadowColor = fColor;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(fx, fy, baseR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  } else {
    // 普通食物
    ctx.fillStyle = fColor;
    ctx.shadowColor = fColor;
    ctx.shadowBlur = 10 + pulse * 3;
    ctx.beginPath();
    ctx.arc(fx, fy, baseR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

// ===== 贝塞尔蛇身渲染 =====
function drawSnake(theme) {
  const GRID = state.GRID;
  const snake = state.snake;
  if (snake.length === 0) return;

  const isInvincible = state.activePowerups && state.activePowerups.invincible;
  const snakeHue = theme.snake[0];
  const snakeSat = theme.snake[1];

  // 预计算蛇身中心点坐标
  const pts = snake.map(seg => ({
    x: seg.x * GRID + GRID / 2,
    y: seg.y * GRID + GRID / 2
  }));

  if (snake.length === 1) {
    // 只有一节，画圆
    const width = GRID * 0.45;
    ctx.fillStyle = isInvincible
      ? `hsl(${(Date.now() / 10) % 360}, 100%, 60%)`
      : `hsl(${snakeHue}, ${snakeSat}%, 55%)`;
    if (isInvincible) { ctx.shadowColor = '#fff'; ctx.shadowBlur = 10; }
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, width, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    drawSnakeHead(pts[0].x, pts[0].y, GRID * 0.45, theme, isInvincible, snakeHue);
    return;
  }

  // 多节蛇身：用渐变宽度的贝塞尔曲线
  // 策略：沿蛇身路径绘制多个圆形（伪贝塞尔），并在相邻段之间连接
  const headWidth = GRID * 0.44;
  const tailWidth = GRID * 0.15;

  // 从尾到头绘制，让头在最上面
  for (let i = snake.length - 1; i >= 0; i--) {
    const t = 1 - i / (snake.length);
    const segWidth = tailWidth + (headWidth - tailWidth) * t;
    const light = 28 + t * 32;

    if (isInvincible) {
      ctx.fillStyle = `hsl(${(Date.now() / 10 + i * 20) % 360}, 100%, 60%)`;
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 8;
    } else {
      ctx.fillStyle = `hsl(${snakeHue + (1 - t) * 25}, ${snakeSat}%, ${light}%)`;
      ctx.shadowBlur = 0;
    }

    // 当前节和下一节之间画连接体
    if (i < snake.length - 1) {
      const curr = pts[i];
      const next = pts[i + 1];
      const nextT = 1 - (i + 1) / (snake.length);
      const nextWidth = tailWidth + (headWidth - tailWidth) * nextT;

      // 中间点
      const mx = (curr.x + next.x) / 2;
      const my = (curr.y + next.y) / 2;

      // 用粗线条模拟连接
      ctx.lineWidth = Math.min(segWidth, nextWidth) * 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      ctx.moveTo(curr.x, curr.y);
      // 如果有 i-1 节作为控制点，用贝塞尔
      if (i > 0) {
        const prev = pts[i - 1];
        const cx = curr.x + (curr.x - prev.x) * 0.15;
        const cy = curr.y + (curr.y - prev.y) * 0.15;
        ctx.quadraticCurveTo(cx, cy, mx, my);
      } else {
        ctx.lineTo(mx, my);
      }
      ctx.stroke();
    }

    // 画圆节点
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, segWidth, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // 蛇头特效
  drawSnakeHead(pts[0].x, pts[0].y, headWidth, theme, isInvincible, snakeHue);
}

// ===== 蛇头细节：发光眼睛 + 吐舌 =====
function drawSnakeHead(cx, cy, radius, theme, isInvincible, snakeHue) {
  const dir = state.dir;
  const dx = dir.x || 0;
  const dy = dir.y || 0;

  // 发光核心
  ctx.shadowColor = isInvincible ? '#fff' : `hsl(${snakeHue}, 100%, 70%)`;
  ctx.shadowBlur = 15;
  ctx.fillStyle = isInvincible ? 'rgba(255,255,255,0.4)' : `hsla(${snakeHue}, 100%, 70%, 0.4)`;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // 眼睛 — 更大、更明显的发光眼睛
  const eyeOff = radius * 0.5;
  const eyeR = radius * 0.28;
  const pupilR = eyeR * 0.5;
  const ex1 = cx + dx * eyeOff - dy * eyeOff * 0.65;
  const ey1 = cy + dy * eyeOff + dx * eyeOff * 0.65;
  const ex2 = cx + dx * eyeOff + dy * eyeOff * 0.65;
  const ey2 = cy + dy * eyeOff - dx * eyeOff * 0.65;

  // 眼白（发光）
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(ex1, ey1, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ex2, ey2, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // 瞳孔
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(ex1 + dx * 1.5, ey1 + dy * 1.5, pupilR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ex2 + dx * 1.5, ey2 + dy * 1.5, pupilR, 0, Math.PI * 2);
  ctx.fill();

  // 瞳孔高光
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(ex1 + dx * 0.5 - 0.5, ey1 + dy * 0.5 - 0.5, pupilR * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ex2 + dx * 0.5 - 0.5, ey2 + dy * 0.5 - 0.5, pupilR * 0.4, 0, Math.PI * 2);
  ctx.fill();

  // 吐舌动画（正弦波控制伸缩）
  if (dx !== 0 || dy !== 0) {
    _tonguePhase += 0.12;
    const tongueLen = 4 + Math.sin(_tonguePhase) * 4;
    const tongueBase = radius * 0.8;
    const bx = cx + dx * tongueBase;
    const by = cy + dy * tongueBase;
    const tipX = bx + dx * tongueLen;
    const tipY = by + dy * tongueLen;
    const forkLen = 3;
    const forkAngle = 0.4;

    ctx.strokeStyle = '#e33';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // 分叉
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(
      tipX + Math.cos(Math.atan2(dy, dx) - forkAngle) * forkLen,
      tipY + Math.sin(Math.atan2(dy, dx) - forkAngle) * forkLen
    );
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(
      tipX + Math.cos(Math.atan2(dy, dx) + forkAngle) * forkLen,
      tipY + Math.sin(Math.atan2(dy, dx) + forkAngle) * forkLen
    );
    ctx.stroke();
  }
}

// ===== Boss食物 =====
function drawBossFood(theme) {
  if (!state.bossFood) return;
  const GRID = state.GRID;
  const bx = state.bossFood.x * GRID + GRID / 2;
  const by = state.bossFood.y * GRID + GRID / 2;
  const pulse = Math.sin(_time * 0.005) * 3;
  const hitsLeft = state.bossFood.hitsLeft;
  const maxHits = state.bossFood.maxHits;
  const progress = 1 - hitsLeft / maxHits;

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
  ctx.fillStyle = '#ff4500';
  ctx.shadowColor = '#ff4500';
  ctx.shadowBlur = 15 + pulse;
  ctx.beginPath();
  ctx.arc(bx, by, GRID / 2 + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // 显示剩余次数
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${GRID * 0.5}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(hitsLeft.toString(), bx, by);
  ctx.textBaseline = 'alphabetic';
}

// ===== 缩圈警告线（生存模式） =====
function drawShrinkBounds() {
  if (!state.shrinkBounds || state.selectedMode !== 'survival') return;
  const GRID = state.GRID;
  const b = state.shrinkBounds;

  // 绘制当前边界
  ctx.strokeStyle = 'rgba(255,100,100,0.4)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(b.left * GRID, b.top * GRID, (b.right - b.left) * GRID, (b.bottom - b.top) * GRID);
  ctx.setLineDash([]);

  // 缩圈警告闪烁
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
  const hy = head.y * GRID + GRID / 2;

  // 进化1: 皇冠
  if (state.snakeEvolution >= 1) {
    ctx.font = `${GRID * 0.5}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('\u{1F451}', hx, hy - GRID * 0.5);
  }

  // 进化3: 光环
  if (state.snakeEvolution >= 3) {
    ctx.strokeStyle = `hsla(${theme.snake[0]}, 100%, 70%, ${0.3 + 0.2 * Math.sin(_time * 0.003)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hx, hy, GRID * 0.8, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ===== 模式专属HUD =====
function drawModeHUD(theme) {
  const GRID = state.GRID;

  // 禅模式计时器
  if (state.selectedMode === 'zen' && state.zenTimeLeft > 0 && state.running && !state.gameOver) {
    const min = Math.floor(state.zenTimeLeft / 60);
    const sec = state.zenTimeLeft % 60;
    ctx.fillStyle = state.zenTimeLeft <= 10 ? '#ff4444' : '#aaa';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${min}:${sec.toString().padStart(2, '0')}`, canvas.width - 8, 20);
    ctx.textAlign = 'center';
  }

  // 生存模式区域大小
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

// ===== 游戏结束画面（升级版） =====
function drawGameOver(theme) {
  if (!state.gameOver) return;

  // 计算死亡动画进度
  if (_deathTime === 0) _deathTime = Date.now();
  const elapsed = Date.now() - _deathTime;
  _deathFade = Math.min(elapsed / 600, 1);
  // 缩放效果：先缩小再恢复
  if (elapsed < 200) {
    _deathZoom = 1 - (elapsed / 200) * 0.03;
  } else if (elapsed < 500) {
    _deathZoom = 0.97 + ((elapsed - 200) / 300) * 0.03;
  } else {
    _deathZoom = 1;
  }

  // 灰度+缩放
  if (_deathFade < 1) {
    ctx.save();
    const cw = canvas.width, ch = canvas.height;
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(_deathZoom, _deathZoom);
    ctx.translate(-cw / 2, -ch / 2);
    // 叠加灰色半透明层模拟变灰
    ctx.fillStyle = `rgba(0,0,0,${_deathFade * 0.7})`;
    ctx.fillRect(-10, -10, cw + 20, ch + 20);
    ctx.restore();
    return; // 动画期间只显示灰度效果
  }

  // 全暗背景
  ctx.fillStyle = 'rgba(0,0,0,.75)';
  ctx.fillRect(-10, -10, canvas.width + 20, canvas.height + 20);

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  // 标题
  ctx.shadowColor = theme.accent;
  ctx.shadowBlur = 30;
  ctx.fillStyle = theme.accent;
  ctx.font = 'bold 42px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('游戏结束', cx, cy - 55);
  ctx.shadowBlur = 0;

  // 分隔线
  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 80, cy - 35);
  ctx.lineTo(cx + 80, cy - 35);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 得分
  ctx.fillStyle = '#eee';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText(`${state.score} 分`, cx, cy - 5);

  // 存活时间
  const alive = state.startTime ? Math.floor(((_deathTime || Date.now()) - state.startTime) / 1000) : 0;
  const min = Math.floor(alive / 60);
  const sec = alive % 60;
  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#aaa';
  ctx.fillText(`存活 ${min > 0 ? min + '分' : ''}${sec}秒  ·  吃到 ${_foodEaten} 个食物`, cx, cy + 25);

  // 蛇身长度
  ctx.fillText(`最终长度: ${state.snake.length}`, cx, cy + 47);

  // 新纪录
  if (state.score > 0 && state.score >= getBest()) {
    ctx.fillStyle = '#f0a500';
    ctx.font = 'bold 20px sans-serif';
    ctx.shadowColor = '#f0a500';
    ctx.shadowBlur = 10;
    ctx.fillText('🏆 新纪录！', cx, cy + 75);
    ctx.shadowBlur = 0;
  }

  // 提示
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#666';
  ctx.fillText('R 重开 · ESC 菜单', cx, cy + 100);
}

// ===== 主绘制函数 =====
export function draw() {
  _time = Date.now();
  const GRID = state.GRID;
  ctx.save();

  // 检测分数变化
  if (state.score !== _prevScore) {
    if (state.score > _prevScore && _prevScore >= 0) {
      triggerScorePop();
    }
    _prevScore = state.score;
  }

  // 重置死亡状态
  if (!state.gameOver) {
    _deathTime = 0;
    _deathFade = 0;
    _deathZoom = 1;
    _deathExploded = false;
  }

  // 屏幕震动
  if (state.screenShake > 0) {
    const sx = (Math.random() - 0.5) * state.screenShake;
    const sy = (Math.random() - 0.5) * state.screenShake;
    ctx.translate(sx, sy);
    state.screenShake *= 0.85;
    if (state.screenShake < 0.5) state.screenShake = 0;
  }

  ctx.clearRect(-10, -10, canvas.width + 20, canvas.height + 20);

  const theme = THEMES[state.currentTheme];

  // 星空
  drawStarfield();

  // 网格
  drawGrid();

  // 迷宫
  drawMaze(theme);

  // 道具
  drawPowerup();

  // Boss食物
  drawBossFood(theme);

  // 食物
  drawFood(theme);

  // 缩圈警告线（生存模式）
  drawShrinkBounds();

  // 幽灵蛇
  drawGhostSnake(theme);

  // 蛇
  drawSnake(theme);

  // 蛇进化特效
  drawEvolutionEffects(theme);

  // 禅模式/生存模式 HUD
  drawModeHUD(theme);

  // 暂停
  drawPaused();

  // 游戏结束
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
