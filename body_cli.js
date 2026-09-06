'use strict';

const fs=require('node:fs');
const path=require('node:path');
const readline=require('node:readline');
const {WebSocket}=require('ws');
const {createCommandAccumulator}=require('./daemon/src/debug_command_adapter');
const DEFAULT_URL='ws://127.0.0.1:8765';
const PROTOCOL_VERSION=7;
const DEFAULT_TOKEN_PATH=path.join(__dirname,'daemon','profiles','.auth','client.token');
function normalizeText(value){const text=String(value??'').trim();if(!text)throw new Error('body_cli_text_required');return text;}
function loadClientToken(file=DEFAULT_TOKEN_PATH){const env=String(process.env.BODY_DEBUG_TOKEN||process.env.BODY_DAEMON_TOKEN||'').trim();if(env)return env;try{const value=fs.readFileSync(file,'utf8').trim();if(value)return value;}catch{}throw new Error(`Không tìm thấy debug auth token tại ${file}. Hãy chạy daemon.cmd trước.`);}
class BodyDebugClient{
  constructor({url=DEFAULT_URL,timeoutMs=120000,tokenPath=DEFAULT_TOKEN_PATH,token=null}={}){this.url=url;this.timeoutMs=timeoutMs;this.tokenPath=tokenPath;this.token=token;this.socket=null;this.pending=new Map();this.sequence=0;this.authenticated=false;this.controller=null;}
  async connect(){
    if(this.socket?.readyState===WebSocket.OPEN&&this.authenticated)return;const authToken=this.token||loadClientToken(this.tokenPath);
    await new Promise((resolve,reject)=>{const ws=this.socket=new WebSocket(this.url);const timer=setTimeout(()=>reject(new Error(`Không kết nối được Company Runtime ${this.url}. Hãy chạy daemon.cmd trước.`)),8000);const fail=error=>{clearTimeout(timer);reject(error instanceof Error?error:new Error(String(error)));};
      ws.once('open',()=>ws.send(JSON.stringify({type:'HELLO',role:'debug_client',protocolVersion:PROTOCOL_VERSION,token:authToken})));ws.once('error',fail);
      ws.on('message',raw=>{let msg;try{msg=JSON.parse(String(raw));}catch{return;}if(msg.type==='HELLO_ACK'&&msg.authenticated===true){clearTimeout(timer);this.authenticated=true;this.controller=msg.controller||null;resolve();return;}if(msg.type==='AUTH_ERROR'){fail(new Error(`Company Runtime auth failed: ${msg.error||'unknown'}`));return;}this.onMessageObject(msg);});
      ws.on('close',()=>{this.authenticated=false;const error=new Error('Company Runtime disconnected.');for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error);}this.pending.clear();});
    });
  }
  onMessageObject(msg){if(msg.type==='HELLO_ACK')return;const id=String(msg.requestId||'');if(!id||!this.pending.has(id))return;const item=this.pending.get(id);clearTimeout(item.timer);this.pending.delete(id);if(msg.ok===false||msg.type==='CLIENT_ERROR')item.reject(new Error(msg.error?.message||msg.error||'Body debug command failed.'));else item.resolve(msg.result??msg);}
  async command(text){await this.connect();const requestId=`debug-${Date.now()}-${++this.sequence}`;const result=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new Error('Body debug command timeout.'));},this.timeoutMs);this.pending.set(requestId,{resolve,reject,timer});});this.socket.send(JSON.stringify({type:'COMMAND',requestId,command:normalizeText(text)}));return result;}
  async close(){if(!this.socket)return;const ws=this.socket;this.socket=null;this.authenticated=false;await new Promise(resolve=>{ws.once('close',resolve);ws.close();setTimeout(resolve,250);});}
}
function print(value){if(typeof value==='string')console.log(value);else console.log(JSON.stringify(value,null,2));}
async function interactive(client){await client.connect();console.log(`Đã kết nối Company Runtime ${client.url} với vai trò DEBUG CLIENT.`);if(client.controller?.brainOnline)console.log('Brain đang giữ quyền điều khiển: các lệnh test có tác dụng sẽ bị chặn; lệnh đọc vẫn dùng được.');const accumulator=createCommandAccumulator(),rl=readline.createInterface({input:process.stdin,output:process.stdout,prompt:'BODY-DEBUG> '});rl.prompt();rl.on('line',async line=>{let accumulated;try{accumulated=accumulator.feed(line);}catch(error){accumulator.reset();console.error('[LỖI]',String(error?.message||error));rl.setPrompt('BODY-DEBUG> ');return rl.prompt();}if(!accumulated.ready){rl.setPrompt('... ');return rl.prompt();}rl.pause();try{print(await client.command(accumulated.command));}catch(error){console.error('[LỖI]',String(error?.message||error));}finally{rl.setPrompt('BODY-DEBUG> ');rl.resume();rl.prompt();}});await new Promise(resolve=>rl.once('close',resolve));}
async function main(argv=process.argv.slice(2)){const client=new BodyDebugClient();try{if(argv.length)print(await client.command(argv.join(' ')));else await interactive(client);}catch(error){console.error('[LỖI]',String(error?.message||error));process.exitCode=1;}finally{await client.close().catch(()=>{});}}
if(require.main===module)main();
module.exports={DEFAULT_URL,PROTOCOL_VERSION,DEFAULT_TOKEN_PATH,loadClientToken,BodyDebugClient,BodyDaemonClient:BodyDebugClient,main};
