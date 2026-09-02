'use strict';

const fs=require('node:fs');
const path=require('node:path');

const RETRYABLE_RENAME_CODES=new Set(['EPERM','EBUSY','EACCES','ENOTEMPTY','ETXTBSY']);
let tempSequence=0;

function sleepSync(ms){
  const delay=Math.max(0,Number(ms)||0);
  if(!delay)return;
  const buffer=new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer),0,0,delay);
}

function errorInfo(error){
  return {
    code:String(error?.code||'UNKNOWN'),
    message:String(error?.message||error||'unknown persistence error')
  };
}

class SafeJsonPersistence {
  constructor(file,{getValue,debounceMs=500,retryDelaysMs=[0,15,40,80,160,320],retryAfterMs=1000,fsImpl=fs,log=console}={}){
    if(typeof getValue!=='function')throw new Error('persistence_get_value_required');
    this.file=file;
    this.getValue=getValue;
    this.debounceMs=Math.max(0,Number(debounceMs)||0);
    this.retryDelaysMs=Array.isArray(retryDelaysMs)&&retryDelaysMs.length?retryDelaysMs.map(x=>Math.max(0,Number(x)||0)):[0];
    this.retryAfterMs=Math.max(50,Number(retryAfterMs)||1000);
    this.fs=fsImpl;
    this.log=log;
    this.timer=null;
    this.dirty=false;
    this.degraded=false;
    this.lastError=null;
    this.lastAttemptAt=null;
    this.lastSuccessAt=null;
    this.successfulWrites=0;
    this.failedFlushes=0;
  }

  schedule(){
    this.dirty=true;
    this._arm(this.debounceMs);
    return this.status();
  }

  _arm(delayMs){
    if(this.timer)return;
    this.timer=setTimeout(()=>{
      this.timer=null;
      this.flushSync();
    },Math.max(0,Number(delayMs)||0));
    this.timer.unref?.();
  }

  _clearTimer(){
    if(!this.timer)return;
    clearTimeout(this.timer);
    this.timer=null;
  }

  _tempPath(){
    tempSequence++;
    return `${this.file}.${process.pid}.${Date.now()}.${tempSequence}.tmp`;
  }

  _markFailure(error){
    const firstFailure=!this.degraded;
    this.degraded=true;
    this.failedFlushes++;
    this.lastError=errorInfo(error);
    if(firstFailure&&this.log?.warn){
      this.log.warn(`[PERSISTENCE DEGRADED] ${this.file}: ${this.lastError.code} ${this.lastError.message}; keeping model dirty and retrying.`);
    }
  }

  _markSuccess(){
    const recovered=this.degraded;
    this.degraded=false;
    this.lastError=null;
    this.dirty=false;
    this.successfulWrites++;
    this.lastSuccessAt=new Date().toISOString();
    if(recovered&&this.log?.warn)this.log.warn(`[PERSISTENCE RECOVERED] ${this.file}`);
  }

  flushSync(){
    this._clearTimer();
    if(!this.dirty)return {ok:true,skipped:true,...this.status()};

    this.lastAttemptAt=new Date().toISOString();
    const tmp=this._tempPath();
    try{
      this.fs.mkdirSync(path.dirname(this.file),{recursive:true});
      const payload=JSON.stringify(this.getValue(),null,2);
      this.fs.writeFileSync(tmp,payload,'utf8');

      let lastError=null;
      for(let i=0;i<this.retryDelaysMs.length;i++){
        const delay=this.retryDelaysMs[i];
        if(delay)sleepSync(delay);
        try{
          this.fs.renameSync(tmp,this.file);
          this._markSuccess();
          return {ok:true,skipped:false,...this.status()};
        }catch(error){
          lastError=error;
          if(!RETRYABLE_RENAME_CODES.has(String(error?.code||'')))break;
        }
      }
      throw lastError||new Error('model_rename_failed');
    }catch(error){
      try{if(this.fs.existsSync(tmp))this.fs.unlinkSync(tmp);}catch{}
      this._markFailure(error);
      this._arm(this.retryAfterMs);
      return {ok:false,skipped:false,...this.status()};
    }
  }

  closeSync(){
    return this.flushSync();
  }

  status(){
    return {
      dirty:this.dirty,
      degraded:this.degraded,
      lastError:this.lastError,
      lastAttemptAt:this.lastAttemptAt,
      lastSuccessAt:this.lastSuccessAt,
      successfulWrites:this.successfulWrites,
      failedFlushes:this.failedFlushes
    };
  }
}

module.exports={SafeJsonPersistence,RETRYABLE_RENAME_CODES,sleepSync};
