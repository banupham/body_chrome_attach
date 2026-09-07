'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const contractDir=path.join(root,'contracts','body','v1');
const command=JSON.parse(fs.readFileSync(path.join(contractDir,'body-step-command.schema.json'),'utf8'));
const result=JSON.parse(fs.readFileSync(path.join(contractDir,'body-step-result.schema.json'),'utf8'));
const observation=JSON.parse(fs.readFileSync(path.join(contractDir,'body-observation.schema.json'),'utf8'));
const socket=JSON.parse(fs.readFileSync(path.join(root,'SOCKET_PROTOCOL.json'),'utf8'));
const bodyDoc=fs.readFileSync(path.join(root,'BODY_CONTRACT.md'),'utf8');
const server=fs.readFileSync(path.join(root,'daemon','server.js'),'utf8');

assert.equal(command.properties.contractVersion.const,'1.0');
assert.equal(command.properties.type.const,'BODY_STEP');
assert.ok(command.required.includes('stepId'));
assert.ok(command.required.includes('taskId'));
assert.equal(result.properties.contractVersion.const,'1.0');
assert.equal(result.properties.type.const,'BODY_STEP_RESULT');
assert.equal(observation.properties.contractVersion.const,'1.0');

assert.equal(socket.bodyContractVersion,'1.0');
assert.deepEqual(socket.brain.physicalActions,['BODY_STEP']);
assert.ok(socket.brain.queries.includes('BODY_OBSERVE'));
for(const legacy of ['INTENT_EXECUTE','STRATEGY_EXECUTE','TAB_SWITCH','BROWSER_COMMAND'])assert.equal(socket.brain.physicalActions.includes(legacy),false);

const docUpper=bodyDoc.toUpperCase();
for(const term of ['BRAIN DECIDES WHAT','BODY LEARNS HOW','ONE BODY_STEP COMMAND','BODY RETURNS FACTS'])assert.ok(docUpper.includes(term),term);
assert.match(server,/BODY_STEP/);
assert.match(server,/BODY_OBSERVE/);
assert.equal(/msg\.type==='STRATEGY_EXECUTE'/.test(server),false,'production Brain router must not expose multi-action strategy execution');
assert.equal(/msg\.type==='INTENT_EXECUTE'/.test(server),false,'production Brain router must not expose raw intent execution');
assert.equal(/msg\.type==='TAB_SWITCH'/.test(server),false,'production Brain router must not expose raw tab switching');
assert.equal(/msg\.type==='BROWSER_COMMAND'/.test(server),false,'production Brain router must not expose raw browser commands');

const forbidden=['success','taskSuccess','verified','verification','goalAchieved','correct','wrong','shouldRetry','nextAction','recommendedAction'];
const resultText=JSON.stringify(result);
for(const key of forbidden)assert.equal(resultText.includes(`\"${key}\"`),false,`BODY_STEP_RESULT schema must not expose judgment field ${key}`);

console.log('body_contract_v1_contract: PASS');
