'use strict';

const {parseArgs}=require('./topic_transition_runner');
const {waitForEligibleBrowser,waitSeconds}=require('./topic_transition_entry');
const {TopicObservationRunner}=require('./topic_observation_runner');

function asBool(value,fallback=false){if(value==null)return fallback;return !['0','false','no','off'].includes(String(value).toLowerCase());}
function parseObservationArgs(argv=process.argv.slice(2)){
  const config=parseArgs(argv);
  Object.assign(config,{observeOnly:true,stopOnTarget:false,seedVideoId:null,trackVideoId:null,discoveryWindowSec:180,snapshotIntervalSec:30,freshMaxAgeHours:6});
  for(let i=0;i<argv.length;i++){
    const raw=String(argv[i]||'');if(!raw.startsWith('--'))continue;
    const [k0,v0]=raw.slice(2).split('=',2);const key=k0.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
    let value=v0;if(value==null&&argv[i+1]&&!String(argv[i+1]).startsWith('--'))value=argv[++i];
    if(['discoveryWindowSec','snapshotIntervalSec','freshMaxAgeHours'].includes(key))config[key]=Number(value);
    else if(key==='seedVideoId')config.seedVideoId=String(value||'').trim()||null;
    else if(key==='trackVideoId')config.trackVideoId=String(value||'').trim()||null;
    else if(key==='observeOnly')config.observeOnly=asBool(value,true);
  }
  config.observeOnly=true;config.stopOnTarget=false;
  if(!Number.isFinite(config.discoveryWindowSec)||config.discoveryWindowSec<1)throw new Error('invalid_discovery_window_sec');
  if(!Number.isFinite(config.snapshotIntervalSec)||config.snapshotIntervalSec<1)throw new Error('invalid_snapshot_interval_sec');
  if(config.snapshotIntervalSec>config.discoveryWindowSec)config.snapshotIntervalSec=config.discoveryWindowSec;
  if(!Number.isFinite(config.freshMaxAgeHours)||config.freshMaxAgeHours<=0)throw new Error('invalid_fresh_max_age_hours');
  if(config.discoveryWindowSec>=config.maxRuntimeSec)throw new Error('discovery_window_must_be_less_than_max_runtime');
  return config;
}

async function main(){
  const argv=process.argv.slice(2);const config=parseObservationArgs(argv);
  await waitForEligibleBrowser(config,{waitSec:waitSeconds(argv)});
  const runner=new TopicObservationRunner(config);
  return runner.run();
}

if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={parseObservationArgs,main};
