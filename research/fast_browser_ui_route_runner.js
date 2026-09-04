'use strict';

const {TopicRouteRunner}=require('./topic_route_runner');
const {sameHeadSearch}=require('./head_keyword_next_runner');

function norm(value){return String(value||'').normalize('NFKC').toLowerCase().normalize('NFD').replace(/\p{M}+/gu,'').replace(/đ/g,'d').replace(/\s+/g,' ').trim();}

class FastBrowserUiRouteRunner extends TopicRouteRunner{
  async restoreHeadSearch(query,{reason='restore_head_search'}={}){
    let obs=await this.observe(`${reason}_initial`);
    if(sameHeadSearch(obs,query,this.activeHeadQuery)){
      this.log('search_query_reused',{query,reason:'already_on_same_head_search'});
      return obs;
    }
    if(!this.activeHeadQuery||norm(this.activeHeadQuery)!==norm(query)||obs.route?.pageType==='home')return null;

    const maxBack=Math.max(2,Number(this.config.maxHops||2)+3);
    for(let attempt=1;attempt<=maxBack;attempt++){
      const before={pageType:obs.route?.pageType||null,videoId:String(obs.route?.videoId||'')};
      const started=Date.now();
      const result=await this.browserCommand('back');
      this.log('browser_ui_fast_back',{
        query,
        attempt,
        durationMs:Date.now()-started,
        commandId:result?.commandId||result?.execution?.commandId||null,
        delivered:result?.delivered??result?.execution?.delivered??null,
        verified:result?.verified??result?.execution?.verified??null,
        transport:'BODY_BROWSER_UI',
        cdpGatewayModified:false
      });

      obs=await this.waitFor(o=>{
        const pageType=o.route?.pageType||null;
        const videoId=String(o.route?.videoId||'');
        return pageType==='search'||pageType==='home'||pageType!==before.pageType||videoId!==before.videoId;
      },{timeoutMs:2500,intervalMs:100,reason:`${reason}_browser_ui_back_${attempt}`}).catch(async()=>this.observe(`${reason}_browser_ui_back_timeout_${attempt}`));

      if(obs.route?.pageType==='search'){
        this.log('search_query_reused',{query,reason:'restored_from_history_browser_ui',backAttempts:attempt});
        return obs;
      }
      if(obs.route?.pageType==='home')break;
    }
    this.log('search_history_restore_failed',{query,reason,pageType:obs.route?.pageType||null,transport:'BODY_BROWSER_UI'});
    return null;
  }

  report(outcome,extra={}){
    const base=super.report(outcome,extra);
    return {...base,browserUiMode:{historyRestore:'BODY_BROWSER_UI',staticSettleSleep:false,routePollIntervalMs:100,cdpGatewayModified:false},guardrails:{...base.guardrails,historyRestoreViaBodyBrowserUi:true,cdpGatewayModified:false}};
  }
}

module.exports={FastBrowserUiRouteRunner,norm};
