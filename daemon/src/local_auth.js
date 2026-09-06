'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

const PAIRING_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_PAIRING_TTL_MS=120000;
const DEFAULT_PAIRING_ATTEMPTS=8;

function token(){return crypto.randomBytes(32).toString('hex');}
function digest(value){return crypto.createHash('sha256').update(String(value||'')).digest('hex');}
function secureEqualHex(a,b){const aa=Buffer.from(String(a||''),'hex'),bb=Buffer.from(String(b||''),'hex');return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);}
function normalizePairingCode(value){return String(value||'').toUpperCase().replace(/[^A-Z2-9]/g,'');}
function makePairingCode(randomBytesImpl=crypto.randomBytes){const bytes=randomBytesImpl(8);let out='';for(let i=0;i<8;i++)out+=PAIRING_ALPHABET[bytes[i]&31];return `${out.slice(0,4)}-${out.slice(4)}`;}

class LocalAuth{
  constructor(baseDir,{now=()=>Date.now(),randomBytes=crypto.randomBytes}={}){
    this.dir=path.join(baseDir,'profiles','.auth');
    this.debugClientPath=path.join(this.dir,'client.token');
    this.brainPath=path.join(this.dir,'brain.token');
    this.extensionsPath=path.join(this.dir,'extensions.json');
    this.now=typeof now==='function'?now:()=>Date.now();
    this.randomBytes=typeof randomBytes==='function'?randomBytes:crypto.randomBytes;
    this.pairingWindow=null;
    fs.mkdirSync(this.dir,{recursive:true});
    this.debugClientSecret=this._loadOrCreateSecret(this.debugClientPath);
    this.brainSecret=this._loadOrCreateSecret(this.brainPath);
    this.clientPath=this.debugClientPath;
    this.clientSecret=this.debugClientSecret;
    this.extensions=this._loadExtensions();
  }

  _writePrivate(file,text){fs.writeFileSync(file,text,{encoding:'utf8',mode:0o600});try{fs.chmodSync(file,0o600);}catch{}}
  _loadOrCreateSecret(file){if(fs.existsSync(file))return fs.readFileSync(file,'utf8').trim();const value=token();this._writePrivate(file,value+'\n');return value;}
  _loadExtensions(){try{return JSON.parse(fs.readFileSync(this.extensionsPath,'utf8'));}catch{return {};}}
  _saveExtensions(){this._writePrivate(this.extensionsPath,JSON.stringify(this.extensions,null,2)+'\n');}
  authenticateDebugClient(value){return secureEqualHex(digest(value),digest(this.debugClientSecret));}
  authenticateClient(value){return this.authenticateDebugClient(value);}
  authenticateBrain(value){return secureEqualHex(digest(value),digest(this.brainSecret));}

  _activePairingWindow(){
    const current=this.pairingWindow;
    if(!current)return null;
    if(this.now()>=current.expiresAtMs||current.remainingAttempts<=0){this.pairingWindow=null;return null;}
    return current;
  }

  openPairingWindow({ttlMs=DEFAULT_PAIRING_TTL_MS,maxAttempts=DEFAULT_PAIRING_ATTEMPTS}={}){
    const ttl=Math.max(30000,Math.min(300000,Number(ttlMs)||DEFAULT_PAIRING_TTL_MS));
    const attempts=Math.max(3,Math.min(20,Math.floor(Number(maxAttempts)||DEFAULT_PAIRING_ATTEMPTS)));
    const openedAtMs=this.now(),code=makePairingCode(this.randomBytes),normalized=normalizePairingCode(code);
    this.pairingWindow={codeHash:digest(normalized),openedAtMs,expiresAtMs:openedAtMs+ttl,maxAttempts:attempts,remainingAttempts:attempts,attemptedCodeHashes:new Set()};
    return {active:true,code,openedAt:new Date(openedAtMs).toISOString(),expiresAt:new Date(openedAtMs+ttl).toISOString(),ttlMs:ttl,remainingAttempts:attempts};
  }

  closePairingWindow(){const wasActive=Boolean(this._activePairingWindow());this.pairingWindow=null;return {closed:wasActive,...this.pairingStatus()};}

  pairingStatus(){
    const current=this._activePairingWindow();
    if(!current)return {active:false,expiresAt:null,remainingAttempts:0};
    return {active:true,openedAt:new Date(current.openedAtMs).toISOString(),expiresAt:new Date(current.expiresAtMs).toISOString(),remainingAttempts:current.remainingAttempts,maxAttempts:current.maxAttempts};
  }

  _authorizeFirstPair(presented){
    const current=this._activePairingWindow();
    if(!current)return {ok:false,error:'extension_pairing_required'};
    const normalized=normalizePairingCode(presented);
    if(!normalized)return {ok:false,error:'extension_pairing_code_required'};
    const presentedHash=digest(normalized);
    if(!secureEqualHex(presentedHash,current.codeHash)){
      if(!current.attemptedCodeHashes.has(presentedHash)){
        current.attemptedCodeHashes.add(presentedHash);
        current.remainingAttempts=Math.max(0,current.remainingAttempts-1);
      }
      if(current.remainingAttempts<=0)this.pairingWindow=null;
      return {ok:false,error:'extension_pairing_code_invalid'};
    }
    this.pairingWindow=null;
    return {ok:true};
  }

  authenticateExtension({extensionId,browserInstanceId=null,runtimeExtensionId,token:presented,origin}){
    const instance=String(extensionId||'').trim(),browser=String(browserInstanceId||'').trim(),runtime=String(runtimeExtensionId||'').trim();
    if(!instance||!runtime)return {ok:false,error:'extension_identity_required'};
    const expectedOrigin=`chrome-extension://${runtime}`;
    if(String(origin||'').replace(/\/$/,'')!==expectedOrigin)return {ok:false,error:'extension_origin_mismatch'};
    const record=this.extensions[instance];
    if(record){
      if(record.runtimeExtensionId!==runtime)return {ok:false,error:'extension_runtime_id_mismatch'};
      if(record.browserInstanceId&&browser&&record.browserInstanceId!==browser)return {ok:false,error:'extension_browser_id_mismatch'};
      if(!presented||!secureEqualHex(digest(presented),record.tokenHash))return {ok:false,error:'extension_token_invalid'};
      if(browser&&!record.browserInstanceId){record.browserInstanceId=browser;this._saveExtensions();}
      return {ok:true,paired:false};
    }
    const firstPair=this._authorizeFirstPair(presented);
    if(!firstPair.ok)return firstPair;
    const pairedToken=token();
    this.extensions[instance]={runtimeExtensionId:runtime,browserInstanceId:browser||null,tokenHash:digest(pairedToken),pairedAt:new Date(this.now()).toISOString()};
    this._saveExtensions();
    return {ok:true,paired:true,pairedToken};
  }

  forgetExtension(extensionId){
    const id=String(extensionId||'').trim();
    if(!id||!this.extensions[id])return false;
    delete this.extensions[id];
    this._saveExtensions();
    return true;
  }

  status(){return {debugClientTokenPath:this.debugClientPath,brainTokenPath:this.brainPath,pairedExtensions:Object.keys(this.extensions).length,pairing:this.pairingStatus()};}
}

module.exports={LocalAuth,digest,secureEqualHex,normalizePairingCode,makePairingCode,DEFAULT_PAIRING_TTL_MS,DEFAULT_PAIRING_ATTEMPTS};
