'use strict';

const {
  TargetPlanPortfolioRunner,
  buildTargetPlanPortfolio,
  buildTargetFingerprint
}=require('./target_plan_portfolio');
const {canonicalSearchRows,summarizeRuns}=require('./head_keyword_next_runner');
const {searchResultSignature,searchQuerySupport}=require('./robust_key_graph_route_runner');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));
const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const fold=value=>clean(value).toLowerCase().normalize('NFD').replace(/\p{M}+/gu,'').replace(/đ/g,'d');

function comparePlanResultsForDiscovery(results){
  const scored=(results||[]).map(row=>{
    const route=row?.evaluation?.bestRoute||null,found=row?.evaluation?.found===true;
    const graphEdgeCount=found&&Number.isFinite(Number(route?.graphEdgeCount))?Number(route.graphEdgeCount):Infinity;
    const rank=found&&Number.isFinite(Number(route?.rank))?Number(route.rank):9999;
    const proximity=Number(row?.evaluation?.closestObserved?.proximity?.score||0);
    const elapsedMs=Number(row?.evaluation?.elapsedMs||0),commandCount=Number(row?.evaluation?.commandCount||0);
    return {...row,_found:found,_graphEdgeCount:graphEdgeCount,_rank:rank,_proximity:proximity,_elapsedMs:elapsedMs,_commandCount:commandCount};
  });
  scored.sort((a,b)=>{
    if(a._found!==b._found)return Number(b._found)-Number(a._found);
    if(a._found)return a._graphEdgeCount-b._graphEdgeCount||a._rank-b._rank||a._elapsedMs-b._elapsedMs||a._commandCount-b._commandCount;
    return b._proximity-a._proximity||a._elapsedMs-b._elapsedMs||a._commandCount-b._commandCount;
  });
  const rows=scored.map((x,i)=>({rank:i+1,planId:x.plan.id,query:x.plan.query,traversal:x.plan.traversal,found:x.evaluation.found,bestRoute:x.evaluation.bestRoute,closestObserved:x.evaluation.closestObserved,elapsedMs:x.evaluation.elapsedMs,commandCount:x.evaluation.commandCount}));
  return {
    rankedPlans:rows,
    shortestFoundPlan:scored.find(x=>x._found)?.plan?.id||null,
    closestUnfoundPlan:scored.find(x=>!x._found)?.plan?.id||null,
    comparisonMode:'shared_session_operational',
    unfoundRankingPrimaryMetric:'target_proximity',
    orderEffectRisk:true,
    validationRecommendation:'Re-run the top plans one at a time with --plan-only on separate pristine Chrome sessions to confirm the shortest route.'
  };
}

/**
 * Runtime hardening for the single-ID target portfolio.
 *
 * Two races are handled here:
 * 1. YouTube can update /results?search_query= before replacing the old result DOM.
 *    The last settled result signature is therefore carried across Home and across
 *    plan changes, so a new query cannot accept the previous query's result set.
 * 2. An async return inside try/finally must await TASK_COMPLETE before the finally
 *    closes the Brain socket, otherwise the task keeps owning its tab forever.
 */
class HardenedTargetPlanPortfolioRunner extends TargetPlanPortfolioRunner{
  constructor(config,client=null,options={}){
    super(config,client,options);
    this.lastSettledSearchSignature='';
    this.lastSettledSearchQuery='';
  }

  async waitSearchResultsSettled(query,{beforeSignature='',reason='search_results',timeoutMs=null}={}){
    const queryKey=fold(query),sameAsLast=queryKey&&queryKey===this.lastSettledSearchQuery;
    const carriedBefore=clean(beforeSignature)||(sameAsLast?'':this.lastSettledSearchSignature);
    const deadline=Date.now()+Math.max(3000,Number(timeoutMs||this.config.searchResultSettleMs||12000));
    const required=Math.max(1,Math.min(4,Number(this.config.searchResultStableSamples||2)));
    let lastSignature='',stable=0,lastObs=null,lastSupport=null,lastRouteQuery='',routeMatchedAt=0;

    while(Date.now()<deadline){
      lastObs=await this.observe(`${reason}_strict_settle`);
      const rows=canonicalSearchRows(lastObs),signature=searchResultSignature(lastObs);
      lastSupport=searchQuerySupport(lastObs,query);
      lastRouteQuery=clean(lastObs?.route?.searchQuery||'');
      const routeMatches=fold(lastRouteQuery)===queryKey;
      if(routeMatches&&!routeMatchedAt)routeMatchedAt=Date.now();
      const stalePreviousResult=Boolean(carriedBefore&&signature===carriedBefore&&!sameAsLast);
      const usable=lastObs?.route?.pageType==='search'&&rows.length>0&&routeMatches&&!stalePreviousResult;

      if(usable){
        stable=signature&&signature===lastSignature?stable+1:1;
        if(stable>=required){
          this.lastSettledSearchSignature=signature;
          this.lastSettledSearchQuery=queryKey;
          const row={
            query,
            routeSearchQuery:lastRouteQuery,
            beforeSignature:carriedBefore,
            afterSignature:signature,
            stableSamples:stable,
            requiredStableSamples:required,
            support:lastSupport,
            resultCount:rows.length,
            strictRouteQueryMatch:true,
            rejectedPreviousResultSignature:Boolean(carriedBefore&&!sameAsLast),
            routeToDomSettleMs:routeMatchedAt?Date.now()-routeMatchedAt:null
          };
          this.searchSettleEvents.push(row);
          this.log('search_results_settled_strict',row);
          return lastObs;
        }
      }else stable=0;
      lastSignature=signature;
      await sleep(250);
    }

    if(!lastRouteQuery)throw new Error(`search_route_query_unavailable_reload_extension:${clean(query)}`);
    throw new Error(`search_results_not_settled_strict:${clean(query)}:route=${lastRouteQuery}:before=${carriedBefore}:after=${lastSignature}:support=${lastSupport?.matches||0}`);
  }

  async run(){
    try{
      await this.selectBrowser();
      await this.createTask();
      this.captureEnvironment();
      await this.validatePristine();
      await this.loadTrackedVideo();
      this.targetFingerprint=buildTargetFingerprint(this.trackedVideoApi);
      this.planPortfolio=buildTargetPlanPortfolio(this.trackedVideoApi,{trackVideoId:this.config.trackVideoId,budget:this.config.planBudget||6});
      if(this.config.planOnly){
        const wanted=fold(this.config.planOnly);
        this.planPortfolio=this.planPortfolio.filter(p=>fold(p.id)===wanted||fold(p.query)===wanted);
        if(!this.planPortfolio.length)throw new Error(`target_plan_not_found:${this.config.planOnly}`);
      }
      this.log('target_plan_portfolio_created',{targetVideoId:this.config.trackVideoId,planCount:this.planPortfolio.length,plans:this.planPortfolio.map(p=>({id:p.id,query:p.query,traversal:p.traversal,source:p.querySource}))});
      if(this.config.homeExplore!==false)this.homeDiscovery.baseline=await this.scanHome('target_portfolio_baseline',{navigate:false});
      for(const plan of this.planPortfolio){
        if(Date.now()-this.startedAt>this.config.maxRuntimeSec*1000)break;
        await this.executePlan(plan);
        if(this.config.stopAfterFirstTarget===true&&this.anyTargetObserved)break;
      }
      await this.loadTrackedVideo({refresh:true});
      const comparison=comparePlanResultsForDiscovery(this.planResults),factorSummary=summarizeRuns(this.headKeywordRuns);
      // MUST await here. Returning the Promise directly would execute finally first,
      // closing BrainClient while complete() is still sending TASK_COMPLETE.
      return await this.complete('target_plan_portfolio_complete',{mode:'target_profile_multi_plan_discovery',targetFingerprint:this.targetFingerprint,planPortfolio:this.planPortfolio,planResults:this.planResults,portfolioComparison:comparison,headKeywordRuns:this.headKeywordRuns,homeDiscovery:this.homeDiscovery,factorSummary});
    }catch(error){
      this.log('runner_error',{error:String(error?.stack||error)});
      await this.req('TASK_FAIL',{taskId:this.taskId,error:String(error?.message||error)}).catch(finalizeError=>this.log('task_finalize_error',{operation:'TASK_FAIL',error:String(finalizeError?.message||finalizeError)}));
      this.endedAt=Date.now();
      const report=this.report('error',{error:String(error?.stack||error),targetFingerprint:this.targetFingerprint,planPortfolio:this.planPortfolio,planResults:this.planResults,portfolioComparison:comparePlanResultsForDiscovery(this.planResults)});
      this.writeReport(report);
      throw error;
    }finally{
      await this.client.close().catch(()=>{});
    }
  }
}

module.exports={comparePlanResultsForDiscovery,HardenedTargetPlanPortfolioRunner};
