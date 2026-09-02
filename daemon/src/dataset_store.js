'use strict';

const fs=require('node:fs');
const path=require('node:path');

class DatasetStore{
  constructor(baseDir,{batchSize=100,flushIntervalMs=300,maxBufferedRows=5000}={}){
    this.baseDir=baseDir;fs.mkdirSync(baseDir,{recursive:true});
    this.humanSamplesPath=path.join(baseDir,'human_samples.jsonl');this.humanEventsPath=path.join(baseDir,'human_events.jsonl');this.agentEventsPath=path.join(baseDir,'agent_events.jsonl');
    this.batchSize=Math.max(10,Number(batchSize)||100);this.flushIntervalMs=Math.max(50,Number(flushIntervalMs)||300);this.maxBufferedRows=Math.max(this.batchSize,Number(maxBufferedRows)||5000);
    this.queues=new Map();this.bufferedRows=0;this.coalescedMousemoves=0;this.flushTimer=null;this.writeChain=Promise.resolve();this.closed=false;
    this.counts={humanSamples:this._lineCount(this.humanSamplesPath),humanEvents:this._lineCount(this.humanEventsPath),agentEvents:this._lineCount(this.agentEventsPath)};
  }
  _lineCount(file){if(!fs.existsSync(file))return 0;const text=fs.readFileSync(file,'utf8');if(!text.trim())return 0;return text.split(/\r?\n/).filter(Boolean).length;}
  _queueFor(file){let queue=this.queues.get(file);if(!queue){queue=[];this.queues.set(file,queue);}return queue;}
  _scheduleFlush(delay=this.flushIntervalMs){if(this.closed||this.flushTimer)return;this.flushTimer=setTimeout(()=>{this.flushTimer=null;this.flush().catch(()=>{});},Math.max(0,delay));this.flushTimer.unref?.();}
  _enqueue(file,obj,{coalescible=false}={}){
    if(this.closed)throw new Error('dataset_store_closed');const queue=this._queueFor(file),line=JSON.stringify(obj)+'\n';
    if(coalescible&&this.bufferedRows>=this.maxBufferedRows){for(let i=queue.length-1;i>=0;i--){if(queue[i].coalescible){queue[i]={line,coalescible:true};this.coalescedMousemoves++;return;}}}
    queue.push({line,coalescible});this.bufferedRows++;if(this.bufferedRows>=this.batchSize)this._scheduleFlush(0);else this._scheduleFlush();
  }
  _takeBatch(){if(this.flushTimer){clearTimeout(this.flushTimer);this.flushTimer=null;}const batch=[];for(const [file,queue] of this.queues){if(!queue.length)continue;const rows=queue.splice(0,queue.length);batch.push([file,rows.map(row=>row.line).join('')]);this.bufferedRows-=rows.length;}return batch;}
  async flush(){const batch=this._takeBatch();if(!batch.length)return this.writeChain;this.writeChain=this.writeChain.then(async()=>{for(const [file,text] of batch)await fs.promises.appendFile(file,text,'utf8');});await this.writeChain;}
  flushSync(){const batch=this._takeBatch();for(const [file,text] of batch)fs.appendFileSync(file,text,'utf8');}
  appendEvent(tabId,event){const row={tabId,...event},coalescible=event?.eventType==='mousemove';if(event.source==='agent'){this._enqueue(this.agentEventsPath,row,{coalescible});this.counts.agentEvents++;return;}if(event.source==='human'){this._enqueue(this.humanEventsPath,row,{coalescible});this.counts.humanEvents++;}}
  appendHumanSample(sample){if(sample?.source!=='human')throw new Error('only_human_samples_can_be_ground_truth');this._enqueue(this.humanSamplesPath,sample);this.counts.humanSamples++;}
  loadHumanSamples(){this.flushSync();if(!fs.existsSync(this.humanSamplesPath))return [];return fs.readFileSync(this.humanSamplesPath,'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
  async close(){this.closed=true;await this.flush();}
  stats(){return {...this.counts,bufferedRows:this.bufferedRows,coalescedMousemoves:this.coalescedMousemoves,batchSize:this.batchSize,flushIntervalMs:this.flushIntervalMs};}
}

module.exports={DatasetStore};
