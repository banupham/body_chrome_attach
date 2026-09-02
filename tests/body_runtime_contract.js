'use strict';

const assert = require('node:assert/strict');
const { parseBodyCommand } = require('../src/body_command_parser');
const { MotorPlanCompiler } = require('../src/motor_plan_compiler');
const { BehaviorLearner } = require('../src/behavior_learner');
const { BodyCommandIngress } = require('../src/command_ingress');
const { CdpInputGateway } = require('../src/cdp_input_gateway');
const { SOURCES } = require('../src/virtual_cursor_protocol');

function fakeChrome() {
  const state = {};
  const messages = [];
  const debuggerCalls = [];
  return {
    state,
    messages,
    debuggerCalls,
    storage: {
      local: {
        async get(key) { return key in state ? { [key]: state[key] } : {}; },
        async set(value) { Object.assign(state, value); }
      }
    },
    tabs: {
      async sendMessage(_tabId, message) { messages.push(message); return { ok: true }; }
    },
    debugger: {
      async attach(target) { debuggerCalls.push(['attach', target]); },
      async detach(target) { debuggerCalls.push(['detach', target]); },
      async sendCommand(target, method, params) { debuggerCalls.push(['sendCommand', target, method, params]); return {}; }
    }
  };
}

(async () => {
  assert.deepEqual(parseBodyCommand('click 10 20'), { type: 'click', x: 10, y: 20 });
  assert.deepEqual(parseBodyCommand('type "hello world"'), { type: 'typeText', text: 'hello world' });
  assert.deepEqual(parseBodyCommand('submit 30 40'), { type: 'submit', x: 30, y: 40 });

  const profile = {
    mouse: {
      speedPxPerSec: 1000,
      pathRatio: 1.1,
      pauseBeforeClickMs: 50,
      turnRate: 0.1,
      trajectoryTemplates: [{
        source: 'USER',
        directPx: 100,
        durationMs: 200,
        pathRatio: 1.1,
        points: [
          { u: 0, v: 0, t: 0 },
          { u: 0.5, v: 0.2, t: 0.45 },
          { u: 1, v: 0, t: 1 }
        ]
      }]
    },
    typing: { meanIntervalMs: 80, p90IntervalMs: 180 },
    submit: { clickProbability: 0.8 }
  };

  const trajectoryCompiler = new MotorPlanCompiler(() => 0.5);
  const learnedMove = trajectoryCompiler.compile({ type: 'move', x: 100, y: 0 }, profile, { pointerStart: { x: 0, y: 0 } });
  const learnedMoveSteps = learnedMove.steps.filter(step => step.method === 'Input.dispatchMouseEvent');
  assert.equal(learnedMove.version, 2);
  assert.equal(learnedMoveSteps[0].behaviorSource, 'learned-user-trajectory');
  assert.equal(Math.round(learnedMoveSteps[0].params.x), 50);
  assert.equal(Math.round(learnedMoveSteps[0].params.y), 20);
  assert.equal(learnedMoveSteps.at(-1).params.x, 100);
  assert.equal(learnedMoveSteps.at(-1).params.y, 0);

  const bootstrapProfile = { ...profile, mouse: { ...profile.mouse, trajectoryTemplates: [] } };
  const bootstrapMove = new MotorPlanCompiler(() => 0.5).compile({ type: 'move', x: 100, y: 0 }, bootstrapProfile, { pointerStart: { x: 0, y: 0 } });
  assert.equal(bootstrapMove.steps[0].behaviorSource, 'bootstrap-linear');

  const clickCompiler = new MotorPlanCompiler(() => 0.1);
  const submitClick = clickCompiler.compile({ type: 'submit', x: 100, y: 200 }, profile, { pointerStart: { x: 0, y: 0 } });
  assert.equal(submitClick.strategy.method, 'click');
  assert.ok(submitClick.steps.some(step => step.method === 'Input.dispatchMouseEvent' && step.params.type === 'mousePressed'));

  const enterCompiler = new MotorPlanCompiler(() => 0.99);
  const submitEnter = enterCompiler.compile({ type: 'submit', x: 100, y: 200 }, profile, { pointerStart: { x: 0, y: 0 } });
  assert.equal(submitEnter.strategy.method, 'enter');
  assert.ok(submitEnter.steps.some(step => step.method === 'Input.dispatchKeyEvent' && step.params.key === 'Enter'));

  const combo = clickCompiler.compile({ type: 'keyCombo', key: 'Control+a' }, profile).steps;
  const aDown = combo.find(step => step.params?.key === 'a' && step.params?.type === 'rawKeyDown');
  assert.ok(aDown);
  assert.equal((aDown.params.modifiers & 2) === 2, true);

  const chromeApi = fakeChrome();
  const learner = new BehaviorLearner(chromeApi);
  await learner.init();
  learner.observe(1, { source: SOURCES.USER, kind: 'pointer', event: { type: 'mouseMoved', x: 0, y: 0, at: 1000 }, context: {} });
  learner.observe(1, { source: SOURCES.USER, kind: 'pointer', event: { type: 'mouseMoved', x: 50, y: 20, at: 1050 }, context: {} });
  learner.observe(1, { source: SOURCES.USER, kind: 'pointer', event: { type: 'mouseMoved', x: 100, y: 0, at: 1100 }, context: {} });
  learner.observe(1, { source: SOURCES.USER, kind: 'pointer', event: { type: 'mousePressed', x: 100, y: 0, at: 1150 }, context: { isSubmitControl: true } });
  learner.observe(1, { source: SOURCES.USER, kind: 'keyboard', event: { type: 'keydown', key: 'a', at: 2000 }, context: { formContext: true } });
  learner.observe(1, { source: SOURCES.USER, kind: 'keyboard', event: { type: 'keydown', key: 'Enter', at: 2080 }, context: { formContext: true } });
  learner.observe(1, { source: SOURCES.CDP, kind: 'keyboard', event: { type: 'keydown', key: 'Enter', at: 2160 }, context: { formContext: true } });
  const learned = learner.snapshot();
  assert.equal(learned.version, 2);
  assert.equal(learned.mouse.samples, 1);
  assert.equal(learned.mouse.trajectoryTemplateCount, 1);
  assert.equal(learned.mouse.trajectoryTemplates[0].source, 'USER');
  assert.ok(learned.mouse.trajectoryTemplates[0].points.some(point => point.v > 0));
  assert.equal(learned.submit.clickCount, 1);
  assert.equal(learned.submit.enterCount, 1);
  assert.equal(learned.typing.keydowns, 2);

  const ingress = new BodyCommandIngress({ runCommand: async ({ text, source }) => ({ text, source }) });
  const ingressResult = await ingress.dispatch('socket', { text: 'status' });
  assert.equal(ingressResult.commandIngress.textOnly, true);
  await assert.rejects(() => ingress.dispatch('socket', { text: 'status', extra: true }), /socket_command_text_only/);

  const gatewayChrome = fakeChrome();
  const gateway = new CdpInputGateway(gatewayChrome);
  await gateway.sendInput(7, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 20, button: 'none' });
  assert.equal(gatewayChrome.messages[0].type, 'CDP_POINTER_EXPECTED');
  assert.equal(gatewayChrome.debuggerCalls.some(row => row[0] === 'sendCommand' && row[2] === 'Input.dispatchMouseEvent'), true);
  await assert.rejects(() => gateway.sendInput(7, 'Runtime.evaluate', { expression: '1+1' }), /human_motor_method_forbidden/);

  const failingChrome = fakeChrome();
  failingChrome.debugger.sendCommand = async () => { throw new Error('synthetic dispatch failure'); };
  const failingGateway = new CdpInputGateway(failingChrome);
  await assert.rejects(() => failingGateway.sendInput(8, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA' }), /synthetic dispatch failure/);
  assert.equal(failingChrome.messages.some(message => message.type === 'CDP_INPUT_FAILED'), true);

  console.log('body_runtime_contract: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
