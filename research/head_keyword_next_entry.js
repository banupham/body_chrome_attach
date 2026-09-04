'use strict';

const {parseArgs}=require('./topic_transition_runner');
const {waitForEligibleBrowser,waitSeconds}=require('./topic_transition_entry');
const {normalizeVideoId}=require('./search_exposure_runner');
const {HeadKeywordNextRunner}=require('./head_keyword_next_runner');

function splitList(value,pattern=/[;|\n]+/){return [...new Set(String(value||'').split(pattern).map(x=>x.trim()).filter(Boolean))];}
function asBool(value,fallback=false){if(value==null)return fallback;return !['0','false','no','off'].includes(String(value).toLowerCase());}
function hasArg(argv,name){return argv.some(x=>String(x)===`--${name}`||String(x).startsWith(`--${name}=`));}

function parseHeadKeywordNextArgs(argv=process.argv.slice(2)){
  const config=parseArgs(argv);
  Object.assign(config,{
    trackVideoId:null,
    headQueries:[config.query],
    seedCount:3,
    maxHops:2,
    branchModes:['natural','metadata_bridge'],
    maxRelatedRank:40,
    relatedScrolls:8,
    relatedScrollDelta:760,
    relatedSettleMs:650,
    relatedSampleLimit:25,
    searchSeedScrolls:1,
    searchScrollDelta:820,
    searchSettleMs:650,
    requirePristine:true,
    stopOnTarget:false,
    dynamicFreshBrowser:true
  });
  if(!hasArg(argv,'dwell-sec'))config.dwellSec=5;
  let explicitHeads=null,explicitModes=null;
  for(let i=0;i<argv.length;i++){
    const raw=String(argv[i]||'');if(!raw.startsWith('--'))continue;
    const [k0,v0]=raw.slice(2).split('=',2),key=k0.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());let value=v0;
    if(value==null&&argv[i+1]&&!String(argv[i+1]).startsWith('--'))value=argv[++i];
    if(key==='trackVideoId')config.trackVideoId=normalizeVideoId(value);
    else if(key==='headQueries')explicitHeads=splitList(value);
    else if(key==='branchModes')explicitModes=splitList(value,/[;,|\n]+/).map(x=>x.toLowerCase());
    else if(key==='requirePristine')config.requirePristine=asBool(value,true);
    else if(['seedCount','maxHops','maxRelatedRank','relatedScrolls','relatedScrollDelta','relatedSettleMs','relatedSampleLimit','searchSeedScrolls','searchScrollDelta','searchSettleMs'].includes(key))config[key]=Number(value);
  }
  if(!config.trackVideoId)throw new Error('track_video_id_required');
  config.headQueries=(explicitHeads?.length?explicitHeads:[config.query]).map(x=>String(x).trim()).filter(Boolean);
  config.headQueries=[...new Set(config.headQueries)];if(!config.headQueries.length)throw new Error('head_keyword_required');
  config.query=config.headQueries[0];
  config.branchModes=explicitModes?.length?explicitModes:config.branchModes;
  config.branchModes=[...new Set(config.branchModes)];for(const mode of config.branchModes)if(!['natural','metadata_bridge'].includes(mode))throw new Error(`unsupported_branch_mode:${mode}`);
  config.seedCount=Math.max(1,Math.min(10,Math.floor(Number(config.seedCount)||3)));
  config.maxHops=Math.max(1,Math.min(4,Math.floor(Number(config.maxHops)||2)));
  config.maxRelatedRank=Math.max(5,Math.min(100,Math.floor(Number(config.maxRelatedRank)||40)));
  config.relatedScrolls=Math.max(0,Math.min(20,Math.floor(Number(config.relatedScrolls)||8)));
  config.relatedScrollDelta=Math.max(120,Math.min(1200,Number(config.relatedScrollDelta)||760));
  config.relatedSettleMs=Math.max(250,Math.min(5000,Number(config.relatedSettleMs)||650));
  config.relatedSampleLimit=Math.max(5,Math.min(60,Math.floor(Number(config.relatedSampleLimit)||25)));
  config.searchSeedScrolls=Math.max(0,Math.min(8,Math.floor(Number(config.searchSeedScrolls)||1)));
  config.searchScrollDelta=Math.max(120,Math.min(1200,Number(config.searchScrollDelta)||820));
  config.searchSettleMs=Math.max(250,Math.min(5000,Number(config.searchSettleMs)||650));
  config.stopOnTarget=false;
  return config;
}

function bindDynamicFreshBrowser(config,eligibleRow){
  if(!config||!eligibleRow?.browserInstanceId)throw new Error('dynamic_browser_binding_requires_eligible_browser');
  const tabs=Array.isArray(eligibleRow.youtubeTabs)?eligibleRow.youtubeTabs:[];
  const tab=tabs.find(x=>x.active===true)||tabs[0];
  if(!tab||!Number.isInteger(Number(tab.id)))throw new Error('dynamic_browser_binding_requires_youtube_tab');
  const previous={browser:config.browser||null,tab:Number.isInteger(Number(config.tab))?Number(config.tab):null};
  config.browser=eligibleRow.browserInstanceId;
  config.tab=Number(tab.id);
  config.dynamicFreshBrowser=true;
  return {previous,browserInstanceId:config.browser,tabId:config.tab};
}

async function main(){
  const argv=process.argv.slice(2),config=parseHeadKeywordNextArgs(argv);
  const supplied={browser:config.browser||null,tab:Number.isInteger(Number(config.tab))?Number(config.tab):null};
  if(supplied.browser||supplied.tab!=null)console.log('[PREFLIGHT] research:search uses a fresh Chrome each run; ignoring supplied --browser/--tab and selecting the current eligible YouTube Browser dynamically.');
  config.browser=null;config.tab=null;
  const eligible=await waitForEligibleBrowser(config,{waitSec:waitSeconds(argv)});
  const binding=bindDynamicFreshBrowser(config,eligible);
  console.log('[PREFLIGHT] dynamically bound this run:',JSON.stringify(binding));
  const runner=new HeadKeywordNextRunner(config);return runner.run();
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={splitList,asBool,hasArg,parseHeadKeywordNextArgs,bindDynamicFreshBrowser,main};
