'use strict';

const path=require('node:path');
const readline=require('node:readline');
const {WebSocketServer,WebSocket}=require('ws');
const {
  ExtensionRegistry,ScopedLearningManager,normalizeSiteKey,HumanActionSegmenter,
  StrategyExecutor,modalityOf,TabHabitModel
}=require('./src/runtime_exports');
const {MotorPlanner}=require('./src/motor_planner');

const PORT=8765;
const registry=new ExtensionRegistry();
const learning=new ScopedLearningManager(path.join(__dirname,'profiles'));
const tabHabit=new TabHabitModel(path.join(__dirname,'profiles','_tab_habits.json'));
const pending=new Map(), clients=new Set(), pointers=new Map(), segmenters=new Map(), tabSites=new Map();
let recordingEnabled=true, learningEnabled=true, rl=null;

const id=(p='r')=>`${p}-${Date.now()}-${process.hrtime.bigint().toString(36)}`;
const ctx=(ext,tab)=>`${ext}/${Number(tab)}`;
const segKey=(ext,tab,site)=>`${ctx(ext,tab)}/${normalizeSiteKey(site)}`;
const prompt=()=>registry.selectedId?`BODY[${registry.selectedId.slice(0,8)}]> `:'BODY> ';
const send=(ws,obj)=>ws?.readyState===WebSocket.OPEN?(ws.send(JSON.stringify(obj)),true):false;
const pnum=(v,n)=>{const x=Number(v);if(!Number.isFinite(x))throw new Error(`${n}_required`);return x;};

function printAsync(text){ if(rl) process.stdout.write(`\n${text}\n${prompt()}`); }
function updatePrompt(){ rl?.setPrompt(prompt()); }

function requestExtension(extensionId,type,payload={},timeoutMs=30000){
  const ext=registry.require(extensionId), requestId=id(type.toLowerCase());
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error(`extension_timeout:${extensionId}:${type}`));},timeoutMs);
    pending.set(requestId,{extensionId:ext.extensionId,resolve,reject,timer});
    send(ext.ws,{type,requestId,...payload});
  });
}

function selected(explicit=null){ return registry.require(explicit||null).extensionId; }
async function refreshTabs(extId){
  const tabs=await requestExtension(extId,'LIST_TABS');
  registry.updateTabs(extId,tabs);
  for(const t of tabs) tabSites.set(ctx(extId,t.id),normalizeSiteKey(t.siteKey));
  return tabs;
}
async function resolveTab(extId,ref='active'){
  const ext=registry.require(extId);
  if(ref==='active'||ref==null){
    if(Number.isInteger(ext.activeTabId)&&ext.tabs.get(ext.activeTabId)) return ext.tabs.get(ext.activeTabId);
    const tab=await requestExtension(extId,'ACTIVE_TAB');
    registry.activateTab(extId,tab.id,tab); tabSites.set(ctx(extId,tab.id),normalizeSiteKey(tab.siteKey)); return tab;
  }
  const tabId=Number(ref); if(!Number.isInteger(tabId)) throw new Error('invalid_tab_id');
  let tab=ext.tabs.get(tabId); if(!tab){await refreshTabs(extId);tab=registry.require(extId).tabs.get(tabId);}
  if(!tab) throw new Error(`tab_not_found:${extId}:${tabId}`); return tab;
}

function segmenter(extId,tabId,siteKey){
  const key=segKey(extId,tabId,siteKey);
  if(segmenters.has(key)) return segmenters.get(key);
  const s=new HumanActionSegmenter(sample=>{
    const learned=learning.observeHumanSample(extId,siteKey,{...sample,tabId:Number(tabId)},{learn:learningEnabled});
    printAsync(`[HỌC] ext=${String(extId).slice(0,8)} tab=${tabId} site=${normalizeSiteKey(siteKey)} action=${learned.action}`);
  });
  segmenters.set(key,s); return s;
}

function recorderEvent(extId,msg){
  const tabId=Number(msg.tabId), event=msg.event; if(!event) return;
  const siteKey=normalizeSiteKey(msg.siteKey||tabSites.get(ctx(extId,tabId))||'__unknown__');
  tabSites.set(ctx(extId,tabId),siteKey); learning.observeEvent(extId,siteKey,tabId,event);
  if(['mousemove','mousedown','mouseup','wheel'].includes(event.eventType)&&Number.isFinite(Number(event.x))&&Number.isFinite(Number(event.y))) pointers.set(ctx(extId,tabId),{x:Number(event.x),y:Number(event.y)});
  if(event.source==='human') segmenter(extId,tabId,siteKey).handle(tabId,event);
}

function tabEvent(extId,event){
  const tabId=Number(event.tabId), siteKey=normalizeSiteKey(event.siteKey);
  tabSites.set(ctx(extId,tabId),siteKey); registry.activateTab(extId,tabId,{siteKey,title:event.title||'',windowId:event.windowId});
  tabHabit.observe(extId,{...event,siteKey});
  if(event.source==='human') learning.observeHumanSample(extId,siteKey,{source:'human',action:'switchTab',tabId,context:{target_role:'browser_tab',target_site:siteKey,windowId:event.windowId}},{learn:learningEnabled});
}

async function executeIntent(intent,{extensionId=null,tabId='active'}={}){
  const extId=selected(extensionId), tab=await resolveTab(extId,tabId), tid=Number(tab.id);
  const siteKey=normalizeSiteKey(tab.siteKey||tabSites.get(ctx(extId,tid)));
  const planner=new MotorPlanner(learning.motorFor(extId,siteKey));
  const planned=planner.plan(intent,{pointerStart:pointers.get(ctx(extId,tid))||{x:400,y:300}});
  const commandId=id(intent.type||'action');
  const execution=await requestExtension(extId,'BODY_EXECUTE',{commandId,tabId:tid,deadlineMs:Number(intent.deadlineMs||60000),plan:planned.plan},65000);
  return {commandId,extensionId:extId,tabId:tid,siteKey,behaviorSource:planned.source,learnedGroup:planned.learnedGroup,learnedTemplateCount:planned.learnedTemplateCount,execution};
}

function history(extId,siteKey,tabId,targetRole='unknown'){
  const site=learning.scope(extId,siteKey), global=learning.globalScope(extId);
  const last=site.habit.state?.lastHumanByTab?.[String(tabId)]||global.habit.state?.lastHumanByTab?.[String(tabId)]||null;
  return {previousAction:last?.action||'unknown',previousModality:last?modalityOf(last):'unknown',targetRole:String(targetRole||'unknown').toLowerCase()};
}

async function executeStrategy(task,{extensionId=null,tabId='active'}={}){
  const extId=selected(extensionId), tab=await resolveTab(extId,tabId), tid=Number(tab.id);
  const siteKey=normalizeSiteKey(tab.siteKey||tabSites.get(ctx(extId,tid)));
  const executor=new StrategyExecutor(learning.habitFor(extId,siteKey),new MotorPlanner(learning.motorFor(extId,siteKey)));
  const decision=executor.choose(task,history(extId,siteKey,tid,task.targetRole||task.role));
  const planned=executor.planSelected(decision,{pointerStart:pointers.get(ctx(extId,tid))||{x:400,y:300}});
  const commandId=id(`strategy-${planned.strategyId}`);
  const execution=await requestExtension(extId,'BODY_EXECUTE',{commandId,tabId:tid,deadlineMs:Number(task.deadlineMs||60000),plan:planned.plan},65000);
  return {commandId,extensionId:extId,tabId:tid,siteKey,habitScope:decision.scopeSource||'site',habitKey:task.habitKey,selectedStrategy:planned.strategyId,selectedModality:planned.modality,score:planned.score,habitObservations:decision.totalHabitObservations,ranking:decision.ranking.map(x=>({id:x.id,modality:x.modality,score:x.score,habitCount:x.habitCount})),subPlans:planned.subPlans,execution};
}

async function switchTab(extensionId,tabId){
  const extId=selected(extensionId), tab=await resolveTab(extId,tabId), commandId=id('switch-tab');
  const result=await requestExtension(extId,'TAB_SWITCH',{commandId,tabId:Number(tab.id)});
  registry.activateTab(extId,Number(tab.id),{...tab,active:true,siteKey:normalizeSiteKey(result.siteKey||tab.siteKey)});
  return {extensionId:extId,commandId,source:'agent',...result};
}

function strategyTask(kind,args){
  const x=pnum(args[0],'x'), y=pnum(args[1],'y');
  if(kind==='focusnext') return {habitKey:'after_typing_next_focus',targetRole:args[4]||'textbox',strategies:[{id:'keyboard_tab',modality:'keyboard',actions:[{type:'pressKey',key:'Tab'}]},{id:'mouse_click',modality:'mouse',actions:[{type:'click',x,y,width:args[2]?pnum(args[2],'width'):120,height:args[3]?pnum(args[3],'height'):36,role:args[4]||'textbox'}]}]};
  if(kind==='submitchoice') return {habitKey:'after_typing_submit',targetRole:args[4]||'button',strategies:[{id:'keyboard_enter',modality:'keyboard',actions:[{type:'pressKey',key:'Enter'}]},{id:'mouse_click',modality:'mouse',actions:[{type:'click',x,y,width:args[2]?pnum(args[2],'width'):120,height:args[3]?pnum(args[3],'height'):40,role:args[4]||'button'}]}]};
  return {habitKey:'after_typing_dismiss',targetRole:'button',strategies:[{id:'keyboard_escape',modality:'keyboard',actions:[{type:'pressKey',key:'Escape'}]},{id:'mouse_click',modality:'mouse',actions:[{type:'click',x,y,width:args[2]?pnum(args[2],'width'):32,height:args[3]?pnum(args[3],'height'):32,role:'button'}]}]};
}

async function runCommand(line){
  line=String(line||'').trim(); if(!line) return null;
  const [cmd,...args]=line.split(' ');
  if(cmd==='help') return helpText();
  if(cmd==='extensions') return registry.list();
  if(cmd==='use'){const item=registry.select(args[0]);updatePrompt();return {selectedExtension:item.extensionId,online:item.online,tabCount:item.tabs.size};}
  if(cmd==='status'){
    const extId=registry.selectedId, ext=extId?registry.get(extId):null; let ping=null;
    if(ext?.online) try{ping=await requestExtension(extId,'PING');}catch{}
    return {selectedExtension:extId,extensions:registry.list(),recordingEnabled,learningEnabled,tabHabit:tabHabit.stats(extId),extension:ping};
  }
  if(cmd==='tabs'){const extId=selected(args[0]||null);return refreshTabs(extId);}
  if(cmd==='tab'){const extId=selected();return resolveTab(extId,args[0]||'active');}
  if(cmd==='switch') return switchTab(null,pnum(args[0],'tabId'));
  if(cmd==='sites') return learning.listSites(selected(args[0]||null));
  if(cmd==='site'||cmd==='dataset'||cmd==='model'||cmd==='habit'){
    const extId=selected(), tab=await resolveTab(extId,args[0]||'active'), stats=learning.stats(extId,normalizeSiteKey(tab.siteKey));
    if(cmd==='dataset') return stats.dataset; if(cmd==='model') return stats.motor; if(cmd==='habit') return stats.habit; return stats;
  }
  if(cmd==='globalmodel') return learning.stats(selected(),'__global__');
  if(cmd==='train'){
    const extId=selected(), ref=args[0]||'active';
    if(ref==='all') return learning.rebuild(extId,'*'); if(ref==='global') return learning.rebuild(extId,'__global__');
    const tab=await resolveTab(extId,ref); return learning.rebuild(extId,normalizeSiteKey(tab.siteKey));
  }
  if(cmd==='record'){
    if(!['on','off'].includes(args[0])) throw new Error('record on|off'); recordingEnabled=args[0]==='on';
    const results=[]; for(const ext of registry.list().filter(x=>x.online)){try{results.push({extensionId:ext.extensionId,result:await requestExtension(ext.extensionId,'RECORD_SET',{enabled:recordingEnabled})});}catch(error){results.push({extensionId:ext.extensionId,error:String(error.message||error)});}}
    return {recordingEnabled,results};
  }
  if(cmd==='learn'){if(!['on','off'].includes(args[0]))throw new Error('learn on|off');learningEnabled=args[0]==='on';return {learningEnabled};}
  if(cmd==='cursor'){if(!['on','off'].includes(args[0]))throw new Error('cursor on|off');return requestExtension(selected(),'CURSOR_SET',{enabled:args[0]==='on'});}
  if(['focusnext','submitchoice','dismisschoice'].includes(cmd)){if(args.length<2)throw new Error(`${cmd} x y [width height role]`);return executeStrategy(strategyTask(cmd,args));}
  if(cmd==='strategy'){const obj=JSON.parse(line.slice('strategy'.length).trim());return executeStrategy(obj.task||obj,{extensionId:obj.extensionId||null,tabId:obj.tabId||'active'});}
  if(cmd==='click') return executeIntent({type:'click',x:pnum(args[0],'x'),y:pnum(args[1],'y'),width:args[2]?pnum(args[2],'width'):12,height:args[3]?pnum(args[3],'height'):12,role:args[4]||'unknown'});
  if(cmd==='doubleclick') return executeIntent({type:'doubleClick',x:pnum(args[0],'x'),y:pnum(args[1],'y'),width:args[2]?pnum(args[2],'width'):12,height:args[3]?pnum(args[3],'height'):12});
  if(cmd==='move'||cmd==='hover') return executeIntent({type:cmd==='move'?'moveTo':'hover',x:pnum(args[0],'x'),y:pnum(args[1],'y')});
  if(cmd==='drag') return executeIntent({type:'drag',x1:pnum(args[0],'x1'),y1:pnum(args[1],'y1'),x2:pnum(args[2],'x2'),y2:pnum(args[3],'y2')});
  if(cmd==='scroll'||cmd==='hscroll') return executeIntent({type:cmd==='scroll'?'scrollVertical':'scrollHorizontal',delta:pnum(args[0],'delta')});
  if(cmd==='type'){if(args.length<3)throw new Error('type x y noi_dung');return executeIntent({type:'typeText',x:pnum(args[0],'x'),y:pnum(args[1],'y'),text:args.slice(2).join(' '),role:'textbox',width:18,height:18});}
  if(cmd==='key') return executeIntent({type:'pressKey',key:args.join(' ')});
  if(cmd==='combo') return executeIntent({type:'keyCombo',key:args.join(' ')});
  if(['back','forward','reload'].includes(cmd)) return executeIntent({type:cmd});
  if(cmd==='detach'){const extId=selected(),tab=await resolveTab(extId,args[0]||'active');return requestExtension(extId,'BODY_DETACH',{tabId:Number(tab.id)});}
  if(cmd==='intent'){const obj=JSON.parse(line.slice('intent'.length).trim());return executeIntent(obj.intent||obj,{extensionId:obj.extensionId||null,tabId:obj.tabId||'active'});}
  if(cmd==='exit'||cmd==='thoat'){process.nextTick(()=>process.exit(0));return {exiting:true};}
  throw new Error('unknown_command');
}

function helpText(){return [
  'MULTI EXTENSION: extensions | use <extensionId> | status',
  'MULTI TAB: tabs | tab | switch <tabId>',
  'LEARNING: sites | site [tabId] | dataset | model | habit | globalmodel | train [tabId|global|all]',
  'CONTROL: record on|off | learn on|off | cursor on|off',
  'STRATEGY: focusnext x y [w h role] | submitchoice x y [w h role] | dismisschoice x y [w h] | strategy {JSON}',
  'MOTOR: move x y | click x y [w h role] | doubleclick | hover | drag x1 y1 x2 y2 | scroll delta | hscroll delta | type x y text | key Enter | combo Control+a | back | forward | reload | detach',
  'SOCKET: COMMAND | INTENT_EXECUTE | STRATEGY_EXECUTE | TAB_SWITCH'
].join('\n');}

const wss=new WebSocketServer({host:'127.0.0.1',port:PORT,verifyClient:({origin},done)=>!origin||origin.startsWith('chrome-extension://')?done(true):done(false,403,'Forbidden Origin')});
wss.on('connection',ws=>{
  let role='unknown';
  ws.on('message',async raw=>{
    let msg;try{msg=JSON.parse(String(raw));}catch{return;}
    if(msg.type==='HELLO'){
      role=msg.role||'unknown';
      if(role==='extension'){
        const extId=String(msg.extensionId||''), item=registry.register(extId,ws,msg);
        for(const t of msg.tabs||[]) tabSites.set(ctx(extId,t.id),normalizeSiteKey(t.siteKey));
        printAsync(`[ONLINE] extension=${extId} tabs=${item.tabs.size}`); requestExtension(extId,'RECORD_SET',{enabled:recordingEnabled}).catch(()=>{}); updatePrompt(); return;
      }
      if(role==='client'){clients.add(ws);send(ws,{type:'HELLO_ACK',role:'client',protocolVersion:3});return;}
    }
    if(role==='extension'){
      const item=registry.bySocket(ws);if(!item)return;const extId=item.extensionId;registry.touch(extId);
      if(msg.type==='RESPONSE'&&msg.requestId){const p=pending.get(msg.requestId);if(p){clearTimeout(p.timer);pending.delete(msg.requestId);if(p.extensionId!==extId)p.reject(new Error('extension_response_scope_mismatch'));else if(msg.ok)p.resolve(msg.result);else p.reject(new Error(msg.error?.message||'extension_error'));}return;}
      if(msg.type==='RECORDER_EVENT'){recorderEvent(extId,msg);return;}
      if(msg.type==='TAB_EVENT'){tabEvent(extId,msg.event||{});return;}
      if(msg.type==='TAB_CONTEXT'){const siteKey=normalizeSiteKey(msg.context?.siteKey);tabSites.set(ctx(extId,msg.tabId),siteKey);registry.updateTab(extId,msg.tabId,{...msg.context,siteKey});return;}
      if(msg.type==='TAB_REMOVED'){registry.removeTab(extId,msg.tabId);pointers.delete(ctx(extId,msg.tabId));tabSites.delete(ctx(extId,msg.tabId));return;}
      return;
    }
    if(role==='client'){
      try{
        let result,type;
        if(msg.type==='COMMAND'){result=await runCommand(msg.command);type='COMMAND_RESULT';}
        else if(msg.type==='INTENT_EXECUTE'){result=await executeIntent(msg.intent,{extensionId:msg.extensionId||null,tabId:msg.tabId||'active'});type='INTENT_RESULT';}
        else if(msg.type==='STRATEGY_EXECUTE'){result=await executeStrategy(msg.task,{extensionId:msg.extensionId||null,tabId:msg.tabId||'active'});type='STRATEGY_RESULT';}
        else if(msg.type==='TAB_SWITCH'){result=await switchTab(msg.extensionId||null,msg.tabId);type='TAB_SWITCH_RESULT';}
        else return;
        send(ws,{type,requestId:msg.requestId||null,ok:true,result});
      }catch(error){send(ws,{type:'CLIENT_ERROR',requestId:msg.requestId||null,ok:false,error:String(error?.message||error)});}
    }
  });
  ws.on('close',()=>{const extId=registry.unregisterSocket(ws);if(extId){printAsync(`[OFFLINE] extension=${extId}`);updatePrompt();}clients.delete(ws);});
});

console.log(`Learned Body daemon: ws://127.0.0.1:${PORT}`);
console.log('Multi-extension + multi-tab + per-site learning. Gõ help để xem lệnh.');
rl=readline.createInterface({input:process.stdin,output:process.stdout,prompt:prompt()});rl.prompt();
rl.on('line',async line=>{try{const out=await runCommand(line);if(out!=null)console.log(typeof out==='string'?out:JSON.stringify(out,null,2));}catch(error){console.log('[LỖI]',String(error?.message||error));}updatePrompt();rl.prompt();});

module.exports={runCommand,executeIntent,executeStrategy,switchTab,registry,learning};
