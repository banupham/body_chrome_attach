'use strict';

const {parseHeadKeywordNextArgs,bindDynamicFreshBrowser,hasArg,asBool}=require('./head_keyword_next_entry');
const {waitForEligibleBrowser,waitSeconds}=require('./topic_transition_entry');
const {HardenedTargetPlanPortfolioRunner}=require('./target_plan_portfolio_runtime');

function parseTargetPlanArgs(argv=process.argv.slice(2)){
  const parserArgv=[...argv];if(!hasArg(parserArgv,'head-queries'))parserArgv.push('--head-queries','__auto_target_profile__');
  const config=parseHeadKeywordNextArgs(parserArgv);config.headQueries=[];config.query='';config.targetTopic=null;
  Object.assign(config,{planBudget:6,planSeedCount:2,planMaxHops:4,planHomeCheckpoints:true,planOnly:null,stopAfterFirstTarget:false,searchResultStableSamples:2,searchResultSettleMs:12000});
  for(let i=0;i<argv.length;i++){
    const raw=String(argv[i]||'');if(!raw.startsWith('--'))continue;const [k0,v0]=raw.slice(2).split('=',2),key=k0.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());let value=v0;if(value==null&&argv[i+1]&&!String(argv[i+1]).startsWith('--'))value=argv[++i];
    if(key==='planBudget')config.planBudget=Number(value);
    else if(key==='planSeedCount')config.planSeedCount=Number(value);
    else if(key==='planMaxHops')config.planMaxHops=Number(value);
    else if(key==='planHomeCheckpoints')config.planHomeCheckpoints=asBool(value,true);
    else if(key==='planOnly')config.planOnly=String(value||'').trim()||null;
    else if(key==='stopAfterFirstTarget')config.stopAfterFirstTarget=asBool(value,false);
    else if(key==='searchResultStableSamples')config.searchResultStableSamples=Number(value);
    else if(key==='searchResultSettleMs')config.searchResultSettleMs=Number(value);
  }
  config.planBudget=Math.max(1,Math.min(10,Math.floor(Number(config.planBudget)||6)));
  config.planSeedCount=Math.max(1,Math.min(4,Math.floor(Number(config.planSeedCount)||2)));
  config.planMaxHops=Math.max(1,Math.min(6,Math.floor(Number(config.planMaxHops)||4)));
  config.searchResultStableSamples=Math.max(1,Math.min(4,Math.floor(Number(config.searchResultStableSamples)||2)));
  config.searchResultSettleMs=Math.max(4000,Math.min(30000,Number(config.searchResultSettleMs)||12000));
  config.seedCount=Math.max(config.seedCount,config.planSeedCount+2);config.maxHops=config.planMaxHops;config.branchModes=['source_bridge'];config.bridgeKeySearch=false;config.stopOnTarget=false;
  return config;
}

async function main(){
  const argv=process.argv.slice(2),config=parseTargetPlanArgs(argv),coldStartBrowser=String(process.env.BODY_RESEARCH_COLD_START_BROWSER||'').trim()||null;
  console.log(`[TARGET PORTFOLIO] single input video ID: ${config.trackVideoId}`);
  console.log(`[TARGET PORTFOLIO] generating up to ${config.planBudget} non-title plans; ${config.planSeedCount} completed seed branch(es) per plan; max ${config.planMaxHops} watched-video hops.`);
  console.log('[TARGET PORTFOLIO] exact target title and video ID are forbidden as queries; target may be observed on Search/Related/Home but is never clicked.');
  console.log('[TARGET PORTFOLIO] shortest route = minimum observed graph edges; top plans should be re-run with --plan-only on separate pristine Chrome sessions for fair validation.');
  config.browser=coldStartBrowser;config.tab=null;
  const eligible=await waitForEligibleBrowser(config,{waitSec:waitSeconds(argv)}),binding=bindDynamicFreshBrowser(config,eligible);console.log('[PREFLIGHT] dynamically bound this run:',JSON.stringify(binding));
  const runner=new HardenedTargetPlanPortfolioRunner(config);return runner.run();
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={parseTargetPlanArgs,main};