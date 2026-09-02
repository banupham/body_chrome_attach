'use strict';

const { MotorPlanCompiler } = require('./motor_plan_compiler');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

class BodyExecutor {
  constructor({ gateway, learner, compiler = new MotorPlanCompiler() } = {}) {
    if (!gateway || !learner) throw new Error('body_executor_dependencies_required');
    this.gateway = gateway;
    this.learner = learner;
    this.compiler = compiler;
    this.pointerByTab = new Map();
    this.executionSequence = 0;
    this.lastExecution = null;
  }

  pointer(tabId) {
    return this.pointerByTab.get(Number(tabId)) || { x: 640, y: 360 };
  }

  rememberPointer(tabId, params) {
    if (!params || !Number.isFinite(Number(params.x)) || !Number.isFinite(Number(params.y))) return;
    this.pointerByTab.set(Number(tabId), { x: Number(params.x), y: Number(params.y) });
  }

  async execute(tabId, command) {
    const id = Number(tabId);
    if (!Number.isInteger(id)) throw new Error('body_execution_tab_id_required');
    await this.learner.init();
    const profile = this.learner.snapshot();
    const plan = this.compiler.compile(command, profile, { pointerStart: this.pointer(id) });
    if (!Array.isArray(plan.steps) || plan.steps.length > 20000) throw new Error('body_motor_plan_invalid');

    const executionId = `body-${Date.now()}-${++this.executionSequence}`;
    const startedAt = Date.now();
    let sentCommands = 0;

    for (const step of plan.steps) {
      if (!step?.method) throw new Error('body_motor_step_method_required');
      await sleep(step.delayMs);
      await this.gateway.sendInput(id, step.method, step.params || {});
      this.rememberPointer(id, step.params);
      sentCommands += 1;
    }

    const result = {
      executionId,
      tabId: id,
      actionType: command.type,
      strategy: plan.strategy,
      sentCommands,
      durationMs: Date.now() - startedAt,
      delivered: true,
      taskSuccess: null,
      note: 'delivered=true only confirms CDP motor delivery; semantic task success is not inferred by Body',
      profileUsed: profile
    };
    this.lastExecution = result;
    return result;
  }

  status() {
    return {
      pointerByTab: Object.fromEntries(this.pointerByTab),
      lastExecution: this.lastExecution,
      gateway: this.gateway.status()
    };
  }
}

module.exports = { BodyExecutor };
