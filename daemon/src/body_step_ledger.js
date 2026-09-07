'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {SafeJsonPersistence}=require('./safe_json_persistence');

function clone(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value));}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=stable(value[key]);return out;}return value;}
function stableStringify(value){return JSON.stringify(stable(value));}
function commandHash(command){return crypto.createHash('sha256').update(stableStringify(command)).digest('hex');}
function ledgerKey(taskId,stepId){return `${String(taskId)}::${String(stepId)}`;}
function codedError(code,message=code){const error=new Error(message);error.code=code;return error;}

class BodyStepLedger{
  constructor(baseDir,{now=()=>Date.now(),fsImpl=fs}={}){
    if(!baseDir)throw new Error('body_step_ledger_base_dir_required');
    this.now=now;this.fs=fsImpl;this.dir=path.join(baseDir,'state');this.file=path.join(this.dir,'body_step_ledger.json');this.state=this._load();
    this.persistence=new SafeJsonPersistence(this.file,{getValue:()=>this.state,debounceMs:0,retryAfterMs:1000,fsImpl:this.fs,log:null});
  }
  _load(){
    if(!this.fs.existsSync(this.file))return {schemaVersion:1,entries:{}};
    let parsed;try{parsed=JSON.parse(this.fs.readFileSync(this.file,'utf8'));}catch{throw codedError('body_step_ledger_invalid_json');}
    if(Number(parsed?.schemaVersion)!==1||!parsed.entries||typeof parsed.entries!=='object'||Array.isArray(parsed.entries))throw codedError('body_step_ledger_invalid');
    return parsed;
  }
  _persistOrThrow({rollback=null}={}){
    this.persistence.schedule();const persisted=this.persistence.flushSync();
    if(persisted.ok)return persisted;
    if(rollback)this.state=rollback;
    throw codedError('body_step_ledger_persistence_failed',persisted.lastError?.message||'body_step_ledger_persistence_failed');
  }
  lookup(command){
    const key=ledgerKey(command.taskId,command.stepId),hash=commandHash(command),entry=this.state.entries[key]||null;
    if(!entry)return {status:'missing',key,hash,entry:null};
    if(entry.commandHash!==hash)throw codedError('body_step_id_conflict');
    return {status:String(entry.state||'UNKNOWN').toLowerCase(),key,hash,entry:clone(entry)};
  }
  reserve(command){
    const existing=this.lookup(command);if(existing.status!=='missing')return existing;
    const before=clone(this.state),entry={taskId:String(command.taskId),stepId:String(command.stepId),commandHash:existing.hash,state:'RESERVED',reservedAt:this.now(),completedAt:null,result:null};
    this.state.entries[existing.key]=entry;this._persistOrThrow({rollback:before});return {status:'reserved-new',key:existing.key,hash:existing.hash,entry:clone(entry)};
  }
  commit(command,result){
    const found=this.lookup(command);if(found.status==='missing')throw codedError('body_step_not_reserved');
    const entry=this.state.entries[found.key];entry.state='DONE';entry.completedAt=this.now();entry.result=clone(result);
    this.persistence.schedule();const persisted=this.persistence.flushSync();
    if(!persisted.ok)throw codedError('body_step_ledger_commit_failed',persisted.lastError?.message||'body_step_ledger_commit_failed');
    return clone(entry);
  }
  replay(command){
    const found=this.lookup(command);if(found.status==='done'&&found.entry?.result)return clone(found.entry.result);return null;
  }
  stats(){
    let reserved=0,done=0;for(const entry of Object.values(this.state.entries)){if(entry.state==='DONE')done++;else if(entry.state==='RESERVED')reserved++;}
    return {schemaVersion:1,file:this.file,total:Object.keys(this.state.entries).length,reserved,done,persistence:this.persistence.status()};
  }
  flushSync(){return this.persistence.flushSync();}
}

module.exports={BodyStepLedger,stableStringify,commandHash,ledgerKey};
