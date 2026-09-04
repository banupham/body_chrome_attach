'use strict';

const {parseArgs}=require('./topic_transition_runner');
const {waitForEligibleBrowser,waitSeconds}=require('./topic_transition_entry');
const {normalizeVideoId}=require('./search_exposure_runner');
const {FastBrowserUiRouteRunner}=require('./fast_browser_ui_route_runner');

function splitList(value,pattern=/[;|\n]+/){return [...new Set(String(value||'').split(pattern).map(x=>x.trim()).filter(Boolean))];}
function asBool(value,fallback=false){if(value==null)return fallback;return !['0','false','no','off'].includes(String(value).toLowerCase());}
function hasArg(argv,name){return argv.some(x=>String(x)===`--${name}`||String(x).startsWith(`--${name}=`));}
function norm(value){return String(value||'').normalize('NFKC').toLowerCase().normalize('NFD').replace(/\p{M}+/gu,'').replace(/đ/g,'d').replace(/\s+/g,' ').trim();}

function parseHeadKeywordNextArgs(argv=process.argv.slice(2)){
  const config=parseArgs(argv);
  Object.assign(config,{
    trackVideoId:null,
    targetTopic:null,
    headQueries:[config.query],
    seedCount:3,
    maxHops:2,
    branchModes:['source_bridge'],
    maxRelatedRank:40,
    relatedScrolls:8,
    relatedScrollDelta:760,
    relatedSettleMs:650,
    relatedSampleLimit:25,
    searchSeedScrolls:1,
    searchScrollDelta:820,
    searchSettleMs:650,
    requirePristine:true,
    pristineSettleMs:12000,
    pristinePollMs:400,
    pristineStableSamples:2,
    stopOnTarget:false,
    dynamicFreshBrowser:true,
    coldStartMode:String(process.env.BODY_RESEARCH_COLD_START||'').trim()||null,
    safeClickTopPx:80,
    safeClickBottomPx:48,
    safeClickSidePx:8,
    homeExplore:true,
    homeSeedCount:3,
    homeScrolls:2,
    homeScrollDelta:760,
    homeSettleMs:900,
    homeWaitMs:8000
  });
  if(!hasArg(argv,'dwell-sec'))config.dwellSec=5;
  let explicitHeads=null,explicitModes=null;
  for(let i=0;i<argv.length;i++){
    const raw=String(argv[i]||'');if(!raw.startsWith('--'))continue;
    const [k0,v0]=raw.slice(2).split('=',2),key=k0.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());let value=v0;
    if(value==null&&argv[i+1]&&!String(argv[i+1]).startsWith('--'))value=argv[++i];
    if(key==='trackVideoId')config.trackVideoId=normalizeVideoId(value);
    else if(key==='targetTopic')config.targetTopic=String(value||'').trim()||null;
    else if(key==='headQueries')explicitHeads=splitList(value);
    else if(key==='branchModes')explicitModes=splitList(value,/[;,|\n]+/).map(x=>x.toLowerCase());
    else if(key==='requirePristine')config.requirePristine=asBool(value,true);
    else if(key==='homeExplore')config.homeExplore=asBool(value,true);
    else if(['seedCount','maxHops','maxRelatedRank','relatedScrolls','relatedScrollDelta','relatedSettleMs','relatedSampleLimit','searchSeedScrolls','searchScrollDelta','searchSettleMs','pristineSettleMs','pristinePollMs','pristineStableSamples','safeClickTopPx','safeClickBottomPx','safeClickSidePx','homeSeedCount','homeScrolls','homeScrollDelta','homeSettleMs','homeWaitMs'].includes(key))config[key]=Number(value);
  }
  if(!config.trackVideoId)throw new Error('track_video_id_required');
  config.headQueries=(explicitHeads?.length?explicitHeads:[config.query]).map(x=>String(x).trim()).filter(Boolean);
  config.headQueries=[...new Set(config.headQueries)];if(!config.headQueries.length)throw new Error('head_keyword_required');
  if(config.targetTopic&&config.headQueries.some(query=>norm(query)===norm(config.targetTopic)))throw new Error('direct_target_topic_search_forbidden');
  config.query=config.headQueries[0];
  config.branchModes=explicitModes?.length?explicitModes:config.branchModes;
  config.branchModes=[...new Set(config.branchModes.map(mode=>mode==='metadata_bridge'?'source_bridge':mode))];
  for(const mode of config.branchModes)if(!['natural','source_bridge'].includes(mode))throw new Error(`unsupported_branch_mode:${mode}`);
  config.seedCount=Math.max(1,Math.min(10,Math.floor(Number(config.seedCount)||3)));
  config.maxHops=Math.max(1,Math.min(6,Math.floor(Number(config.maxHops)||2)));
  config.maxRelatedRank=Math.max(5,Math.min(100,Math.floor(Number(config.maxRelatedRank)||40)));
  config.relatedScrolls=Math.max(0,Math.min(20,Math.floor(Number(config.relatedScrolls)||8)));
  config.relatedScrollDelta=Math.max(120,Math.min(1200,Number(config.relatedScrollDelta)||760));
  config.relatedSettleMs=Math.max(250,Math.min(5000,Number(config.relatedSettleMs)||650));
  config.relatedSampleLimit=Math.max(5,Math.min(60,Math.floor(Number(config.relatedSampleLimit)||25)));
  config.searchSeedScrolls=Math.max(0,Math.min(8,Math.floor(Number(config.searchSeedScrolls)||1)));
  config.searchScrollDelta=Math.max(120,Math.min(1200,Number(config.searchScrollDelta)||820));
  config.searchSettleMs=Math.max(250,Math.min(5000,Number(config.searchSettleMs)||650));
  config.pristineSettleMs=Math.max(2000,Math.min(30000,Number(config.pristineSettleMs)||12000));
  config.pristinePollMs=Math.max(100,Math.min(2000,Number(config.pristinePollMs)||400));
  config.pristineStableSamples=Math.max(1,Math.min(5,Math.floor(Number(config.pristineStableSamples)||2)));
  config.safeClickTopPx=Math.max(56,Math.min(240,Number(config.safeClickTopPx)||80));
  config.safeClickBottomPx=Math.max(16,Math.min(180,Number(config.safeClickBottomPx)||48));
  config.safeClickSidePx=Math.max(0,Math.min(120,Number(config.safeClickSidePx)||8));
  config.homeSeedCount=Math.max(1,Math.min(10,Math.floor(Number(config.homeSeedCount)||3)));
  config.homeScrolls=Math.max(0,Math.min(10,Math.floor(Number(config.homeScrolls)||2)));
  config.homeScrollDelta=Math.max(120,Math.min(1200,Number(config.homeScrollDelta)||760));
  config.homeSettleMs=Math.max(250,Math.min(5000,Number(config.homeSettleMs)||900));
  config.homeWaitMs=Math.max(1000,Math.min(20000,Number(config.homeWaitMs)||8000));
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
  return {previous,browserInstanceId:config.browser,tabId:config.tab,coldStartMode:config.coldStartMode||null};
}

async function main(){
  const argv=process.argv.slice(2),config=parseHeadKeywordNextArgs(argv);
  const supplied={browser:config.browser||null,tab:Number.isInteger(Number(config.tab))?Number(config.tab):null};
  const coldStartBrowser=String(process.env.BODY_RESEARCH_COLD_START_BROWSER||'').trim()||null;
  if(supplied.browser||supplied.tab!=null)console.log('[PREFLIGHT] research:search uses a fresh Chrome each run; ignoring supplied --browser/--tab and selecting the current eligible YouTube Browser dynamically.');
  console.log('[RESEARCH] target-blind route mode: target video/topic metadata is evaluation-only and is never used to choose the next video.');
  console.log('[RESEARCH] history restore uses BODY Browser UI fast Back; CDP gateway is unchanged.');
  console.log(`[RESEARCH] pristine auth preflight waits up to ${config.pristineSettleMs}ms and requires ${config.pristineStableSamples} consecutive signed_out observations; unknown is never treated as signed_out.`);
  if(config.coldStartMode)console.log(`[RESEARCH] cold start mode: ${config.coldStartMode}; Browser id was discovered dynamically during this run.`);
  config.browser=coldStartBrowser;config.tab=null;
  const eligible=await waitForEligibleBrowser(config,{waitSec:waitSeconds(argv)});
  const binding=bindDynamicFreshBrowser(config,eligible);
  console.log('[PREFLIGHT] dynamically bound this run:',JSON.stringify(binding));
  const runner=new FastBrowserUiRouteRunner(config);return runner.run();
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={splitList,asBool,hasArg,norm,parseHeadKeywordNextArgs,bindDynamicFreshBrowser,main};