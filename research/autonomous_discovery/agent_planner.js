'use strict';

const {bodyCapabilityCatalog,capabilityId}=require('./body_capabilities');
const {contextKey,candidateIdentity}=require('./world_model');
const {fold}=require('./topic_classifier');

const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
const jitter=(scale=1)=>(Math.random()-0.5)*scale;
function actionKey(action){return `${action.type}|${action.capability||''}|${action.target?.videoId||''}|${action.query||''}|${action.tabId??''}`;}
function recentPenalty(action,history=[]){const key=actionKey(action),recent=(history||[]).slice(-12);let hits=0;for(const row of recent)if(row.actionKey===key&&row.success===false)hits++;return Math.min(40,hits*12);}
function memoryBonus(memory,id,context){const value=memory?.ucb?.(id,context,1.05);return Number.isFinite(value)?clamp(value,-8,12):8;}
function targetCandidateScore(candidate,world){
  let score=20+Number(candidate.targetProximity||0)*120;
  if(candidate.targetMatch)score+=1000;
  if(!world.history.some(row=>row.videoId===candidate.videoId&&row.success))score+=8;
  if(candidate.topic&&candidate.topic!=='unknown'&&!world.history.some(row=>row.topic===candidate.topic))score+=6;
  if(candidate.visible&&candidate.actionRect)score+=5;
  if(candidate.surface==='related')score+=3;
  if(candidate.surface==='search_results')score+=2;
  if(candidate.isRadio)score-=3;
  if(Number.isFinite(Number(candidate.position)))score+=Math.max(0,5-Math.log2(Math.max(1,Number(candidate.position))));
  return score;
}
function genericBodyActions(world){
  const catalog=bodyCapabilityCatalog(),actions=[];
  for(const action of catalog.browserUi){
    let utility=-20,purpose='available_browser_capability';
    if(action==='back'&&world.current.pageType!=='home'){utility=5;purpose='recover_or_branch';}
    else if(action==='forward'){utility=-4;purpose='inspect_forward_history';}
    else if(['reload','hardreload'].includes(action)){utility=world.environment.online?0:-6;purpose='refresh_environment';}
    else if(action==='stop'){utility=world.advertising.playingAd?2:-8;purpose='interrupt_current_navigation';}
    else if(action==='newtab'){utility=-2;purpose='open_parallel_branch';}
    else if(action==='closetab'){utility=world.tabs.length>1?-1:-30;purpose='prune_branch';}
    else if(action==='reopentab'){utility=-5;purpose='recover_closed_branch';}
    else if(['nexttab','prevtab'].includes(action)){utility=world.tabs.length>1?1:-30;purpose='inspect_workspace';}
    else if(action==='address'){utility=0;purpose='direct_environment_navigation';}
    actions.push({type:'body_step',capability:`browser_ui.${action}`,step:{kind:'browser_ui',action},purpose,baseUtility:utility,expected:'observable_or_execution_fact'});
  }
  const active=world.controls.activeTarget;
  if(active?.editable){
    actions.push({type:'body_step',capability:'motor.pressKey',step:{kind:'motor',intent:{type:'pressKey',key:'Escape'}},purpose:'escape_active_control',baseUtility:-2,expected:'control_or_page_change'});
    actions.push({type:'body_step',capability:'motor.keyCombo',step:{kind:'motor',intent:{type:'keyCombo',key:'Control+a'}},purpose:'select_active_editable_text',baseUtility:-3,expected:'focus_preserved'});
  }
  if(world.body.pointer?.known){
    actions.push({type:'body_step',capability:'motor.moveTo',step:{kind:'motor',intent:{type:'moveTo',x:Number(world.body.pointer.x||0),y:Number(world.body.pointer.y||0),role:'page'}},purpose:'motor_probe',baseUtility:-25,expected:'pointer_change'});
  }
  return actions;
}

class AutonomousAgentPlanner{
  constructor({memory=null,explorationBase=0.18}={}){this.memory=memory;this.explorationBase=clamp(explorationBase,0,0.8);this.catalog=bodyCapabilityCatalog();}
  inferTask(targetProfile,queryPlan){
    return {
      objective:'reach_video_id_without_direct_title_or_id_search',
      targetVideoId:String(targetProfile?.videoId||''),
      targetTopic:queryPlan?.fingerprint?.primaryTopic||queryPlan?.semanticTopics?.[0]||'unknown',
      targetLanguage:queryPlan?.targetLanguage||'unknown',
      constraints:['do_not_search_target_video_id','do_not_search_exact_or_near_exact_target_title'],
      successEvidence:['current_video_id_equals_target','target_candidate_observed_then_opened'],
      capabilities:this.catalog
    };
  }
  deriveSubgoal(world,task){
    if(world.currentIsTarget)return {id:'maintain_or_expand_from_goal',reason:'target_is_current'};
    if(world.targetVisible)return {id:'open_observed_target',reason:`target_visible:${world.targetVisible.surface}`};
    const best=[...world.candidates].sort((a,b)=>Number(b.targetProximity||0)-Number(a.targetProximity||0))[0];
    if(best&&Number(best.targetProximity||0)>=0.28)return {id:'follow_high_evidence_neighbor',reason:`proximity:${best.targetProximity}`};
    if(world.advertising.playingAd)return {id:'restore_observable_content',reason:'advertising_interruption'};
    if(world.current.pageType==='search'&&world.candidates.length)return {id:'learn_from_search_neighborhood',reason:'search_results_available'};
    if(['watch','watch_radio','shorts'].includes(world.current.pageType)&&world.candidates.length)return {id:'expand_recommendation_graph',reason:'recommendations_available'};
    if(world.tabs.length>1)return {id:'inspect_workspace_branches',reason:'multiple_tabs'};
    return {id:'acquire_more_target_evidence',reason:'low_environment_evidence'};
  }
  generate(world,{task,queryPlan,dynamicQueries=[],usedQueries=new Set(),stagnation=0}={}){
    const context=contextKey(world),subgoal=this.deriveSubgoal(world,task),actions=[];
    if(world.targetVisible){
      const c=world.targetVisible;actions.push({type:'click_candidate',capability:'motor.click',target:c,purpose:'open_target',baseUtility:1500,expected:'target_video_current'});
    }
    for(const c of world.candidates){actions.push({type:'click_candidate',capability:'motor.click',target:c,purpose:'follow_environment_edge',baseUtility:targetCandidateScore(c,world),expected:`current_video:${c.videoId}`});}
    const allQueries=[...(queryPlan?.plan||[]),...(dynamicQueries||[])];
    for(const row of allQueries){
      const used=usedQueries.has(fold(row.query));const learned=this.memory?.state?.queries?.[fold(row.query)];let utility=32+Number(row.score||0)*1.5+(used?-12:10)+Number(learned?.meanReward||0)*2;
      if(stagnation>=2)utility+=10;if(world.current.pageType==='search'&&used)utility-=5;
      actions.push({type:'search',capability:'motor+search_control',query:row.query,queryRow:row,purpose:'acquire_target_anchored_evidence',baseUtility:utility,expected:'search_results_for_query'});
    }
    if(['watch','watch_radio','shorts'].includes(world.current.pageType)){
      actions.push({type:'dwell',capability:'brain.wait',purpose:'observe_recommendation_change',baseUtility:12+Math.min(12,stagnation*2),expected:'time_or_recommendation_change'});
    }
    const scrollBase=world.candidates.some(c=>!c.visible)?18:5;
    actions.push({type:'scroll',capability:'motor.scrollVertical',direction:'down',purpose:'expand_visible_environment',baseUtility:scrollBase+stagnation*2,expected:'scroll_or_candidate_change'});
    actions.push({type:'scroll',capability:'motor.scrollVertical',direction:'up',purpose:'reinspect_previous_environment',baseUtility:stagnation>=3?8:-3,expected:'scroll_or_candidate_change'});
    if(world.controls.homeLink||world.current.pageType!=='home')actions.push({type:'home',capability:'motor.click|browser_ui.address',purpose:'sample_home_environment',baseUtility:stagnation>=3?20:2,expected:'page_type_home'});
    for(const tab of world.tabs){if(tab.id!==world.tabId)actions.push({type:'tab_switch',capability:'tab.tab_switch',tabId:tab.id,purpose:'inspect_parallel_environment_branch',baseUtility:8+(tab.siteKey.includes('youtube.com')?10:0),expected:`active_tab:${tab.id}`});}
    actions.push(...genericBodyActions(world));
    const history=world.history||[];
    for(const action of actions){
      const id=action.capability||action.type;action.context=context;action.subgoal=subgoal;action.actionKey=actionKey(action);action.utility=Number((Number(action.baseUtility||0)+memoryBonus(this.memory,id,context)-recentPenalty(action,history)+jitter(1.4)).toFixed(3));
    }
    actions.sort((a,b)=>b.utility-a.utility);
    return {task,subgoal,context,actions};
  }
  choose(plan,{stagnation=0}={}){
    const actions=plan.actions||[];if(!actions.length)return null;
    const epsilon=clamp(this.explorationBase+Math.min(0.35,Number(stagnation||0)*0.045),0,0.65);
    if(Math.random()<epsilon){const pool=actions.slice(0,Math.min(8,actions.length));const weights=pool.map((_,i)=>Math.max(1,pool.length-i));const total=weights.reduce((a,b)=>a+b,0);let r=Math.random()*total;for(let i=0;i<pool.length;i++){r-=weights[i];if(r<=0)return {...pool[i],selection:'exploration',epsilon};}}
    return {...actions[0],selection:'utility_max',epsilon};
  }
}

module.exports={AutonomousAgentPlanner,actionKey,targetCandidateScore,genericBodyActions,recentPenalty};
