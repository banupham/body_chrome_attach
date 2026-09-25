'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {GuardianProtectionState}=require('./src/guardian_protection_state');

test('Guardian protection state defaults Human learning to blocked without gating Brain execution',()=>{
  const state=new GuardianProtectionState();
  assert.equal(state.learningAllowed('browser-a'),false);
  assert.equal(state.browserVerdict('browser-a').browserValid,null);
  assert.equal(state.status().attached,false);
});

test('valid browser may enable Human learning; automation may disable learning without invalidating browser',()=>{
  const state=new GuardianProtectionState(),socket={};
  state.attach(socket,{guardianId:'guardian-test'});
  state.setBrowserVerdict({browserInstanceId:'browser-a',valid:true,reasons:[]});
  state.setLearning({browserInstanceId:'browser-a',allowed:true,reasons:[]});
  assert.equal(state.browserVerdict('browser-a').browserValid,true);
  assert.equal(state.learningAllowed('browser-a'),true);

  state.setLearning({browserInstanceId:'browser-a',allowed:false,reasons:['EXTERNAL_CONTROLLER_CONFLICT']});
  assert.equal(state.browserVerdict('browser-a').browserValid,true);
  assert.equal(state.learningAllowed('browser-a'),false);
});

test('invalid browser forces Human learning off and Guardian disconnect fails Human learning closed',()=>{
  const state=new GuardianProtectionState(),socket={};
  state.attach(socket);
  state.setBrowserVerdict({browserInstanceId:'browser-a',valid:true,reasons:[]});
  state.setLearning({browserInstanceId:'browser-a',allowed:true,reasons:[]});
  state.setBrowserVerdict({browserInstanceId:'browser-a',valid:false,reasons:['INVALID_CHROME']});
  assert.equal(state.browserVerdict('browser-a').browserValid,false);
  assert.equal(state.learningAllowed('browser-a'),false);

  state.setBrowserVerdict({browserInstanceId:'browser-a',valid:true,reasons:[]});
  state.setLearning({browserInstanceId:'browser-a',allowed:true,reasons:[]});
  assert.equal(state.detach(socket),true);
  assert.equal(state.learningAllowed('browser-a'),false);
});
