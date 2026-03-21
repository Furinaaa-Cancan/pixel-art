// ============================================================
//  particles.js — 粒子系统（升级版：对象池 + 新粒子类型 + 物理）
// ============================================================

import { $ } from './config.js';

const pCanvas = $('#particles');
const pCtx = pCanvas.getContext('2d');

// ===== 对象池 =====
const POOL_SIZE = 300;
const pool = new Array(POOL_SIZE);
let activeCount = 0;

// 粒子属性：
// type: 'normal' | 'text' | 'trail' | 'ripple' | 'spark'
// x, y, vx, vy, life, decay, size, color
// text (for text type), radius/maxRadius (for ripple), gravity, drag
// active: boolean

for (let i = 0; i < POOL_SIZE; i++) {
  pool[i] = {
    active: false,
    type: 'normal',
    x: 0, y: 0, vx: 0, vy: 0,
    life: 0, decay: 0, size: 0,
    color: '#fff',
    text: '',
    radius: 0, maxRadius: 0, lineWidth: 2,
    gravity: 0, drag: 1
  };
}

function acquire() {
  // 找一个空闲粒子
  for (let i = 0; i < POOL_SIZE; i++) {
    if (!pool[i].active) {
      pool[i].active = true;
      activeCount++;
      return pool[i];
    }
  }
  // 池满则复用最老的（life 最低的）
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

// ===== 导出：生成普通粒子 =====
export function spawnP(x, y, color, count, sizeRange = [2, 5], speedRange = [1, 4]) {
  for (let i = 0; i < count; i++) {
    const p = acquire();
    const a = Math.random() * Math.PI * 2;
    const spd = speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]);
    p.type = 'normal';
    p.x = x; p.y = y;
    p.vx = Math.cos(a) * spd;
    p.vy = Math.sin(a) * spd;
    p.life = 1;
    p.decay = 0.015 + Math.random() * 0.025;
    p.size = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);
    p.color = color;
    p.gravity = 0.03 + Math.random() * 0.02; // 轻微重力
    p.drag = 0.98; // 阻力
  }
}

// ===== 导出：生成文字粒子 =====
export function spawnText(x, y, text, color) {
  const p = acquire();
  p.type = 'text';
  p.x = x; p.y = y;
  p.vx = 0; p.vy = -1.5;
  p.life = 1;
  p.decay = 0.018;
  p.size = 0;
  p.color = color;
  p.text = text;
  p.gravity = 0;
  p.drag = 1;
}

// ===== 导出：生成拖尾粒子 =====
export function spawnTrail(x, y, color) {
  const p = acquire();
  p.type = 'normal'; // 普通渲染即可
  p.x = x + (Math.random() - 0.5) * 4;
  p.y = y + (Math.random() - 0.5) * 4;
  p.vx = (Math.random() - 0.5) * 0.3;
  p.vy = (Math.random() - 0.5) * 0.3;
  p.life = 0.6 + Math.random() * 0.3;
  p.decay = 0.03 + Math.random() * 0.02;
  p.size = 1.5 + Math.random() * 2;
  p.color = color;
  p.gravity = 0;
  p.drag = 0.99;
}

// ===== 导出：生成涟漪粒子（圆环扩散） =====
export function spawnRipple(x, y, color, maxRadius = 40) {
  const p = acquire();
  p.type = 'ripple';
  p.x = x; p.y = y;
  p.vx = 0; p.vy = 0;
  p.life = 1;
  p.decay = 0.025;
  p.size = 0;
  p.color = color;
  p.radius = 0;
  p.maxRadius = maxRadius;
  p.lineWidth = 2.5;
  p.gravity = 0;
  p.drag = 1;
}

// ===== 导出：生成火花粒子（对角线运动，用于 combo） =====
export function spawnSparks(x, y, color, count = 8) {
  for (let i = 0; i < count; i++) {
    const p = acquire();
    p.type = 'spark';
    // 对角线方向
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
    const spd = 2 + Math.random() * 3;
    p.x = x; p.y = y;
    p.vx = Math.cos(angle) * spd;
    p.vy = Math.sin(angle) * spd;
    p.life = 1;
    p.decay = 0.02 + Math.random() * 0.015;
    p.size = 1 + Math.random() * 2;
    p.color = color;
    p.gravity = 0.06; // 重力让火花下落
    p.drag = 0.97;
  }
}

// ===== 粒子 resize =====
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

    // 物理更新
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

    pCtx.globalAlpha = Math.max(0, p.life);

    if (p.type === 'text') {
      pCtx.fillStyle = p.color;
      pCtx.font = 'bold 18px sans-serif';
      pCtx.textAlign = 'center';
      // 文字稍微放大然后缩回
      const scale = p.life > 0.8 ? 1 + (1 - p.life) * 3 : 1;
      pCtx.save();
      pCtx.translate(p.x, p.y);
      pCtx.scale(scale, scale);
      pCtx.fillText(p.text, 0, 0);
      pCtx.restore();
    } else if (p.type === 'ripple') {
      // 圆环扩散
      const progress = 1 - p.life;
      p.radius = progress * p.maxRadius;
      pCtx.strokeStyle = p.color;
      pCtx.lineWidth = p.lineWidth * p.life;
      pCtx.beginPath();
      pCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      pCtx.stroke();
    } else if (p.type === 'spark') {
      // 火花：画一条短线（运动方向的尾迹）
      pCtx.strokeStyle = p.color;
      pCtx.lineWidth = p.size * p.life;
      pCtx.lineCap = 'round';
      pCtx.beginPath();
      pCtx.moveTo(p.x, p.y);
      pCtx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3);
      pCtx.stroke();
    } else {
      // 普通粒子
      pCtx.fillStyle = p.color;
      pCtx.beginPath();
      pCtx.arc(p.x, p.y, Math.max(0.5, p.size * p.life), 0, Math.PI * 2);
      pCtx.fill();
    }
  }

  pCtx.globalAlpha = 1;
  requestAnimationFrame(updateP);
}
updateP();
