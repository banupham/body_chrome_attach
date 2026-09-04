'use strict';

const {bootstrapBlankBrowser}=require('./pristine_blank_bootstrap');
const {main:targetMain}=require('./target_plan_entry');

async function main(){
  const waitSec=Math.max(5,Number(process.env.BODY_RESEARCH_BROWSER_WAIT_SEC||40)||40),bootstrap=await bootstrapBlankBrowser({waitSec});
  process.env.BODY_RESEARCH_COLD_START='about_blank_body_browser_ui';
  process.env.BODY_RESEARCH_COLD_START_BROWSER=String(bootstrap.browserInstanceId||'');
  process.env.BODY_RESEARCH_COLD_START_TAB=String(bootstrap.tabId||'');
  console.log('[COLD START] bootstrap complete; starting single-ID target portfolio after Guardian eligibility and stable signed-out semantic state.');
  return targetMain();
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={main};
