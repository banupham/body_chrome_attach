'use strict';

const {bootstrapBlankBrowser}=require('./pristine_blank_bootstrap');
const {main:targetMain}=require('./target_plan_entry');

function coldTargetBootstrapGuidance(error){
  const message=String(error?.message||error||'');
  if(!message.startsWith('pristine_blank_browser_not_found:'))return null;
  return 'strict_cold_start_requires_blank_body_browser: the previous attempt already navigated the BODY Chrome from about:blank to YouTube. For a valid cold comparison, open a new BODY-enabled Chrome at about:blank and rerun research:target:cold. To continue the already-open signed-out YouTube session only for debugging, use research:target instead.';
}

async function main(){
  const waitSec=Math.max(5,Number(process.env.BODY_RESEARCH_BROWSER_WAIT_SEC||40)||40);let bootstrap;
  try{bootstrap=await bootstrapBlankBrowser({waitSec});}
  catch(error){const guidance=coldTargetBootstrapGuidance(error);if(guidance)throw new Error(guidance,{cause:error});throw error;}
  process.env.BODY_RESEARCH_COLD_START='about_blank_body_browser_ui';
  process.env.BODY_RESEARCH_COLD_START_BROWSER=String(bootstrap.browserInstanceId||'');
  process.env.BODY_RESEARCH_COLD_START_TAB=String(bootstrap.tabId||'');
  console.log('[COLD START] bootstrap complete; starting single-ID target portfolio after Guardian eligibility and stable signed-out semantic state.');
  return targetMain();
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={coldTargetBootstrapGuidance,main};