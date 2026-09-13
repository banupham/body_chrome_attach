'use strict';

const {AutonomousYouTubeBrainV2}=require('./brain_v2');
const {inspectQuery}=require('./query_firewall');
const {classifyVideo}=require('./topic_classifier');

function bool(value,fallback=false){if(value==null)return fallback;return !['0','false','no','off'].includes(String(value).toLowerCase());}
function parseArgs(argv=process.argv.slice(2)){
  const out={target:null,selftest:false,unlimited:false,continueAfterFound:false,maxMinutes:30,maxSteps:120,maxQueries:18,maxDwellSec:90,reportEverySteps:10,reportEveryMinutes:10,browser:null,tab:null,root:null,browserWaitSec:120,actionRetries:3,verifyTimeoutMs:5500};
  for(let i=0;i<argv.length;i++){
    const raw=argv[i];if(!raw.startsWith('--'))continue;const [left,inline]=raw.slice(2).split('=',2);const key=left.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());let value=inline;if(value==null&&argv[i+1]&&!argv[i+1].startsWith('--'))value=argv[++i];
    if(['maxMinutes','maxSteps','maxQueries','maxDwellSec','reportEverySteps','reportEveryMinutes','tab','browserWaitSec','actionRetries','verifyTimeoutMs'].includes(key))out[key]=Number(value);
    else if(['selftest','unlimited','continueAfterFound'].includes(key))out[key]=bool(value,true);
    else if(key in out)out[key]=value;
  }
  if(out.selftest)return out;
  if(!out.target)throw new Error('usage: YouTubeExplorerBrain --target VIDEO_ID [--unlimited true]');
  out.target=String(out.target).trim();if(!/^[A-Za-z0-9_-]{6,20}$/.test(out.target))throw new Error('target_video_id_invalid');
  if(out.unlimited){out.maxMinutes=0;out.maxSteps=0;}
  out.maxDwellSec=Math.max(4,Math.min(600,Number(out.maxDwellSec)||90));out.reportEverySteps=Math.max(1,Number(out.reportEverySteps)||10);out.reportEveryMinutes=Math.max(1,Number(out.reportEveryMinutes)||10);out.maxQueries=Math.max(3,Math.min(60,Number(out.maxQueries)||18));
  out.browserWaitSec=Math.max(5,Math.min(300,Number(out.browserWaitSec)||120));out.actionRetries=Math.max(2,Math.min(6,Number(out.actionRetries)||3));out.verifyTimeoutMs=Math.max(1800,Math.min(15000,Number(out.verifyTimeoutMs)||5500));
  return out;
}
function runSelftest(){
  const target={targetVideoId:'abc123XYZ90',targetTitle:'A Very Specific Target Video Title 2026'};
  if(inspectQuery('abc123XYZ90',target).allowed)throw new Error('selftest_target_id_firewall_failed');
  if(inspectQuery('Very Specific Target Video Title',target).allowed)throw new Error('selftest_target_title_firewall_failed');
  if(!inspectQuery('gaming',target).allowed)throw new Error('selftest_safe_query_failed');
  const classified=classifyVideo({title:'VALORANT Gameplay Highlights',youtubeApi:{categoryId:'20',tags:['gaming','esports']}});
  if(classified.primary!=='gaming')throw new Error('selftest_topic_classifier_failed');
  console.log('YouTubeExplorerBrain selftest: PASS');return 0;
}

async function main(){
  const config=parseArgs();if(config.selftest)return runSelftest();
  console.log('BODY Autonomous YouTube Discovery Brain V2');console.log(`Target videoId: ${config.target}`);console.log(`Mode: ${config.unlimited?'UNLIMITED':'BOUNDED'} | continueAfterFound=${config.continueAfterFound}`);console.log(`Step verification: retries=${config.actionRetries} | timeout=${config.verifyTimeoutMs}ms | browserWait=${config.browserWaitSec}s`);console.log('Autonomy: OPEN_DISCOVERY (navigation/search/read only; no like/comment/subscribe/share).');console.log('YouTube API key: read from YOUTUBE_DATA_API_KEY / YOUTUBE_API_KEY (never written to reports).');
  const brain=new AutonomousYouTubeBrainV2(config);let stopping=false;
  const onSignal=signal=>{if(stopping){console.error(`\n${signal} received again: forcing exit.`);process.exit(130);}stopping=true;console.log(`\n${signal}: requesting graceful stop; flushing final batch report...`);brain.requestStop(signal);};
  process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
  try{
    const report=await brain.run();console.log('\n=== DISCOVERY FINISHED ===');console.log(JSON.stringify({runId:report.runId,status:report.status,steps:report.summary.steps,targetDiscovery:report.targetDiscovery,reportsRoot:brain.reportDir,sessionLedger:brain.ledgerFile,memoryFile:brain.memory.file},null,2));return report;
  }finally{process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);}
}
if(require.main===module)main().catch(error=>{console.error('\n[AUTODISCOVERY ERROR]',String(error?.stack||error));process.exitCode=1;});
module.exports={parseArgs,runSelftest,main};
