'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {BodyStepLedger,commandHash}=require('./src/body_step_ledger');

function tmp(name){return fs.mkdtempSync(path.join(os.tmpdir(),`${name}-`));}
function command(requestId='r1'){return {contractVersion:'1.0',type:'BODY_STEP',requestId,stepId:'STEP-1',taskId:'TASK-1',tabId:'primary',step:{kind:'motor',intent:{type:'pressKey',key:'Enter'}}};}

test('BODY step command identity ignores transport requestId and object key order',()=>{
  const a=command('r1'),b={taskId:'TASK-1',stepId:'STEP-1',type:'BODY_STEP',contractVersion:'1.0',requestId:'r2',step:{intent:{key:'Enter',type:'pressKey'},kind:'motor'},tabId:'primary'};
  assert.equal(commandHash(a),commandHash(b));
});

test('RESERVED state is durable across daemon-style ledger restart',()=>{
  const base=tmp('body-ledger-reserve'),first=new BodyStepLedger(base);first.reserve(command());const reloaded=new BodyStepLedger(base),found=reloaded.lookup(command('different-request'));
  assert.equal(found.status,'reserved');assert.equal(reloaded.stats().reserved,1);assert.equal(reloaded.stats().done,0);
});

test('DONE result is durable and replayable after restart',()=>{
  const base=tmp('body-ledger-done'),first=new BodyStepLedger(base),cmd=command();first.reserve(cmd);first.commit(cmd,{type:'BODY_STEP_RESULT',stepId:'STEP-1',taskId:'TASK-1',execution:{attemptCount:1}});const reloaded=new BodyStepLedger(base),result=reloaded.replay(command('new-request'));
  assert.equal(result.execution.attemptCount,1);assert.equal(reloaded.stats().done,1);assert.equal(reloaded.stats().reserved,0);
});

test('reusing a taskId/stepId for a different Body command is rejected',()=>{
  const ledger=new BodyStepLedger(tmp('body-ledger-conflict')),cmd=command();ledger.reserve(cmd);const changed={...cmd,step:{kind:'motor',intent:{type:'pressKey',key:'Escape'}}};assert.throws(()=>ledger.lookup(changed),/body_step_id_conflict/);
});
