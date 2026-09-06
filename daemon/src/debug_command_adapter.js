'use strict';

const POINTER_INTENTS=new Set(['click','doubleClick','move','moveTo','hover','focus','drag','scroll','scrollVertical','scrollHorizontal','type','typeText','pressKey','keyCombo']);

function structureComplete(text){
  let depth=0,started=false,inString=false,escape=false;
  for(const ch of String(text||'')){
    if(inString){
      if(escape){escape=false;continue;}
      if(ch==='\\'){escape=true;continue;}
      if(ch==='"')inString=false;
      continue;
    }
    if(ch==='"'){inString=true;continue;}
    if(ch==='{'||ch==='['){depth++;started=true;continue;}
    if(ch==='}'||ch===']'){depth--;if(depth<0)return true;}
  }
  return started && depth===0 && !inString;
}

function looksLikeStructuredCommand(text){
  const trimmed=String(text||'').trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[') || /^(strategy|intent|taskcreate)\s+[\[{]/i.test(trimmed);
}

function createCommandAccumulator({maxBytes=262144}={}){
  let buffer='';
  return {
    feed(line){
      const current=String(line??'');
      if(!buffer){
        if(!looksLikeStructuredCommand(current) || structureComplete(current)) return {ready:true,command:current,continuation:false};
        buffer=current;
        return {ready:false,command:null,continuation:true};
      }
      buffer+=`\n${current}`;
      if(Buffer.byteLength(buffer,'utf8')>maxBytes){buffer='';throw new Error(`debug_command_too_large:max_bytes=${maxBytes}`);}
      if(!structureComplete(buffer)) return {ready:false,command:null,continuation:true};
      const command=buffer;buffer='';return {ready:true,command,continuation:false};
    },
    reset(){buffer='';},
    get waiting(){return Boolean(buffer);}
  };
}

function normalizeRawJsonCommand(text){
  const trimmed=String(text||'').trim();
  if(!trimmed.startsWith('{')) return trimmed;
  let obj;
  try{obj=JSON.parse(trimmed);}catch(error){throw new Error(`invalid_debug_json:${String(error?.message||error)}`);}
  if(typeof obj?.command==='string'&&obj.command.trim()) return obj.command.trim();
  if(obj?.habitKey && Array.isArray(obj?.strategies)) return `strategy ${JSON.stringify(obj)}`;
  if(obj?.task?.habitKey && Array.isArray(obj?.task?.strategies)) return `strategy ${JSON.stringify(obj)}`;
  if(obj?.intent || POINTER_INTENTS.has(String(obj?.type||''))) return `intent ${JSON.stringify(obj)}`;
  throw new Error('debug_json_command_unrecognized:expected_strategy_or_intent');
}

function parseTargetedCommand(text){
  let command=String(text||'').trim();
  let targetRef=null;
  const prefix=command.match(/^@([^\s]+)\s+([\s\S]+)$/);
  if(prefix){targetRef=prefix[1];command=prefix[2].trim();}
  const suffix=command.match(/(?:^|\s)--ext(?:=|\s+)([^\s]+)\s*$/);
  if(suffix){
    if(targetRef)throw new Error('extension_target_duplicated');
    targetRef=suffix[1];
    command=command.slice(0,suffix.index).trim();
  }
  return {targetRef,command};
}

class DebugCommandAdapter{
  constructor(runtime,router,{updatePrompt=()=>{}}={}){
    this.runtime=runtime;
    this.router=router;
    this.updatePrompt=updatePrompt;
    this.serial=Promise.resolve();
  }

  extensionSummary(){
    const items=this.runtime.registry.list();
    const online=items.filter(x=>x.online);
    return {
      onlineCount:online.length,
      totalCount:items.length,
      selectedExtensionId:this.runtime.registry.selectedId||null,
      extensions:items.map(x=>({
        index:x.index,
        shortId:x.shortId,
        extensionId:x.extensionId,
        online:x.online,
        selected:x.selected,
        tabCount:x.tabCount,
        activeTabId:x.activeTabId,
        browserInstanceId:x.browserInstanceId,
        runtimeExtensionId:x.runtimeExtensionId,
        protocolVersion:x.protocolVersion,
        extensionVersion:x.extensionVersion
      }))
    };
  }

  helpAddon(){
    return [
      '',
      'DEBUG EXTENSIONS:',
      '  exts                              list online/offline extensions + indexes',
      '  use <index|prefix|full-id>        select an online extension',
      '  next | prev                       cycle online extensions',
      '  @<index|prefix|full-id> <cmd>     run one command on a target extension',
      '  <cmd> --ext=<ref>                 same as @<ref> without changing selection',
      '  Paste raw strategy JSON or multiline: strategy { ... }',
      '  Paste raw intent JSON or multiline:   intent { ... }'
    ].join('\n');
  }

  async _run(text,options={}){
    let {targetRef,command}=parseTargetedCommand(text);
    command=normalizeRawJsonCommand(command);
    const [name,...args]=command.split(/\s+/);

    if(name==='exts' || name==='extlist' || name==='onlineexts') return this.extensionSummary();
    if(name==='use'){
      if(!args[0])throw new Error('use_requires_extension_ref:index|prefix|full-id');
      const item=this.runtime.registry.select(args[0]);
      this.updatePrompt();
      return {selectedExtensionId:item.extensionId,shortId:item.extensionId.slice(0,8),tabCount:item.tabs.size,activeTabId:item.activeTabId,browserInstanceId:item.browserInstanceId};
    }
    if(name==='next' || name==='prev'){
      const item=this.runtime.registry.cycle(name==='next'?1:-1);
      this.updatePrompt();
      return {selectedExtensionId:item.extensionId,shortId:item.extensionId.slice(0,8),tabCount:item.tabs.size,activeTabId:item.activeTabId,browserInstanceId:item.browserInstanceId};
    }
    if(name==='help'){
      const base=await this.router.runCommand(command,options);
      return `${base}${this.helpAddon()}`;
    }

    if(!targetRef) return this.router.runCommand(command,options);

    const target=this.runtime.registry.resolveRef(targetRef,{onlineOnly:true});
    const previous=this.runtime.registry.selectedId;
    this.runtime.registry.selectedId=target.extensionId;
    try{
      return await this.router.runCommand(command,options);
    } finally {
      const old=previous?this.runtime.registry.get(previous):null;
      if(old?.online===true && old.ws) this.runtime.registry.selectedId=previous;
      else this.runtime.registry.selectedId=target.extensionId;
      this.updatePrompt();
    }
  }

  run(text,options={}){
    const work=()=>this._run(String(text||'').trim(),options);
    const result=this.serial.then(work,work);
    this.serial=result.catch(()=>{});
    return result;
  }
}

module.exports={DebugCommandAdapter,createCommandAccumulator,structureComplete,looksLikeStructuredCommand,normalizeRawJsonCommand,parseTargetedCommand};
