'use strict';

const {GuardianRuntime}=require('./runtime');
const {GuardianBrowserRegistry}=require('./browser_registry');
const {BehaviorGuardian}=require('../daemon/src/behavior_guardian');
const {assessControllerConflict}=require('../daemon/src/external_controller_probe');

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

function selftest(){
  const registry=new GuardianBrowserRegistry();
  registry.upsert({browserInstanceId:'browser-selftest',extensionInstanceId:'ext-selftest',online:true,activeTabId:1,tabs:[{id:1,active:true}]});
  const browser=registry.require('browser-selftest');
  if(browser.online!==true||browser.activeTabId!==1)throw new Error('guardian_selftest_registry_failed');

  let now=1000;
  const behavior=new BehaviorGuardian({now:()=>now});
  behavior.observe('browser-selftest',{eventType:'mousedown',ts:1000,isTrusted:false,source:'third_party',x:10,y:20});
  now=1100;
  const summary=behavior.observe('browser-selftest',{eventType:'mouseup',ts:1100,isTrusted:false,source:'third_party',x:10,y:20});
  if(summary?.blocked!==true)throw new Error('guardian_selftest_behavior_failed');

  const controller=assessControllerConflict({
    available:true,
    driverProcesses:[{name:'chromedriver.exe',pid:1}],
    frameworkProcesses:[{name:'python.exe',pid:2}],
    inputAutomationProcesses:[],
    browserAutomationFlags:[{name:'chrome.exe',pid:3}],
    browserRemoteDebugFlags:[],
    suspectUdpEndpoints:[]
  },[]);
  if(controller?.blocked!==true)throw new Error('guardian_selftest_controller_failed');

  console.log('Guardian selftest: PASS');
  return 0;
}

async function main(){
  if(process.argv.includes('--selftest'))return selftest();
  const check=process.argv.includes('--check');
  let stopping=false,current=null;
  const stop=()=>{stopping=true;try{current?.client?.close();}catch{}};
  process.once('SIGINT',stop);
  process.once('SIGTERM',stop);

  while(!stopping){
    current=new GuardianRuntime();
    try{
      const status=await current.start();
      console.log(JSON.stringify({component:'Guardian',state:'RUNNING',authorityOrder:status.authorityOrder,browserCount:status.browsers.length,decisionCount:Object.keys(status.decisions).length}));
      if(check){await current.stop();return 0;}
      await new Promise(resolve=>{
        const done=()=>resolve();
        current.client.once('disconnected',done);
        const poll=setInterval(()=>{if(stopping){clearInterval(poll);resolve();}},250);
        poll.unref?.();
      });
    }catch(error){
      console.error('[GUARDIAN]',String(error?.stack||error?.message||error));
      if(check)return 1;
    }finally{
      try{await current.stop();}catch{}
      current=null;
    }
    if(!stopping)await sleep(2000);
  }
  return 0;
}

if(require.main===module)main().then(code=>{process.exitCode=Number(code)||0;}).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={main,sleep,selftest};
