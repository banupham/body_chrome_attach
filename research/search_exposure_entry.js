'use strict';

const {parseArgs}=require('./topic_transition_runner');
const {waitForEligibleBrowser,waitSeconds}=require('./topic_transition_entry');
const {SearchExposureRunner,normalizeVideoId}=require('./search_exposure_runner');

function splitQueries(value){
  return [...new Set(String(value||'').split(/[;|\n]+/).map(x=>x.trim()).filter(Boolean))];
}
function asBool(value,fallback=false){
  if(value==null)return fallback;
  return !['0','false','no','off'].includes(String(value).toLowerCase());
}
function parseSearchExposureArgs(argv=process.argv.slice(2)){
  const config=parseArgs(argv);
  Object.assign(config,{
    trackVideoId:null,
    headQuery:config.query,
    headQueries:[config.query],
    queries:[],
    autoExplore:true,
    requirePristine:true,
    samples:1,
    sampleIntervalSec:60,
    maxSearchRank:80,
    maxSearchScrolls:12,
    searchScrollDelta:820,
    searchSettleMs:650,
    competitorSampleLimit:20,
    competitorExpansion:true,
    competitorExpansionLimit:3,
    maxAutoQueries:28,
    stopOnTarget:false
  });
  let explicitQueries=null;
  let explicitHeadQueries=null;
  for(let i=0;i<argv.length;i++){
    const raw=String(argv[i]||'');
    if(!raw.startsWith('--'))continue;
    const [k0,v0]=raw.slice(2).split('=',2);
    const key=k0.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
    let value=v0;
    if(value==null&&argv[i+1]&&!String(argv[i+1]).startsWith('--'))value=argv[++i];
    if(key==='trackVideoId')config.trackVideoId=normalizeVideoId(value);
    else if(key==='headQuery')config.headQuery=String(value||'').trim()||config.query;
    else if(key==='headQueries')explicitHeadQueries=splitQueries(value);
    else if(key==='queries')explicitQueries=splitQueries(value);
    else if(key==='autoExplore')config.autoExplore=asBool(value,true);
    else if(key==='requirePristine')config.requirePristine=asBool(value,true);
    else if(key==='competitorExpansion')config.competitorExpansion=asBool(value,true);
    else if(['samples','sampleIntervalSec','maxSearchRank','maxSearchScrolls','searchScrollDelta','searchSettleMs','competitorSampleLimit','competitorExpansionLimit','maxAutoQueries'].includes(key))config[key]=Number(value);
  }
  if(!config.trackVideoId)throw new Error('track_video_id_required');
  config.headQueries=explicitHeadQueries?.length?explicitHeadQueries:[config.headQuery||config.query].filter(Boolean);
  if(config.headQuery&&!config.headQueries.some(q=>q.toLowerCase()===config.headQuery.toLowerCase()))config.headQueries.unshift(config.headQuery);
  config.headQueries=[...new Set(config.headQueries.map(x=>String(x).trim()).filter(Boolean))];
  config.queries=explicitQueries?.length?explicitQueries:[];
  for(const key of ['samples','sampleIntervalSec','maxSearchRank','maxSearchScrolls','searchScrollDelta','searchSettleMs','competitorSampleLimit','competitorExpansionLimit','maxAutoQueries']){
    if(!Number.isFinite(config[key]))throw new Error(`invalid_${key}`);
  }
  config.samples=Math.max(1,Math.floor(config.samples));
  config.sampleIntervalSec=Math.max(0,config.sampleIntervalSec);
  config.maxSearchRank=Math.max(1,Math.floor(config.maxSearchRank));
  config.maxSearchScrolls=Math.max(0,Math.floor(config.maxSearchScrolls));
  config.searchScrollDelta=Math.max(120,Math.min(1200,config.searchScrollDelta));
  config.searchSettleMs=Math.max(250,config.searchSettleMs);
  config.competitorSampleLimit=Math.max(0,Math.min(50,Math.floor(config.competitorSampleLimit)));
  config.competitorExpansionLimit=Math.max(0,Math.min(8,Math.floor(config.competitorExpansionLimit)));
  config.maxAutoQueries=Math.max(4,Math.min(60,Math.floor(config.maxAutoQueries)));
  config.stopOnTarget=false;
  return config;
}

async function main(){
  const argv=process.argv.slice(2);
  const config=parseSearchExposureArgs(argv);
  await waitForEligibleBrowser(config,{waitSec:waitSeconds(argv)});
  const runner=new SearchExposureRunner(config);
  return runner.run();
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={splitQueries,parseSearchExposureArgs,main};
