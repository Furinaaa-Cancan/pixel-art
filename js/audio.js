// ============================================================
//  audio.js — 程序化分层BGM引擎 + 高级音效系统
// ============================================================

import { $ } from './config.js';

const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx;

// ===== 主控 =====
let masterGain;
let reverbSend;   // 混响发送通道
let reverbReturn; // 混响返回通道
let dryGain;      // 干声通道

// ===== 音效并发控制 =====
const MAX_CONCURRENT = 8;
const activeSfx = []; // { node, startTime }

// ===== BGM 状态 =====
let bgmPlaying = false;
let bgmLayers = {};       // bass, melody, percussion, high
let bgmScheduler = null;  // requestAnimationFrame / setTimeout id
let bgmBPM = 120;
let bgmBeat = 0;
let bgmNextBeatTime = 0;
let bgmScore = 0;
let bgmSpeed = 100;
let bgmMasterGain;

// ============================================================
//  初始化
// ============================================================
export function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new AudioCtx();

  // 主增益
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.8;
  masterGain.connect(audioCtx.destination);

  // 干声通道
  dryGain = audioCtx.createGain();
  dryGain.gain.value = 0.85;
  dryGain.connect(masterGain);

  // 简易延迟线混响
  _createReverb();

  // BGM 主增益
  bgmMasterGain = audioCtx.createGain();
  bgmMasterGain.gain.value = 0;
  bgmMasterGain.connect(masterGain);
}

// ===== 简易混响（延迟线模拟） =====
function _createReverb() {
  reverbSend = audioCtx.createGain();
  reverbSend.gain.value = 0.25;

  reverbReturn = audioCtx.createGain();
  reverbReturn.gain.value = 0.35;
  reverbReturn.connect(masterGain);

  // 4条不同延迟时间的延迟线 => 模拟早期反射
  const delays = [0.031, 0.047, 0.071, 0.097];
  const gains  = [0.4,   0.35,  0.25,  0.2];
  delays.forEach((t, i) => {
    const d = audioCtx.createDelay(0.2);
    d.delayTime.value = t;
    const g = audioCtx.createGain();
    g.gain.value = gains[i];
    // 加一个低通滤波让混响更自然
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3000 - i * 400;
    reverbSend.connect(d);
    d.connect(lp);
    lp.connect(g);
    g.connect(reverbReturn);
  });
}

// ===== 音效路由：干声 + 混响发送 =====
function _sfxOutput() {
  return { dry: dryGain, reverb: reverbSend };
}

// ===== 并发管理 =====
function _trackSfx(node) {
  activeSfx.push({ node, t: audioCtx.currentTime });
  if (activeSfx.length > MAX_CONCURRENT) {
    const oldest = activeSfx.shift();
    try { oldest.node.stop(); } catch {}
    try { oldest.node.disconnect(); } catch {}
  }
}

function _removeSfx(node) {
  const idx = activeSfx.findIndex(s => s.node === node);
  if (idx >= 0) activeSfx.splice(idx, 1);
}

// ============================================================
//  底层工具
// ============================================================

/** 播放一个音调，返回 OscillatorNode */
function _tone(freq, endFreq, dur, type = 'sine', vol = 0.25, reverbAmt = 0.3) {
  ensureAudio();
  const now = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, now);
  if (endFreq !== freq) {
    o.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 20), now + dur);
  }
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + dur);
  o.connect(g);

  const out = _sfxOutput();
  // 干声
  const dg = audioCtx.createGain();
  dg.gain.value = 1 - reverbAmt;
  g.connect(dg);
  dg.connect(out.dry);
  // 混响
  const rg = audioCtx.createGain();
  rg.gain.value = reverbAmt;
  g.connect(rg);
  rg.connect(out.reverb);

  o.start(now);
  o.stop(now + dur);
  _trackSfx(o);
  o.onended = () => {
    _removeSfx(o);
    try { o.disconnect(); g.disconnect(); dg.disconnect(); rg.disconnect(); } catch {}
  };
  return o;
}

/** 创建白噪声 burst */
function _noiseBurst(dur, vol = 0.1, reverbAmt = 0.2) {
  ensureAudio();
  const now = audioCtx.currentTime;
  const bufSize = Math.ceil(audioCtx.sampleRate * dur);
  const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);

  const src = audioCtx.createBufferSource();
  src.buffer = buf;

  const g = audioCtx.createGain();
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + dur);

  // 高通让噪声更像"嗖"声
  const hp = audioCtx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2000;

  src.connect(hp);
  hp.connect(g);

  const out = _sfxOutput();
  const dg = audioCtx.createGain();
  dg.gain.value = 1 - reverbAmt;
  g.connect(dg);
  dg.connect(out.dry);
  const rg = audioCtx.createGain();
  rg.gain.value = reverbAmt;
  g.connect(rg);
  rg.connect(out.reverb);

  src.start(now);
  src.stop(now + dur);
  _trackSfx(src);
  src.onended = () => {
    _removeSfx(src);
    try { src.disconnect(); hp.disconnect(); g.disconnect(); dg.disconnect(); rg.disconnect(); } catch {}
  };
  return src;
}

// ============================================================
//  音效 — 升级版
// ============================================================

// --- 吃食物：丰富音色 + 微弱回声 ---
export function playEat() {
  ensureAudio();
  const now = audioCtx.currentTime;
  // 主音
  _tone(587, 880, 0.12, 'sine', 0.22, 0.25);
  // 泛音叠加
  _tone(587 * 2, 880 * 1.5, 0.1, 'triangle', 0.06, 0.15);
  // 微弱延迟回声
  const delay = audioCtx.createDelay(0.5);
  delay.delayTime.value = 0.12;
  const dg = audioCtx.createGain();
  dg.gain.value = 0.08;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(587, now);
  o.frequency.exponentialRampToValueAtTime(880, now + 0.12);
  g.gain.setValueAtTime(0.15, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  o.connect(g);
  g.connect(delay);
  delay.connect(dg);
  dg.connect(dryGain);
  o.start(now);
  o.stop(now + 0.25);
  o.onended = () => { try { o.disconnect(); g.disconnect(); delay.disconnect(); dg.disconnect(); } catch {} };
}

// --- 奖励食物：华丽上行琶音 ---
export function playBonusEat() {
  const notes = [700, 880, 1100, 1400];
  notes.forEach((f, i) => {
    setTimeout(() => _tone(f, f * 1.3, 0.12, 'sine', 0.2 - i * 0.03, 0.3), i * 55);
  });
  // 亮泛音
  setTimeout(() => _tone(1400, 2200, 0.15, 'triangle', 0.08, 0.4), 180);
}

// --- 金色食物：三音阶上行 + 快速颤音闪烁 ---
export function playGold() {
  ensureAudio();
  const base = [800, 1000, 1200];
  base.forEach((f, i) => {
    setTimeout(() => _tone(f, f * 1.6, 0.12, 'sine', 0.25, 0.35), i * 60);
  });
  // 颤音闪烁效果
  setTimeout(() => {
    const now = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1600, now);
    // 快速颤音：用LFO调制增益
    const lfo = audioCtx.createOscillator();
    const lfoG = audioCtx.createGain();
    lfo.frequency.value = 25; // 25Hz颤音
    lfoG.gain.value = 0.15;
    lfo.connect(lfoG);
    lfoG.connect(g.gain);
    g.gain.setValueAtTime(0.15, now);
    g.gain.linearRampToValueAtTime(0.001, now + 0.3);
    o.connect(g);
    g.connect(dryGain);
    o.start(now);
    lfo.start(now);
    o.stop(now + 0.3);
    lfo.stop(now + 0.3);
    o.onended = () => { try { o.disconnect(); g.disconnect(); lfo.disconnect(); lfoG.disconnect(); } catch {} };
  }, 200);
}

// --- 能力提升：FM合成科幻音效 ---
export function playPowerup() {
  ensureAudio();
  const now = audioCtx.currentTime;
  // FM合成：载波 + 调制器
  const carrier = audioCtx.createOscillator();
  const modulator = audioCtx.createOscillator();
  const modGain = audioCtx.createGain();
  const cGain = audioCtx.createGain();

  modulator.type = 'sine';
  modulator.frequency.setValueAtTime(200, now);
  modulator.frequency.exponentialRampToValueAtTime(600, now + 0.35);
  modGain.gain.setValueAtTime(300, now); // 调制深度
  modGain.gain.linearRampToValueAtTime(50, now + 0.35);

  carrier.type = 'sine';
  carrier.frequency.setValueAtTime(400, now);
  carrier.frequency.exponentialRampToValueAtTime(1200, now + 0.35);

  modulator.connect(modGain);
  modGain.connect(carrier.frequency); // FM: 调制器 -> 载波频率

  cGain.gain.setValueAtTime(0.2, now);
  cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  carrier.connect(cGain);
  cGain.connect(dryGain);

  // 混响
  const rg = audioCtx.createGain();
  rg.gain.value = 0.3;
  cGain.connect(rg);
  rg.connect(reverbSend);

  carrier.start(now);
  modulator.start(now);
  carrier.stop(now + 0.4);
  modulator.stop(now + 0.4);
  _trackSfx(carrier);
  carrier.onended = () => {
    _removeSfx(carrier);
    try { carrier.disconnect(); modulator.disconnect(); modGain.disconnect(); cGain.disconnect(); rg.disconnect(); } catch {}
  };

  // 第二层：延迟的高频扫描
  setTimeout(() => _tone(800, 1600, 0.2, 'triangle', 0.1, 0.4), 120);
}

// --- 死亡：下行音 + 低频震动 ---
export function playDie() {
  ensureAudio();
  const now = audioCtx.currentTime;
  // 主下行音 - 更粗犷
  _tone(400, 60, 0.5, 'sawtooth', 0.25, 0.3);
  // 低频震动 sub bass
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(60, now);
  o.frequency.exponentialRampToValueAtTime(25, now + 0.6);
  g.gain.setValueAtTime(0.3, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
  o.connect(g);
  g.connect(dryGain);
  o.start(now);
  o.stop(now + 0.6);
  o.onended = () => { try { o.disconnect(); g.disconnect(); } catch {} };
  // 噪声冲击
  _noiseBurst(0.15, 0.12, 0.4);
  // 中频下行补充
  setTimeout(() => _tone(200, 40, 0.4, 'square', 0.08, 0.2), 80);
}

// --- Combo：音高随combo数递增 ---
export function playCombo(comboCount = 1) {
  const baseFreq = 800 + Math.min(comboCount, 15) * 80;
  _tone(baseFreq, baseFreq * 1.5, 0.08, 'sine', 0.15, 0.2);
  // combo高时加泛音
  if (comboCount >= 5) {
    _tone(baseFreq * 1.5, baseFreq * 2, 0.06, 'triangle', 0.06, 0.3);
  }
  if (comboCount >= 10) {
    _tone(baseFreq * 2, baseFreq * 2.5, 0.05, 'sine', 0.04, 0.4);
  }
}

// --- 成就：多层和弦 + 琶音上行 ---
export function playAchieve() {
  ensureAudio();
  // C大调和弦 C-E-G
  const chord = [523, 659, 784];
  chord.forEach((f, i) => {
    _tone(f, f * 1.2, 0.3, 'sine', 0.12, 0.4);
  });
  // 琶音上行
  const arp = [523, 659, 784, 1047, 1319];
  arp.forEach((f, i) => {
    setTimeout(() => _tone(f, f * 1.1, 0.15, 'sine', 0.1, 0.35), 100 + i * 80);
  });
  // 最终闪亮
  setTimeout(() => _tone(1568, 2093, 0.25, 'triangle', 0.08, 0.5), 550);
}

// --- 转向音效：短促"嗖"声 ---
export function playTurn() {
  _noiseBurst(0.04, 0.06, 0.15);
}

// --- 菜单 Hover ---
export function playMenuHover() {
  _tone(1200, 1400, 0.05, 'sine', 0.06, 0.1);
}

// --- 菜单 Select ---
export function playMenuSelect() {
  _tone(800, 1200, 0.08, 'sine', 0.12, 0.2);
  setTimeout(() => _tone(1200, 1600, 0.06, 'triangle', 0.06, 0.15), 50);
}

// ============================================================
//  主音量控制
// ============================================================
export function setVolume(v) {
  ensureAudio();
  const val = Math.max(0, Math.min(1, v));
  masterGain.gain.linearRampToValueAtTime(val, audioCtx.currentTime + 0.05);
}

// ============================================================
//  程序化分层 BGM 引擎
// ============================================================

// 音阶定义（C小调五声音阶，更有氛围感）
const SCALE = [
  130.81, 155.56, 174.61, 196.00, 233.08,  // C3 Eb3 F3 G3 Bb3
  261.63, 311.13, 349.23, 392.00, 466.16,  // C4 Eb4 F4 G4 Bb4
  523.25, 622.25, 698.46, 783.99, 932.33   // C5 Eb5 F5 G5 Bb5
];

// 旋律模式
const MELODY_PATTERNS = [
  [0, 2, 4, 3, 2, 4, 3, 1],         // 模式A：平稳
  [0, 4, 3, 2, 4, 6, 5, 3],         // 模式B：上行活跃
  [2, 5, 7, 6, 4, 3, 5, 4],         // 模式C：高分紧张
];

// Bass 节奏型
const BASS_RHYTHM = [1, 0, 0.5, 0, 1, 0, 0.5, 0.3]; // 1=强拍 0=休息

function _createBGMLayer(name) {
  const g = audioCtx.createGain();
  g.gain.value = 0;
  g.connect(bgmMasterGain);
  return { gain: g, active: false, nodes: [] };
}

function _cleanupLayerNodes(layer) {
  // 清理已结束的节点
  layer.nodes = layer.nodes.filter(n => {
    try {
      if (n._ended) { n.disconnect(); return false; }
    } catch {}
    return true;
  });
}

function _initBGMLayers() {
  bgmLayers.bass = _createBGMLayer('bass');
  bgmLayers.melody = _createBGMLayer('melody');
  bgmLayers.percussion = _createBGMLayer('percussion');
  bgmLayers.high = _createBGMLayer('high');
}

function _scheduleBeat() {
  if (!bgmPlaying) return;

  const now = audioCtx.currentTime;
  // 调度提前量
  const lookAhead = 0.1;

  while (bgmNextBeatTime < now + lookAhead) {
    _playBeat(bgmNextBeatTime, bgmBeat);
    const beatDur = 60.0 / bgmBPM;
    bgmNextBeatTime += beatDur;
    bgmBeat++;
  }

  bgmScheduler = setTimeout(_scheduleBeat, 25); // 25ms 调度精度
}

function _playBeat(time, beat) {
  const beatInBar = beat % 8;

  // === Bass 层（始终可用） ===
  if (bgmLayers.bass.active) {
    const bassVol = BASS_RHYTHM[beatInBar];
    if (bassVol > 0) {
      const beatDur = 60.0 / bgmBPM;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      // Bass 音：在根音和五度间交替
      const bassNote = (beatInBar < 4) ? SCALE[0] : SCALE[3];
      o.frequency.setValueAtTime(bassNote, time);
      g.gain.setValueAtTime(0.18 * bassVol, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + beatDur * 0.8);
      o.connect(g);
      g.connect(bgmLayers.bass.gain);
      o.start(time);
      o.stop(time + beatDur * 0.8);
      o._ended = false;
      o.onended = () => { o._ended = true; try { o.disconnect(); g.disconnect(); } catch {} };
      bgmLayers.bass.nodes.push(o);
    }
  }

  // === Melody 层（分数 > 50） ===
  if (bgmLayers.melody.active) {
    const patIdx = bgmScore < 150 ? 0 : (bgmScore < 300 ? 1 : 2);
    const pattern = MELODY_PATTERNS[patIdx];
    const noteIdx = pattern[beatInBar];
    const beatDur = 60.0 / bgmBPM;

    // 每两拍弹一个音（不要太密集）
    if (beatInBar % 2 === 0) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'triangle';
      const freq = SCALE[noteIdx + 5]; // 用高一个八度
      o.frequency.setValueAtTime(freq, time);
      g.gain.setValueAtTime(0.08, time);
      g.gain.setValueAtTime(0.08, time + beatDur * 0.1);
      g.gain.exponentialRampToValueAtTime(0.001, time + beatDur * 1.5);
      o.connect(g);
      g.connect(bgmLayers.melody.gain);
      o.start(time);
      o.stop(time + beatDur * 1.5);
      o._ended = false;
      o.onended = () => { o._ended = true; try { o.disconnect(); g.disconnect(); } catch {} };
      bgmLayers.melody.nodes.push(o);
    }
  }

  // === Percussion 层（分数 > 100） ===
  if (bgmLayers.percussion.active) {
    const beatDur = 60.0 / bgmBPM;
    // 模拟 hi-hat：用滤波噪声
    if (beatInBar % 2 === 0 || beatInBar === 3 || beatInBar === 7) {
      const bufSize = Math.ceil(audioCtx.sampleRate * 0.03);
      const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const hp = audioCtx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      const g = audioCtx.createGain();
      const isStrong = (beatInBar === 0 || beatInBar === 4);
      g.gain.setValueAtTime(isStrong ? 0.08 : 0.04, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
      src.connect(hp);
      hp.connect(g);
      g.connect(bgmLayers.percussion.gain);
      src.start(time);
      src.stop(time + 0.03);
      src._ended = false;
      src.onended = () => { src._ended = true; try { src.disconnect(); hp.disconnect(); g.disconnect(); } catch {} };
      bgmLayers.percussion.nodes.push(src);
    }
    // 模拟 kick（低频脉冲）在强拍
    if (beatInBar === 0 || beatInBar === 4) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, time);
      o.frequency.exponentialRampToValueAtTime(40, time + 0.08);
      g.gain.setValueAtTime(0.15, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
      o.connect(g);
      g.connect(bgmLayers.percussion.gain);
      o.start(time);
      o.stop(time + 0.1);
      o._ended = false;
      o.onended = () => { o._ended = true; try { o.disconnect(); g.disconnect(); } catch {} };
      bgmLayers.percussion.nodes.push(o);
    }
  }

  // === High 层（分数 > 200）：高频点缀 ===
  if (bgmLayers.high.active) {
    const beatDur = 60.0 / bgmBPM;
    // 每4拍一个高频点缀
    if (beatInBar % 4 === 2) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      // 随机从高音阶挑一个音
      const highNote = SCALE[10 + (beat % 5)];
      o.frequency.setValueAtTime(highNote, time);
      g.gain.setValueAtTime(0.04, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + beatDur * 2);
      o.connect(g);
      g.connect(bgmLayers.high.gain);
      o.start(time);
      o.stop(time + beatDur * 2);
      o._ended = false;
      o.onended = () => { o._ended = true; try { o.disconnect(); g.disconnect(); } catch {} };
      bgmLayers.high.nodes.push(o);
    }
  }

  // 每8拍清理一次旧节点
  if (beat % 8 === 0) {
    Object.values(bgmLayers).forEach(_cleanupLayerNodes);
  }
}

function _setLayerGain(layer, targetVol, fadeTime = 0.5) {
  if (!layer || !layer.gain) return;
  const now = audioCtx.currentTime;
  layer.gain.gain.cancelScheduledValues(now);
  layer.gain.gain.setValueAtTime(layer.gain.gain.value, now);
  layer.gain.gain.linearRampToValueAtTime(targetVol, now + fadeTime);
}

// ===== updateBGM：game.js 在分数变化时调用 =====
export function updateBGM(score, speed) {
  if (!bgmPlaying) return;
  bgmScore = score;
  bgmSpeed = speed;

  // BPM 随速度变化：速度越快(数值越小) BPM 越高
  // speed 典型范围 ~120(慢) 到 ~40(快)
  bgmBPM = Math.round(100 + (130 - speed) * 0.8);
  bgmBPM = Math.max(90, Math.min(200, bgmBPM));

  // Bass 层：始终激活
  if (!bgmLayers.bass.active) {
    bgmLayers.bass.active = true;
    _setLayerGain(bgmLayers.bass, 1.0, 0.3);
  }

  // Melody 层：分数 > 50
  if (score > 50 && !bgmLayers.melody.active) {
    bgmLayers.melody.active = true;
    _setLayerGain(bgmLayers.melody, 1.0, 1.0);
  } else if (score <= 50 && bgmLayers.melody.active) {
    bgmLayers.melody.active = false;
    _setLayerGain(bgmLayers.melody, 0, 0.5);
  }

  // Percussion 层：分数 > 100
  if (score > 100 && !bgmLayers.percussion.active) {
    bgmLayers.percussion.active = true;
    _setLayerGain(bgmLayers.percussion, 1.0, 1.0);
  } else if (score <= 100 && bgmLayers.percussion.active) {
    bgmLayers.percussion.active = false;
    _setLayerGain(bgmLayers.percussion, 0, 0.5);
  }

  // High 层：分数 > 200
  if (score > 200 && !bgmLayers.high.active) {
    bgmLayers.high.active = true;
    _setLayerGain(bgmLayers.high, 1.0, 1.5);
  } else if (score <= 200 && bgmLayers.high.active) {
    bgmLayers.high.active = false;
    _setLayerGain(bgmLayers.high, 0, 0.5);
  }
}

// ===== startBGM =====
export function startBGM() {
  ensureAudio();
  if (bgmPlaying) return;
  bgmPlaying = true;
  try { $('#music-toggle').textContent = '\u266B'; } catch {}

  _initBGMLayers();

  // Bass 默认激活
  bgmLayers.bass.active = true;
  _setLayerGain(bgmLayers.bass, 1.0, 0.3);

  // 淡入 BGM 主增益
  const now = audioCtx.currentTime;
  bgmMasterGain.gain.cancelScheduledValues(now);
  bgmMasterGain.gain.setValueAtTime(0, now);
  bgmMasterGain.gain.linearRampToValueAtTime(1.0, now + 1.0);

  bgmBeat = 0;
  bgmNextBeatTime = now + 0.1;
  bgmBPM = 120;

  // 如果已有分数信息，应用层状态
  updateBGM(bgmScore, bgmSpeed);

  _scheduleBeat();
}

// ===== stopBGM =====
export function stopBGM() {
  if (!bgmPlaying && !bgmScheduler) {
    try { $('#music-toggle').textContent = '\u266A'; } catch {}
    return;
  }

  // 淡出
  if (audioCtx && bgmMasterGain) {
    const now = audioCtx.currentTime;
    bgmMasterGain.gain.cancelScheduledValues(now);
    bgmMasterGain.gain.setValueAtTime(bgmMasterGain.gain.value, now);
    bgmMasterGain.gain.linearRampToValueAtTime(0, now + 0.5);
  }

  bgmPlaying = false;
  try { $('#music-toggle').textContent = '\u266A'; } catch {}

  // 延迟清理，让淡出完成
  setTimeout(() => {
    if (bgmScheduler) { clearTimeout(bgmScheduler); bgmScheduler = null; }
    // 停止所有层节点
    Object.values(bgmLayers).forEach(layer => {
      if (layer && layer.nodes) {
        layer.nodes.forEach(n => { try { n.stop(); n.disconnect(); } catch {} });
        layer.nodes = [];
      }
      if (layer && layer.gain) {
        try { layer.gain.disconnect(); } catch {}
      }
    });
    bgmLayers = {};
  }, 600);
}

// ===== toggleBGM =====
export function toggleBGM() {
  ensureAudio();
  bgmPlaying ? stopBGM() : startBGM();
}
