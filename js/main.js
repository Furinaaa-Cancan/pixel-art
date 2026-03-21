// ============================================================
//  main.js — 入口：模块组装 + 菜单逻辑
// ============================================================

import { $, $$, state, applyTheme, showBest } from './config.js';
import { ensureAudio, stopBGM, toggleBGM, playMenuHover, playMenuSelect, startBGM } from './audio.js';
import { resizeCanvas } from './renderer.js';
import { init, animLoop, renderAchPanel, getDailyChallenge, getStats } from './game.js';
import { setupInput } from './input.js';

// ===== 初始化 Canvas =====
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ===== 菜单按钮 =====
function setupBtnGroup(selector, callback) {
  $$(selector).forEach(btn => {
    btn.addEventListener('click', () => {
      $$(selector).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      callback(btn);
      playMenuSelect();
    });
    btn.addEventListener('mouseenter', () => playMenuHover());
  });
}

setupBtnGroup('#mode-btns .btn', b => state.selectedMode = b.dataset.mode);
setupBtnGroup('#diff-btns .btn', b => state.selectedDiff = b.dataset.diff);
setupBtnGroup('#theme-btns .btn', b => applyTheme(b.dataset.theme));

// ===== 背景音乐按钮 =====
$('#music-toggle').addEventListener('click', toggleBGM);

// ===== 成就面板 =====
$('#show-ach-btn').addEventListener('click', () => {
  renderAchPanel();
  $('#achievements-panel').style.display = 'block';
});
$('#close-ach').addEventListener('click', () => {
  $('#achievements-panel').style.display = 'none';
});

// ===== 统计面板 =====
$('#show-stats-btn').addEventListener('click', () => {
  const stats = getStats();
  const content = $('#stats-content');
  const totalMin = Math.floor((stats.totalPlayTime || 0) / 60);
  content.innerHTML = `
    <div>总游戏场次: <strong>${stats.totalGames || 0}</strong></div>
    <div>总吃到食物: <strong>${stats.totalFoodEaten || 0}</strong></div>
    <div>最长蛇身: <strong>${stats.longestSnake || 0}</strong></div>
    <div>最高连击: <strong>${stats.highestCombo || 0}</strong></div>
    <div>总游戏时间: <strong>${totalMin} 分钟</strong></div>
  `;
  $('#stats-panel').style.display = 'block';
});
$('#close-stats').addEventListener('click', () => {
  $('#stats-panel').style.display = 'none';
});

// ===== 游戏流程 =====
function startGame(dailyConfig) {
  ensureAudio();
  $('#menu').style.display = 'none';
  $('#achievements-panel').style.display = 'none';
  $('#stats-panel').style.display = 'none';
  $('#game-wrap').style.display = 'block';
  $('#hud').style.display = 'flex';
  if ('ontouchstart' in window) $('#touch-pad').style.display = 'block';
  init(dailyConfig);
  startBGM();
  animLoop();
}

function returnToMenu() {
  clearInterval(state.timer);
  clearTimeout(state.foodTimer);
  if (state.shrinkInterval) clearInterval(state.shrinkInterval);
  if (state.zenTimer) clearInterval(state.zenTimer);
  cancelAnimationFrame(state.animFrame);
  stopBGM();
  $('#game-wrap').style.display = 'none';
  $('#hud').style.display = 'none';
  $('#touch-pad').style.display = 'none';
  $('#msg').textContent = '';
  $('#menu').style.display = 'flex';
  showBest();
}

$('#start-btn').addEventListener('click', () => startGame());

// ===== 每日挑战 =====
$('#daily-btn').addEventListener('click', () => {
  const config = getDailyChallenge();
  startGame(config);
});

// ===== 输入 =====
setupInput(returnToMenu);

// ===== 初始显示 =====
showBest();
