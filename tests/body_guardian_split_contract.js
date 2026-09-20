'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {GuardianAuthorityGate}=require('../daemon/src/guardian_authority_gate');

(()=>{
  const gate=new GuardianAuthorityGate({now:()=>1000,defaultTtlMs:5000});
  assert.equal(gate.status().attached,false);
  assert.equal(gate.authorization('browser-a').allowed,false);
  assert.equal(gate.authorization('browser-a').code,'guardian_authority_not_attached');

  const root=path.resolve(__dirname,'..');
  const daemonRuntime=fs.readFileSync(path.join(root,'daemon','src','daemon_runtime.js'),'utf8');
  const bodyBootstrap=fs.readFileSync(path.join(root,'daemon','body_bootstrap.js'),'utf8');
  const server=fs.readFileSync(path.join(root,'daemon','server.js'),'utf8');
  const bodyBuilder=fs.readFileSync(path.join(root,'tools','build_body_core_test.py'),'utf8');
  const bodyGateway=fs.readFileSync(path.join(root,'daemon','src','body_step_gateway.js'),'utf8');

  assert.doesNotMatch(daemonRuntime,/createRuntimeGuardian|runtime\.guardian|probeEnvironment|probeAllEnvironments/);
  assert.doesNotMatch(bodyBootstrap,/BODY_GUARDIAN_MODE|DetachedGuardian|ProtectionSupervisor|environment_guardian/);
  assert.match(server,/GuardianAuthorityGate/);
  assert.match(server,/role='guardian'/);
  assert.match(server,/GUARDIAN_GATE_SET/);
  assert.doesNotMatch(server,/ENVIRONMENT_STATUS|ENVIRONMENT_PROBE_ALL/);
  assert.doesNotMatch(bodyGateway,/environment:\{/);
  assert.doesNotMatch(bodyGateway,/browserState:String\(browser\.state/);
  assert.match(bodyGateway,/guardianGate\.assertAllowed/);

  for(const guardianFile of [
    'guardian_bootstrap.js',
    'src/guardian_module.js',
    'src/environment_guardian.js',
    'src/protection_supervisor.js',
    'src/behavior_guardian.js',
    'src/external_controller_probe.js',
    'src/device_network_probe.js'
  ])assert.ok(bodyBuilder.includes(guardianFile),`BODY build must explicitly exclude ${guardianFile}`);

  console.log('body_guardian_split_contract: PASS');
})();
