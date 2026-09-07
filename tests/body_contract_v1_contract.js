'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {BROWSER_COMMANDS,COMPOUND_COMMANDS}=require('../daemon/src/browser_ui_adapter');

const root=path.join(__dirname,'..');
const contractDir=path.join(root,'contracts','body','v1');
const command=JSON.parse(fs.readFileSync(path.join(contractDir,'body-step-command.schema.json'),'utf8'));
const result=JSON.parse(fs.readFileSync(path.join(contractDir,'body-step-result.schema.json'),'utf8'));
const observation=JSON.parse(fs.readFileSync(path.join(contractDir,'body-observation.schema.json'),'utf8'));
const socket=JSON.parse(fs.readFileSync(path.join(root,'SOCKET_PROTOCOL.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const bodyDoc=fs.readFileSync(path.join(root,'BODY_CONTRACT.md'),'utf8');
const server=fs.readFileSync(path.join(root,'daemon','server.js'),'utf8');

assert.equal(command.properties.contractVersion.const,'1.0');
assert.equal(command.properties.type.const,'BODY_STEP');
assert.ok(command.required.includes('stepId'));
assert.ok(command.required.includes('taskId'));
const browserUiSchema=command.properties.step.oneOf.find(row=>row.properties?.kind?.const==='browser_ui');
const expectedBrowserActions=[...Object.keys(BROWSER_COMMANDS),...Object.keys(COMPOUND_COMMANDS)].sort();
assert.deepEqual([...browserUiSchema.properties.action.enum].sort(),expectedBrowserActions);

assert.equal(result.properties.contractVersion.const,'1.0');
assert.equal(result.properties.type.const,'BODY_STEP_RESULT');
assert.ok(result.properties.execution.required.includes('attemptCount'));
assert.ok(result.properties.execution.required.includes('replayed'));
const attemptCountSchema=result.properties.execution.properties.attemptCount;
assert.ok(attemptCountSchema.oneOf.some(row=>row.type==='integer'&&row.maximum===1));
assert.ok(attemptCountSchema.oneOf.some(row=>row.type==='null'));
assert.ok(result.properties.execution.properties.accepted.type.includes('null'));
assert.ok(result.properties.execution.properties.dispatched.type.includes('null'));
assert.ok(result.properties.execution.properties.completed.type.includes('null'));
assert.equal(observation.properties.contractVersion.const,'1.0');
assert.ok(observation.properties.content.required.includes('page'));
assert.ok(observation.properties.control.required.includes('activeTarget'));
assert.ok(observation.properties.freshness.required.includes('liveRefreshSucceeded'));

assert.equal(pkg.version,'0.8.0');
assert.equal(manifest.version,pkg.version,'package and Extension versions must stay aligned');
assert.equal(socket.bodyContractVersion,'1.0');
assert.deepEqual(socket.brain.physicalActions,['BODY_STEP']);
assert.ok(socket.brain.queries.includes('BODY_OBSERVE'));
assert.ok(socket.extension.requests.includes('BODY_OBSERVE_SNAPSHOT'));
assert.match(socket.brain.physicalActionRequirement,/explicitly RUNNING taskId/);
assert.match(socket.bodyContract.deliverySemantics,/at-most-once/);
assert.deepEqual([...socket.bodyContract.browserUiActions].sort(),expectedBrowserActions);
for(const legacy of ['INTENT_EXECUTE','STRATEGY_EXECUTE','TAB_SWITCH','BROWSER_COMMAND'])assert.equal(socket.brain.physicalActions.includes(legacy),false);

const docUpper=bodyDoc.toUpperCase();
for(const term of ['BRAIN DECIDES WHAT','BODY LEARNS HOW','ONE BODY_STEP COMMAND','BODY RETURNS FACTS','AT-MOST-ONCE PHYSICAL EXECUTION','NEVER IMPLICITLY STARTS A TASK','UNKNOWN EXECUTION FACTS'])assert.ok(docUpper.includes(term),term);
assert.match(server,/BODY_STEP/);
assert.match(server,/BODY_OBSERVE/);
assert.match(server,/new BodyStepGateway\(runtime,\{baseDir:__dirname\}\)/);
assert.match(server,/bodyGateway\.flushSync/);
assert.equal(/msg\.type==='STRATEGY_EXECUTE'/.test(server),false,'production Brain router must not expose multi-action strategy execution');
assert.equal(/msg\.type==='INTENT_EXECUTE'/.test(server),false,'production Brain router must not expose raw intent execution');
assert.equal(/msg\.type==='TAB_SWITCH'/.test(server),false,'production Brain router must not expose raw tab switching');
assert.equal(/msg\.type==='BROWSER_COMMAND'/.test(server),false,'production Brain router must not expose raw browser commands');

const forbidden=['success','taskSuccess','verified','verification','goalAchieved','correct','wrong','shouldRetry','nextAction','recommendedAction'];
const resultText=JSON.stringify(result);
for(const key of forbidden)assert.equal(resultText.includes(`\"${key}\"`),false,`BODY_STEP_RESULT schema must not expose judgment field ${key}`);

console.log('body_contract_v1_contract: PASS');
