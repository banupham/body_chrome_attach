'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EvidenceStore}=require('./src/evidence_store');
const {EvidenceAssembler}=require('./src/evidence_assembler');
const {createDaemonRuntime}=require('./src/daemon_runtime');

function tmp(name){return fs.mkdtempSync(path.join(os.tmpdir(),`${name}-`));}
const identity={companyId:'company-a',deviceId:'device-a',browserInstanceId:'browser-a',extensionInstanceId:'ext-a',runtimeExtensionId:'runtime-a'};
function before(){return {available:true,platform:'youtube',observerVersion:1,observedAt:100,privacy:{searchQueryCaptured:false,accountIdentityCaptured:false,textContentCaptured:false},route:{supported:true,pageType:'home',path:'/',videoId:null,listId:null,searchQueryPresent:false},controls:{searchInput:{available:true,visible:true,active:true,tag:'input',actionRect:{x:10,y:10,width:100,height:20}},searchButton:{available:true,visible:true,active:false,tag:'button',actionRect:{x:120,y:10,width:30,height:20}}},surfaces:[],viewport:{width:1200,height:700}};}
function after(){return {available:true,platform:'youtube',observerVersion:1,observedAt:200,privacy:{searchQueryCaptured:false,accountIdentityCaptured:false,textContentCaptured:false},route:{supported:true,pageType:'search',path:'/results',videoId:null,listId:null,searchQueryPresent:true},controls:{searchInput:{available:true,visible:true,active:false,tag:'input',actionRect:{x:10,y:10,width:100,height:20}},searchButton:{available:true,visible:true,active:false,tag:'button',actionRect:{x:120,y:10,width:30,height:20}}},surfaces:[{surface:'search_results',itemCount:4}],viewport:{width:1200,height:700}};}

test('EvidenceStore is append-only hash chained and detects tampering',()=>{
  let now=1000,seq=0;
  const root=tmp('evidence-chain');
  const store=new EvidenceStore(root,{now:()=>now++,randomBytes:size=>Buffer.alloc(size,++seq)});
  const base={identity,siteKey:'www.youtube.com',tabId:7,source:'human',provenance:{kind:'human_demonstration',trustedInput:true},beforeState:before(),action:{type:'youtube.search',trigger:'keyboard_enter',queryCaptured:false},afterState:after(),observedEffect:{navigationObserved:true,searchResultsObserved:true,searchResultCount:4}};
  const one=store.append(base),two=store.append(base);
  assert.equal(one.previousHash,null);
  assert.equal(two.previousHash,one.recordHash);
  assert.equal(store.list(identity,'www.youtube.com').length,2);
  assert.equal(store.verifyFile(path.join(root,'by-browser','browser-a','www.youtube.com','evidence.jsonl')).ok,true);
  assert.throws(()=>store.append({...base,source:'agent'}),/evidence_human_source_required/);
  assert.throws(()=>store.append({...base,provenance:{kind:'human_demonstration',trustedInput:false}}),/evidence_trusted_input_required/);

  const file=path.join(root,'by-browser','browser-a','www.youtube.com','evidence.jsonl');
  const lines=fs.readFileSync(file,'utf8').trim().split(/\r?\n/);
  const tampered=JSON.parse(lines[0]);tampered.action.type='tampered';lines[0]=JSON.stringify(tampered);
  fs.writeFileSync(file,lines.join('\n')+'\n','utf8');
  store.lastHashByFile.delete(file);
  assert.throws(()=>store.verifyFile(file),/evidence_integrity_violation/);
});

test('EvidenceAssembler creates one traceable youtube.search record only from trusted Human Enter',()=>{
  let now=5000;
  const root=tmp('evidence-assembler'),store=new EvidenceStore(root,{now:()=>now,randomBytes:size=>Buffer.alloc(size,2)}),assembler=new EvidenceAssembler(store,{now:()=>now,ttlMs:10000});
  const agent=assembler.observeRecorder(identity,'www.youtube.com',3,{source:'agent',isTrusted:true,eventType:'keydown',key:'Enter',semanticBefore:before()});
  assert.equal(agent,null);
  const accepted=assembler.observeRecorder(identity,'www.youtube.com',3,{source:'human',isTrusted:true,eventType:'keydown',key:'Enter',ts:4999,semanticBefore:before()});
  assert.equal(accepted.action,'youtube.search');
  assert.equal(assembler.status().pending,1);
  const record=assembler.observeAfter(identity,'www.youtube.com',3,after());
  assert.equal(record.action.type,'youtube.search');
  assert.equal(record.action.queryCaptured,false);
  assert.equal(record.identity.browserInstanceId,'browser-a');
  assert.equal(record.identity.extensionInstanceId,'ext-a');
  assert.equal(record.observedEffect.toPageType,'search');
  assert.equal(record.observedEffect.searchResultCount,4);
  assert.equal(assembler.status().pending,0);
  assert.equal(assembler.status().completed,1);
  assert.equal(JSON.stringify(record).includes('search_query='),false);
  assert.equal(assembler.observeAfter(identity,'www.youtube.com',3,after()),null,'same trigger must not emit twice');
});

test('runtime keeps semanticBefore out of learning DatasetStore while writing separate Evidence Store',()=>{
  const baseDir=tmp('evidence-runtime');
  const runtime=createDaemonRuntime({baseDir});
  runtime.registerExtensionIdentity({browserInstanceId:'browser-a',extensionInstanceId:'ext-a',runtimeExtensionId:'runtime-a'});
  runtime.registry.register('ext-a',{}, {browserInstanceId:'browser-a',extensionInstanceId:'ext-a',runtimeExtensionId:'runtime-a',tabs:[{id:11,active:true,siteKey:'www.youtube.com'}]});
  runtime.recorderEvent('ext-a',{tabId:11,siteKey:'www.youtube.com',event:{source:'human',isTrusted:true,eventType:'keydown',key:'Enter',keyClass:'Enter',ts:1000,target:{tag:'input',role:'searchbox',sensitive:false},semanticBefore:before()}});
  const evidence=runtime.semanticObservation('ext-a',{tabId:11,siteKey:'www.youtube.com',observation:after()});
  assert.equal(evidence.action.type,'youtube.search');
  runtime.flushSync();

  const datasetFile=path.join(baseDir,'profiles','by-browser','browser-a','www.youtube.com','data','human_events.jsonl');
  const datasetText=fs.readFileSync(datasetFile,'utf8');
  assert.equal(datasetText.includes('semanticBefore'),false);
  assert.equal(datasetText.includes('search_results'),false);
  assert.equal(datasetText.includes('youtube.search'),false);

  const evidenceFile=path.join(baseDir,'evidence','by-browser','browser-a','www.youtube.com','evidence.jsonl');
  assert.equal(fs.existsSync(evidenceFile),true);
  const evidenceText=fs.readFileSync(evidenceFile,'utf8');
  assert.equal(evidenceText.includes('youtube.search'),true);
  assert.equal(runtime.evidenceStore.verifyFile(evidenceFile).ok,true);
});

test('pending evidence expires and tab cleanup prevents stale pairing',()=>{
  let now=1000;
  const root=tmp('evidence-ttl'),store=new EvidenceStore(root,{now:()=>now,randomBytes:size=>Buffer.alloc(size,3)}),assembler=new EvidenceAssembler(store,{now:()=>now,ttlMs:1000});
  assembler.observeRecorder(identity,'www.youtube.com',9,{source:'human',isTrusted:true,eventType:'keydown',key:'Enter',semanticBefore:before()});
  assert.equal(assembler.clearTab(identity,9),true);
  assert.equal(assembler.observeAfter(identity,'www.youtube.com',9,after()),null);
  assembler.observeRecorder(identity,'www.youtube.com',10,{source:'human',isTrusted:true,eventType:'keydown',key:'Enter',semanticBefore:before()});
  now=2501;
  assert.equal(assembler.observeAfter(identity,'www.youtube.com',10,after()),null);
  assert.equal(assembler.status().expired,1);
});
