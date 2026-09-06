'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {endpointPaths,publishRuntimeEndpoint,clearRuntimeEndpoint,readRuntimeEndpoint}=require('../daemon/src/runtime_endpoint');
const {normalizeRuntimeEndpoint,resolveRuntimeEndpoint}=require('../src/runtime_endpoint_client');

function tmp(name){return fs.mkdtempSync(path.join(os.tmpdir(),`${name}-`));}

(async()=>{
  const project=tmp('runtime-endpoint'),daemonDir=path.join(project,'daemon');fs.mkdirSync(path.join(project,'dist'),{recursive:true});
  const record=publishRuntimeEndpoint(daemonDir,54321,{pid:111,now:()=>0,killImpl:()=>{const e=new Error('dead');e.code='ESRCH';throw e;}});
  assert.equal(record.wsUrl,'ws://127.0.0.1:54321');
  const paths=endpointPaths(daemonDir),loaded=readRuntimeEndpoint(paths.state);
  assert.equal(loaded.port,54321);assert.equal(loaded.host,'127.0.0.1');
  const extensionRecord=JSON.parse(fs.readFileSync(paths.extension,'utf8'));assert.equal(extensionRecord.port,54321);assert.equal('pid' in extensionRecord,false);

  assert.throws(()=>publishRuntimeEndpoint(daemonDir,54322,{pid:222,killImpl:()=>true}),/company_runtime_already_running:111:54321/);
  assert.equal(clearRuntimeEndpoint(daemonDir,{pid:222}),false);assert.equal(readRuntimeEndpoint(paths.state).port,54321);
  assert.equal(clearRuntimeEndpoint(daemonDir,{pid:111}),true);assert.throws(()=>readRuntimeEndpoint(paths.state),/runtime_endpoint_unavailable/);

  assert.deepEqual(normalizeRuntimeEndpoint({active:true,host:'127.0.0.1',port:60123,wsUrl:'ws://evil.invalid:1'}),{active:true,host:'127.0.0.1',port:60123,wsUrl:'ws://127.0.0.1:60123',startedAt:null});
  assert.throws(()=>normalizeRuntimeEndpoint({active:true,host:'0.0.0.0',port:60123}),/runtime_endpoint_unavailable/);
  assert.throws(()=>normalizeRuntimeEndpoint({active:false,host:'127.0.0.1',port:60123}),/runtime_endpoint_unavailable/);

  let fetchedUrl=null,fetchedOptions=null;
  const endpoint=await resolveRuntimeEndpoint({runtime:{getURL:name=>`chrome-extension://runtime-id/${name}`}},{cacheBust:()=>123,fetchImpl:async(url,options)=>{fetchedUrl=url;fetchedOptions=options;return {ok:true,async json(){return {active:true,host:'127.0.0.1',port:61234};}};}});
  assert.equal(endpoint.wsUrl,'ws://127.0.0.1:61234');assert.match(fetchedUrl,/runtime-endpoint\.json\?v=123$/);assert.equal(fetchedOptions.cache,'no-store');

  for(const file of ['daemon/server.js','body_cli.js','src/daemon_bridge.js']){
    const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');assert.equal(source.includes('8765'),false,`${file} must not hard-code port 8765`);
  }
  const server=fs.readFileSync(path.join(__dirname,'..','daemon','server.js'),'utf8');assert.match(server,/port:0/);assert.doesNotMatch(server,/ensureAutomaticPairingWindow/);
  console.log('runtime_endpoint_contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
