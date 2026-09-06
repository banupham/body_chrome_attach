'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {ScopedLearningManager}=require('./src/scoped_learning');
const {TabHabitModel}=require('./src/tab_habit_model');

function tempDir(){return fs.mkdtempSync(path.join(os.tmpdir(),'body-learning-identity-'));}
function writeJsonl(file,rows){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,rows.map(row=>JSON.stringify(row)).join('\n')+'\n','utf8');}

function resolver(ref){
  const map={
    'ext-a':{browserInstanceId:'browser-a',extensionInstanceId:'ext-a',runtimeExtensionId:'runtime'},
    'ext-b':{browserInstanceId:'browser-a',extensionInstanceId:'ext-b',runtimeExtensionId:'runtime'},
    'ext-c':{browserInstanceId:'browser-c',extensionInstanceId:'ext-c',runtimeExtensionId:'runtime'},
    'ext-conflict':{browserInstanceId:'browser-conflict',extensionInstanceId:'ext-conflict',runtimeExtensionId:'runtime'}
  };
  const row=map[String(ref)];if(!row)throw new Error(`unknown_ref:${ref}`);return row;
}

test('legacy extension learning is atomically moved to Browser scope and remains readable',()=>{
  const root=tempDir(),profiles=path.join(root,'profiles');
  const legacyFile=path.join(profiles,'ext-a','example.com','data','human_samples.jsonl');
  writeJsonl(legacyFile,[{source:'human',action:'click',extensionId:'ext-a',siteKey:'example.com'}]);

  const learning=new ScopedLearningManager(profiles,{resolveIdentity:resolver});
  const bound=learning.bindIdentity('ext-a');
  assert.equal(bound.browserInstanceId,'browser-a');
  assert.equal(bound.migration.migrated,true);
  assert.equal(fs.existsSync(path.join(profiles,'ext-a')),false);
  assert.equal(fs.existsSync(path.join(profiles,'by-browser','browser-a','example.com','data','human_samples.jsonl')),true);

  const scope=learning.scope('ext-a','example.com');
  assert.equal(scope.store.loadHumanSamples().length,1);
  learning.observeHumanSample('ext-a','example.com',{action:'move',source:'human'},{learn:false});
  learning.flushSync();
  const rows=scope.store.loadHumanSamples();
  assert.equal(rows.length,2);
  assert.equal(rows[1].browserInstanceId,'browser-a');
  assert.equal(rows[1].extensionInstanceId,'ext-a');
});

test('replacement transport identity reuses the same Browser learning scope without mixing another Browser',()=>{
  const root=tempDir(),profiles=path.join(root,'profiles');
  const learning=new ScopedLearningManager(profiles,{resolveIdentity:resolver});
  learning.observeHumanSample('ext-a','example.com',{action:'click',source:'human'},{learn:false});
  learning.observeHumanSample('ext-b','example.com',{action:'scrollVertical',source:'human'},{learn:false});
  learning.observeHumanSample('ext-c','example.com',{action:'pressKey',source:'human'},{learn:false});
  learning.flushSync();

  const a=learning.scope('ext-a','example.com').store.loadHumanSamples();
  const b=learning.scope('ext-b','example.com').store.loadHumanSamples();
  const c=learning.scope('ext-c','example.com').store.loadHumanSamples();
  assert.equal(a.length,2);
  assert.equal(b.length,2);
  assert.equal(c.length,1);
  assert.deepEqual(a.map(row=>row.extensionInstanceId),['ext-a','ext-b']);
  assert.ok(a.every(row=>row.browserInstanceId==='browser-a'));
  assert.ok(c.every(row=>row.browserInstanceId==='browser-c'));
  assert.equal(fs.existsSync(path.join(profiles,'ext-b')),false);
});

test('migration conflict fails closed and preserves both legacy and Browser payloads',()=>{
  const root=tempDir(),profiles=path.join(root,'profiles');
  const legacy=path.join(profiles,'ext-conflict','site.test','data','human_samples.jsonl');
  const stable=path.join(profiles,'by-browser','browser-conflict','site.test','data','human_samples.jsonl');
  writeJsonl(legacy,[{source:'human',action:'legacy'}]);
  writeJsonl(stable,[{source:'human',action:'stable'}]);
  const learning=new ScopedLearningManager(profiles,{resolveIdentity:resolver});
  assert.throws(()=>learning.bindIdentity('ext-conflict'),/legacy_learning_migration_conflict/);
  assert.equal(fs.existsSync(legacy),true);
  assert.equal(fs.existsSync(stable),true);
});

test('TabHabit v1 migration quarantines unscoped transitions instead of mixing Browsers',()=>{
  const root=tempDir(),file=path.join(root,'_tab_habits.json');
  fs.writeFileSync(file,JSON.stringify({
    version:1,revision:9,updatedAt:'2026-09-01T00:00:00.000Z',
    transitions:{'old.test=>next.test':9},
    lastActiveByExtension:{'ext-a':{tabId:1,siteKey:'old.test',ts:1}}
  },null,2));

  const model=new TabHabitModel(file,{resolveIdentity:resolver});
  const before=model.stats('ext-a');
  assert.equal(before.browserInstanceId,'browser-a');
  assert.deepEqual(before.transitions,{});
  assert.equal(before.lastActive.siteKey,'old.test');
  assert.equal(before.legacyUnscopedTransitionsIgnored,true);
  assert.equal(before.legacyUnscopedTransitionCount,1);

  model.observe('ext-a',{source:'human',eventType:'tabActivated',tabId:2,siteKey:'next.test',ts:2});
  const after=model.stats('ext-b');
  assert.equal(after.transitions['old.test=>next.test'],1);
  assert.equal(model.stats('ext-c').transitions['old.test=>next.test'],undefined);
  model.flushSync();
  const persisted=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(persisted.version,2);
  assert.equal(persisted.legacyUnscopedTransitions['old.test=>next.test'],9);
});
