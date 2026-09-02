
'use strict';

class ExtensionRegistry {
  constructor() {
    this.items=new Map();
    this.socketToId=new WeakMap();
    this.selectedId=null;
  }

  register(extensionId,ws,meta={}) {
    extensionId=String(extensionId||'').trim();
    if(!extensionId) throw new Error('extension_id_required');

    const existing=this.items.get(extensionId);
    if(existing?.ws && existing.ws!==ws) {
      try { existing.ws.close(4001,'replaced_by_reconnect'); } catch {}
    }

    const tabs=new Map();
    for(const t of meta.tabs||[]) {
      if(Number.isInteger(Number(t.id))) tabs.set(Number(t.id),{...t,id:Number(t.id)});
    }

    const item={
      extensionId,
      ws,
      online:true,
      connectedAt:Date.now(),
      lastSeenAt:Date.now(),
      protocolVersion:meta.protocolVersion||null,
      extensionVersion:meta.extensionVersion||null,
      runtimeExtensionId:meta.runtimeExtensionId||null,
      tabs,
      activeTabId:[...tabs.values()].find(t=>t.active)?.id ?? null
    };

    this.items.set(extensionId,item);
    this.socketToId.set(ws,extensionId);

    if(!this.selectedId) this.selectedId=extensionId;
    return item;
  }

  unregisterSocket(ws) {
    const id=this.socketToId.get(ws);
    if(!id) return null;
    const item=this.items.get(id);
    if(item?.ws===ws) {
      item.online=false;
      item.ws=null;
      item.lastSeenAt=Date.now();
    }
    return id;
  }

  bySocket(ws) {
    const id=this.socketToId.get(ws);
    return id ? this.items.get(id) || null : null;
  }

  get(id=null) {
    const target=id || this.selectedId;
    if(!target) return null;
    return this.items.get(String(target)) || null;
  }

  require(id=null) {
    const item=this.get(id);
    if(!item) throw new Error(`extension_not_found:${id||this.selectedId||''}`);
    if(!item.online || !item.ws) throw new Error(`extension_offline:${item.extensionId}`);
    return item;
  }

  select(id) {
    const item=this.get(id);
    if(!item) throw new Error(`extension_not_found:${id}`);
    this.selectedId=item.extensionId;
    return item;
  }

  touch(id) {
    const item=this.get(id);
    if(item) item.lastSeenAt=Date.now();
  }

  updateTabs(id,tabs) {
    const item=this.get(id);
    if(!item) return;
    item.tabs.clear();
    for(const t of tabs||[]) {
      if(Number.isInteger(Number(t.id))) item.tabs.set(Number(t.id),{...t,id:Number(t.id)});
    }
    item.activeTabId=[...item.tabs.values()].find(t=>t.active)?.id ?? item.activeTabId;
  }

  updateTab(id,tabId,patch) {
    const item=this.get(id);
    if(!item) return;
    tabId=Number(tabId);
    const current=item.tabs.get(tabId)||{id:tabId};
    item.tabs.set(tabId,{...current,...patch,id:tabId});
    if(patch?.active===true) {
      for(const [k,t] of item.tabs.entries()) item.tabs.set(k,{...t,active:k===tabId});
      item.activeTabId=tabId;
    }
  }

  activateTab(id,tabId,patch={}) {
    this.updateTab(id,tabId,{...patch,active:true});
  }

  removeTab(id,tabId) {
    const item=this.get(id);
    if(!item) return;
    item.tabs.delete(Number(tabId));
    if(item.activeTabId===Number(tabId)) item.activeTabId=null;
  }

  list() {
    return [...this.items.values()]
      .map(x=>({
        extensionId:x.extensionId,
        online:x.online,
        selected:x.extensionId===this.selectedId,
        connectedAt:x.connectedAt,
        lastSeenAt:x.lastSeenAt,
        protocolVersion:x.protocolVersion,
        extensionVersion:x.extensionVersion,
        tabCount:x.tabs.size,
        activeTabId:x.activeTabId
      }))
      .sort((a,b)=>String(a.extensionId).localeCompare(String(b.extensionId),'en'));
  }
}

module.exports={ExtensionRegistry};
