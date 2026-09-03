'use strict';

const BROWSER_STATES=new Set(['REGISTERED','OFFLINE','ENV_CHECK','ACTIVE','BUSY','HUMAN_CONTROL','QUARANTINED','ERROR']);

class BrowserManager{
  constructor(identityStore){
    if(!identityStore)throw new Error('browser_manager_identity_required');
    this.identity=identityStore;
    this.browsers=new Map();
    this.extensionToBrowser=new Map();
    for(const registration of identityStore.browserRegistrations())this._hydrate(registration);
  }

  _hydrate(registration){
    const browserInstanceId=String(registration.browserInstanceId||'').trim();
    if(!browserInstanceId)return null;
    const current=this.browsers.get(browserInstanceId)||null;
    const row={
      companyId:registration.companyId||this.identity.snapshot().companyId,
      deviceId:registration.deviceId||this.identity.snapshot().deviceId,
      browserInstanceId,
      extensionInstanceId:registration.extensionInstanceId||current?.extensionInstanceId||null,
      runtimeExtensionId:registration.runtimeExtensionId||current?.runtimeExtensionId||null,
      online:false,
      state:current?.state||'OFFLINE',
      stateReason:current?.stateReason||'not_connected',
      connectedAt:current?.connectedAt||null,
      lastSeenAt:current?.lastSeenAt||registration.lastSeenAt||null,
      activeTabId:current?.activeTabId||null,
      tabs:current?.tabs||new Map(),
      environment:{eligible:null,status:'PENDING_PHASE4',evidence:[]}
    };
    this.browsers.set(browserInstanceId,row);
    if(row.extensionInstanceId)this.extensionToBrowser.set(row.extensionInstanceId,browserInstanceId);
    return row;
  }

  registerExtension(item){
    const browserId=String(item?.browserInstanceId||'').trim();
    const extensionId=String(item?.extensionInstanceId||item?.extensionId||'').trim();
    if(!browserId||!extensionId)throw new Error('browser_manager_identity_required');
    const identity=this.identity.identityChain(browserId);
    if(!identity)throw new Error(`browser_identity_not_registered:${browserId}`);
    if(identity.extensionInstanceId!==extensionId)throw new Error(`browser_manager_extension_mismatch:${browserId}`);
    const previousBrowser=this.extensionToBrowser.get(extensionId);
    if(previousBrowser&&previousBrowser!==browserId)throw new Error(`browser_manager_extension_already_bound:${extensionId}`);

    const row=this.browsers.get(browserId)||this._hydrate(identity);
    row.extensionInstanceId=extensionId;
    row.runtimeExtensionId=item.runtimeExtensionId||identity.runtimeExtensionId;
    row.online=true;
    row.state='ACTIVE';
    row.stateReason='extension_online';
    row.connectedAt=item.connectedAt||Date.now();
    row.lastSeenAt=item.lastSeenAt||Date.now();
    row.tabs=new Map();
    for(const tab of item.tabs?.values?.()||[]){
      if(Number.isInteger(Number(tab.id)))row.tabs.set(Number(tab.id),{...tab,id:Number(tab.id)});
    }
    row.activeTabId=Number.isInteger(Number(item.activeTabId))?Number(item.activeTabId):([...row.tabs.values()].find(t=>t.active)?.id??null);
    this.extensionToBrowser.set(extensionId,browserId);
    return this.public(row);
  }

  browserForExtension(extensionId){
    const browserId=this.extensionToBrowser.get(String(extensionId||''));
    return browserId?this.browsers.get(browserId)||null:null;
  }

  updateTabsByExtension(extensionId,tabs){
    const row=this.browserForExtension(extensionId);
    if(!row)return null;
    row.tabs.clear();
    for(const tab of tabs||[])if(Number.isInteger(Number(tab.id)))row.tabs.set(Number(tab.id),{...tab,id:Number(tab.id)});
    row.activeTabId=[...row.tabs.values()].find(t=>t.active)?.id??row.activeTabId;
    row.lastSeenAt=Date.now();
    return this.public(row);
  }

  updateTabByExtension(extensionId,tabId,patch={}){
    const row=this.browserForExtension(extensionId);
    if(!row)return null;
    const id=Number(tabId);if(!Number.isInteger(id))return null;
    const current=row.tabs.get(id)||{id};
    row.tabs.set(id,{...current,...patch,id});
    if(patch.active===true){
      for(const [key,tab] of row.tabs.entries())row.tabs.set(key,{...tab,active:key===id});
      row.activeTabId=id;
    }
    row.lastSeenAt=Date.now();
    return this.public(row);
  }

  removeTabByExtension(extensionId,tabId){
    const row=this.browserForExtension(extensionId);if(!row)return null;
    const id=Number(tabId);row.tabs.delete(id);if(row.activeTabId===id)row.activeTabId=null;row.lastSeenAt=Date.now();
    return this.public(row);
  }

  extensionOffline(extensionId){
    const row=this.browserForExtension(extensionId);if(!row)return null;
    row.online=false;row.state='OFFLINE';row.stateReason='extension_offline';row.lastSeenAt=Date.now();
    return this.public(row);
  }

  setState(browserInstanceId,state,reason=null){
    const row=this.require(browserInstanceId);const next=String(state||'').toUpperCase();
    if(!BROWSER_STATES.has(next))throw new Error(`invalid_browser_state:${next}`);
    row.state=next;row.stateReason=reason||null;row.lastSeenAt=Date.now();
    return this.public(row);
  }

  require(browserInstanceId){
    const id=String(browserInstanceId||'').trim();const row=this.browsers.get(id);
    if(!row)throw new Error(`browser_not_found:${id}`);return row;
  }

  assertTab(browserInstanceId,tabId,{requireOnline=true}={}){
    const row=this.require(browserInstanceId);
    if(requireOnline&&!row.online)throw new Error(`browser_offline:${row.browserInstanceId}`);
    if(['QUARANTINED','ERROR'].includes(row.state))throw new Error(`browser_not_eligible:${row.browserInstanceId}:${row.state}`);
    const id=Number(tabId);if(!Number.isInteger(id))throw new Error('task_tab_id_invalid');
    const tab=row.tabs.get(id);if(!tab)throw new Error(`tab_not_in_browser:${row.browserInstanceId}:${id}`);
    return tab;
  }

  public(row){
    return {
      companyId:row.companyId,deviceId:row.deviceId,browserInstanceId:row.browserInstanceId,
      extensionInstanceId:row.extensionInstanceId,runtimeExtensionId:row.runtimeExtensionId,
      online:row.online,state:row.state,stateReason:row.stateReason,connectedAt:row.connectedAt,lastSeenAt:row.lastSeenAt,
      activeTabId:row.activeTabId,tabCount:row.tabs.size,tabs:[...row.tabs.values()].map(t=>({...t})),environment:{...row.environment,evidence:[...(row.environment?.evidence||[])]}
    };
  }

  list(){return [...this.browsers.values()].map(row=>this.public(row)).sort((a,b)=>a.browserInstanceId.localeCompare(b.browserInstanceId,'en'));}
}

module.exports={BrowserManager,BROWSER_STATES};
