'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {MotorPlanner,bootstrapMove}=require('../src/canonical_motor_planner');
const daemonPlanner=require('../daemon/src/motor_planner');
const {CdpInputGateway}=require('../src/cdp_input_gateway');
const {OnlineBehaviorModel}=require('../daemon/src/online_model');
const {HabitModel}=require('../daemon/src/habit_model');
const {DatasetStore}=require('../daemon/src/dataset_store');
const {ScopedLearningManager}=require('../daemon/src/scoped_learning');
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

  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'body-learning-contract-'));
  try{
    const motor=new OnlineBehaviorModel(path.join(tmp,'behavior_model.json'));
    const habit=new HabitModel(path.join(tmp,'habit_model.json'));
    const store=new DatasetStore(path.join(tmp,'data'));
    const humanClick={source:'human',action:'click',tabId:1,context:{target_role:'button',target_rect:{x:90,y:90,width:20,height:20}},pointer_start:{x:0,y:0},points:[{t:0,x:0,y:0},{t:120,x:100,y:100}],hold_ms:35};
    const agentClick={...humanClick,source:'agent'};
    assert.equal(motor.observe(agentClick),false,'agent sample must not update motor model');
    assert.equal(habit.observe(agentClick),false,'agent sample must not update habit model');
    assert.equal(motor.stats().revision,0);
    assert.equal(habit.stats().revision,0);
    assert.throws(()=>store.appendHumanSample(agentClick),/only_human_samples_can_be_ground_truth/);
    store.appendEvent(1,{source:'agent',eventType:'mousemove',x:10,y:10});
    store.appendEvent(1,{source:'human',eventType:'mousemove',x:11,y:11});
    store.flushSync();
    assert.equal(store.stats().agentEvents,1,'agent telemetry is stored separately');
    assert.equal(store.stats().humanEvents,1,'human telemetry is stored separately');
    assert.equal(motor.observe(humanClick),true);
    assert.equal(habit.observe(humanClick),true);
    assert.equal(motor.stats().totalTemplates,1,'human sample must create a motor template');
    const learnedPlan=new MotorPlanner(motor).plan({type:'click',x:100,y:100,width:20,height:20,role:'button'},{pointerStart:{x:0,y:0}});
    assert.equal(learnedPlan.source,'learned','BODY planner must consume learned human motor template');
    const motorRevision=motor.stats().revision,habitRevision=habit.stats().revision;
    motor.observe(agentClick);habit.observe(agentClick);
    assert.equal(motor.stats().revision,motorRevision,'agent replay must not self-train motor model');
    assert.equal(habit.stats().revision,habitRevision,'agent replay must not self-train habit model');
    const scoped=new ScopedLearningManager(path.join(tmp,'scoped'));
    assert.throws(()=>scoped.observeHumanSample('ext','example.com',agentClick),/only_human_samples_can_be_ground_truth/,'scoped manager must reject mislabeled agent samples');
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}

  const serviceWorker=fs.readFileSync(path.join(__dirname,'..','src','service_worker_entry.js'),'utf8');assert.equal(serviceWorker.includes('body.executeText'),false);assert.equal(serviceWorker.includes('body.cdpInput'),false);assert.equal(serviceWorker.includes('BodyExecutor'),false);
  const content=fs.readFileSync(path.join(__dirname,'..','src','virtual_cursor_content.js'),'utf8');for(const forbidden of ['.click(','.focus(','.scrollIntoView(','.dispatchEvent(','form.submit(','location =','history.back(','history.forward('])assert.equal(content.includes(forbidden),false,`content script action forbidden: ${forbidden}`);assert.ok(content.includes('document.elementFromPoint'));assert.ok(content.includes('getBoundingClientRect'));
  console.log('body_runtime_contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
