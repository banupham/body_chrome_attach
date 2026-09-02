'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {ControllerLease}=require('./src/controller_lease');
const {LocalAuth}=require('./src/local_auth');
const {commandKind}=require('./src/command_router');

function tmp(name){return fs.mkdtempSync(path.join(os.tmpdir(),`${name}-`));}

test('Brain controller lease is exclusive and releases cleanly',()=>{
  const lease=new ControllerLease();
  const brainA={},brainB={};
  assert.equal(lease.status().brainOnline,false);
  lease.attachBrain(brainA,{controllerId:'brain-a'});
  assert.equal(lease.status().brainOnline,true);
  assert.equal(lease.status().brain.controllerId,'brain-a');
  assert.throws(()=>lease.attachBrain(brainB,{controllerId:'brain-b'}),/brain_controller_already_attached/);
  assert.throws(()=>lease.assertDebugControlAllowed(),/brain_controller_active/);
  assert.equal(lease.detachSocket(brainB),false);
  assert.equal(lease.detachSocket(brainA),true);
  assert.equal(lease.assertDebugControlAllowed(),true);
});

test('Brain and debug client use separate local credentials',()=>{
  const auth=new LocalAuth(tmp('controller-auth'));
  assert.notEqual(auth.brainSecret,auth.debugClientSecret);
  assert.equal(auth.authenticateBrain(auth.brainSecret),true);
  assert.equal(auth.authenticateBrain(auth.debugClientSecret),false);
  assert.equal(auth.authenticateDebugClient(auth.debugClientSecret),true);
  assert.equal(auth.authenticateDebugClient(auth.brainSecret),false);
});

test('debug command classification keeps reads available during Brain control',()=>{
  for(const command of ['status','extensions','tabs','dataset','model','habit'])assert.equal(commandKind(command),'read');
  for(const command of ['click 1 2','type 1 2 hello','browsernewtab','record off','train all','detach'])assert.equal(commandKind(command),'control');
});
