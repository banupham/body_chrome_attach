'use strict';

// Verify the action's own expectation. An unrelated animation, tab or scroll
// change must not reward a failed click or an unobserved native UI operation.
function evaluateAction(action,outcome,before,after,delta){
  if(!after)return {verdict:'unknown',reason:'post_action_observation_unavailable',expected:action.expected||null};
  let confirmed=false,reason='expected_effect_not_observed';
  if(action.type==='click_candidate')confirmed=after.current.videoId===String(action.target?.videoId||'');
  else if(action.type==='tab_switch')confirmed=Number(after.body.activeTabId)===Number(action.tabId);
  else if(action.type==='search')confirmed=outcome.success&&after.current.pageType==='search';
  else if(action.type==='home')confirmed=outcome.success&&after.current.pageType==='home';
  else if(action.type==='preview_candidate')confirmed=outcome.previewConfirmed===true;
  else if(action.type==='dwell')confirmed=outcome.success;
  else if(action.type==='scroll')confirmed=delta.reasons.includes('scroll')||JSON.stringify(before.candidates.map(c=>c.videoId))!==JSON.stringify(after.candidates.map(c=>c.videoId));
  else if(action.type==='body_step'){
    const step=action.step||{};
    if(step.kind==='browser_ui'){
      if(step.action==='dismiss')confirmed=before.scene?.hasFocus===false&&after.scene?.hasFocus===true||Boolean(before.scene?.dialogs?.length)&&Number(after.scene?.dialogs?.length||0)<before.scene.dialogs.length;
      else if(step.action==='newtab')confirmed=after.tabs.some(t=>!before.tabs.some(b=>b.id===t.id));
      else if(step.action==='closetab')confirmed=!after.tabs.some(t=>t.id===before.tabId);
      else if(['nexttab','prevtab'].includes(step.action))confirmed=after.body.activeTabId!==before.body.activeTabId;
      else if(['back','forward','address','reload','hardreload'].includes(step.action))confirmed=after.tabs.some(t=>t.id===before.tabId&&before.tabs.some(b=>b.id===t.id&&(b.navigationToken!==t.navigationToken||b.navigationEpoch!==t.navigationEpoch)));
      else return {verdict:outcome.error?'failed':'unknown',reason:outcome.error||'browser_ui_effect_unobservable',expected:action.expected||null};
    }else if(['moveTo','hover'].includes(step.intent?.type))confirmed=delta.reasons.includes('pointer')||delta.reasons.includes('control_state');
    else confirmed=delta.reasons.some(r=>r!=='pointer');
  }
  if(outcome.error)reason=outcome.error;
  return {verdict:confirmed&&outcome.success?'confirmed':'failed',reason:confirmed&&outcome.success?'expected_effect_observed':reason,expected:action.expected||null,observedChanges:delta.reasons};
}
function rebindAffordance(descriptor,semantic){
  const rows=(semantic?.affordances||[]).filter(row=>String(row.tag||'')===String(descriptor.tag||'')&&String(row.role||'')===String(descriptor.role||'')&&String(row.label||'')===String(descriptor.label||'')&&JSON.stringify(row.link||null)===JSON.stringify(descriptor.link||null));
  // Index order can change after a DOM refresh; ambiguous identities require replanning.
  if(rows.length!==1)return null;
  const row=rows[0];return row.disabled||row.actionable===false||!row.actionRect?null:row;
}
module.exports={evaluateAction,rebindAffordance};
