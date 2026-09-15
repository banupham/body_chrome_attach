'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {SafeJsonPersistence}=require('./safe_json_persistence');
const {runtimeDataDir}=require('./runtime_data_dir');

function clone(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value));}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=stable(value[key]);return out;}return value;}
function stableStringify(value){return JSON.stringify(stable(value));}
function commandIdentity(command){const value=clone(command)||{};delete value.requestId;return value;}
function commandHash(command){return crypto.createHash('sha256').update(stableStringify(commandIdentity(command))).digest('hex');}
function ledgerKey(taskId,stepId){return `${String(taskId)}::${String(stepId)}`;}
function codedError(code,message=code){const error=new Error(message);error.code=code;return error;}
function freshState(){return {schemaVersion:1,entries:{}};}
function validState(value){return Number(value?.schemaVersion)===1&&value.entries&&typeof value.entries==='object'&&!Array.isArray(value.entries);}
function errorText(error){return `${String(error?.code||'UNKNOWN')}:${String(error?.message||error||'unknown')}`;}

class BodyStepLedger{
  constructor(baseDir,{now=()=>Date.now(),fsImpl=fs,env=process.env}={}){
    if(!baseDir)throw new Error('body_step_ledger_base_dir_required');
    const resolvedBaseDir=runtimeDataDir(baseDir,env);
    this.now=now;this.fs=fsImpl;this.dir=path.join(resolvedBaseDir,'state');this.file=path.join(this.dir,'body_step_ledger.json');this.recovery=null;this.state=this._load();
    this.persistence=new SafeJsonPersistence(this.file,{getValue:()=>this.state,debounceMs:0,retryAfterMs:1000,fsImpl:this.fs,log:null});
  }
  _writeFreshState(state){
    const tmp=`${this.file}.${process.pid}.${Date.now()}.recovery.tmp`;
    this.fs.mkdirSync(this.dir,{recursive:true});
    try{
      this.fs.writeFileSync(tmp,JSON.stringify(state,null,2)+'\n','utf8');
      try{this.fs.renameSync(tmp,this.file);}
      catch(error){
        if(!['EEXIST','EPERM','EACCES'].includes(String(error?.code||'')))throw error;
        try{this.fs.rmSync(this.file,{force:true});}catch{}
        this.fs.renameSync(tmp,this.file);
      }
    }finally{try{this.fs.rmSync(tmp,{force:true});}catch{}}
  }
  _recover(reason,loadError=null){
    const state=freshState(),stamp=new Date(Number(this.now())||Date.now()).toISOString().replace(/[:.]/g,'-'),backup=`${this.file}.corrupt-${stamp}-${process.pid}.bak`,recovery={recovered:true,reason,sourceFile:this.file,backupFile:null,freshFileWritten:false,error:loadError?errorText(loadError):null};
    try{
      this.fs.mkdirSync(this.dir,{recursive:true});
      if(this.fs.existsSync(this.file)){
        try{this.fs.renameSync(this.file,backup);recovery.backupFile=backup;}
        catch(renameError){
          try{this.fs.copyFileSync(this.file,backup);recovery.backupFile=backup;this.fs.rmSync(this.file,{force:true});}
          catch(copyError){recovery.error=[recovery.error,errorText(renameError),errorText(copyError)].filter(Boolean).join('|');try{this.fs.rmSync(this.file,{force:true});}catch{}}
        }
      }
      try{this._writeFreshState(state);recovery.freshFileWritten=true;}
      catch(writeError){recovery.error=[recovery.error,errorText(writeError)].filter(Boolean).join('|');}
    }catch(error){recovery.error=[recovery.error,errorText(error)].filter(Boolean).join('|');}
    this.recovery=recovery;
    try{console.warn(`[BODY LEDGER RECOVERED] reason=${reason} backup=${recovery.backupFile||'unavailable'} fresh=${recovery.freshFileWritten?'yes':'no'}${recovery.error?` error=${recovery.error}`:''}`);}catch{}
    return state;
  }
  _load(){
    if(!this.fs.existsSync(this.file))return freshState();
    let raw;try{raw=this.fs.readFileSync(this.file,'utf8');}catch(error){return this._recover('read_failed',error);}
    let parsed;try{parsed=JSON.parse(raw);}catch(error){return this._recover('invalid_json',error);}
    if(!validState(parsed))return this._recover('invalid_schema');
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
  replay(command){const found=this.lookup(command);if(found.status==='done'&&found.entry?.result)return clone(found.entry.result);return null;}
  stats(){let reserved=0,done=0;for(const entry of Object.values(this.state.entries)){if(entry.state==='DONE')done++;else if(entry.state==='RESERVED')reserved++;}return {schemaVersion:1,file:this.file,total:Object.keys(this.state.entries).length,reserved,done,recovery:this.recovery?clone(this.recovery):null,persistence:this.persistence.status()};}
  flushSync(){return this.persistence.flushSync();}
}

module.exports={BodyStepLedger,stableStringify,commandIdentity,commandHash,ledgerKey,freshState,validState};
