'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {normalizeSnapshot,WindowsBrowserUiObserver}=require('./src/browser_ui_observer');
const {BodyStepGateway}=require('./src/body_step_gateway');

function tmp(){return fs.mkdtempSync(path.join(os.tmpdir(),'browser-ui-eyes-'));}

test('normalizes native Chrome UI evidence without exposing editable raw values',()=>{
  const out=normalizeSnapshot({available:true,observed:true,confidence:'title_match',observedAt:123,signature:'sig-1',window:{processId:44,name:'Example - Google Chrome',className:'Chrome_WidgetWin_1',rect:{x:1,y:2,width:900,height:700}},controls:[{index:1,surface:'omnibox_or_find',controlType:'Edit',name:'Address and search bar',state:{focused:true,enabled:true},rect:{x:100,y:50,width:500,height:30},valueFingerprint:{length:21,sha256:'abcdef1234567890'}}]}, {browserInstanceId:'browser-a',tabId:3,windowId:9,title:'Example'});
  assert.equal(out.observed,true);assert.equal(out.source,'windows_uia_read_only');assert.equal(out.addressBar.state.focused,true);assert.equal(out.addressBar.valueFingerprint.length,21);assert.equal(out.scope.windowId,9);assert.equal(JSON.stringify(out).includes('https://'),false);
});

test('non-Windows observer stays read-only and fails open as unavailable evidence',async()=>{
  let spawned=0;const observer=new WindowsBrowserUiObserver({platform:'linux',spawnImpl:()=>{spawned++;throw new Error('must_not_spawn');}});const out=await observer.observe({browserInstanceId:'b',tabId:1,title:'Example'});assert.equal(spawned,0);assert.equal(out.available,false);assert.equal(out.observed,false);assert.equal(out.reason,'platform_unsupported');
});

test('Windows observation is non-blocking and returns pending while background refresh is scheduled',async()=>{
  const observer=new WindowsBrowserUiObserver({platform:'win32'});let scheduled=0;observer._schedule=()=>{scheduled++;};const out=await observer.observe({browserInstanceId:'b',tabId:1,windowId:7,title:'Example'});assert.equal(scheduled,1);assert.equal(out.available,true);assert.equal(out.observed,false);assert.equal(out.reason,'uia_refresh_pending');
});

test('BODY_OBSERVE carries native browser UI facts without changing action execution',async()=>{
  const browser={browserInstanceId:'browser-a',extensionInstanceId:null,online:true,state:'ACTIVE',activeTabId:1,tabs:new Map([[1,{id:1,active:true,windowId:7,title:'Example',siteKey:'example.test',navigationToken:'n1',navigationEpoch:1,status:'complete'}]]),environment:{eligible:true,status:'ELIGIBLE',reasons:[]}};
  const runtime={identity:{identityChain:()=>({browserInstanceId:'browser-a'})},identityForExtension:()=>({browserInstanceId:'browser-a'}),browsers:{require:()=>browser},pointerState:{snapshot:()=>({known:false})},tasks:{get:()=>({workspace:{browserInstanceId:'browser-a',primaryTabId:1,tabIds:[1]}})}};
  let calls=0;const browserUiObserver={observe:async request=>{calls++;return {available:true,observed:true,reason:null,confidence:'title_match',source:'windows_uia_read_only',observedAt:100,scope:request,window:{name:'Example - Google Chrome'},focusedControl:{controlType:'Edit',name:'Address and search bar'},addressBar:{controlType:'Edit',name:'Address and search bar'},tabs:[],controls:[],signature:'native-1'};}};
  const body=new BodyStepGateway(runtime,{baseDir:tmp(),now:()=>100,browserUiObserver});const observation=await body.observe({browserInstanceId:'browser-a',tabId:1});assert.equal(calls,1);assert.equal(observation.browserUi.observed,true);assert.equal(observation.browserUi.signature,'native-1');assert.equal(observation.freshness.browserUiAgeMs,0);
});

test('native helper is browser-chrome-only and contains no action primitives',()=>{
  const source=fs.readFileSync(path.join(__dirname,'native','windows_ui_observer.ps1'),'utf8');
  for(const forbidden of ['InvokePattern','.Invoke(','SetValue','SendKeys','SendInput','mouse_event','PostMessage','Runtime.evaluate','Input.dispatch'])assert.equal(source.includes(forbidden),false,`forbidden native UI action primitive: ${forbidden}`);
  assert.ok(source.includes("$type -eq 'Document'"));assert.ok(source.includes('Chrome_RenderWidgetHostHWND'));assert.ok(source.includes('ValueFingerprint'));assert.ok(source.includes('chrome_window_title_mismatch'));assert.ok(source.includes("$type -eq 'Pane'"));
});
