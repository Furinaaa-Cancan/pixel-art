// ============================================================
//  config.js — 常量、配置、共享状态
// ============================================================

export const $ = s => document.querySelector(s);
export const $$ = s => document.querySelectorAll(s);

// ===== 主题 =====
export const THEMES = {
  default: { class: '', snake: [145, 80], food: '#e94560', accent: '#e94560' },
  neon:    { class: 'theme-neon', snake: [180, 90], food: '#0ff', accent: '#0ff' },
  retro:   { class: 'theme-retro', snake: [25, 85], food: '#ff6b35', accent: '#ff6b35' },
  cyber:   { class: 'theme-cyber', snake: [280, 80], food: '#bf00ff', accent: '#bf00ff' },
};

// ===== 难度 =====
export const DIFF = {
  easy:   { speed: 150, accel: 1, min: 85 },
  normal: { speed: 110, accel: 2, min: 55 },
  hard:   { speed: 70,  accel: 3, min: 35 },
};

// ===== 食物类型 =====
export const FOOD_TYPES = [
  { type: 'normal', color: null, points: 10, weight: 60 },
  { type: 'bonus',  color: '#00ff88', points: 25, weight: 20 },
  { type: 'gold',   color: '#ffd700', points: 50, weight: 8, duration: 5000 },
  { type: 'shrink', color: '#ff69b4', points: 5, weight: 7 },
  { type: 'speed_food', color: '#00bfff', points: 15, weight: 5 },
];

// ===== 道具类型 =====
export const POWERUP_TYPES = [
  { type: 'double',     icon: 'x2',  color: '#ffd700', desc: '双倍积分', duration: 8000 },
  { type: 'slow',       icon: '\u{1F422}',  color: '#00ff88', desc: '减速', duration: 6000 },
  { type: 'invincible', icon: '\u{1F6E1}\uFE0F',  color: '#0ff',    desc: '无敌', duration: 5000 },
  { type: 'shrink_pw',  icon: '\u2702\uFE0F',  color: '#ff69b4', desc: '缩短', duration: 0 },
];

// ===== 成就 =====
export const ACHIEVEMENTS = [
  { id: 'first_blood',  icon: '\u{1FA78}', name: '初见', desc: '第一次吃到食物' },
  { id: 'score_100',    icon: '\u{1F4AF}', name: '百分选手', desc: '单局得分达到 100' },
  { id: 'score_500',    icon: '\u{1F525}', name: '火力全开', desc: '单局得分达到 500' },
  { id: 'score_1000',   icon: '\u{1F451}', name: '蛇王', desc: '单局得分达到 1000' },
  { id: 'combo_3',      icon: '\u26A1', name: '三连击', desc: '达成 3 连击' },
  { id: 'combo_5',      icon: '\u{1F4A5}', name: '五连杀', desc: '达成 5 连击' },
  { id: 'combo_10',     icon: '\u{1F31F}', name: '超神', desc: '达成 10 连击' },
  { id: 'gold_eat',     icon: '\u{1F947}', name: '淘金者', desc: '吃到金色食物' },
  { id: 'powerup_5',    icon: '\u{1F48A}', name: '道具达人', desc: '累计拾取 5 个道具' },
  { id: 'survive_60',   icon: '\u23F1\uFE0F', name: '持久战', desc: '单局存活 60 秒' },
  { id: 'survive_180',  icon: '\u{1F3C6}', name: '耐力王', desc: '单局存活 180 秒' },
  { id: 'nowalls_win',  icon: '\u{1F300}', name: '穿越者', desc: '在穿墙模式得分 200+' },
  { id: 'maze_win',     icon: '\u{1F9F1}', name: '迷宫大师', desc: '在迷宫模式得分 200+' },
  { id: 'speed_win',    icon: '\u26A1', name: '闪电侠', desc: '在极速模式得分 200+' },
  { id: 'long_snake',   icon: '\u{1F40D}', name: '巨蟒', desc: '蛇身长度达到 30' },
  { id: 'invincible',   icon: '\u{1F6E1}\uFE0F', name: '无敌', desc: '使用无敌道具撞墙存活' },
];

// ===== 网格 =====
export const COLS = 20;
export const ROWS = 20;

// ===== 共享可变状态 =====
export const state = {
  currentTheme: 'default',
  selectedMode: 'classic',
  selectedDiff: 'normal',
  snake: [],
  dir: { x: 0, y: 0 },
  nextDir: { x: 0, y: 0 },
  food: null,
  foodType: null,
  foodTimer: null,
  powerup: null,
  activePowerups: {},
  powerupTimers: {},
  score: 0,
  combo: 0,
  comboTimer: null,
  lastEatTime: 0,
  running: false,
  gameOver: false,
  paused: false,
  speed: 0,
  timer: null,
  mazeWalls: null,
  startTime: 0,
  totalPowerupsCollected: 0,
  foodPulse: 0,
  screenShake: 0,
  animFrame: null,
  GRID: 20,
};

// ===== 工具函数 =====
export function applyTheme(t) {
  state.currentTheme = t;
  document.body.className = THEMES[t].class;
}

export function canvasToScreen(gx, gy) {
  const canvas = $('#game');
  const r = canvas.getBoundingClientRect();
  return { x: r.left + gx * state.GRID + state.GRID / 2, y: r.top + gy * state.GRID + state.GRID / 2 };
}

export function getBest(mode) {
  const m = mode || state.selectedMode;
  return parseInt(localStorage.getItem(`snake_best_${m}`) || '0', 10);
}

export function saveBest(s, mode) {
  const m = mode || state.selectedMode;
  if (s > getBest(m)) localStorage.setItem(`snake_best_${m}`, s);
}

export function showBest() {
  const b = getBest();
  $('#best-display').textContent = b > 0 ? `最高 ${b}` : '';
  $('#menu-best').textContent = b > 0 ? `历史最高分: ${b} (${state.selectedMode})` : '';
}
