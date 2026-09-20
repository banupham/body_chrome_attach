'use strict';

function clean(value){return String(value??'').trim();}

class GuardianProtectionState{
  constructor(){
    this.socket=null;
    this.guardian=null;
    this.browsers=new Map();
  }

  attach(ws,{guardianId='guardian',connectedAt=Date.now()}={}){
    if(!ws)throw new Error('guardian_socket_required');
    if(this.socket&&this.socket!==ws)throw new Error('guardian_authority_already_attached');
    this.socket=ws;
    this.guardian={guardianId:clean(guardianId)||'guardian',connectedAt:Number(connectedAt)||Date.now()};
    return this.status();
  }

  detach(ws){
    if(this.socket!==ws)return false;
    this.socket=null;
    this.guardian=null;
    // Fail closed only for HUMAN LEARNING. Existing Brain tasks are untouched.
    for(const row of this.browsers.values()){
      row.browserValid=null;
      row.browserReasons=['GUARDIAN_DETACHED'];
      row.learningAllowed=false;
      row.learningReasons=['GUARDIAN_DETACHED'];
      row.updatedAt=Date.now();
    }
    return true;
  }

  _row(browserInstanceId){
    const id=clean(browserInstanceId);
    if(!id)throw new Error('guardian_browser_required');
    let row=this.browsers.get(id);
    if(!row){
      row={
        browserInstanceId:id,
        browserValid:null,
        browserReasons:['NOT_EVALUATED'],
        learningAllowed:false,
        learningReasons:['NOT_EVALUATED'],
        updatedAt:Date.now()
      };
      this.browsers.set(id,row);
    }
    return row;
  }

  setBrowserVerdict({browserInstanceId,valid,reasons=[]}={}){
    if(!this.socket)throw new Error('guardian_authority_not_attached');
    const row=this._row(browserInstanceId);
    row.browserValid=valid===true;
    row.browserReasons=Array.isArray(reasons)?reasons.map(String):[];
    row.updatedAt=Date.now();
    if(row.browserValid!==true){
      row.learningAllowed=false;
      row.learningReasons=['BROWSER_INVALID',...row.browserReasons];
    }
    return {...row};
  }

  setLearning({browserInstanceId,allowed,reasons=[]}={}){
    if(!this.socket)throw new Error('guardian_authority_not_attached');
    const row=this._row(browserInstanceId);
    row.learningAllowed=row.browserValid===true&&allowed===true;
    row.learningReasons=Array.isArray(reasons)?reasons.map(String):[];
    row.updatedAt=Date.now();
    return {...row};
  }

  browserVerdict(browserInstanceId){
    const id=clean(browserInstanceId),row=this.browsers.get(id);
    if(!row)return {browserInstanceId:id,browserValid:null,reasons:['NOT_EVALUATED']};
    return {browserInstanceId:id,browserValid:row.browserValid,reasons:[...row.browserReasons],updatedAt:row.updatedAt};
  }

  learningAllowed(browserInstanceId){
    const row=this.browsers.get(clean(browserInstanceId));
    return Boolean(this.socket&&row?.browserValid===true&&row?.learningAllowed===true);
  }

  clearBrowser(browserInstanceId){return this.browsers.delete(clean(browserInstanceId));}

  status(){
    return {
      attached:Boolean(this.socket),
      guardian:this.guardian?{...this.guardian}:null,
      browsers:Object.fromEntries([...this.browsers.entries()].map(([id,row])=>[id,{...row,browserReasons:[...row.browserReasons],learningReasons:[...row.learningReasons]}]))
    };
  }
}

module.exports={GuardianProtectionState};
