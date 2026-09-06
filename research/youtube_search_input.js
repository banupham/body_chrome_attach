'use strict';

function rectOf(control){
  const r=control?.actionRect;
  if(!r||![r.centerX,r.centerY,r.width,r.height].every(Number.isFinite))throw new Error('search_input_action_rect_required');
  return r;
}

function replaceSearchIntents(control,query){
  const r=rectOf(control);
  const text=String(query??'').trim();
  if(!text)throw new Error('search_query_required');
  return [
    {type:'click',x:r.centerX,y:r.centerY,width:r.width,height:r.height,role:'textbox'},
    {type:'keyCombo',key:'Control+a'},
    {type:'pressKey',key:'Backspace'},
    {type:'typeText',x:r.centerX,y:r.centerY,width:r.width,height:r.height,role:'textbox',text},
    {type:'pressKey',key:'Enter'}
  ];
}

async function replaceSearchQuery(runner,control,query){
  if(!runner||typeof runner.intent!=='function')throw new Error('search_runner_intent_required');
  const intents=replaceSearchIntents(control,query);
  for(const intent of intents)await runner.intent(intent);
  return intents;
}

module.exports={rectOf,replaceSearchIntents,replaceSearchQuery};
