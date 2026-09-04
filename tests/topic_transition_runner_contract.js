'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {BrainClient,semanticArrivalReady,isGenericActionTitle,usableSeedCandidate,arrivalExpectedTitle}=require('../research/topic_transition_runner');

assert.equal(semanticArrivalReady({route:{videoId:'target1'},currentVideo:{title:'NHẠC REMIX',semanticTitle:true}},{videoId:'target1',title:'ROBLOX +1 SPEED VS GIANT'}),false,'route change alone must not accept stale previous-video metadata');
assert.equal(semanticArrivalReady({route:{videoId:'target1'},currentVideo:{title:'ROBLOX +1 SPEED VS GIANT',semanticTitle:true}},{videoId:'target1',title:'ROBLOX +1 SPEED VS GIANT'}),true);
assert.equal(semanticArrivalReady({route:{videoId:'target1'},currentVideo:{title:'ROBLOX +1 SPEED VS GIANT',semanticTitle:true}},{videoId:'target1',title:'ROBLOX +1 SPEED VS GIANT 12 phút, 10 giây'}),true,'duration-decorated candidate titles may settle to the shorter watch title');
assert.equal(arrivalExpectedTitle({title:'Xem',youtubeApi:{title:'1920x1080_Academy-EP02_EN_15s.mp4'}}),'1920x1080_Academy-EP02_EN_15s.mp4');
assert.equal(semanticArrivalReady({route:{videoId:'ad1'},currentVideo:{title:'1920x1080_Academy-EP02_EN_15s.mp4',semanticTitle:true,youtubeApi:{title:'1920x1080_Academy-EP02_EN_15s.mp4'}}},{videoId:'ad1',title:'Xem',youtubeApi:{title:'1920x1080_Academy-EP02_EN_15s.mp4'}}),true,'API-enriched canonical title must settle even when the search anchor was a CTA label');
assert.equal(isGenericActionTitle('Xem'),true);
assert.equal(isGenericActionTitle('Watch now'),true);
assert.equal(isGenericActionTitle('NHẠC REMIX TIKTOK TRIỆU VIEW'),false);
assert.equal(usableSeedCandidate({videoId:'ad1',title:'Xem',semanticTitle:true}),false,'generic CTA anchors must not become research seeds');
assert.equal(usableSeedCandidate({videoId:'music1',title:'NHẠC REMIX TIKTOK TRIỆU VIEW',semanticTitle:true}),true);

class FakeWebSocket extends EventEmitter {
  static OPEN=1;
  static CLOSED=3;
  static instances=[];
  constructor(){
    super();
    this.readyState=0;
    this.failNextSend=false;
    this.deferNextRequest=false;
    FakeWebSocket.instances.push(this);
    queueMicrotask(()=>{this.readyState=FakeWebSocket.OPEN;this.emit('open');});
  }
  send(raw,callback){
    const msg=JSON.parse(String(raw));
    if(this.failNextSend){this.failNextSend=false;throw new Error('synthetic_send_failure');}
    if(msg.type==='HELLO'){
      queueMicrotask(()=>{
        callback?.();
        this.emit('message',JSON.stringify({type:'HELLO_ACK',authenticated:true}));
      });
      return;
    }
    if(this.deferNextRequest){this.deferNextRequest=false;this.deferred={msg,callback};return;}
    queueMicrotask(()=>{
      callback?.();
      this.emit('message',JSON.stringify({requestId:msg.requestId,ok:true,result:{echo:msg.type,state:'COMPLETED'}}));
    });
  }
  close(){
    if(this.readyState===FakeWebSocket.CLOSED)return;
    this.readyState=FakeWebSocket.CLOSED;
    queueMicrotask(()=>this.emit('close'));
  }
}

(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'body-topic-runner-'));
  const tokenPath=path.join(dir,'brain.token');
  fs.writeFileSync(tokenPath,'test-token');

  const client=new BrainClient({tokenPath,WebSocketImpl:FakeWebSocket,timeoutMs:1000});
  await client.connect();
  let ws=FakeWebSocket.instances.at(-1);
  ws.failNextSend=true;
  await assert.rejects(client.request('SYNTHETIC_FAIL'),/synthetic_send_failure/);
  assert.equal(client.pending.size,0,'sync send failure must not leave an orphan pending request');
  await assert.doesNotReject(()=>client.close());
  assert.equal(client.pending.size,0);

  const client2=new BrainClient({tokenPath,WebSocketImpl:FakeWebSocket,timeoutMs:1000});
  const ok=await client2.request('PING_TEST');
  assert.equal(ok.echo,'PING_TEST');
  await assert.doesNotReject(()=>client2.close());

  const client3=new BrainClient({tokenPath,WebSocketImpl:FakeWebSocket,timeoutMs:1000});
  await client3.connect();
  ws=FakeWebSocket.instances.at(-1);
  ws.deferNextRequest=true;
  const pending=client3.request('WAIT_FOR_CLOSE');
  const rejected=assert.rejects(pending,/brain_client_closed/);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(client3.pending.size,1);
  await client3.close();
  await rejected;
  assert.equal(client3.pending.size,0,'intentional close must drain pending requests');

  fs.rmSync(dir,{recursive:true,force:true});
  console.log('topic_transition_runner_contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
