'use strict';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cubic(a, b, c, d, t) {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

function mousePath(start, end, profile = {}, random = Math.random) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const speed = clamp(Number(profile.speedPxPerSec) || 900, 80, 5000);
  const durationMs = clamp((distance / speed) * 1000, 45, 2600);
  const steps = clamp(Math.round(distance / 12), 4, 90);
  const nx = -dy / distance;
  const ny = dx / distance;
  const ratio = clamp(Number(profile.pathRatio) || 1.12, 1, 4);
  const curve = clamp(0.06 + (ratio - 1) * 0.32, 0.04, 0.48);
  const sign = random() < 0.5 ? -1 : 1;
  const bend = distance * curve * (0.65 + random() * 0.45) * sign;
  const c1 = {
    x: start.x + dx * (0.22 + random() * 0.10) + nx * bend,
    y: start.y + dy * (0.22 + random() * 0.10) + ny * bend
  };
  const c2 = {
    x: start.x + dx * (0.64 + random() * 0.12) + nx * bend * 0.45,
    y: start.y + dy * (0.64 + random() * 0.12) + ny * bend * 0.45
  };
  const out = [];
  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    const eased = t * t * (3 - 2 * t);
    out.push({
      delayMs: index === 1 ? 0 : durationMs / steps,
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mouseMoved',
        x: cubic(start.x, c1.x, c2.x, end.x, eased),
        y: cubic(start.y, c1.y, c2.y, end.y, eased),
        button: 'none'
      }
    });
  }

  const correctionCount = clamp(Math.round((Number(profile.turnRate) || 0.08) * 8), 0, 3);
  for (let i = 0; i < correctionCount; i += 1) {
    const amplitude = clamp(2 + distance * 0.004, 2, 7) * (1 - i * 0.2);
    const angle = random() * Math.PI * 2;
    out.push({
      delayMs: 18 + random() * 30,
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mouseMoved', x: end.x + Math.cos(angle) * amplitude, y: end.y + Math.sin(angle) * amplitude, button: 'none' }
    });
    out.push({
      delayMs: 18 + random() * 24,
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mouseMoved', x: end.x, y: end.y, button: 'none' }
    });
  }
  return out;
}

const KEY_SPECS = Object.freeze({
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Tab: { code: 'Tab', vk: 9 },
  Escape: { code: 'Escape', vk: 27 },
  Backspace: { code: 'Backspace', vk: 8 },
  Delete: { code: 'Delete', vk: 46 },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  Home: { code: 'Home', vk: 36 },
  End: { code: 'End', vk: 35 },
  Control: { code: 'ControlLeft', vk: 17 },
  Shift: { code: 'ShiftLeft', vk: 16 },
  Alt: { code: 'AltLeft', vk: 18 },
  Meta: { code: 'MetaLeft', vk: 91 }
});
const KEY_ALIASES = Object.freeze({ esc: 'Escape', return: 'Enter', ctrl: 'Control', control: 'Control', cmd: 'Meta', command: 'Meta' });
const MODIFIER_BITS = Object.freeze({ Alt: 1, Control: 2, Meta: 4, Shift: 8 });
const SHIFTED_DIGITS = Object.freeze({ '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0' });
const PUNCTUATION = Object.freeze({
  '-': ['Minus', 189, false], '_': ['Minus', 189, true], '=': ['Equal', 187, false], '+': ['Equal', 187, true],
  '[': ['BracketLeft', 219, false], '{': ['BracketLeft', 219, true], ']': ['BracketRight', 221, false], '}': ['BracketRight', 221, true],
  '\\': ['Backslash', 220, false], '|': ['Backslash', 220, true], ';': ['Semicolon', 186, false], ':': ['Semicolon', 186, true],
  "'": ['Quote', 222, false], '"': ['Quote', 222, true], ',': ['Comma', 188, false], '<': ['Comma', 188, true],
  '.': ['Period', 190, false], '>': ['Period', 190, true], '/': ['Slash', 191, false], '?': ['Slash', 191, true],
  '`': ['Backquote', 192, false], '~': ['Backquote', 192, true], ' ': ['Space', 32, false]
});
const SHIFTED_PRINTABLES = new Set([...Object.keys(SHIFTED_DIGITS), ...Object.entries(PUNCTUATION).filter(([, spec]) => spec[2]).map(([char]) => char), ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']);

function normalizeKeyName(value) {
  const raw = String(value ?? '').trim();
  return KEY_ALIASES[raw.toLowerCase()] || raw;
}

function printableCode(char) {
  if (/^[a-z]$/i.test(char)) return `Key${char.toUpperCase()}`;
  if (/^[0-9]$/.test(char)) return `Digit${char}`;
  if (Object.prototype.hasOwnProperty.call(SHIFTED_DIGITS, char)) return `Digit${SHIFTED_DIGITS[char]}`;
  return PUNCTUATION[char]?.[0] || 'Unidentified';
}

function printableVk(char) {
  if (/^[a-z]$/i.test(char)) return char.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(char)) return char.charCodeAt(0);
  if (Object.prototype.hasOwnProperty.call(SHIFTED_DIGITS, char)) return SHIFTED_DIGITS[char].charCodeAt(0);
  return PUNCTUATION[char]?.[1] || 0;
}

function keyParams(name, type = 'rawKeyDown', modifiers = 0) {
  const key = normalizeKeyName(name);
  if (!key) throw new Error('key_required');
  const spec = KEY_SPECS[key];
  if (spec) {
    const params = { type, key, code: spec.code, modifiers };
    if (spec.vk) {
      params.windowsVirtualKeyCode = spec.vk;
      params.nativeVirtualKeyCode = spec.vk;
    }
    if ((type === 'keyDown' || type === 'char') && spec.text && !modifiers) {
      params.text = spec.text;
      params.unmodifiedText = spec.text;
    }
    return params;
  }
  if (key.length === 1) return characterParams(key, type);
  return { type, key, code: key, modifiers };
}

function characterParams(char, type = 'rawKeyDown') {
  const modifiers = SHIFTED_PRINTABLES.has(char) ? MODIFIER_BITS.Shift : 0;
  const vk = printableVk(char);
  const params = { type, key: char, code: printableCode(char), modifiers };
  if (vk) {
    params.windowsVirtualKeyCode = vk;
    params.nativeVirtualKeyCode = vk;
  }
  if (type === 'char') {
    params.text = char;
    params.unmodifiedText = char;
  }
  return params;
}

function characterStroke(char, delayMs) {
  const shifted = SHIFTED_PRINTABLES.has(char);
  const out = [];
  if (shifted) {
    out.push({ delayMs, method: 'Input.dispatchKeyEvent', params: keyParams('Shift', 'rawKeyDown', MODIFIER_BITS.Shift) });
  }
  out.push(
    { delayMs: shifted ? 10 : delayMs, method: 'Input.dispatchKeyEvent', params: characterParams(char, 'rawKeyDown') },
    { delayMs: 0, method: 'Input.dispatchKeyEvent', params: characterParams(char, 'char') },
    { delayMs: 10, method: 'Input.dispatchKeyEvent', params: characterParams(char, 'keyUp') }
  );
  if (shifted) out.push({ delayMs: 10, method: 'Input.dispatchKeyEvent', params: keyParams('Shift', 'keyUp', 0) });
  return out;
}

function typingDelay(profile, random = Math.random) {
  const mean = clamp(Number(profile.meanIntervalMs) || 85, 12, 600);
  const p90 = clamp(Number(profile.p90IntervalMs) || 180, mean, 1200);
  if (random() < 0.12) return mean + random() * Math.max(0, p90 - mean);
  return mean * (0.72 + random() * 0.56);
}

function typingPlan(text, profile, random = Math.random) {
  const out = [];
  for (const char of [...String(text ?? '')]) out.push(...characterStroke(char, clamp(typingDelay(profile, random), 10, 1200)));
  return out;
}

function keyStroke(name, delayMs = 55, modifiers = 0) {
  const normalized = normalizeKeyName(name);
  const spec = KEY_SPECS[normalized];
  const downType = spec?.text && !modifiers ? 'keyDown' : 'rawKeyDown';
  return [
    { delayMs: 0, method: 'Input.dispatchKeyEvent', params: keyParams(normalized, downType, modifiers) },
    { delayMs, method: 'Input.dispatchKeyEvent', params: keyParams(normalized, 'keyUp', modifiers) }
  ];
}

function keyCombo(value) {
  const parts = String(value || '').split('+').map(normalizeKeyName).filter(Boolean);
  if (parts.length < 2) throw new Error('key_combo_requires_modifier_and_key');
  const modifiers = parts.filter(part => MODIFIER_BITS[part]);
  const keys = parts.filter(part => !MODIFIER_BITS[part]);
  if (!modifiers.length || !keys.length) throw new Error('key_combo_requires_modifier_and_key');
  let mask = 0;
  const out = [];
  for (const modifier of modifiers) {
    mask |= MODIFIER_BITS[modifier];
    out.push({ delayMs: 0, method: 'Input.dispatchKeyEvent', params: keyParams(modifier, 'rawKeyDown', mask) });
  }
  for (const key of keys) {
    out.push({ delayMs: 25, method: 'Input.dispatchKeyEvent', params: keyParams(key, 'rawKeyDown', mask) });
    out.push({ delayMs: 40, method: 'Input.dispatchKeyEvent', params: keyParams(key, 'keyUp', mask) });
  }
  for (const modifier of [...modifiers].reverse()) {
    mask &= ~MODIFIER_BITS[modifier];
    out.push({ delayMs: 20, method: 'Input.dispatchKeyEvent', params: keyParams(modifier, 'keyUp', mask) });
  }
  return out;
}

function clickPlan(start, point, profile, random = Math.random, count = 1) {
  const out = mousePath(start, point, profile.mouse, random);
  const pause = clamp(Number(profile.mouse.pauseBeforeClickMs) || 70, 0, 1500);
  for (let index = 1; index <= count; index += 1) {
    out.push({ delayMs: index === 1 ? pause : 90, method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: index } });
    out.push({ delayMs: 45, method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: index } });
  }
  return out;
}

function scrollPlan(command, pointer) {
  const count = 6;
  const delta = Number(command.deltaY);
  const x = Number.isFinite(command.x) ? command.x : pointer.x;
  const y = Number.isFinite(command.y) ? command.y : pointer.y;
  return Array.from({ length: count }, () => ({
    delayMs: 22,
    method: 'Input.dispatchMouseEvent',
    params: { type: 'mouseWheel', x, y, deltaX: 0, deltaY: delta / count }
  }));
}

class MotorPlanCompiler {
  constructor(random = Math.random) {
    this.random = random;
  }

  compile(command, profile, { pointerStart = { x: 640, y: 360 } } = {}) {
    const start = { x: Number(pointerStart.x) || 640, y: Number(pointerStart.y) || 360 };
    let steps = [];
    let strategy = null;
    let finalPointer = start;

    if (command.type === 'move') {
      finalPointer = { x: command.x, y: command.y };
      steps = mousePath(start, finalPointer, profile.mouse, this.random);
    } else if (command.type === 'click') {
      finalPointer = { x: command.x, y: command.y };
      steps = clickPlan(start, finalPointer, profile, this.random, 1);
    } else if (command.type === 'doubleClick') {
      finalPointer = { x: command.x, y: command.y };
      steps = clickPlan(start, finalPointer, profile, this.random, 2);
    } else if (command.type === 'typeText') {
      steps = typingPlan(command.text, profile.typing, this.random);
    } else if (command.type === 'pressKey') {
      steps = keyStroke(command.key, clamp(Number(profile.typing.meanIntervalMs) || 85, 20, 500));
    } else if (command.type === 'keyCombo') {
      steps = keyCombo(command.key);
    } else if (command.type === 'scroll') {
      steps = scrollPlan(command, start);
    } else if (command.type === 'submit') {
      const hasPoint = Number.isFinite(command.x) && Number.isFinite(command.y);
      const clickProbability = clamp(Number(profile.submit.clickProbability) || 0.5, 0.05, 0.95);
      if (hasPoint && this.random() < clickProbability) {
        strategy = { method: 'click', clickProbability, enterProbability: 1 - clickProbability };
        finalPointer = { x: command.x, y: command.y };
        steps = clickPlan(start, finalPointer, profile, this.random, 1);
      } else {
        strategy = { method: 'enter', clickProbability, enterProbability: 1 - clickProbability, fallbackBecauseNoPoint: !hasPoint };
        steps = keyStroke('Enter', clamp(Number(profile.typing.meanIntervalMs) || 85, 20, 500));
      }
    } else {
      throw new Error(`motor_plan_unsupported:${command.type}`);
    }

    return {
      version: 1,
      actionType: command.type,
      strategy,
      steps,
      finalPointer
    };
  }
}

module.exports = { mousePath, typingPlan, keyStroke, keyCombo, MotorPlanCompiler };
