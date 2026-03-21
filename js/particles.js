// ============================================================
//  particles.js — 粒子系统（精简版：少即是多，柔和发光）
// ============================================================

import { $ } from './config.js';

const pCanvas = $('#particles');
const pCtx = pCanvas.getContext('2d');

// ===== 对象池 =====
const POOL_SIZE = 300;
const pool = new Array(POOL_SIZE);
let activeCount = 0;

for (let i = 0; i < POOL_SIZE; i++) {
  pool[i] = {
    active: false, type: 'normal',
    x: 0, y: 0, vx: 0, vy: 0,
    life: 0, decay: 0, size: 0,
    color: '#fff', text: '',
    radius: 0, maxRadius: 0, lineWidth: 2,
    gravity: 0, drag: 1
  };
}

function acquire() {
  for (let i = 0; i < POOL_SIZE; i++) {
    if (!pool[i].active) {
      pool[i].active = true;
      activeCount++;
      return pool[i];
    }
  }
  let minLife = Infinity, minIdx = 0;
  for (let i = 0; i < POOL_SIZE; i++) {
    if (pool[i].life < minLife) {
      minLife = pool[i].life;
      minIdx = i;
    }
  }
  return pool[minIdx];
}

function release(p) {
  if (p.active) {
    p.active = false;
    activeCount--;
  }
}

// ===== spawnP — 基础爆发粒子 =====
export function spawnP(x, y, color, count, sizeRange = [1, 3], speedRange = [1, 3]) {
  for (let i = 0; i < count; i++) {
    const p = acquire();
    const a = Math.random() * Math.PI * 2;
    const spd = speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]);
    p.type = 'normal';
    p.x = x; p.y = y;
    p.vx = Math.cos(a) * spd;
    p.vy = Math.sin(a) * spd;
    p.life = 1;
    p.decay = 0.018 + Math.random() * 0.022;
    p.size = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);
    p.color = color;
    p.gravity = 0.02;
    p.drag = 0.96;
  }
}

// ===== spawnText — 上浮文字 =====
export function spawnText(x, y, text, color) {
  const p = acquire();
  p.type = 'text';
  p.x = x; p.y = y;
  p.vx = 0; p.vy = -1;
  p.life = 1;
  p.decay = 0.015;
  p.size = 0;
  p.color = color;
  p.text = text;
  p.gravity = 0;
  p.drag = 1;
}

// ===== spawnTrail — 已废弃，保留签名 =====
export function spawnTrail(x, y, color) {
  // 不再生成粒子，拖尾效果由 renderer 直接绘制
}

// ===== spawnRipple — 圆环扩散 =====
export function spawnRipple(x, y, color, maxRadius = 40) {
  const p = acquire();
  p.type = 'ripple';
  p.x = x; p.y = y;
  p.vx = 0; p.vy = 0;
  p.life = 1;
  p.decay = 0.02;
  p.size = 0;
  p.color = color;
  p.radius = 0;
  p.maxRadius = maxRadius;
  p.lineWidth = 2;
  p.gravity = 0;
  p.drag = 1;
}

// ===== spawnSparks — 映射为少量基础粒子 =====
export function spawnSparks(x, y, color, count = 8) {
  spawnP(x, y, color, Math.min(count, 4), [1, 3], [1, 2]);
}

// ===== resize =====
function resizeP() {
  pCanvas.width = innerWidth;
  pCanvas.height = innerHeight;
}
addEventListener('resize', resizeP);
resizeP();

// ===== 更新与渲染 =====
function updateP() {
  pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);

  for (let i = 0; i < POOL_SIZE; i++) {
    const p = pool[i];
    if (!p.active) continue;

    // 物理
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.vy += p.gravity;
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;

    if (p.life <= 0) {
      release(p);
      continue;
    }

    // 平滑淡出：生命值后30%加速衰减透明度
    const alpha = p.life < 0.3 ? p.life / 0.3 * p.life : p.life;
    pCtx.globalAlpha = Math.max(0, alpha);

    if (p.type === 'text') {
      // 轻盈上浮文字
      pCtx.font = '300 16px "Inter", system-ui, sans-serif';
      pCtx.textAlign = 'center';
      pCtx.shadowColor = p.color;
      pCtx.shadowBlur = 4;
      pCtx.fillStyle = p.color;
      pCtx.fillText(p.text, p.x, p.y);
      pCtx.shadowBlur = 0;

    } else if (p.type === 'ripple') {
      // 圆环扩散
      const progress = 1 - p.life;
      p.radius = progress * p.maxRadius;
      const lw = 2 - progress * 1.5; // 2 -> 0.5
      pCtx.strokeStyle = p.color;
      pCtx.lineWidth = Math.max(0.5, lw);
      pCtx.lineCap = 'round';
      pCtx.beginPath();
      pCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      pCtx.stroke();

    } else {
      // 发光圆点粒子
      const r = Math.max(0.5, p.size * p.life);
      pCtx.shadowColor = p.color;
      pCtx.shadowBlur = 4;
      pCtx.fillStyle = p.color;
      pCtx.beginPath();
      pCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
      pCtx.fill();
      pCtx.shadowBlur = 0;
    }
  }

  pCtx.globalAlpha = 1;
  pCtx.shadowBlur = 0;
  requestAnimationFrame(updateP);
}
updateP();
