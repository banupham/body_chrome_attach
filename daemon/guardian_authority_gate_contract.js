'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {GuardianAuthorityGate}=require('./src/guardian_authority_gate');

test('Guardian authority gate is fail-closed until external Guardian attaches',()=>{
  let now=1000;
  const gate=new GuardianAuthorityGate({now:()=>now,defaultTtlMs:5000});
  assert.equal(gate.authorization('browser-a').code,'guardian_authority_not_attached');
  assert.throws(()=>gate.assertAllowed('browser-a'),/guardian_authority_not_attached/);

  const socket={id:'guardian-socket'};
  gate.attach(socket,{guardianId:'guardian-test'});
  assert.equal(gate.authorization('browser-a').code,'guardian_grant_missing');

  const grant=gate.setGrant({browserInstanceId:'browser-a',allowed:true,leaseId:'lease-1',ttlMs:3000});
  assert.equal(grant.authority,'guardian');
  assert.equal(gate.assertAllowed('browser-a').allowed,true);

  now=4501;
  assert.equal(gate.authorization('browser-a').code,'guardian_grant_expired');
  assert.throws(()=>gate.assertAllowed('browser-a'),/guardian_grant_missing|guardian_grant_expired/);
});

test('explicit deny and Guardian disconnect both prevent Brain CDP',()=>{
  const gate=new GuardianAuthorityGate({now:()=>1000});
  const socket={};
  gate.attach(socket);
  gate.setGrant({browserInstanceId:'browser-a',allowed:false,leaseId:'deny'});
  assert.equal(gate.authorization('browser-a').code,'guardian_cdp_blocked');
  gate.setGrant({browserInstanceId:'browser-a',allowed:true,leaseId:'allow'});
  assert.equal(gate.assertAllowed('browser-a').allowed,true);
  assert.equal(gate.detach(socket),true);
  assert.equal(gate.authorization('browser-a').code,'guardian_authority_not_attached');
  assert.equal(gate.status().activeGrantCount,0);
});
