'use strict';

const { SOURCES } = require('./virtual_cursor_protocol');

const STORAGE_KEY = 'bodyChromeAttachMotorProfileV1';
const MAX_INTERVALS = 256;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rollingPush(list, value, limit = MAX_INTERVALS) {
  if (!Number.isFinite(Number(value))) return;
  list.push(Number(value));
  if (list.length > limit) list.splice(0, list.length - limit);
}

function mean(values, fallback) {
  const rows = values.filter(Number.isFinite);
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : fallback;
}

function quantile(values, q, fallback) {
  const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return fallback;
  const index = clamp(Math.round((rows.length - 1) * q), 0, rows.length - 1);
  return rows[index];
}

function defaultModel() {
  return {
    version: 1,
    updatedAt: null,
    mouse: {
      samples: 0,
      speedPxPerSec: [],
      pathRatio: [],
      pauseBeforeClickMs: [],
      turnRate: []
    },
    typing: {
      keydowns: 0,
      backspaces: 0,
      intervalsMs: []
    },
    submit: {
      click: 0,
      enter: 0
    }
  };
}

class BehaviorLearner {
  constructor(chromeApi, { storageKey = STORAGE_KEY } = {}) {
    this.chrome = chromeApi;
    this.storageKey = storageKey;
    this.model = defaultModel();
    this.tabState = new Map();
    this.persistTimer = null;
    this.ready = false;
  }

  async init() {
    if (this.ready) return this.snapshot();
    try {
      const stored = await this.chrome.storage.local.get(this.storageKey);
      const value = stored?.[this.storageKey];
      if (value?.version === 1) this.model = { ...defaultModel(), ...value };
    } catch (_) {}
    this.ready = true;
    return this.snapshot();
  }

  stateFor(tabId) {
    const id = Number(tabId);
    let state = this.tabState.get(id);
    if (!state) {
      state = {
        pointerStart: null,
        lastPointer: null,
        lastMoveAt: null,
        pathDistance: 0,
        turns: 0,
        lastAngle: null,
        lastKeydownAt: null
      };
      this.tabState.set(id, state);
    }
    return state;
  }

  resetPointerEpisode(state, point = null) {
    state.pointerStart = point;
    state.lastPointer = point;
    state.lastMoveAt = point?.at ?? null;
    state.pathDistance = 0;
    state.turns = 0;
    state.lastAngle = null;
  }

  observePointer(tabId, event, context = {}) {
    const state = this.stateFor(tabId);
    const type = String(event?.type || '');
    const x = Number(event?.x);
    const y = Number(event?.y);
    const at = Number(event?.at || Date.now());
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const point = { x, y, at };

    if (type === 'mouseMoved') {
      if (!state.lastPointer || !Number.isFinite(state.lastMoveAt) || at - state.lastMoveAt > 450) {
        this.resetPointerEpisode(state, point);
        return;
      }
      const dx = x - state.lastPointer.x;
      const dy = y - state.lastPointer.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0) {
        state.pathDistance += distance;
        const angle = Math.atan2(dy, dx);
        if (state.lastAngle != null) {
          let delta = Math.abs(angle - state.lastAngle);
          if (delta > Math.PI) delta = Math.PI * 2 - delta;
          if (delta > 0.35) state.turns += 1;
        }
        state.lastAngle = angle;
      }
      state.lastPointer = point;
      state.lastMoveAt = at;
      return;
    }

    if (type === 'mousePressed') {
      if (state.pointerStart && state.lastPointer) {
        const durationMs = Math.max(1, at - state.pointerStart.at);
        const direct = Math.max(1, Math.hypot(x - state.pointerStart.x, y - state.pointerStart.y));
        const speed = state.pathDistance / (durationMs / 1000);
        const ratio = state.pathDistance / direct;
        const pause = Number.isFinite(state.lastMoveAt) ? Math.max(0, at - state.lastMoveAt) : 0;
        const moveCountProxy = Math.max(1, Math.round(state.pathDistance / 8));
        if (state.pathDistance >= 4 && durationMs <= 10000) {
          rollingPush(this.model.mouse.speedPxPerSec, clamp(speed, 30, 5000));
          rollingPush(this.model.mouse.pathRatio, clamp(ratio, 1, 4));
          rollingPush(this.model.mouse.pauseBeforeClickMs, clamp(pause, 0, 2000));
          rollingPush(this.model.mouse.turnRate, clamp(state.turns / moveCountProxy, 0, 1));
          this.model.mouse.samples += 1;
        }
      }
      if (context?.isSubmitControl === true) this.model.submit.click += 1;
      this.resetPointerEpisode(state, point);
      this.touch();
      return;
    }

    if (type === 'mouseReleased') {
      state.lastPointer = point;
      state.lastMoveAt = at;
    }
  }

  observeKeyboard(tabId, event, context = {}) {
    if (String(event?.type || '') !== 'keydown' || event?.repeat === true) return;
    const state = this.stateFor(tabId);
    const at = Number(event?.at || Date.now());
    const key = String(event?.key || '');
    if (Number.isFinite(state.lastKeydownAt)) {
      const interval = at - state.lastKeydownAt;
      if (interval >= 8 && interval <= 2500) rollingPush(this.model.typing.intervalsMs, interval);
    }
    state.lastKeydownAt = at;
    this.model.typing.keydowns += 1;
    if (key === 'Backspace') this.model.typing.backspaces += 1;
    if (key === 'Enter' && context?.formContext === true) this.model.submit.enter += 1;
    this.touch();
  }

  observe(tabId, payload) {
    if (payload?.source !== SOURCES.USER) return this.snapshot();
    if (payload.kind === 'pointer') this.observePointer(tabId, payload.event, payload.context || {});
    else if (payload.kind === 'keyboard') this.observeKeyboard(tabId, payload.event, payload.context || {});
    return this.snapshot();
  }

  touch() {
    this.model.updatedAt = new Date().toISOString();
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.chrome.storage.local.set({ [this.storageKey]: this.model }).catch(() => {});
    }, 500);
  }

  snapshot() {
    const mouseSamples = Number(this.model.mouse.samples || 0);
    const intervals = this.model.typing.intervalsMs || [];
    const submitClick = Number(this.model.submit.click || 0);
    const submitEnter = Number(this.model.submit.enter || 0);
    const submitTotal = submitClick + submitEnter;
    return {
      version: 1,
      updatedAt: this.model.updatedAt,
      mouse: {
        samples: mouseSamples,
        speedPxPerSec: mean(this.model.mouse.speedPxPerSec || [], 900),
        pathRatio: mean(this.model.mouse.pathRatio || [], 1.12),
        pauseBeforeClickMs: mean(this.model.mouse.pauseBeforeClickMs || [], 70),
        turnRate: mean(this.model.mouse.turnRate || [], 0.08)
      },
      typing: {
        keydowns: Number(this.model.typing.keydowns || 0),
        meanIntervalMs: mean(intervals, 85),
        p90IntervalMs: quantile(intervals, 0.9, 180),
        backspaceRate: Number(this.model.typing.keydowns || 0)
          ? Number(this.model.typing.backspaces || 0) / Number(this.model.typing.keydowns || 1)
          : 0
      },
      submit: {
        samples: submitTotal,
        clickCount: submitClick,
        enterCount: submitEnter,
        clickProbability: (submitClick + 1) / (submitTotal + 2),
        enterProbability: (submitEnter + 1) / (submitTotal + 2)
      }
    };
  }
}

module.exports = { STORAGE_KEY, BehaviorLearner };
