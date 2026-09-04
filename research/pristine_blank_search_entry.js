'use strict';

const {bootstrapBlankBrowser}=require('./pristine_blank_bootstrap');
const {main:searchMain}=require('./head_keyword_next_entry');

async function main(){
  const waitSec=Math.max(5,Number(process.env.BODY_RESEARCH_BROWSER_WAIT_SEC||40)||40);
  const bootstrap=await bootstrapBlankBrowser({waitSec});
  process.env.BODY_RESEARCH_COLD_START='about_blank_body_browser_ui';
  process.env.BODY_RESEARCH_COLD_START_BROWSER=String(bootstrap.browserInstanceId||'');
  process.env.BODY_RESEARCH_COLD_START_TAB=String(bootstrap.tabId||'');
  console.log('[COLD START] bootstrap complete; attaching research Brain after Environment Guardian eligibility.');
  return searchMain();
}

if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={main};
