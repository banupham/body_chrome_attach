'use strict';

const childProcess=require('node:child_process');

const DRIVER_NAMES=new Set(['chromedriver.exe','msedgedriver.exe','geckodriver.exe','iedriverserver.exe']);
const INPUT_AUTOMATION_NAMES=new Set(['autohotkey.exe','autohotkey64.exe','autohotkey32.exe','autoit3.exe','autoit3_x64.exe']);
const BROWSER_NAMES=new Set(['chrome.exe','msedge.exe','brave.exe','chromium.exe']);
const FRAMEWORK_PATTERN=/\b(selenium|playwright|puppeteer|pyautogui|pynput|webdriver)\b/i;
const AUTOMATION_FLAG_PATTERN=/(?:^|\s)--enable-automation(?:\s|$)/i;
const REMOTE_DEBUG_PATTERN=/(?:^|\s)--remote-debugging-(?:port(?:=|\s+)[^\s]+|pipe)(?:\s|$)/i;

function arrayOf(value){return Array.isArray(value)?value:(value&&typeof value==='object'?[value]:[]);}
function safeName(value){return String(value||'').trim().toLowerCase();}
function safePid(value){const n=Number(value);return Number.isInteger(n)&&n>0?n:null;}

function compactProcessSnapshot(payload={}){
  const processes=arrayOf(payload.processes).map(row=>({name:safeName(row?.Name||row?.name),pid:safePid(row?.ProcessId||row?.processId||row?.pid),parentPid:safePid(row?.ParentProcessId||row?.parentProcessId),commandLine:String(row?.CommandLine||row?.commandLine||'')})).filter(row=>row.name&&row.pid);
  const udp=arrayOf(payload.udp).map(row=>({pid:safePid(row?.OwningProcess||row?.owningProcess||row?.pid),localPort:Number(row?.LocalPort||row?.localPort||0)})).filter(row=>row.pid&&Number.isInteger(row.localPort)&&row.localPort>=0&&row.localPort<=65535);
  const drivers=processes.filter(row=>DRIVER_NAMES.has(row.name)),browserFlagRows=processes.filter(row=>BROWSER_NAMES.has(row.name)&&AUTOMATION_FLAG_PATTERN.test(row.commandLine)),remoteDebugRows=processes.filter(row=>BROWSER_NAMES.has(row.name)&&REMOTE_DEBUG_PATTERN.test(row.commandLine)),inputAutomation=processes.filter(row=>INPUT_AUTOMATION_NAMES.has(row.name)),frameworks=processes.filter(row=>!DRIVER_NAMES.has(row.name)&&!BROWSER_NAMES.has(row.name)&&FRAMEWORK_PATTERN.test(row.commandLine)),suspectPids=new Set([...drivers,...frameworks,...inputAutomation].map(row=>row.pid)),udpForSuspect=udp.filter(row=>suspectPids.has(row.pid));
  return {available:true,driverProcesses:drivers.map(row=>({name:row.name,pid:row.pid})),frameworkProcesses:frameworks.map(row=>({name:row.name,pid:row.pid})),inputAutomationProcesses:inputAutomation.map(row=>({name:row.name,pid:row.pid})),browserAutomationFlags:browserFlagRows.map(row=>({name:row.name,pid:row.pid,flag:'--enable-automation'})),browserRemoteDebugFlags:remoteDebugRows.map(row=>({name:row.name,pid:row.pid,flag:/--remote-debugging-pipe/i.test(row.commandLine)?'--remote-debugging-pipe':'--remote-debugging-port'})),suspectUdpEndpoints:udpForSuspect.map(row=>({pid:row.pid,localPort:row.localPort}))};
}

function assessControllerConflict(observation={},deepSignalIds=[]){
  const signalIds=new Set(),details={};let score=0;const add=(id,weight,value)=>{if(signalIds.has(id))return;signalIds.add(id);score+=weight;if(value!==undefined)details[id]=value;};const deep=new Set((Array.isArray(deepSignalIds)?deepSignalIds:[]).map(String)),deepAutomation=deep.has('webdriver_true')||deep.has('automation_markers'),drivers=observation.available===true&&observation.driverProcesses?.length>0,frameworks=observation.available===true&&observation.frameworkProcesses?.length>0,inputAutomation=observation.available===true&&observation.inputAutomationProcesses?.length>0,automationFlag=observation.available===true&&observation.browserAutomationFlags?.length>0,remoteDebug=observation.available===true&&observation.browserRemoteDebugFlags?.length>0,suspectUdp=observation.available===true&&observation.suspectUdpEndpoints?.length>0;
  if(drivers)add('external_webdriver_process',40,observation.driverProcesses.map(x=>x.name));if(frameworks)add('automation_framework_process',25,observation.frameworkProcesses.map(x=>x.name));if(inputAutomation)add('external_input_automation_process',25,observation.inputAutomationProcesses.map(x=>x.name));if(automationFlag)add('browser_enable_automation_flag',35);if(remoteDebug)add('browser_remote_debugging_flag',30);if(suspectUdp)add('automation_process_udp_endpoint',5,observation.suspectUdpEndpoints.length);if(deepAutomation)add('deep_browser_automation_signal',35,[...deep].filter(x=>x==='webdriver_true'||x==='automation_markers'));
  score=Math.min(100,score);const independentSources=[drivers||frameworks||inputAutomation,automationFlag||remoteDebug,deepAutomation].filter(Boolean).length,blocked=(drivers&&(automationFlag||remoteDebug||frameworks||deepAutomation))||(automationFlag&&deepAutomation)||(remoteDebug&&deepAutomation)||(score>=70&&independentSources>=2);
  return {available:observation.available===true,reason:observation.available===true?null:String(observation.reason||'controller_probe_unavailable'),score,blocked,review:score>=25,signalIds:[...signalIds],details};
}

function emptyUnavailable(reason){return {available:false,reason:String(reason||'controller_probe_unavailable'),driverProcesses:[],frameworkProcesses:[],inputAutomationProcesses:[],browserAutomationFlags:[],browserRemoteDebugFlags:[],suspectUdpEndpoints:[]};}

class ExternalControllerProbe{
  constructor({platform=process.platform,execFile=childProcess.execFile,timeoutMs=7000}={}){this.platform=platform;this.execFile=execFile;this.timeoutMs=Math.max(2000,Math.min(15000,Number(timeoutMs)||7000));}
  probe(){
    if(this.platform!=='win32')return Promise.resolve(emptyUnavailable('windows_only'));
    const script="$ErrorActionPreference='Stop';$p=@();try{$p=@(Get-CimInstance Win32_Process -ErrorAction Stop|Select-Object Name,ProcessId,ParentProcessId,CommandLine)}catch{$p=@(Get-WmiObject Win32_Process -ErrorAction Stop|Select-Object Name,ProcessId,ParentProcessId,CommandLine)};$u=@();try{$u=@(Get-NetUDPEndpoint -ErrorAction Stop|Select-Object OwningProcess,LocalPort)}catch{};[pscustomobject]@{processes=$p;udp=$u}|ConvertTo-Json -Compress -Depth 4";
    return new Promise(resolve=>{
      let settled=false;const done=value=>{if(settled)return;settled=true;resolve(value);};
      try{
        this.execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:this.timeoutMs,windowsHide:true,maxBuffer:4*1024*1024},(error,stdout,stderr)=>{
          if(error){done(emptyUnavailable(`controller_probe_failed:${String(error.code||error.killed&&'timeout'||error.message||'unknown').slice(0,120)}`));return;}
          try{const parsed=JSON.parse(String(stdout||'{}').replace(/^\uFEFF/,'').trim()||'{}');done(compactProcessSnapshot(parsed));}catch(parseError){done(emptyUnavailable(`controller_probe_invalid_json:${String(parseError?.message||parseError).slice(0,100)}`));}
        });
      }catch(error){done(emptyUnavailable(`controller_probe_start_failed:${String(error?.code||error?.message||'unknown').slice(0,120)}`));}
    });
  }
}

module.exports={ExternalControllerProbe,compactProcessSnapshot,assessControllerConflict,emptyUnavailable,DRIVER_NAMES,INPUT_AUTOMATION_NAMES,BROWSER_NAMES};
