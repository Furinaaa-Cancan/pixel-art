// ============================================================
//  input.js — 输入处理 (Ultimate Edition)
// ============================================================

import { $, $$, state } from './config.js';
import { handleDir, init } from './game.js';

const dirMap = {
  arrowup:{x:0,y:-1},w:{x:0,y:-1},up:{x:0,y:-1},
  arrowdown:{x:0,y:1},s:{x:0,y:1},down:{x:0,y:1},
  arrowleft:{x:-1,y:0},a:{x:-1,y:0},left:{x:-1,y:0},
  arrowright:{x:1,y:0},d:{x:1,y:0},right:{x:1,y:0},
};

// Direction names for indicator
const dirNames = { '0,-1': 'up', '0,1': 'down', '-1,0': 'left', '1,0': 'right' };

// ===== Gamepad state =====
let gamepadConnected = false;
let gamepadIndex = -1;
let lastGamepadDir = null;
let lastGamepadButtons = {};
let returnToMenuFn = null;

// ===== Setup all input handlers =====
export function setupInput(returnToMenu) {
  returnToMenuFn = returnToMenu;

  // Register gamepad polling on state so game.js can call it without circular import
  state._pollGamepad = pollGamepad;

  // Keyboard
  document.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'escape') { returnToMenu(); return; }
    if (k === 'r') { init(); return; }
    if (k === ' ' && state.running && !state.gameOver) {
      e.preventDefault();
      state.paused = !state.paused;
      const msgEl = $('#msg');
      if (msgEl) msgEl.textContent = state.paused ? '\u5DF2\u6682\u505C' : '';
      return;
    }
    handleDir(dirMap[k]);
  });

  // Touch direction buttons
  $$('#touch-pad button').forEach(b =>
    b.addEventListener('touchstart', e => {
      e.preventDefault();
      handleDir(dirMap[b.dataset.dir]);
    })
  );

  // Canvas swipe gestures (optimized with larger dead zone and direction indicator)
  const canvas = $('#game');
  let tX, tY, tTime;
  const SWIPE_THRESHOLD = 8; // Reduced from implicit 10 for more responsive swipes
  const MAX_TAP_DURATION = 300;

  if (canvas) {
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.touches[0];
      tX = t.clientX;
      tY = t.clientY;
      tTime = Date.now();
    });

    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      // Live swipe detection for instant response
      if (!tX && tX !== 0) return;
      const t = e.touches[0];
      const dx = t.clientX - tX, dy = t.clientY - tY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= SWIPE_THRESHOLD) {
        let dir;
        if (Math.abs(dx) > Math.abs(dy)) {
          dir = dx > 0 ? dirMap.right : dirMap.left;
        } else {
          dir = dy > 0 ? dirMap.down : dirMap.up;
        }
        handleDir(dir);
        showDirectionIndicator(dir);
        // Reset start point to allow chained swipes
        tX = t.clientX;
        tY = t.clientY;
      }
    });

    canvas.addEventListener('touchend', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      const dx = t.clientX - tX, dy = t.clientY - tY;
      const elapsed = Date.now() - tTime;

      if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD && elapsed < MAX_TAP_DURATION) {
        // Tap to pause
        if (state.running && !state.gameOver) {
          state.paused = !state.paused;
          const msgEl = $('#msg');
          if (msgEl) msgEl.textContent = state.paused ? '\u5DF2\u6682\u505C' : '';
        }
      }
      tX = tY = null;
    });
  }

  // Gamepad events
  window.addEventListener('gamepadconnected', e => {
    gamepadConnected = true;
    gamepadIndex = e.gamepad.index;
  });

  window.addEventListener('gamepaddisconnected', e => {
    if (e.gamepad.index === gamepadIndex) {
      gamepadConnected = false;
      gamepadIndex = -1;
    }
  });
}

// ===== Direction indicator (shows briefly on swipe) =====
function showDirectionIndicator(dir) {
  const key = `${dir.x},${dir.y}`;
  const name = dirNames[key] || '';
  state.dirIndicator = { dir: name, time: Date.now() };
  // Auto-clear after 300ms
  setTimeout(() => {
    if (state.dirIndicator && Date.now() - state.dirIndicator.time >= 280) {
      state.dirIndicator = null;
    }
  }, 300);
}

// ===== Gamepad polling (call in animLoop) =====
export function pollGamepad() {
  if (!gamepadConnected || gamepadIndex < 0) return;

  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = gamepads[gamepadIndex];
  if (!gp) return;

  // D-pad / Left stick direction
  const DEADZONE = 0.3;
  let gpDir = null;

  // Left stick
  const lx = gp.axes[0] || 0;
  const ly = gp.axes[1] || 0;
  if (Math.abs(lx) > DEADZONE || Math.abs(ly) > DEADZONE) {
    if (Math.abs(lx) > Math.abs(ly)) {
      gpDir = lx > 0 ? dirMap.right : dirMap.left;
    } else {
      gpDir = ly > 0 ? dirMap.down : dirMap.up;
    }
  }

  // D-pad buttons (standard mapping: 12=up, 13=down, 14=left, 15=right)
  if (gp.buttons[12] && gp.buttons[12].pressed) gpDir = dirMap.up;
  if (gp.buttons[13] && gp.buttons[13].pressed) gpDir = dirMap.down;
  if (gp.buttons[14] && gp.buttons[14].pressed) gpDir = dirMap.left;
  if (gp.buttons[15] && gp.buttons[15].pressed) gpDir = dirMap.right;

  // Only send direction on change to avoid flooding
  if (gpDir) {
    const dirKey = `${gpDir.x},${gpDir.y}`;
    if (dirKey !== lastGamepadDir) {
      lastGamepadDir = dirKey;
      handleDir(gpDir);
    }
  } else {
    lastGamepadDir = null;
  }

  // A button (index 0) — confirm / start / restart
  const aPressed = gp.buttons[0] && gp.buttons[0].pressed;
  if (aPressed && !lastGamepadButtons.a) {
    if (state.gameOver) {
      init();
    }
  }
  lastGamepadButtons.a = aPressed;

  // B button (index 1) — pause
  const bPressed = gp.buttons[1] && gp.buttons[1].pressed;
  if (bPressed && !lastGamepadButtons.b) {
    if (state.running && !state.gameOver) {
      state.paused = !state.paused;
      const msgEl = $('#msg');
      if (msgEl) msgEl.textContent = state.paused ? '\u5DF2\u6682\u505C' : '';
    }
  }
  lastGamepadButtons.b = bPressed;

  // Start button (index 9) — ESC / menu
  const startPressed = gp.buttons[9] && gp.buttons[9].pressed;
  if (startPressed && !lastGamepadButtons.start) {
    if (returnToMenuFn) returnToMenuFn();
  }
  lastGamepadButtons.start = startPressed;
}
