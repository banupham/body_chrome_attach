'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {GuardianProtectionState}=require('../daemon/src/guardian_protection_state');

(()=>{
  const state=new GuardianProtectionState();
  assert.equal(state.status().attached,false);
  assert.equal(state.learningAllowed('browser-a'),false);
  assert.equal(state.browserVerdict('browser-a').browserValid,null);

  const root=path.resolve(__dirname,'..');
  const daemonRuntime=fs.readFileSync(path.join(root,'daemon','src','daemon_runtime.js'),'utf8');
  const bodyBootstrap=fs.readFileSync(path.join(root,'daemon','body_bootstrap.js'),'utf8');
  const server=fs.readFileSync(path.join(root,'daemon','server.js'),'utf8');
  const bodyBuilder=fs.readFileSync(path.join(root,'tools','build_body_core_test.py'),'utf8');
  const bodyGateway=fs.readFileSync(path.join(root,'daemon','src','body_step_gateway.js'),'utf8');

  assert.doesNotMatch(daemonRuntime,/createRuntimeGuardian|runtime\.guardian|probeEnvironment|probeAllEnvironments/);
  assert.doesNotMatch(bodyBootstrap,/BODY_GUARDIAN_MODE|DetachedGuardian|ProtectionSupervisor|environment_guardian/);
  assert.match(server,/GuardianProtectionState/);
  assert.match(server,/role='guardian'/);
  assert.match(server,/GUARDIAN_BROWSER_VERDICT/);
  assert.match(server,/GUARDIAN_LEARNING_SET/);
  assert.doesNotMatch(server,/GUARDIAN_GATE_SET|GUARDIAN_GATE_REVOKE/);
  assert.doesNotMatch(bodyGateway,/guardianGate|assertAllowed/);
  assert.doesNotMatch(bodyGateway,/environment:\{/);
  assert.doesNotMatch(bodyGateway,/browserState:String\(browser\.state/);

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
