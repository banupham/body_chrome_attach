'use strict';

const { SOURCES } = require('./virtual_cursor_protocol');

const STORAGE_KEY = 'bodyChromeAttachMotorProfileV1';
const MAX_INTERVALS = 256;
const MAX_TRAJECTORIES = 64;
const MAX_TRAJECTORY_POINTS = 64;
const MAX_EPISODE_POINTS = 256;

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
    version: 2,
    updatedAt: null,
    mouse: {
      samples: 0,
      speedPxPerSec: [],
      pathRatio: [],
      pauseBeforeClickMs: [],
      turnRate: [],
      trajectoryTemplates: []
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

function migrateModel(value) {
  const next = defaultModel();
  if (!value || ![1, 2].includes(Number(value.version))) return next;
  next.updatedAt = value.updatedAt || null;
  next.mouse.samples = Number(value.mouse?.samples || 0);
  next.mouse.speedPxPerSec = Array.isArray(value.mouse?.speedPxPerSec) ? value.mouse.speedPxPerSec.slice(-MAX_INTERVALS) : [];
  next.mouse.pathRatio = Array.isArray(value.mouse?.pathRatio) ? value.mouse.pathRatio.slice(-MAX_INTERVALS) : [];
  next.mouse.pauseBeforeClickMs = Array.isArray(value.mouse?.pauseBeforeClickMs) ? value.mouse.pauseBeforeClickMs.slice(-MAX_INTERVALS) : [];
  next.mouse.turnRate = Array.isArray(value.mouse?.turnRate) ? value.mouse.turnRate.slice(-MAX_INTERVALS) : [];
  next.mouse.trajectoryTemplates = Array.isArray(value.mouse?.trajectoryTemplates)
    ? value.mouse.trajectoryTemplates.filter(template => Array.isArray(template?.points) && template.points.length >= 2).slice(-MAX_TRAJECTORIES)
    : [];
  next.typing.keydowns = Number(value.typing?.keydowns || 0);
  next.typing.backspaces = Number(value.typing?.backspaces || 0);
  next.typing.intervalsMs = Array.isArray(value.typing?.intervalsMs) ? value.typing.intervalsMs.slice(-MAX_INTERVALS) : [];
  next.submit.click = Number(value.submit?.click || 0);
  next.submit.enter = Number(value.submit?.enter || 0);
  return next;
}

function decimatePoints(points, limit = MAX_TRAJECTORY_POINTS) {
  if (points.length <= limit) return points.slice();
  const out = [];
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round((index / (limit - 1)) * (points.length - 1));
    out.push(points[sourceIndex]);
  }
  return out;
}

function normalizeTrajectory(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const sampled = decimatePoints(points);
  const first = sampled[0];
  const last = sampled[sampled.length - 1];
  const dx = Number(last.x) - Number(first.x);
  const dy = Number(last.y) - Number(first.y);
  const directPx = Math.hypot(dx, dy);
  const durationMs = Math.max(1, Number(last.at) - Number(first.at));
  if (!Number.isFinite(directPx) || directPx < 8 || !Number.isFinite(durationMs) || durationMs > 10000) return null;

  const ux = dx / directPx;
  const uy = dy / directPx;
  const nx = -uy;
  const ny = ux;
  const normalized = sampled.map(point => {
    const rx = Number(point.x) - Number(first.x);
    const ry = Number(point.y) - Number(first.y);
    return {
      u: (rx * ux + ry * uy) / directPx,
      v: (rx * nx + ry * ny) / directPx,
      t: clamp((Number(point.at) - Number(first.at)) / durationMs, 0, 1)
    };
  });
  normalized[0] = { u: 0, v: 0, t: 0 };
  normalized[normalized.length - 1] = { u: 1, v: 0, t: 1 };

  let pathDistance = 0;
  for (let index = 1; index < sampled.length; index += 1) {
    pathDistance += Math.hypot(
      Number(sampled[index].x) - Number(sampled[index - 1].x),
      Number(sampled[index].y) - Number(sampled[index - 1].y)
    );
  }

  return {
    source: 'USER',
    capturedAt: new Date().toISOString(),
    directPx,
    durationMs,
    pathRatio: pathDistance / directPx,
    points: normalized
  };
}

function cloneTemplate(template) {
  return {
    source: 'USER',
    capturedAt: template.capturedAt || null,
    directPx: Number(template.directPx) || 0,
    durationMs: Number(template.durationMs) || 0,
    pathRatio: Number(template.pathRatio) || 1,
    points: (template.points || []).map(point => ({
      u: Number(point.u) || 0,
      v: Number(point.v) || 0,
      t: clamp(Number(point.t) || 0, 0, 1)
    }))
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
      this.model = migrateModel(value);
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
        pathPoints: [],
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
    state.pathPoints = point ? [point] : [];
  }

  appendEpisodePoint(state, point) {
    const previous = state.pathPoints[state.pathPoints.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.5 && point.at - previous.at < 12) return;
    state.pathPoints.push(point);
    if (state.pathPoints.length > MAX_EPISODE_POINTS) {
      state.pathPoints = decimatePoints(state.pathPoints, Math.floor(MAX_EPISODE_POINTS * 0.75));
    }
  }

  storeTrajectory(state, point) {
    const points = state.pathPoints.slice();
    const last = points[points.length - 1];
    if (!last || last.x !== point.x || last.y !== point.y || last.at !== point.at) points.push(point);
    const template = normalizeTrajectory(points);
    if (!template) return false;
    this.model.mouse.trajectoryTemplates.push(template);
    if (this.model.mouse.trajectoryTemplates.length > MAX_TRAJECTORIES) {
      this.model.mouse.trajectoryTemplates.splice(0, this.model.mouse.trajectoryTemplates.length - MAX_TRAJECTORIES);
    }
    return true;
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
      this.appendEpisodePoint(state, point);
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
          this.storeTrajectory(state, point);
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
    const templates = (this.model.mouse.trajectoryTemplates || []).map(cloneTemplate);
    return {
      version: 2,
      updatedAt: this.model.updatedAt,
      mouse: {
        samples: mouseSamples,
        speedPxPerSec: mean(this.model.mouse.speedPxPerSec || [], 900),
        pathRatio: mean(this.model.mouse.pathRatio || [], 1.12),
        pauseBeforeClickMs: mean(this.model.mouse.pauseBeforeClickMs || [], 70),
        turnRate: mean(this.model.mouse.turnRate || [], 0.08),
        trajectoryTemplateCount: templates.length,
        trajectoryTemplates: templates
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

module.exports = {
  STORAGE_KEY,
  MAX_TRAJECTORIES,
  MAX_TRAJECTORY_POINTS,
  normalizeTrajectory,
  BehaviorLearner
};
