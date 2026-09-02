'use strict';

const readline=require('node:readline');
const {WebSocket}=require('ws');

const DEFAULT_URL='ws://127.0.0.1:8765';

function normalizeText(value){
  const text=String(value??'').trim();
  if(!text) throw new Error('body_cli_text_required');
  return text;
}

class BodyDaemonClient {
  constructor({url=DEFAULT_URL,timeoutMs=120000}={}){
    this.url=url;
    this.timeoutMs=timeoutMs;
    this.socket=null;
    this.pending=new Map();
    this.sequence=0;
  }

  async connect(){
    if(this.socket?.readyState===WebSocket.OPEN) return;
    await new Promise((resolve,reject)=>{
      const ws=this.socket=new WebSocket(this.url);
      const timer=setTimeout(()=>reject(new Error(`Không kết nối được daemon ${this.url}. Hãy chạy daemon.cmd trước.`)),8000);
      ws.once('open',()=>{
        clearTimeout(timer);
        ws.send(JSON.stringify({type:'HELLO',role:'client',protocolVersion:3}));
        resolve();
      });
      ws.once('error',error=>{ clearTimeout(timer); reject(error); });
      ws.on('message',raw=>this.onMessage(raw));
      ws.on('close',()=>{
        const error=new Error('Body daemon disconnected.');
        for(const item of this.pending.values()){ clearTimeout(item.timer); item.reject(error); }
        this.pending.clear();
      });
    });
  }

  onMessage(raw){
    let msg; try{msg=JSON.parse(String(raw));}catch{return;}
    if(msg.type==='HELLO_ACK') return;
    const id=String(msg.requestId||'');
    if(!id||!this.pending.has(id)) return;
    const item=this.pending.get(id);
    clearTimeout(item.timer);
    this.pending.delete(id);
    if(msg.ok===false||msg.type==='CLIENT_ERROR') item.reject(new Error(msg.error?.message||msg.error||'Body command failed.'));
    else item.resolve(msg.result??msg);
  }

  async command(text){
    await this.connect();
    const requestId=`cli-${Date.now()}-${++this.sequence}`;
    const result=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new Error('Body command timeout.'));},this.timeoutMs);
      this.pending.set(requestId,{resolve,reject,timer});
    });
    this.socket.send(JSON.stringify({type:'COMMAND',requestId,command:normalizeText(text)}));
    return result;
  }

  async close(){
    if(!this.socket) return;
    const ws=this.socket; this.socket=null;
    await new Promise(resolve=>{ ws.once('close',resolve); ws.close(); setTimeout(resolve,250); });
  }
}

function print(value){
  if(typeof value==='string') console.log(value);
  else console.log(JSON.stringify(value,null,2));
}

async function interactive(client){
  await client.connect();
  console.log(`Đã kết nối ${client.url}. Gõ help để xem lệnh.`);
  const rl=readline.createInterface({input:process.stdin,output:process.stdout,prompt:'BODY> '});
  rl.prompt();
  rl.on('line',async line=>{
    if(!String(line).trim()) return rl.prompt();
    rl.pause();
    try{ print(await client.command(line)); }
    catch(error){ console.error('[LỖI]',String(error?.message||error)); }
    finally{ rl.resume(); rl.prompt(); }
  });
  await new Promise(resolve=>rl.once('close',resolve));
}

async function main(argv=process.argv.slice(2)){
  const client=new BodyDaemonClient();
  try{
    if(argv.length) print(await client.command(argv.join(' ')));
    else await interactive(client);
  } catch(error){
    console.error('[LỖI]',String(error?.message||error));
    process.exitCode=1;
  } finally{
    await client.close().catch(()=>{});
  }
}

if(require.main===module) main();
module.exports={DEFAULT_URL,BodyDaemonClient,main};
