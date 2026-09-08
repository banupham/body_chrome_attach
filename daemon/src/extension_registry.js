'use strict';

class ExtensionRegistry {
  constructor() {
    this.items=new Map();
    this.socketToId=new WeakMap();
    this.socketIds=new WeakMap();
    this.socketSequence=0;
    this.selectedId=null;
  }

  _onlineItems() {
    return [...this.items.values()]
      .filter(x=>x.online===true && x.ws)
      .sort((a,b)=>String(a.extensionId).localeCompare(String(b.extensionId),'en'));
  }

  _reconcileSelection() {
    const selected=this.selectedId?this.items.get(this.selectedId):null;
    if(selected?.online===true && selected.ws) return selected;
    const online=this._onlineItems();
    this.selectedId=online.length===1?online[0].extensionId:null;
    return this.selectedId?this.items.get(this.selectedId):null;
  }

  register(extensionId,ws,meta={}) {
    extensionId=String(extensionId||'').trim();
    if(!extensionId) throw new Error('extension_id_required');

    const existing=this.items.get(extensionId);
    const socketId=++this.socketSequence;
    this.socketIds.set(ws,socketId);
    const previousSocketId=existing?.ws?(this.socketIds.get(existing.ws)||null):null;
    const replacing=Boolean(existing?.ws && existing.ws!==ws);
    console.log(`[WS-REGISTRY] register ext=${extensionId.slice(0,8)} socket=${socketId} replacing=${replacing} previous=${previousSocketId??'none'}`);
    if(replacing) {
      try { existing.ws.close(4001,'replaced_by_reconnect'); } catch {}
    }

    const tabs=new Map();
    for(const t of meta.tabs||[]) {
      if(Number.isInteger(Number(t.id))) tabs.set(Number(t.id),{...t,id:Number(t.id)});
    }

    const item={
      companyId:meta.companyId||existing?.companyId||null,
      deviceId:meta.deviceId||existing?.deviceId||null,
      browserInstanceId:meta.browserInstanceId||existing?.browserInstanceId||null,
      extensionInstanceId:extensionId,
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

    if(this.selectedId===extensionId) return item;
    this._reconcileSelection();
    return item;
  }

  unregisterSocket(ws) {
    const socketId=this.socketIds.get(ws)||null;
    const id=this.socketToId.get(ws);
    if(!id) {
      console.log(`[WS-REGISTRY] unregister-unmapped socket=${socketId??'unknown'}`);
      return null;
    }
    this.socketToId.delete(ws);
    const item=this.items.get(id);
    const currentSocketId=item?.ws?(this.socketIds.get(item.ws)||null):null;
    if(!item || item.ws!==ws) {
      console.log(`[WS-REGISTRY] stale-unregister ext=${String(id).slice(0,8)} socket=${socketId??'unknown'} current=${currentSocketId??'none'}`);
      return null;
    }
    item.online=false;
    item.ws=null;
    item.lastSeenAt=Date.now();
    if(this.selectedId===id) this.selectedId=null;
    this._reconcileSelection();
    console.log(`[WS-REGISTRY] unregister-current ext=${String(id).slice(0,8)} socket=${socketId??'unknown'}`);
    return id;
  }

  bySocket(ws) {
    const id=this.socketToId.get(ws);
    if(!id)return null;
    const item=this.items.get(id)||null;
    return item?.ws===ws?item:null;
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

  resolveRef(ref,{onlineOnly=true}={}) {
    const value=String(ref??'').trim();
    if(!value) throw new Error('extension_ref_required');
    const online=this._onlineItems();
    const pool=onlineOnly?online:[...this.items.values()].sort((a,b)=>String(a.extensionId).localeCompare(String(b.extensionId),'en'));

    if(/^\d+$/.test(value)) {
      const index=Number(value);
      const item=online[index-1]||null;
      if(!item) throw new Error(`extension_index_not_found:${value}`);
      return item;
    }

    const exact=this.items.get(value)||null;
    if(exact) {
      if(onlineOnly && (!exact.online || !exact.ws)) throw new Error(`extension_offline:${exact.extensionId}`);
      return exact;
    }

    const normalized=value.toLowerCase();
    const matches=pool.filter(item=>String(item.extensionId).toLowerCase().startsWith(normalized));
    if(matches.length===1) return matches[0];
    if(matches.length>1) throw new Error(`extension_ref_ambiguous:${value}`);
    throw new Error(`extension_not_found:${value}`);
  }

  select(ref) {
    const item=this.resolveRef(ref,{onlineOnly:true});
    this.selectedId=item.extensionId;
    return item;
  }

  cycle(direction=1) {
    const online=this._onlineItems();
    if(!online.length) throw new Error('no_online_extensions');
    const step=Number(direction)<0?-1:1;
    let index=online.findIndex(x=>x.extensionId===this.selectedId);
    if(index<0) index=step>0?-1:0;
    index=(index+step+online.length)%online.length;
    this.selectedId=online[index].extensionId;
    return online[index];
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

  identity(id=null){
    const item=this.get(id);
    if(!item)return null;
    return {
      companyId:item.companyId,
      deviceId:item.deviceId,
      browserInstanceId:item.browserInstanceId,
      extensionInstanceId:item.extensionInstanceId,
      runtimeExtensionId:item.runtimeExtensionId
    };
  }

  list() {
    const online=this._onlineItems();
    const indexById=new Map(online.map((item,index)=>[item.extensionId,index+1]));
    return [...this.items.values()]
      .map(x=>({
        index:indexById.get(x.extensionId)||null,
        shortId:String(x.extensionId).slice(0,8),
        companyId:x.companyId,
        deviceId:x.deviceId,
        browserInstanceId:x.browserInstanceId,
        extensionInstanceId:x.extensionInstanceId,
        extensionId:x.extensionId,
        online:x.online,
        selected:x.extensionId===this.selectedId,
        connectedAt:x.connectedAt,
        lastSeenAt:x.lastSeenAt,
        protocolVersion:x.protocolVersion,
        extensionVersion:x.extensionVersion,
        runtimeExtensionId:x.runtimeExtensionId,
        tabCount:x.tabs.size,
        activeTabId:x.activeTabId
      }))
      .sort((a,b)=>String(a.extensionId).localeCompare(String(b.extensionId),'en'));
  }
}

module.exports={ExtensionRegistry};
