'use strict';

const {AutonomousYouTubeBrainV3}=require('./brain_v3');
const {inspectQuery}=require('./query_firewall');
const {classifyVideo}=require('./topic_classifier');
const {adaptiveQueryPlan}=require('./adaptive_query_planner');
const {bodyCapabilityCatalog}=require('./body_capabilities');

function bool(value,fallback=false){if(value==null)return fallback;return !['0','false','no','off'].includes(String(value).toLowerCase());}
function parseArgs(argv=process.argv.slice(2)){
  const out={target:null,accountId:null,selftest:false,unlimited:false,continueAfterFound:false,maxMinutes:30,maxSteps:120,maxQueries:24,maxDwellSec:90,reportEverySteps:10,reportEveryMinutes:10,browser:null,tab:null,root:null,browserWaitSec:120,actionRetries:3,verifyTimeoutMs:5500,explorationRate:0.18};
  for(let i=0;i<argv.length;i++){
    const raw=argv[i];if(!raw.startsWith('--'))continue;const [left,inline]=raw.slice(2).split('=',2);const key=left.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());let value=inline;if(value==null&&argv[i+1]&&!argv[i+1].startsWith('--'))value=argv[++i];
    if(['maxMinutes','maxSteps','maxQueries','maxDwellSec','reportEverySteps','reportEveryMinutes','tab','browserWaitSec','actionRetries','verifyTimeoutMs','explorationRate'].includes(key))out[key]=Number(value);
    else if(['selftest','unlimited','continueAfterFound'].includes(key))out[key]=bool(value,true);
    else if(key in out)out[key]=value;
  }
  if(out.selftest)return out;
  if(!out.target)throw new Error('usage: YouTubeExplorerBrain --target VIDEO_ID [--account-id LOCAL_ACCOUNT_ID] [--unlimited true]');
  out.target=String(out.target).trim();if(!/^[A-Za-z0-9_-]{6,20}$/.test(out.target))throw new Error('target_video_id_invalid');
  if(out.accountId!=null){out.accountId=String(out.accountId).trim();if(!out.accountId||out.accountId.length>160)throw new Error('account_id_invalid');}
  if(out.unlimited){out.maxMinutes=0;out.maxSteps=0;}
  out.maxDwellSec=Math.max(4,Math.min(600,Number(out.maxDwellSec)||90));out.reportEverySteps=Math.max(1,Number(out.reportEverySteps)||10);out.reportEveryMinutes=Math.max(1,Number(out.reportEveryMinutes)||10);out.maxQueries=Math.max(3,Math.min(80,Number(out.maxQueries)||24));
  out.browserWaitSec=Math.max(5,Math.min(300,Number(out.browserWaitSec)||120));out.actionRetries=Math.max(2,Math.min(6,Number(out.actionRetries)||3));out.verifyTimeoutMs=Math.max(1800,Math.min(15000,Number(out.verifyTimeoutMs)||5500));out.explorationRate=Math.max(0,Math.min(0.8,Number(out.explorationRate)||0.18));
  return out;
}
function runSelftest(){
  const target={targetVideoId:'abc123XYZ90',targetTitle:'A Very Specific Target Video Title 2026'};
  if(inspectQuery('abc123XYZ90',target).allowed)throw new Error('selftest_target_id_firewall_failed');
  if(inspectQuery('Very Specific Target Video Title',target).allowed)throw new Error('selftest_target_title_firewall_failed');
  const classified=classifyVideo({title:'VALORANT Gameplay Highlights',youtubeApi:{categoryId:'20',tags:['gaming','esports']}});if(classified.primary!=='gaming')throw new Error('selftest_topic_classifier_failed');
  const plan=adaptiveQueryPlan({videoId:'abc123XYZ90',title:'Nhà đẹp Bình Chánh Minh Ngọc',defaultLanguage:'vi',tags:['nhà đẹp','bình chánh','minh ngọc'],topicLabels:['Hobby'],channel:{keywords:['nhà bình chánh'],topicLabels:['Lifestyle']}},{maxQueries:20});
  if(plan.plan.some(row=>/\bhobby\b/i.test(row.query)))throw new Error('selftest_language_mixing_failed');if(!plan.plan.length)throw new Error('selftest_adaptive_query_plan_empty');
  const catalog=bodyCapabilityCatalog();if(!catalog.motor.includes('drag')||!catalog.browserUi.includes('devtools')||!catalog.tab.includes('tab_switch'))throw new Error('selftest_full_body_capability_catalog_failed');
  console.log('YouTubeExplorerBrain selftest: PASS');return 0;
}

async function main(){
  const config=parseArgs();if(config.selftest)return runSelftest();
  console.log('BODY Autonomous YouTube Discovery Brain V3');console.log(`Target videoId: ${config.target}`);console.log(`Account context: ${config.accountId?`ENABLED (${config.accountId})`:'ANONYMOUS / NOT PROVIDED'}`);console.log(`Mode: ${config.unlimited?'UNLIMITED':'BOUNDED'} | continueAfterFound=${config.continueAfterFound}`);console.log(`Agent exploration rate: ${config.explorationRate}`);console.log(`Step verification: retries=${config.actionRetries} | timeout=${config.verifyTimeoutMs}ms | browserWait=${config.browserWaitSec}s`);console.log('Autonomy: FULL_BODY_AGENT. Brain receives the complete BODY motor/browser/tab action surface and plans from observed environment state.');console.log('Task constraint retained: target ID/title are for profiling and success verification, not direct YouTube search.');console.log('Account ID is a local logical binding. It never logs into Google and does not capture Google account identity; the attached Chrome profile must already be signed in.');console.log('YouTube API key: read from YOUTUBE_DATA_API_KEY / YOUTUBE_API_KEY (never written to reports).');
  const brain=new AutonomousYouTubeBrainV3(config);let stopping=false;
  const onSignal=signal=>{if(stopping){console.error(`\n${signal} received again: forcing exit.`);process.exit(130);}stopping=true;console.log(`\n${signal}: requesting graceful stop; flushing final batch report...`);brain.requestStop(signal);};
  process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
  try{const report=await brain.run();console.log('\n=== DISCOVERY FINISHED ===');console.log(JSON.stringify({runId:report.runId,status:report.status,steps:report.summary.steps,targetDiscovery:report.targetDiscovery,account:report.account?{accountKey:report.account.accountKey,relationship:report.account.relationship?.kind,historySampleCount:report.account.historySampleCount}:null,reportsRoot:brain.reportDir,sessionLedger:brain.ledgerFile,memoryFile:brain.memory.file,planner:report.autonomy?.planner},null,2));return report;}
  finally{process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);}
}
if(require.main===module)main().catch(error=>{console.error('\n[AUTODISCOVERY ERROR]',String(error?.stack||error));process.exitCode=1;});
module.exports={parseArgs,runSelftest,main};
