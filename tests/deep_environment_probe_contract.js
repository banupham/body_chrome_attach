'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {analyzeDeepSnapshots,deepEnvironmentProbe}=require('../src/deep_environment_probe');

function snapshot(){return {context:{chromeObject:true},navigator:{userAgent:'Mozilla/5.0 Windows Chrome/140',platform:'Win32',languages:['en-US'],hardwareConcurrency:8,deviceMemory:8,webdriver:false},intl:{timeZone:'UTC'},screen:{width:1920,height:1080,devicePixelRatio:1},canvas:{samples:[{dataUrlHash:'a',pixelHash:'b',textWidth:1},{dataUrlHash:'a',pixelHash:'b',textWidth:1}]},webgl:{primary:{available:true,unmaskedVendor:'V',unmaskedRenderer:'R',maxTextureSize:4096,readPixelsHash:'h'},samples:[{available:true,readPixelsHash:'h'}]},audio:{primary:{available:true,hash:'x'},samples:[{available:true,hash:'x'}]},nativeIntegrity:{functionToString:{native:true,sourceHash:'1'},canvasToDataURL:{native:true,sourceHash:'2'},webglGetParameter:{native:true,sourceHash:'3'}},descriptors:{webdriver:{configurable:true,enumerable:true,hasGetter:true,hasSetter:false}},automationMarkers:[],iframe:{available:true,userAgent:'Mozilla/5.0 Windows Chrome/140',platform:'Win32',webdriver:false},worker:{available:true,userAgent:'Mozilla/5.0 Windows Chrome/140',platform:'Win32'}};}
function extension(){return {runtimePlatform:{os:'win'},systemCpu:{numOfProcessors:8},systemMemory:{capacity:16*1073741824},systemDisplays:[{bounds:{width:1920,height:1080},deviceScaleFactor:1}],privacy:{webRTCIPHandlingPolicy:{available:true,value:'default'}}};}

(async()=>{
  const main=snapshot(),isolated=snapshot(),ext=extension();
  let result=analyzeDeepSnapshots(main,isolated,ext);assert.equal(result.score,0);assert.equal(result.highSuspicion,false);assert.ok(result.coverage.percent>=80);
  main.navigator.webdriver=true;main.automationMarkers=['__playwright__binding__'];main.navigator.hardwareConcurrency=64;main.navigator.deviceMemory=32;main.screen.width=777;main.screen.devicePixelRatio=3;main.webgl.primary.unmaskedRenderer='SwiftShader';
  result=analyzeDeepSnapshots(main,isolated,ext);assert.equal(result.highSuspicion,true);for(const id of ['webdriver_true','automation_markers','cpu_exceeds_system','memory_exceeds_system'])assert.ok(result.signals.some(x=>x.id===id),id);
  const unavailable=await deepEnvironmentProbe({tabs:{}},1);assert.equal(unavailable.available,false);assert.match(unavailable.error,/scripting_unavailable/);
  const source=fs.readFileSync(path.join(__dirname,'..','src','deep_environment_probe.js'),'utf8');for(const forbidden of ['proxy.settings.set','proxy.settings.clear','privacy.network.webRTCIPHandlingPolicy.set','chrome.debugger'])assert.equal(source.includes(forbidden),false,`deep probe mutation forbidden: ${forbidden}`);
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'..','manifest.json'),'utf8'));for(const permission of ['scripting','privacy','system.cpu','system.memory','system.display'])assert.ok(manifest.permissions.includes(permission),permission);
  console.log('deep_environment_probe_contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
