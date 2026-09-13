'use strict';

const {AutonomousYouTubeBrain}=require('./brain');

function bool(value,fallback=false){if(value==null)return fallback;return !['0','false','no','off'].includes(String(value).toLowerCase());}
function parseArgs(argv=process.argv.slice(2)){
  const out={target:null,unlimited:false,continueAfterFound:false,maxMinutes:30,maxSteps:120,maxQueries:18,maxDwellSec:90,reportEverySteps:10,reportEveryMinutes:10,browser:null,tab:null,root:null};
  for(let i=0;i<argv.length;i++){
    const raw=argv[i];if(!raw.startsWith('--'))continue;const [left,inline]=raw.slice(2).split('=',2);const key=left.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());let value=inline;if(value==null&&argv[i+1]&&!argv[i+1].startsWith('--'))value=argv[++i];
    if(['maxMinutes','maxSteps','maxQueries','maxDwellSec','reportEverySteps','reportEveryMinutes','tab'].includes(key))out[key]=Number(value);
    else if(['unlimited','continueAfterFound'].includes(key))out[key]=bool(value,true);
    else if(key in out)out[key]=value;
  }
  if(!out.target)throw new Error('usage: npm run research:autodiscover -- --target VIDEO_ID [--unlimited true]');
  out.target=String(out.target).trim();if(!/^[A-Za-z0-9_-]{6,20}$/.test(out.target))throw new Error('target_video_id_invalid');
  if(out.unlimited){out.maxMinutes=0;out.maxSteps=0;}
  out.maxDwellSec=Math.max(4,Math.min(600,Number(out.maxDwellSec)||90));out.reportEverySteps=Math.max(1,Number(out.reportEverySteps)||10);out.reportEveryMinutes=Math.max(1,Number(out.reportEveryMinutes)||10);out.maxQueries=Math.max(3,Math.min(60,Number(out.maxQueries)||18));
  return out;
}

async function main(){
  const config=parseArgs();console.log('BODY Autonomous YouTube Discovery Brain');console.log(`Target videoId: ${config.target}`);console.log(`Mode: ${config.unlimited?'UNLIMITED':'BOUNDED'} | continueAfterFound=${config.continueAfterFound}`);console.log('YouTube API key: read from YOUTUBE_DATA_API_KEY / YOUTUBE_API_KEY (never written to reports).');
  const brain=new AutonomousYouTubeBrain(config);const report=await brain.run();console.log('\n=== DISCOVERY FINISHED ===');console.log(JSON.stringify({runId:report.runId,status:report.status,steps:report.summary.steps,targetDiscovery:report.targetDiscovery,reportsRoot:brain.reportDir,sessionLedger:brain.ledgerFile,memoryFile:brain.memory.file},null,2));
}
if(require.main===module)main().catch(error=>{console.error('\n[AUTODISCOVERY ERROR]',String(error?.stack||error));process.exitCode=1;});
module.exports={parseArgs,main};
