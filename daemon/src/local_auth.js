'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

function token(){return crypto.randomBytes(32).toString('hex');}
function digest(value){return crypto.createHash('sha256').update(String(value||'')).digest('hex');}
function secureEqualHex(a,b){const aa=Buffer.from(String(a||''),'hex'),bb=Buffer.from(String(b||''),'hex');return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);}

class LocalAuth{
  constructor(baseDir){
    this.dir=path.join(baseDir,'profiles','.auth');
    this.debugClientPath=path.join(this.dir,'client.token');
    this.brainPath=path.join(this.dir,'brain.token');
    this.extensionsPath=path.join(this.dir,'extensions.json');
    fs.mkdirSync(this.dir,{recursive:true});
    this.debugClientSecret=this._loadOrCreateSecret(this.debugClientPath);
    this.brainSecret=this._loadOrCreateSecret(this.brainPath);
    this.extensions=this._loadExtensions();
  }

  _writePrivate(file,text){fs.writeFileSync(file,text,{encoding:'utf8',mode:0o600});try{fs.chmodSync(file,0o600);}catch{}}
  _loadOrCreateSecret(file){if(fs.existsSync(file))return fs.readFileSync(file,'utf8').trim();const value=token();this._writePrivate(file,value+'\n');return value;}
  _loadExtensions(){try{return JSON.parse(fs.readFileSync(this.extensionsPath,'utf8'));}catch{return {};}}
  _saveExtensions(){this._writePrivate(this.extensionsPath,JSON.stringify(this.extensions,null,2)+'\n');}
  authenticateDebugClient(value){return secureEqualHex(digest(value),digest(this.debugClientSecret));}
  authenticateBrain(value){return secureEqualHex(digest(value),digest(this.brainSecret));}

  authenticateExtension({extensionId,runtimeExtensionId,token:presented,origin}){
    const instance=String(extensionId||'').trim(),runtime=String(runtimeExtensionId||'').trim();
    if(!instance||!runtime)return {ok:false,error:'extension_identity_required'};
    const expectedOrigin=`chrome-extension://${runtime}`;
    if(String(origin||'').replace(/\/$/,'')!==expectedOrigin)return {ok:false,error:'extension_origin_mismatch'};
    const record=this.extensions[instance];
    if(record){
      if(record.runtimeExtensionId!==runtime)return {ok:false,error:'extension_runtime_id_mismatch'};
      if(!presented||!secureEqualHex(digest(presented),record.tokenHash))return {ok:false,error:'extension_token_invalid'};
      return {ok:true,paired:false};
    }
    const pairedToken=token();
    this.extensions[instance]={runtimeExtensionId:runtime,tokenHash:digest(pairedToken),pairedAt:new Date().toISOString()};
    this._saveExtensions();
    return {ok:true,paired:true,pairedToken};
  }

  status(){
    return {
      debugClientTokenPath:this.debugClientPath,
      brainTokenPath:this.brainPath,
      pairedExtensions:Object.keys(this.extensions).length
    };
  }
}

module.exports={LocalAuth,digest,secureEqualHex};
