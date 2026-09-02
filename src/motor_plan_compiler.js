'use strict';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function validTrajectoryTemplates(profile = {}) {
  return (profile.trajectoryTemplates || []).filter(template =>
    Array.isArray(template?.points) &&
    template.points.length >= 2 &&
    template.points.every(point => Number.isFinite(Number(point.u)) && Number.isFinite(Number(point.v)) && Number.isFinite(Number(point.t)))
  );
}

function selectTrajectoryTemplate(profile = {}, sequence = 0) {
  const templates = validTrajectoryTemplates(profile);
  if (!templates.length) return { template: null, index: -1, count: 0 };
  const index = Math.abs(Math.trunc(Number(sequence) || 0)) % templates.length;
  return { template: templates[index], index, count: templates.length };
}

function bootstrapLinearPath(start, end, profile = {}) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const speed = clamp(Number(profile.speedPxPerSec) || 900, 80, 5000);
  const durationMs = clamp((distance / speed) * 1000, 45, 2600);
  const steps = clamp(Math.round(distance / 14), 4, 72);
  const out = [];
  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    out.push({
      delayMs: index === 1 ? 0 : durationMs / steps,
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mouseMoved',
        x: start.x + dx * t,
        y: start.y + dy * t,
        button: 'none'
      },
      behaviorSource: 'bootstrap-linear'
    });
  }
  return out;
}

function learnedTrajectoryPath(start, end, profile = {}, sequence = 0) {
  const selected = selectTrajectoryTemplate(profile, sequence);
  if (!selected.template) return bootstrapLinearPath(start, end, profile);

  const template = selected.template;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / distance;
  const uy = dy / distance;
  const nx = -uy;
  const ny = ux;
  const templateDirectPx = Math.max(1, Number(template.directPx) || distance);
  const templateDurationMs = Math.max(1, Number(template.durationMs) || 0);
  const templateSpeed = templateDurationMs > 0 ? templateDirectPx / (templateDurationMs / 1000) : Number(profile.speedPxPerSec) || 900;
  const durationMs = clamp((distance / clamp(templateSpeed, 80, 5000)) * 1000, 45, 2600);
  const points = template.points;
  const out = [];
  let previousT = 0;

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const t = clamp(Number(point.t), previousT, 1);
    const u = Number(point.u);
    const v = Number(point.v);
    const final = index === points.length - 1;
    out.push({
      delayMs: clamp((t - previousT) * durationMs, index === 1 ? 0 : 1, 1200),
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mouseMoved',
        x: final ? end.x : start.x + ux * (u * distance) + nx * (v * distance),
        y: final ? end.y : start.y + uy * (u * distance) + ny * (v * distance),
        button: 'none'
      },
      behaviorSource: 'learned-user-trajectory',
      trajectoryTemplateIndex: selected.index,
      trajectoryTemplateCount: selected.count
    });
    previousT = t;
  }

  if (!out.length || out[out.length - 1].params.x !== end.x || out[out.length - 1].params.y !== end.y) {
    out.push({
      delayMs: 1,
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mouseMoved', x: end.x, y: end.y, button: 'none' },
      behaviorSource: 'learned-user-trajectory',
      trajectoryTemplateIndex: selected.index,
      trajectoryTemplateCount: selected.count
    });
  }
  return out;
}

function mousePath(start, end, profile = {}, sequence = 0) {
  return learnedTrajectoryPath(start, end, profile, sequence);
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
  if (key.length === 1) return characterParams(key, type, modifiers);
  return { type, key, code: key, modifiers };
}

function characterParams(char, type = 'rawKeyDown', extraModifiers = 0) {
  const shiftModifier = SHIFTED_PRINTABLES.has(char) ? MODIFIER_BITS.Shift : 0;
  const modifiers = Number(extraModifiers || 0) | shiftModifier;
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

function clickPlan(start, point, profile, sequence, count = 1) {
  const out = mousePath(start, point, profile.mouse, sequence);
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
    this.decisionRandom = random;
    this.mouseSequence = 0;
  }

  nextMouseSequence() {
    const value = this.mouseSequence;
    this.mouseSequence += 1;
    return value;
  }

  compile(command, profile, { pointerStart = { x: 640, y: 360 } } = {}) {
    const start = { x: finiteOr(pointerStart.x, 640), y: finiteOr(pointerStart.y, 360) };
    let steps = [];
    let strategy = null;
    let finalPointer = start;

    if (command.type === 'move') {
      finalPointer = { x: command.x, y: command.y };
      steps = mousePath(start, finalPointer, profile.mouse, this.nextMouseSequence());
    } else if (command.type === 'click') {
      finalPointer = { x: command.x, y: command.y };
      steps = clickPlan(start, finalPointer, profile, this.nextMouseSequence(), 1);
    } else if (command.type === 'doubleClick') {
      finalPointer = { x: command.x, y: command.y };
      steps = clickPlan(start, finalPointer, profile, this.nextMouseSequence(), 2);
    } else if (command.type === 'typeText') {
      steps = typingPlan(command.text, profile.typing, this.decisionRandom);
    } else if (command.type === 'pressKey') {
      steps = keyStroke(command.key, clamp(Number(profile.typing.meanIntervalMs) || 85, 20, 500));
    } else if (command.type === 'keyCombo') {
      steps = keyCombo(command.key);
    } else if (command.type === 'scroll') {
      steps = scrollPlan(command, start);
    } else if (command.type === 'submit') {
      const hasPoint = Number.isFinite(command.x) && Number.isFinite(command.y);
      const clickProbability = clamp(Number(profile.submit.clickProbability) || 0.5, 0.05, 0.95);
      if (hasPoint && this.decisionRandom() < clickProbability) {
        strategy = { method: 'click', clickProbability, enterProbability: 1 - clickProbability };
        finalPointer = { x: command.x, y: command.y };
        steps = clickPlan(start, finalPointer, profile, this.nextMouseSequence(), 1);
      } else {
        strategy = { method: 'enter', clickProbability, enterProbability: 1 - clickProbability, fallbackBecauseNoPoint: !hasPoint };
        steps = keyStroke('Enter', clamp(Number(profile.typing.meanIntervalMs) || 85, 20, 500));
      }
    } else {
      throw new Error(`motor_plan_unsupported:${command.type}`);
    }

    return {
      version: 2,
      actionType: command.type,
      strategy,
      steps,
      finalPointer
    };
  }
}

module.exports = {
  selectTrajectoryTemplate,
  bootstrapLinearPath,
  learnedTrajectoryPath,
  mousePath,
  typingPlan,
  keyStroke,
  keyCombo,
  MotorPlanCompiler
};
