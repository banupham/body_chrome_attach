'use strict';

function codedError(code,message=code){const error=new Error(message);error.code=code;return error;}
function clean(value){return String(value??'').trim();}

class GuardianAuthorityGate{
  constructor({now=()=>Date.now(),defaultTtlMs=30000}={}){
    this.now=now;
    this.defaultTtlMs=Math.max(1000,Number(defaultTtlMs)||30000);
    this.socket=null;
    this.guardian=null;
    this.grants=new Map();
  }

  attach(ws,{guardianId='guardian',connectedAt=this.now()}={}){
    if(!ws)throw codedError('guardian_socket_required');
    if(this.socket&&this.socket!==ws)throw codedError('guardian_authority_already_attached');
    this.socket=ws;
    this.guardian={guardianId:clean(guardianId)||'guardian',connectedAt:Number(connectedAt)||this.now()};
    return this.status();
  }

  detach(ws){
    if(this.socket!==ws)return false;
    this.socket=null;
    this.guardian=null;
    this.grants.clear();
    return true;
  }

  setGrant(input={}){
    if(!this.socket)throw codedError('guardian_authority_not_attached');
    const browserInstanceId=clean(input.browserInstanceId);
    if(!browserInstanceId)throw codedError('guardian_browser_required');
    const allowed=input.allowed===true;
    const issuedAt=this.now();
    const explicitExpiry=Number(input.expiresAt);
    const ttl=Math.max(1000,Number(input.ttlMs)||this.defaultTtlMs);
    const expiresAt=Number.isFinite(explicitExpiry)&&explicitExpiry>issuedAt?explicitExpiry:issuedAt+ttl;
    const row={browserInstanceId,allowed,leaseId:clean(input.leaseId)||null,issuedAt,expiresAt,authority:'guardian'};
    this.grants.set(browserInstanceId,row);
    return {...row};
  }

  revoke(browserInstanceId){
    const id=clean(browserInstanceId);
    if(!id)throw codedError('guardian_browser_required');
    return this.grants.delete(id);
  }

  authorization(browserInstanceId){
    const id=clean(browserInstanceId);
    if(!id)return {allowed:false,code:'guardian_browser_required',browserInstanceId:null};
    if(!this.socket)return {allowed:false,code:'guardian_authority_not_attached',browserInstanceId:id};
    const row=this.grants.get(id)||null;
    if(!row)return {allowed:false,code:'guardian_grant_missing',browserInstanceId:id};
    if(Number(row.expiresAt)<=this.now()){
      this.grants.delete(id);
      return {allowed:false,code:'guardian_grant_expired',browserInstanceId:id};
    }
    if(row.allowed!==true)return {allowed:false,code:'guardian_cdp_blocked',browserInstanceId:id,leaseId:row.leaseId,expiresAt:row.expiresAt};
    return {allowed:true,code:'guardian_cdp_allowed',browserInstanceId:id,leaseId:row.leaseId,expiresAt:row.expiresAt};
  }

  assertAllowed(browserInstanceId){
    const result=this.authorization(browserInstanceId);
    if(result.allowed===true)return result;
    throw codedError(result.code,result.code+':'+(result.browserInstanceId||'unknown'));
  }

  status(){
    return {attached:Boolean(this.socket),guardian:this.guardian?{...this.guardian}:null,activeGrantCount:this.grants.size};
  }
}

module.exports={GuardianAuthorityGate,codedError};
