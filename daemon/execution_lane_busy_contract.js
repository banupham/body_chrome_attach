'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {ExecutionLane}=require('./src/execution_lane');

function deferred(){
  let resolve,reject;
  const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});
  return {promise,resolve,reject};
}

function tick(){return new Promise(resolve=>setImmediate(resolve));}

test('lane reports busy from first enqueue until final queued work finishes',async()=>{
  const snapshots=[];
  const lane=new ExecutionLane({onStateChange:(scope,state)=>snapshots.push({scope,...state})});
  const firstGate=deferred();
  const secondGate=deferred();
  const started=[];

  const first=lane.run('ext-a',{operation:'first'},async()=>{
    started.push('first');
    await firstGate.promise;
    return 'one';
  });
  const second=lane.run('ext-a',{operation:'second'},async()=>{
    started.push('second');
    await secondGate.promise;
    return 'two';
  });

  await tick();
  assert.deepEqual(started,['first']);
  let state=lane.status('ext-a');
  assert.equal(state.active,true);
  assert.equal(state.queued,1);
  assert.equal(state.busy,true);

  firstGate.resolve();
  assert.equal(await first,'one');
  await tick();
  assert.deepEqual(started,['first','second']);
  state=lane.status('ext-a');
  assert.equal(state.active,true);
  assert.equal(state.queued,0);
  assert.equal(state.busy,true);

  secondGate.resolve();
  assert.equal(await second,'two');
  await tick();
  state=lane.status('ext-a');
  assert.equal(state.active,false);
  assert.equal(state.queued,0);
  assert.equal(state.busy,false);

  assert.equal(snapshots[0].busy,true);
  assert.ok(snapshots.some(x=>x.active===true&&x.queued===1&&x.busy===true));
  assert.equal(snapshots.at(-1).busy,false);
});

test('failed work keeps lane busy while another item is queued and releases only after drain',async()=>{
  const snapshots=[];
  const lane=new ExecutionLane({onStateChange:(scope,state)=>snapshots.push({scope,...state})});
  const firstGate=deferred();
  const secondGate=deferred();

  const first=lane.run('ext-a',{operation:'first'},async()=>{
    await firstGate.promise;
    throw new Error('simulated_failure');
  });
  const second=lane.run('ext-a',{operation:'second'},async()=>{
    await secondGate.promise;
    return 'ok';
  });

  await tick();
  firstGate.resolve();
  await assert.rejects(first,/simulated_failure/);
  await tick();
  assert.equal(lane.status('ext-a').busy,true);
  assert.equal(lane.status('ext-a').active,true);

  secondGate.resolve();
  assert.equal(await second,'ok');
  await tick();
  assert.equal(lane.status('ext-a').busy,false);
  assert.equal(snapshots.at(-1).busy,false);
});
