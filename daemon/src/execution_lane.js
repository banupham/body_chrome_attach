'use strict';

class ExecutionLane {
  constructor(){
    this.tails=new Map();
    this.states=new Map();
    this.sequence=0;
  }

  _state(scope){
    const key=String(scope||'__default__');
    if(!this.states.has(key))this.states.set(key,{
      scope:key,
      active:false,
      queued:0,
      current:null,
      lastStartedAt:null,
      lastFinishedAt:null,
      completed:0,
      failed:0
    });
    return this.states.get(key);
  }

  run(scope,metadata={},work){
    if(typeof work!=='function')throw new Error('execution_lane_work_required');
    const key=String(scope||'__default__');
    const state=this._state(key);
    const sequence=++this.sequence;
    state.queued++;

    const previous=this.tails.get(key)||Promise.resolve();
    const task=previous.catch(()=>{}).then(async()=>{
      state.queued=Math.max(0,state.queued-1);
      state.active=true;
      state.current={sequence,...metadata};
      state.lastStartedAt=new Date().toISOString();
      try{
        const result=await work();
        state.completed++;
        return result;
      }catch(error){
        state.failed++;
        throw error;
      }finally{
        state.active=false;
        state.current=null;
        state.lastFinishedAt=new Date().toISOString();
      }
    });

    const tail=task.catch(()=>{});
    this.tails.set(key,tail);
    tail.then(()=>{
      if(this.tails.get(key)===tail&&state.queued===0&&!state.active)this.tails.delete(key);
    });
    return task;
  }

  status(scope=null){
    const clone=state=>({
      scope:state.scope,
      active:state.active,
      queued:state.queued,
      current:state.current?{...state.current}:null,
      lastStartedAt:state.lastStartedAt,
      lastFinishedAt:state.lastFinishedAt,
      completed:state.completed,
      failed:state.failed
    });
    if(scope!==null&&scope!==undefined){
      const state=this.states.get(String(scope));
      return state?clone(state):null;
    }
    return [...this.states.values()].map(clone);
  }
}

module.exports={ExecutionLane};
