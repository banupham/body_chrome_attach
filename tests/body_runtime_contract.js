'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {MotorPlanner,bootstrapMove}=require('../src/canonical_motor_planner');
const daemonPlanner=require('../daemon/src/motor_planner');
const {CdpInputGateway}=require('../src/cdp_input_gateway');
function modelNull(){return {sampleMouse(){return null;},sampleTyping(){return null;},sampleScroll(){return null;}};}
function fakeChrome(){const messages=[],debuggerCalls=[];return {messages,debuggerCalls,tabs:{async sendMessage(_id,message){messages.push(message);return {ok:true};}},debugger:{async attach(target){debuggerCalls.push(['attach',target]);},async detach(target){debuggerCalls.push(['detach',target]);},async sendCommand(target,method,params){debuggerCalls.push(['sendCommand',target,method,params]);return {};}}};}
(async()=>{
  assert.equal(daemonPlanner.MotorPlanner,MotorPlanner,'daemon must re-export the canonical page planner');
  const bootstrap=bootstrapMove({x:0,y:0},{x:100,y:50});for(const row of bootstrap)assert.ok(Math.abs(row.params.y-row.params.x*0.5)<1e-9,'bootstrap must remain linear');
  const planner=new MotorPlanner(modelNull());const move=planner.plan({type:'moveTo',x:100,y:50},{pointerStart:{x:0,y:0}});assert.equal(move.plan.executionCapability,'HUMAN_MOTOR');assert.equal(move.plan.steps[0].behaviorPhase,'bootstrap-linear');
  await assert.rejects(async()=>planner.plan({type:'back'}),/browser_ui_action_required/);await assert.rejects(async()=>planner.plan({type:'reload'}),/browser_ui_action_required/);
  const typingModel={sampleMouse(){return null;},sampleTyping(){return {groupKey:'typing|typeText',count:1,template:{intervals:[100,120],holds:[40,50]}};},sampleScroll(){return null;}};const typingSteps=new MotorPlanner(typingModel).plan({type:'typeText',x:10,y:10,text:'A!'},{pointerStart:{x:0,y:0}}).plan.steps;assert.ok(typingSteps.some(s=>s.params?.key==='Shift'&&s.params?.type==='rawKeyDown'));assert.ok(typingSteps.some(s=>s.params?.key==='!'&&s.params?.code==='Digit1'&&s.params?.type==='char'));
  const gatewayChrome=fakeChrome(),gateway=new CdpInputGateway(gatewayChrome);await gateway.sendInput(7,'Input.dispatchMouseEvent',{type:'mouseMoved',x:10,y:20,button:'none'});assert.equal(gatewayChrome.messages[0].type,'CDP_POINTER_EXPECTED');await assert.rejects(()=>gateway.sendInput(7,'Runtime.evaluate',{expression:'1+1'}),/human_motor_method_forbidden/);
  const failingChrome=fakeChrome();failingChrome.debugger.sendCommand=async()=>{throw new Error('synthetic dispatch failure');};const failingGateway=new CdpInputGateway(failingChrome);await assert.rejects(()=>failingGateway.sendInput(8,'Input.dispatchKeyEvent',{type:'rawKeyDown',key:'a',code:'KeyA'}),/synthetic dispatch failure/);assert.equal(failingChrome.messages.some(message=>message.type==='CDP_INPUT_FAILED'),true);
  const serviceWorker=fs.readFileSync(path.join(__dirname,'..','src','service_worker_entry.js'),'utf8');assert.equal(serviceWorker.includes('body.executeText'),false);assert.equal(serviceWorker.includes('body.cdpInput'),false);assert.equal(serviceWorker.includes('BodyExecutor'),false);
  for(const required of ['daemonIdentityReady = daemon.identity()','async function connectDaemon()','await daemonIdentityReady','ensureContentScript','repairOpenWebTabs','CONTENT_SCRIPT_FILE','files: [CONTENT_SCRIPT_FILE]','chrome.windows?.onFocusChanged','contextSource: \'chrome_window_focus\'','pendingUserMotorByTab','pendingUserMotorCount','forwardUserMotorReliable','forwardedEventCount','pendingEventCount','lastForwardError','learningInput: learningInputStatus()'])assert.ok(serviceWorker.includes(required),`multi-Chrome learning repair missing: ${required}`);
  assert.ok(serviceWorker.indexOf('await daemonIdentityReady;')<serviceWorker.indexOf('await repairOpenWebTabs().catch(() => null);'),'Browser identity must exist before existing-tab repair can trigger reconnect');
  assert.ok(serviceWorker.indexOf('await repairOpenWebTabs().catch(() => null);')<serviceWorker.indexOf('const status = await daemon.start();'),'existing web tabs must be repaired before Extension HELLO/environment check');
  assert.ok(serviceWorker.includes("if (!sent) {\n        if (daemon.socket?.readyState !== 1) return false;\n        break;"),'a failed send on an apparently-open socket must stay queued instead of being dropped');
  assert.ok(serviceWorker.includes('forwardUserMotorReliable(tabId, message.payload)'),'all Human motor events must use reliable forwarding');
  const popup=fs.readFileSync(path.join(__dirname,'..','src','pairing_popup.js'),'utf8');assert.ok(popup.includes('Nhận ${observed}'));assert.ok(popup.includes('Gửi ${forwarded}'));assert.ok(popup.includes('Chờ ${pending}'));assert.ok(popup.includes('browserInstanceId'));assert.ok(popup.includes('activeTabId'));
  const content=fs.readFileSync(path.join(__dirname,'..','src','virtual_cursor_content.js'),'utf8');for(const forbidden of ['.click(','.focus(','.scrollIntoView(','.dispatchEvent(','form.submit(','location =','history.back(','history.forward('])assert.equal(content.includes(forbidden),false,`content script action forbidden: ${forbidden}`);assert.ok(content.includes('document.elementFromPoint'));assert.ok(content.includes('getBoundingClientRect'));
  console.log('body_runtime_contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
