'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {ExtensionRegistry}=require('./src/extension_registry');
const {DebugCommandAdapter,createCommandAccumulator,normalizeRawJsonCommand,parseTargetedCommand}=require('./src/debug_command_adapter');

function socket(){return {close(){}};}
function register(registry,id){return registry.register(id,socket(),{browserInstanceId:`browser-${id}`,tabs:[{id:1,active:true}]});}

test('extension refs support online index, unique prefix, full id and reject ambiguous refs',()=>{
  const registry=new ExtensionRegistry();
  register(registry,'abcdef11-1111');
  register(registry,'abcdef22-2222');
  register(registry,'12345678-3333');

  const list=registry.list();
  const target=list.find(x=>x.extensionId==='abcdef11-1111');
  assert.ok(Number.isInteger(target.index));
  assert.equal(registry.resolveRef(String(target.index)).extensionId,target.extensionId);
  assert.equal(registry.resolveRef('abcdef1').extensionId,'abcdef11-1111');
  assert.equal(registry.resolveRef('abcdef22-2222').extensionId,'abcdef22-2222');
  assert.throws(()=>registry.resolveRef('abcdef'),/extension_ref_ambiguous/);
  assert.throws(()=>registry.resolveRef('99'),/extension_index_not_found/);
});

test('selected disconnect auto-selects only a single remaining online extension',()=>{
  const registry=new ExtensionRegistry();
  const a=register(registry,'ext-a');
  const b=register(registry,'ext-b');
  assert.equal(registry.selectedId,'ext-a');

  registry.select('ext-b');
  registry.unregisterSocket(b.ws);
  assert.equal(registry.selectedId,'ext-a');

  const b2=register(registry,'ext-b');
  const c=register(registry,'ext-c');
  registry.select('ext-a');
  registry.unregisterSocket(a.ws);
  assert.equal(registry.selectedId,null);
  assert.throws(()=>registry.require(),/extension_not_found/);

  registry.select('ext-c');
  registry.unregisterSocket(c.ws);
  assert.equal(registry.selectedId,'ext-b');
  assert.equal(registry.require().extensionId,'ext-b');
  registry.unregisterSocket(b2.ws);
  assert.equal(registry.selectedId,null);
});

test('next and prev cycle only online extensions',()=>{
  const registry=new ExtensionRegistry();
  register(registry,'ext-a');
  const b=register(registry,'ext-b');
  register(registry,'ext-c');
  registry.select('ext-a');
  assert.equal(registry.cycle(1).extensionId,'ext-b');
  assert.equal(registry.cycle(1).extensionId,'ext-c');
  assert.equal(registry.cycle(-1).extensionId,'ext-b');
  registry.unregisterSocket(b.ws);
  assert.notEqual(registry.cycle(1).extensionId,'ext-b');
});

test('debug adapter supports explicit target without permanently changing selection',async()=>{
  const registry=new ExtensionRegistry();
  register(registry,'alpha-1111');
  register(registry,'beta-2222');
  registry.select('alpha-1111');
  const calls=[];
  const runtime={registry};
  const router={
    async runCommand(command,options){calls.push({command,selected:registry.selectedId,options});return {command,selected:registry.selectedId};}
  };
  const adapter=new DebugCommandAdapter(runtime,router);

  const prefixed=await adapter.run('@beta status',{assertControl:()=>{}});
  assert.equal(prefixed.selected,'beta-2222');
  assert.equal(registry.selectedId,'alpha-1111');

  const suffixed=await adapter.run('status --ext=beta');
  assert.equal(suffixed.selected,'beta-2222');
  assert.equal(registry.selectedId,'alpha-1111');

  const use=await adapter.run('use beta');
  assert.equal(use.selectedExtensionId,'beta-2222');
  assert.equal(registry.selectedId,'beta-2222');
  assert.equal((await adapter.run('prev')).selectedExtensionId,'alpha-1111');
  assert.equal((await adapter.run('next')).selectedExtensionId,'beta-2222');

  const raw=await adapter.run(JSON.stringify({type:'pressKey',key:'Enter'}));
  assert.equal(raw.command,'intent {"type":"pressKey","key":"Enter"}');
  assert.ok(calls.length>=3);
});

test('target syntax and raw/multiline JSON parsing are bounded and deterministic',()=>{
  assert.deepEqual(parseTargetedCommand('@abc click 1 2'),{targetRef:'abc',command:'click 1 2'});
  assert.deepEqual(parseTargetedCommand('click 1 2 --ext=abc'),{targetRef:'abc',command:'click 1 2'});
  assert.throws(()=>parseTargetedCommand('@abc click 1 2 --ext=def'),/extension_target_duplicated/);
  assert.match(normalizeRawJsonCommand('{"intent":{"type":"pressKey","key":"Enter"}}'),/^intent /);

  const accumulator=createCommandAccumulator({maxBytes:1024});
  let part=accumulator.feed('intent {');
  assert.equal(part.ready,false);
  part=accumulator.feed('"type":"pressKey",');
  assert.equal(part.ready,false);
  part=accumulator.feed('"key":"Enter"}');
  assert.equal(part.ready,true);
  assert.match(part.command,/pressKey/);
  assert.equal(accumulator.waiting,false);
});
