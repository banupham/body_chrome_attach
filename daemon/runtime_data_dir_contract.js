'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {LocalIdentityStore}=require('./src/local_identity');
const {LocalAuth}=require('./src/local_auth');
const {TaskManager}=require('./src/task_manager');
const {EnvironmentGuardian}=require('./src/environment_guardian');
const {BodyStepLedger}=require('./src/body_step_ledger');
const {ScopedLearningManager}=require('./src/scoped_learning');
const {TabHabitModel}=require('./src/tab_habit_model');
const {EvidenceStore}=require('./src/evidence_store');
const {endpointPaths}=require('./src/runtime_endpoint');
const {configuredRuntimeDataDir}=require('./src/runtime_data_dir');

function tmp(prefix){return fs.mkdtempSync(path.join(os.tmpdir(),`${prefix}-`));}
function under(file,root){return path.resolve(file).startsWith(path.resolve(root)+path.sep)||path.resolve(file)===path.resolve(root);}

test('BODY_RUNTIME_DATA_DIR redirects every mutable BODY store out of packaged code',()=>{
  const codeRoot=tmp('body-code'),dataRoot=tmp('body-data');
  const env={...process.env,BODY_RUNTIME_DATA_DIR:dataRoot,BODY_COMPANY_ID:'company-test',BODY_DEVICE_ID:'device-test'};
  assert.equal(configuredRuntimeDataDir(env),path.resolve(dataRoot));

  const identity=new LocalIdentityStore(codeRoot,{env,uuid:()=> 'fixed-id',now:()=>0});
  assert.ok(under(identity.companyPath,dataRoot));
  assert.ok(under(identity.devicePath,dataRoot));
  assert.ok(under(identity.browsersPath,dataRoot));

  const auth=new LocalAuth(codeRoot,{env});
  assert.ok(under(auth.brainPath,dataRoot));
  assert.ok(under(auth.debugClientPath,dataRoot));
  assert.ok(under(auth.extensionsPath,dataRoot));

  const tasks=new TaskManager(codeRoot,{}, {env,uuid:()=> 'task-id',now:()=>0});
  assert.ok(under(tasks.file,dataRoot));

  const browsers={browsers:new Map(),setEnvironment(){},setState(){},list(){return [];}};
  const guardian=new EnvironmentGuardian(codeRoot,browsers,{requestExtension:async()=>({}),env,deviceProbe:{probe(){return {};}}});
  assert.ok(under(guardian.file,dataRoot));

  const ledger=new BodyStepLedger(codeRoot,{env,now:()=>0});
  assert.ok(under(ledger.file,dataRoot));

  const learning=new ScopedLearningManager(path.join(codeRoot,'profiles'),{env,resolveIdentity:()=>({browserInstanceId:'browser-a',extensionInstanceId:'ext-a'})});
  assert.ok(under(learning.baseDir,dataRoot));
  assert.equal(path.basename(learning.baseDir),'profiles');

  const tabHabit=new TabHabitModel(path.join(codeRoot,'profiles','_tab_habits.json'),{env});
  assert.ok(under(tabHabit.file,dataRoot));

  const evidence=new EvidenceStore(path.join(codeRoot,'evidence'),{env,now:()=>0,randomBytes:size=>Buffer.alloc(size,1)});
  assert.ok(under(evidence.baseDir,dataRoot));
  assert.equal(path.basename(evidence.baseDir),'evidence');

  const endpoints=endpointPaths(codeRoot,env);
  assert.ok(under(endpoints.state,dataRoot));
  assert.ok(under(endpoints.port,dataRoot));
  assert.ok(under(endpoints.lock,dataRoot));
  assert.equal(under(endpoints.extension,dataRoot),false,'dev Extension mirror remains an immutable-code-side compatibility path');

  assert.deepEqual(fs.readdirSync(codeRoot),[],'persistent mode must not create mutable state under the packaged code root');
});

test('runtime data routing remains backward compatible when no override is configured',()=>{
  const codeRoot=tmp('body-code-fallback');
  const env={};
  const identity=new LocalIdentityStore(codeRoot,{env,uuid:()=> 'fallback-id',now:()=>0});
  assert.ok(under(identity.companyPath,codeRoot));
  assert.equal(configuredRuntimeDataDir(env),null);
});
