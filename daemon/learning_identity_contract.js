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
    'ext-a':{browserInstanceId:'browser-a',extensionInstanceId:'ext-a',runtimeExtensionId:'runtime-a'},
    'ext-b':{browserInstanceId:'browser-b',extensionInstanceId:'ext-b',runtimeExtensionId:'runtime-b'},
    'ext-c':{browserInstanceId:'browser-c',extensionInstanceId:'ext-c',runtimeExtensionId:'runtime-c'},
    'ext-legacy':{browserInstanceId:'browser-new',extensionInstanceId:'ext-legacy',runtimeExtensionId:'runtime-new'}
  };
  const row=map[String(ref)];if(!row)throw new Error(`unknown_ref:${ref}`);return row;
}

function human(action,extra={}){return {source:'human',action,tabId:1,context:{target_role:'unknown'},...extra};}

test('same website shares one learning dataset and model across Browser identities',()=>{
  const root=tempDir(),profiles=path.join(root,'profiles');
  const learning=new ScopedLearningManager(profiles,{resolveIdentity:resolver});
  learning.observeHumanSample('ext-a','example.com',human('pressKey',{key:'Enter',hold_ms:61}),{learn:true});
  learning.observeHumanSample('ext-b','example.com',human('pressKey',{key:'Tab',hold_ms:73}),{learn:true});
  learning.flushSync();

  const a=learning.stats('ext-a','example.com');
  const b=learning.stats('ext-b','example.com');
  assert.equal(a.learningScope,'site_shared');
  assert.equal(b.learningScope,'site_shared');
  assert.equal(a.dataset.humanSamples,2);
  assert.equal(b.dataset.humanSamples,2);
  assert.equal(a.motor.groups['keyboard|pressKey|Enter'],1);
  assert.equal(a.motor.groups['keyboard|pressKey|Tab'],1);
  assert.deepEqual(a.motor.groups,b.motor.groups);

  const rows=learning.scope('ext-a','example.com').store.loadHumanSamples();
  assert.deepEqual(rows.map(row=>row.browserInstanceId),['browser-a','browser-b']);
  assert.equal(path.basename(path.dirname(learning.scope('ext-a','example.com').dir)),'by-site');
  assert.equal(learning.scope('ext-a','example.com'),learning.scope('ext-b','example.com'));
});

test('different websites remain separate while device-global fallback is shared',()=>{
  const root=tempDir(),profiles=path.join(root,'profiles');
  const learning=new ScopedLearningManager(profiles,{resolveIdentity:resolver});
  learning.observeHumanSample('ext-a','alpha.test',human('pressKey',{key:'Enter'}));
  learning.observeHumanSample('ext-b','beta.test',human('pressKey',{key:'Tab'}));
  learning.flushSync();
  assert.equal(learning.stats('ext-a','alpha.test').dataset.humanSamples,1);
  assert.equal(learning.stats('ext-b','beta.test').dataset.humanSamples,1);
  assert.equal(learning.stats('ext-c','__global__').dataset.humanSamples,2);
  assert.ok(learning.motorFor('ext-c','alpha.test').samplePressKey('Enter'));
  assert.ok(learning.motorFor('ext-c','beta.test').samplePressKey('Tab'));
});

test('legacy by-browser data from every Browser is copied, deduplicated and rebuilt into by-site',()=>{
  const root=tempDir(),profiles=path.join(root,'profiles');
  const aSite=path.join(profiles,'by-browser','browser-old-a','youtube.com','data','human_samples.jsonl');
  const bSite=path.join(profiles,'by-browser','browser-old-b','youtube.com','data','human_samples.jsonl');
  const aGlobal=path.join(profiles,'by-browser','browser-old-a','__global__','data','human_samples.jsonl');
  const bGlobal=path.join(profiles,'by-browser','browser-old-b','__global__','data','human_samples.jsonl');
  const rowA=human('pressKey',{key:'Enter',browserInstanceId:'browser-old-a',siteKey:'youtube.com'});
  const rowB=human('pressKey',{key:'Tab',browserInstanceId:'browser-old-b',siteKey:'youtube.com'});
  writeJsonl(aSite,[rowA]);writeJsonl(bSite,[rowB]);writeJsonl(aGlobal,[rowA]);writeJsonl(bGlobal,[rowB]);

  const learning=new ScopedLearningManager(profiles,{resolveIdentity:resolver});
  const site=learning.stats('ext-a','youtube.com'),global=learning.stats('ext-b','__global__');
  assert.equal(site.dataset.humanSamples,2);
  assert.equal(global.dataset.humanSamples,2);
  assert.equal(site.motor.groups['keyboard|pressKey|Enter'],1);
  assert.equal(site.motor.groups['keyboard|pressKey|Tab'],1);
  assert.equal(global.motor.groups['keyboard|pressKey|Enter'],1);
  assert.equal(global.motor.groups['keyboard|pressKey|Tab'],1);
  assert.equal(fs.existsSync(aSite),true,'legacy source is preserved for rollback/audit');
  assert.equal(fs.existsSync(bSite),true,'legacy source is preserved for rollback/audit');
  assert.equal(fs.existsSync(path.join(profiles,'by-site','youtube.com','data','human_samples.jsonl')),true);

  const learningAgain=new ScopedLearningManager(profiles,{resolveIdentity:resolver});
  assert.equal(learningAgain.stats('ext-c','youtube.com').dataset.humanSamples,2,'restart must not duplicate imported rows');
});

test('changed legacy Browser source is incrementally imported without duplicating old rows',()=>{
  const root=tempDir(),profiles=path.join(root,'profiles'),file=path.join(profiles,'by-browser','browser-old','example.com','data','human_samples.jsonl');
  const first=human('pressKey',{key:'Enter',browserInstanceId:'browser-old',siteKey:'example.com'});
  const second=human('pressKey',{key:'Escape',browserInstanceId:'browser-old',siteKey:'example.com'});
  writeJsonl(file,[first]);
  let learning=new ScopedLearningManager(profiles,{resolveIdentity:resolver});
  assert.equal(learning.stats('ext-a','example.com').dataset.humanSamples,1);
  writeJsonl(file,[first,second]);
  learning=new ScopedLearningManager(profiles,{resolveIdentity:resolver});
  assert.equal(learning.stats('ext-b','example.com').dataset.humanSamples,2);
  assert.equal(learning.stats('ext-b','example.com').motor.groups['keyboard|pressKey|Escape'],1);
});

test('legacy extension-scoped learning is imported into the shared site store without deleting source',()=>{
  const root=tempDir(),profiles=path.join(root,'profiles');
  const legacy=path.join(profiles,'ext-legacy','example.com','data','human_samples.jsonl');
  writeJsonl(legacy,[human('pressKey',{key:'Escape',siteKey:'example.com'})]);
  const learning=new ScopedLearningManager(profiles,{resolveIdentity:resolver});
  const bound=learning.bindIdentity('ext-legacy');
  assert.equal(bound.learningScope,'site_shared');
  assert.equal(learning.stats('ext-legacy','example.com').dataset.humanSamples,1);
  assert.equal(learning.stats('ext-a','example.com').motor.groups['keyboard|pressKey|Escape'],1);
  assert.equal(fs.existsSync(legacy),true);
});

test('TabHabit v1 migration still quarantines unscoped transitions instead of mixing Browsers',()=>{
  const root=tempDir(),file=path.join(root,'_tab_habits.json');
  fs.writeFileSync(file,JSON.stringify({version:1,revision:9,updatedAt:'2026-09-01T00:00:00.000Z',transitions:{'old.test=>next.test':9},lastActiveByExtension:{'ext-a':{tabId:1,siteKey:'old.test',ts:1}}},null,2));
  const model=new TabHabitModel(file,{resolveIdentity:resolver});
  const before=model.stats('ext-a');
  assert.equal(before.browserInstanceId,'browser-a');
  assert.deepEqual(before.transitions,{});
  assert.equal(before.lastActive.siteKey,'old.test');
  assert.equal(before.legacyUnscopedTransitionsIgnored,true);
  assert.equal(before.legacyUnscopedTransitionCount,1);
  model.observe('ext-a',{source:'human',eventType:'tabActivated',tabId:2,siteKey:'next.test',ts:2});
  const after=model.stats('ext-a');
  assert.equal(after.transitions['old.test=>next.test'],1);
  model.flushSync();
  const persisted=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(persisted.version,2);
  assert.equal(persisted.legacyUnscopedTransitions['old.test=>next.test'],9);
});
