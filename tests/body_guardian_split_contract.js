'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DetachedGuardian}=require('../daemon/src/guardian_module');

(async()=>{
  const browser={browserInstanceId:'browser-split-test',online:true,state:'ENV_CHECK',stateReason:'environment_check_required',environment:{eligible:false,status:'PENDING',reasons:['ENVIRONMENT_CHECK_REQUIRED'],evidence:[]},tabs:[{id:1,active:true,siteKey:'youtube.com'}]};
  const browsers={
    require(id){assert.equal(id,browser.browserInstanceId);return browser;},
    list(){return [browser];}
  };
  const guardian=new DetachedGuardian({browsers});
  assert.equal(guardian.mode,'DETACHED');
  assert.equal(guardian.status().attached,false);
  assert.equal(guardian.status().policy.failClosed,true);
  const result=await guardian.probeBrowser(browser.browserInstanceId);
  assert.equal(result.eligible,false);
  assert.equal(result.status,'PENDING');
  assert.deepEqual(result.reasons,['GUARDIAN_DETACHED']);
  assert.equal(browser.environment.eligible,false);
  assert.equal(browser.state,'ENV_CHECK');

  const root=path.resolve(__dirname,'..');
  const daemonRuntime=fs.readFileSync(path.join(root,'daemon','src','daemon_runtime.js'),'utf8');
  const bodyBootstrap=fs.readFileSync(path.join(root,'daemon','body_bootstrap.js'),'utf8');
  const guardianBootstrap=fs.readFileSync(path.join(root,'daemon','guardian_bootstrap.js'),'utf8');
  const server=fs.readFileSync(path.join(root,'daemon','server.js'),'utf8');
  const bodyBuilder=fs.readFileSync(path.join(root,'tools','build_body_core_test.py'),'utf8');

  assert.match(daemonRuntime,/createRuntimeGuardian/);
  assert.doesNotMatch(daemonRuntime,/require\(['"]\.\/environment_guardian['"]\)/);
  assert.match(bodyBootstrap,/BODY_GUARDIAN_MODE='detached'/);
  assert.doesNotMatch(bodyBootstrap,/ProtectionSupervisor|environment_guardian/);
  assert.match(guardianBootstrap,/attachProtectionGuardian/);
  assert.match(server,/guardian_detached/);

  for(const guardianFile of [
    'guardian_bootstrap.js',
    'src/environment_guardian.js',
    'src/protection_supervisor.js',
    'src/behavior_guardian.js',
    'src/external_controller_probe.js',
    'src/device_network_probe.js'
  ])assert.ok(bodyBuilder.includes(guardianFile),`BODY build must explicitly exclude ${guardianFile}`);

  console.log('body_guardian_split_contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
