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
function activeTabOf(browser){const tabs=tabsOf(browser);return tabs.find(tab=>tab?.active===true)||tabs[0]||null;}
function compactBrowser(browser){return browser?{browserInstanceId:browser.browserInstanceId||null,extensionInstanceId:browser.extensionInstanceId||null,state:browser.state||null,environmentEligible:browser.environment?.eligible===true,environmentStatus:browser.environment?.status||null,reasons:Array.isArray(browser.environment?.reasons)?browser.environment.reasons:[],tabCount:Number(browser.tabCount||tabsOf(browser).length||0),tabs:tabsOf(browser).map(tab=>({id:tab.id,active:tab.active===true,title:tab.title||'',siteKey:tab.siteKey||'',urlScheme:tab.urlScheme||''}))}:null;}
function shouldRetryAddressNavigation({browser,attempts,maxAttempts,lastAttemptAt,now=Date.now(),retryMs=2200}={}){
  if(!browser||browser.online!==true)return false;
  if(youtubeTabOf(browser))return false;
  if(Number(attempts||0)>=Math.max(1,Number(maxAttempts)||1))return false;
  return Number(now)-Number(lastAttemptAt||0)>=Math.max(250,Number(retryMs)||2200);
}
function semanticPristineSnapshot(tab){
  const obs=tab?.youtubeObservation||null,diagnostics=(obs?.surfaces||[]).map(s=>s?.diagnostics||{}),controls=obs?.controls||{},pageType=obs?.route?.pageType||'unknown';
  const signedInState=String(obs?.signedInState||'unknown');
  const routeReady=pageType!=='unknown'&&pageType!=='other';
  const searchControlReady=Boolean(controls?.searchInput?.actionRect);
  const surfaceRootReady=diagnostics.some(x=>Boolean(x?.rootSelector));
  const candidateReady=(obs?.surfaces||[]).some(s=>Array.isArray(s?.items)&&s.items.length>0);
  return {available:Boolean(obs),signedInState,pageType,routeReady,searchControlReady,surfaceRootReady,candidateReady,uiReady:routeReady&&(searchControlReady||surfaceRootReady||candidateReady||signedInState!=='unknown'),observationError:tab?.youtubeObservationError||null};
}
async function semanticSnapshotForTab(debug,tabId){
  try{
    const rows=await debug.command('tabs'),tab=(rows||[]).find(x=>Number(x?.id)===Number(tabId));
    return semanticPristineSnapshot(tab);
  }catch(error){return {available:false,signedInState:'unknown',pageType:'unknown',routeReady:false,searchControlReady:false,surfaceRootReady:false,candidateReady:false,uiReady:false,observationError:String(error?.message||error)};}
}
async function issueBrowserUiAddress(debug,target,url,attempt){
  await debug.command(`use ${target.extensionInstanceId}`);
  try{
    const navigation=await debug.command(`browseraddress ${url}`);
    const summary={browserInstanceId:target.browserInstanceId,url,attempt,delivered:navigation?.delivered??null,verified:navigation?.verified??null,verificationReason:navigation?.verification?.reason||navigation?.observedEffect?.reason||null,browserApiFastPath:navigation?.executionAudit?.browserApiFastPath===true,nativeInputUsed:navigation?.executionAudit?.nativeInputUsed===true,fastTransport:navigation?.executionAudit?.fastTransport||null};
    console.log('[COLD START] BODY Browser UI address navigation issued:',JSON.stringify(summary));
    if(navigation?.verified!==true)console.log('[COLD START] address navigation not verified yet; polling actual Browser route and retrying only if YouTube does not appear.');
    return {ok:true,navigation,summary};
  }catch(error){
    const summary={browserInstanceId:target.browserInstanceId,url,attempt,error:String(error?.message||error)};
    console.log('[COLD START] BODY Browser UI address navigation attempt failed:',JSON.stringify(summary));
    return {ok:false,error,summary};
  }
}

async function bootstrapBlankBrowser({url='https://www.youtube.com/',waitSec=40,probeIntervalMs=1500,navigationRetryMs=2200,maxNavigationAttempts=3,semanticStableSamples=2,client=null}={}){
  const ownClient=!client,debug=client||new BodyDebugClient(),deadline=Date.now()+Math.max(5,Number(waitSec)||40)*1000;
  const maxAttempts=Math.max(1,Math.min(6,Math.floor(Number(maxNavigationAttempts)||3))),retryMs=Math.max(500,Number(navigationRetryMs)||2200),requiredSemanticStable=Math.max(1,Math.min(5,Math.floor(Number(semanticStableSamples)||2)));
  let target=null,last=null,lastProbeAt=0,lastNavigationAt=0,navigationAttempts=0,semanticSignedOutStable=0,semanticWaitLogged=false,lastSemantic=null;
  try{
    while(Date.now()<deadline&&!target){
      const browsers=await debug.command('browsers');target=chooseNewestBlankBrowser(browsers);last=browsers;
      if(!target)await sleep(350);
    }
    if(!target)throw new Error(`pristine_blank_browser_not_found:${JSON.stringify((last||[]).filter(x=>x?.online).map(compactBrowser))}`);
    if(!target.extensionInstanceId)throw new Error(`pristine_blank_extension_missing:${target.browserInstanceId||'unknown'}`);

    console.log('[COLD START] blank Browser selected:',JSON.stringify(compactBrowser(target)));
    navigationAttempts++;
    lastNavigationAt=Date.now();
    await issueBrowserUiAddress(debug,target,url,navigationAttempts);

    while(Date.now()<deadline){
      const browsers=await debug.command('browsers'),current=(browsers||[]).find(row=>row.browserInstanceId===target.browserInstanceId);last=browsers;
      if(!current||current.online!==true){await sleep(300);continue;}
      const youtubeTab=youtubeTabOf(current);
      if(youtubeTab){
        if(current.environment?.eligible===true){
          lastSemantic=await semanticSnapshotForTab(debug,youtubeTab.id);
          if(lastSemantic.signedInState==='signed_in')throw new Error(`pristine_blank_signed_in:tab=${youtubeTab.id}:pageType=${lastSemantic.pageType}`);
          if(lastSemantic.signedInState==='signed_out'&&lastSemantic.routeReady)semanticSignedOutStable++;else semanticSignedOutStable=0;
          if(semanticSignedOutStable>=requiredSemanticStable){
            const result={browserInstanceId:current.browserInstanceId,extensionInstanceId:current.extensionInstanceId,tabId:Number(youtubeTab.id),url,environment:current.environment,coldStartMode:'about_blank_body_browser_ui',navigationAttempts,semanticSignedOutStable,semantic:lastSemantic};
            console.log('[COLD START] YouTube Browser eligible and semantic signed-out state stable:',JSON.stringify({browserInstanceId:result.browserInstanceId,tabId:result.tabId,status:result.environment?.status||null,reasons:result.environment?.reasons||[],navigationAttempts,semanticSignedOutStable,signedInState:lastSemantic.signedInState,pageType:lastSemantic.pageType,uiReady:lastSemantic.uiReady}));
            return result;
          }
          if(!semanticWaitLogged||lastSemantic.signedInState!=='unknown'){
            semanticWaitLogged=true;
            console.log('[COLD START] Guardian is eligible; waiting for YouTube semantic/auth hydration:',JSON.stringify({signedInState:lastSemantic.signedInState,pageType:lastSemantic.pageType,uiReady:lastSemantic.uiReady,searchControlReady:lastSemantic.searchControlReady,surfaceRootReady:lastSemantic.surfaceRootReady,candidateReady:lastSemantic.candidateReady,stableSignedOutSamples:semanticSignedOutStable,requiredStableSamples:requiredSemanticStable,observationError:lastSemantic.observationError}));
          }
        }else if(Date.now()-lastProbeAt>=Math.max(500,Number(probeIntervalMs)||1500)){
          lastProbeAt=Date.now();
          try{await debug.command(`envprobe ${target.browserInstanceId}`);console.log(`[COLD START] Guardian re-probe requested for ${target.browserInstanceId}.`);}catch(error){console.log('[COLD START] Guardian probe pending:',String(error?.message||error));}
        }
      }else if(shouldRetryAddressNavigation({browser:current,attempts:navigationAttempts,maxAttempts,lastAttemptAt:lastNavigationAt,now:Date.now(),retryMs})){
        navigationAttempts++;
        lastNavigationAt=Date.now();
        const active=activeTabOf(current);
        console.log('[COLD START] YouTube route still absent; retrying BODY Browser UI address navigation:',JSON.stringify({attempt:navigationAttempts,maxAttempts,activeTab:active?{id:active.id,title:active.title||'',siteKey:active.siteKey||'',urlScheme:active.urlScheme||''}:null}));
        await issueBrowserUiAddress(debug,current,url,navigationAttempts);
      }
      await sleep(350);
    }
    const current=(last||[]).find(row=>row.browserInstanceId===target.browserInstanceId);
    throw new Error(`pristine_blank_bootstrap_timeout:navigationAttempts=${navigationAttempts}:semantic=${JSON.stringify(lastSemantic)}:${JSON.stringify(compactBrowser(current))}`);
  }finally{if(ownClient)await debug.close().catch(()=>{});}
}

async function main(){const waitSec=Math.max(5,Number(process.env.BODY_RESEARCH_BROWSER_WAIT_SEC||40)||40);const result=await bootstrapBlankBrowser({waitSec});console.log(JSON.stringify(result,null,2));return result;}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={sleep,tabsOf,isYoutubeTab,isBlankTab,blankBrowserCandidates,chooseNewestBlankBrowser,youtubeTabOf,activeTabOf,compactBrowser,shouldRetryAddressNavigation,semanticPristineSnapshot,semanticSnapshotForTab,issueBrowserUiAddress,bootstrapBlankBrowser,main};