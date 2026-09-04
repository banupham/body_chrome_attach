'use strict';

const {BodyDebugClient}=require('../body_cli');

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));}
function tabsOf(browser){return Array.isArray(browser?.tabs)?browser.tabs:[];}
function isYoutubeTab(tab){return String(tab?.siteKey||'').toLowerCase().includes('youtube.com');}
function isBlankTab(tab){
  const site=String(tab?.siteKey||'').toLowerCase(),scheme=String(tab?.urlScheme||'').toLowerCase(),title=String(tab?.title||'').trim().toLowerCase();
  if(isYoutubeTab(tab))return false;
  if(site==='__non_web__')return true;
  if(['about:','chrome:','chrome-search:'].includes(scheme))return true;
  return !site&&!scheme&&(!title||title==='new tab');
}
function blankBrowserCandidates(browsers){
  return (Array.isArray(browsers)?browsers:[]).filter(browser=>{
    if(browser?.online!==true)return false;
    const tabs=tabsOf(browser);if(!tabs.length||tabs.some(isYoutubeTab))return false;
    const active=tabs.find(tab=>tab?.active===true)||tabs[0];
    return isBlankTab(active)&&tabs.every(tab=>isBlankTab(tab));
  }).sort((a,b)=>Number(b?.connectedAt||0)-Number(a?.connectedAt||0)||Number(b?.lastSeenAt||0)-Number(a?.lastSeenAt||0));
}
function chooseNewestBlankBrowser(browsers){return blankBrowserCandidates(browsers)[0]||null;}
function youtubeTabOf(browser){const tabs=tabsOf(browser);return tabs.find(tab=>tab?.active===true&&isYoutubeTab(tab))||tabs.find(isYoutubeTab)||null;}
function compactBrowser(browser){return browser?{browserInstanceId:browser.browserInstanceId||null,extensionInstanceId:browser.extensionInstanceId||null,state:browser.state||null,environmentEligible:browser.environment?.eligible===true,environmentStatus:browser.environment?.status||null,reasons:Array.isArray(browser.environment?.reasons)?browser.environment.reasons:[],tabCount:Number(browser.tabCount||tabsOf(browser).length||0),tabs:tabsOf(browser).map(tab=>({id:tab.id,active:tab.active===true,title:tab.title||'',siteKey:tab.siteKey||'',urlScheme:tab.urlScheme||''}))}:null;}

async function bootstrapBlankBrowser({url='https://www.youtube.com/',waitSec=40,probeIntervalMs=1500,client=null}={}){
  const ownClient=!client,debug=client||new BodyDebugClient(),deadline=Date.now()+Math.max(5,Number(waitSec)||40)*1000;
  let target=null,last=null,lastProbeAt=0;
  try{
    while(Date.now()<deadline&&!target){
      const browsers=await debug.command('browsers');target=chooseNewestBlankBrowser(browsers);last=browsers;
      if(!target)await sleep(350);
    }
    if(!target)throw new Error(`pristine_blank_browser_not_found:${JSON.stringify((last||[]).filter(x=>x?.online).map(compactBrowser))}`);
    if(!target.extensionInstanceId)throw new Error(`pristine_blank_extension_missing:${target.browserInstanceId||'unknown'}`);

    console.log('[COLD START] blank Browser selected:',JSON.stringify(compactBrowser(target)));
    await debug.command(`use ${target.extensionInstanceId}`);
    const navigation=await debug.command(`browseraddress ${url}`);
    console.log('[COLD START] BODY Browser UI address navigation issued:',JSON.stringify({browserInstanceId:target.browserInstanceId,url,delivered:navigation?.delivered??null,verified:navigation?.verified??null}));

    while(Date.now()<deadline){
      const browsers=await debug.command('browsers'),current=(browsers||[]).find(row=>row.browserInstanceId===target.browserInstanceId);last=browsers;
      if(!current||current.online!==true){await sleep(300);continue;}
      const youtubeTab=youtubeTabOf(current);
      if(youtubeTab&&current.environment?.eligible===true){
        const result={browserInstanceId:current.browserInstanceId,extensionInstanceId:current.extensionInstanceId,tabId:Number(youtubeTab.id),url,environment:current.environment,coldStartMode:'about_blank_body_browser_ui'};
        console.log('[COLD START] YouTube Browser eligible:',JSON.stringify({browserInstanceId:result.browserInstanceId,tabId:result.tabId,status:result.environment?.status||null,reasons:result.environment?.reasons||[]}));
        return result;
      }
      if(youtubeTab&&Date.now()-lastProbeAt>=Math.max(500,Number(probeIntervalMs)||1500)){
        lastProbeAt=Date.now();
        try{await debug.command(`envprobe ${target.browserInstanceId}`);console.log(`[COLD START] Guardian re-probe requested for ${target.browserInstanceId}.`);}catch(error){console.log('[COLD START] Guardian probe pending:',String(error?.message||error));}
      }
      await sleep(350);
    }
    const current=(last||[]).find(row=>row.browserInstanceId===target.browserInstanceId);
    throw new Error(`pristine_blank_bootstrap_timeout:${JSON.stringify(compactBrowser(current))}`);
  }finally{if(ownClient)await debug.close().catch(()=>{});}
}

async function main(){const waitSec=Math.max(5,Number(process.env.BODY_RESEARCH_BROWSER_WAIT_SEC||40)||40);const result=await bootstrapBlankBrowser({waitSec});console.log(JSON.stringify(result,null,2));return result;}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={sleep,tabsOf,isYoutubeTab,isBlankTab,blankBrowserCandidates,chooseNewestBlankBrowser,youtubeTabOf,compactBrowser,bootstrapBlankBrowser,main};
