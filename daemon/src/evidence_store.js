'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

function safeSegment(raw,fallback='unknown'){
  const value=String(raw||fallback).toLowerCase().replace(/[^a-z0-9._-]+/g,'_').replace(/^_+|_+$/g,'');
  return value||fallback;
}

function hashRecord(record){
  const copy={...record};
  delete copy.recordHash;
  return crypto.createHash('sha256').update(JSON.stringify(copy),'utf8').digest('hex');
}

function clone(value){return JSON.parse(JSON.stringify(value));}

class EvidenceStore{
  constructor(baseDir,{now=()=>Date.now(),randomBytes=size=>crypto.randomBytes(size)}={}){
    this.baseDir=baseDir;
    this.now=now;
    this.randomBytes=randomBytes;
    this.lastHashByFile=new Map();
    fs.mkdirSync(baseDir,{recursive:true});
  }

  _file(identity,siteKey){
    const browserId=String(identity?.browserInstanceId||'').trim();
    if(!browserId)throw new Error('evidence_browser_instance_id_required');
    return path.join(this.baseDir,'by-browser',safeSegment(browserId,'browser'),safeSegment(siteKey,'__unknown__'),'evidence.jsonl');
  }

  _readRows(file){
    if(!fs.existsSync(file))return [];
    const text=fs.readFileSync(file,'utf8');
    if(!text.trim())return [];
    return text.split(/\r?\n/).filter(Boolean).map((line,index)=>{
      try{return JSON.parse(line);}catch{throw new Error(`evidence_json_invalid:${file}:${index+1}`);}
    });
  }

  verifyFile(file){
    const rows=this._readRows(file);
    let previousHash=null;
    for(let index=0;index<rows.length;index++){
      const row=rows[index];
      if(Number(row.schemaVersion)!==1)throw new Error(`evidence_schema_unsupported:${index+1}`);
      if((row.previousHash||null)!==previousHash)throw new Error(`evidence_chain_broken:${index+1}`);
      const expected=hashRecord(row);
      if(row.recordHash!==expected)throw new Error(`evidence_integrity_violation:${index+1}`);
      previousHash=row.recordHash;
    }
    this.lastHashByFile.set(file,previousHash);
    return {ok:true,count:rows.length,lastHash:previousHash};
  }

  _previousHash(file){
    return this.verifyFile(file).lastHash;
  }

  append({identity,siteKey,tabId,source,provenance,beforeState,action,afterState,observedEffect}){
    if(source!=='human')throw new Error('evidence_human_source_required');
    if(provenance?.trustedInput!==true)throw new Error('evidence_trusted_input_required');
    const browserId=String(identity?.browserInstanceId||'').trim();
    if(!browserId)throw new Error('evidence_browser_instance_id_required');
    const id=`evidence-${this.now()}-${this.randomBytes(6).toString('hex')}`;
    const file=this._file(identity,siteKey);
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const record={
      schemaVersion:1,
      evidenceId:id,
      recordedAt:new Date(this.now()).toISOString(),
      identity:{
        companyId:identity.companyId||null,
        deviceId:identity.deviceId||null,
        browserInstanceId:browserId,
        extensionInstanceId:identity.extensionInstanceId||null,
        runtimeExtensionId:identity.runtimeExtensionId||null
      },
      siteKey:String(siteKey||'__unknown__'),
      tabId:Number(tabId),
      source:'human',
      provenance:clone(provenance||{}),
      beforeState:clone(beforeState||{}),
      action:clone(action||{}),
      afterState:clone(afterState||{}),
      observedEffect:clone(observedEffect||{}),
      previousHash:this._previousHash(file)
    };
    record.recordHash=hashRecord(record);
    fs.appendFileSync(file,JSON.stringify(record)+'\n','utf8');
    this.lastHashByFile.set(file,record.recordHash);
    return clone(record);
  }

  list(identity,siteKey){
    const file=this._file(identity,siteKey);
    this.verifyFile(file);
    return this._readRows(file).map(clone);
  }

  stats(){
    let files=0,records=0;
    if(fs.existsSync(this.baseDir)){
      const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else if(entry.isFile()&&entry.name==='evidence.jsonl'){files++;records+=this.verifyFile(full).count;}}};
      walk(this.baseDir);
    }
    return {files,records,root:this.baseDir};
  }
}

module.exports={EvidenceStore,hashRecord,safeSegment};
