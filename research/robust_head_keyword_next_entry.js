'use strict';

const {waitForEligibleBrowser,waitSeconds}=require('./topic_transition_entry');
const {parseHeadKeywordNextArgs,bindDynamicFreshBrowser}=require('./head_keyword_next_entry');
const {RobustKeyGraphRouteRunner}=require('./robust_key_graph_route_runner');

async function main(){
  const argv=process.argv.slice(2),config=parseHeadKeywordNextArgs(argv),supplied={browser:config.browser||null,tab:Number.isInteger(Number(config.tab))?Number(config.tab):null},coldStartBrowser=String(process.env.BODY_RESEARCH_COLD_START_BROWSER||'').trim()||null;
  if(supplied.browser||supplied.tab!=null)console.log('[PREFLIGHT] robust research:search ignores supplied --browser/--tab and binds the current eligible YouTube Browser dynamically.');
  console.log('[RESEARCH] robust target-blind frontier: Search result sets must settle before seed selection; stale seeds are skipped, never fatal.');
  console.log('[RESEARCH] target video is observation-only: it is excluded from seed selection and is never clicked.');
  console.log('[RESEARCH] key frontier is recomputed after every derived-key run and balances cross-topic bridges with cluster-deepening keys.');
  console.log('[RESEARCH] demandProxy uses deduplicated observed video statistics; it is not YouTube query search volume.');
  if(config.coldStartMode)console.log(`[RESEARCH] cold start mode: ${config.coldStartMode}.`);
  config.browser=coldStartBrowser;config.tab=null;
  const eligible=await waitForEligibleBrowser(config,{waitSec:waitSeconds(argv)}),binding=bindDynamicFreshBrowser(config,eligible);
  console.log('[PREFLIGHT] dynamically bound this run:',JSON.stringify(binding));
  const runner=new RobustKeyGraphRouteRunner(config);return runner.run();
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={main};
