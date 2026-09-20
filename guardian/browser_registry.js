'use strict';

class GuardianBrowserRegistry{
  constructor(){this.browsers=new Map();this.extensionToBrowser=new Map();}

  sync(rows=[]){
    const seen=new Set();
    for(const row of rows||[]){
      const id=String(row?.browserInstanceId||'').trim();if(!id)continue;
      seen.add(id);this.upsert(row);
    }
    for(const [id,row] of this.browsers.entries())if(!seen.has(id)&&row.online===true){row.online=false;row.state='OFFLINE';row.stateReason='body_status_absent';}
    return this.list();
  }

  upsert(input={}){
    const id=String(input.browserInstanceId||'').trim();if(!id)throw new Error('guardian_browser_id_required');
    const current=this.browsers.get(id)||{browserInstanceId:id,tabs:new Map(),environment:{eligible:false,status:'PENDING',reasons:['NOT_EVALUATED'],evidence:[]}};
    current.extensionInstanceId=input.extensionInstanceId??current.extensionInstanceId??null;
    current.runtimeExtensionId=input.runtimeExtensionId??current.runtimeExtensionId??null;
    current.online=input.online!==false;
    const physicalState=String(input.state||'').toUpperCase();
    current.state=current.online&&['ONLINE','BUSY','HUMAN_CONTROL','ERROR'].includes(physicalState)?physicalState:(current.online?'ONLINE':'OFFLINE');
    current.stateReason=input.stateReason||current.stateReason||null;
    current.activeTabId=Number.isInteger(Number(input.activeTabId))?Number(input.activeTabId):(current.activeTabId??null);
    current.lastSeenAt=input.lastSeenAt||Date.now();
    if(Array.isArray(input.tabs)){
      current.tabs=new Map();
      for(const tab of input.tabs)if(Number.isInteger(Number(tab?.id)))current.tabs.set(Number(tab.id),{...tab,id:Number(tab.id)});
    }
    this.browsers.set(id,current);
    if(current.extensionInstanceId)this.extensionToBrowser.set(String(current.extensionInstanceId),id);
    return this.public(current);
  }

  browserForExtension(extensionId){
    const id=this.extensionToBrowser.get(String(extensionId||''));return id?this.browsers.get(id)||null:null;
  }

  require(browserInstanceId){
    const id=String(browserInstanceId||'').trim(),row=this.browsers.get(id);
    if(!row)throw new Error('guardian_browser_not_found:'+id);
    return row;
  }

  setEnvironment(browserInstanceId,environment,reason=null){
    const row=this.require(browserInstanceId);
    row.environment={...environment,reasons:Array.isArray(environment?.reasons)?environment.reasons.map(String):[],evidence:Array.isArray(environment?.evidence)?environment.evidence:[]};
    row.state=row.online?'ONLINE':'OFFLINE';
    row.stateReason=reason||null;
    row.lastSeenAt=Date.now();
    return this.public(row);
  }

  setState(browserInstanceId,state,reason=null){
    const row=this.require(browserInstanceId);
    row.state=String(state||row.state||'ONLINE').toUpperCase();
    row.stateReason=reason||null;
    row.lastSeenAt=Date.now();
    return this.public(row);
  }

  markOffline(browserInstanceId){
    const row=this.require(browserInstanceId);
    row.online=false;row.state='OFFLINE';row.stateReason='body_offline';row.lastSeenAt=Date.now();
    return this.public(row);
  }

  public(row){
    return {
      browserInstanceId:row.browserInstanceId,
      extensionInstanceId:row.extensionInstanceId||null,
      runtimeExtensionId:row.runtimeExtensionId||null,
      online:row.online===true,
      state:row.state||'UNKNOWN',
      stateReason:row.stateReason||null,
      activeTabId:Number.isInteger(Number(row.activeTabId))?Number(row.activeTabId):null,
      tabs:[...(row.tabs?.values?.()||[])].map(tab=>({...tab})),
      environment:row.environment?JSON.parse(JSON.stringify(row.environment)):null,
      lastSeenAt:row.lastSeenAt||null
    };
  }

  list(){return [...this.browsers.values()].map(row=>this.public(row)).sort((a,b)=>a.browserInstanceId.localeCompare(b.browserInstanceId,'en'));}
}

module.exports={GuardianBrowserRegistry};
