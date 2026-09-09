'use strict';

const path=require('node:path');
const readline=require('node:readline');
const {spawn}=require('node:child_process');

class WindowsInputWorker{
  constructor({platform=process.platform,spawnImpl=spawn,baseDir=path.join(__dirname,'..'),timeoutMs=15000,env=process.env}={}){
    this.platform=platform;this.spawnImpl=spawnImpl;this.baseDir=baseDir;this.timeoutMs=Math.max(1000,Number(timeoutMs)||15000);this.env=env||{};this.child=null;this.starting=null;this.pending=new Map();this.sequence=0;
    process.once('exit',()=>{try{this.child?.kill();}catch{}});
  }
  async _spawn(exe,args){return new Promise((resolve,reject)=>{let child;try{child=this.spawnImpl(exe,args,{cwd:this.baseDir,windowsHide:true,stdio:['pipe','pipe','pipe']});}catch(error){reject(error);return;}const onError=error=>{cleanup();try{child.kill();}catch{}reject(error);};const onSpawn=()=>{cleanup();resolve(child);};const cleanup=()=>{child.off?.('error',onError);child.off?.('spawn',onSpawn);};child.once?.('error',onError);child.once?.('spawn',onSpawn);if(!child.once)resolve(child);});}
  _bind(child){
    this.child=child;const lines=readline.createInterface({input:child.stdout});
    lines.on('line',line=>{let msg;try{msg=JSON.parse(String(line));}catch{return;}const key=String(msg.id??''),item=this.pending.get(key);if(!item)return;clearTimeout(item.timer);this.pending.delete(key);if(msg.ok===false)item.reject(new Error(msg.error||'windows_input_failed'));else item.resolve({ok:true,worker:true});});
    child.stderr?.on('data',()=>{});child.once?.('close',code=>{if(this.child===child)this.child=null;const error=new Error(`windows_input_worker_closed:${code}`);for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error);}this.pending.clear();});
  }
  async start(){
    if(this.platform!=='win32')throw new Error('browser_ui_input_windows_only');if(this.child&&!this.child.killed)return this.child;if(this.starting)return this.starting;
    this.starting=(async()=>{
      const bundled=String(this.env.BODY_WINDOWS_INPUT_HELPER_EXE||'').trim(),helper=path.join(this.baseDir,'native','windows_input.py');
      const candidates=bundled?[[bundled,['worker']]]:[['python',[helper,'worker']],['py',['-3',helper,'worker']]];
      let lastError=null;for(const [exe,args] of candidates){try{const child=await this._spawn(exe,args);this._bind(child);return child;}catch(error){lastError=error;}}
      throw lastError||new Error(bundled?'windows_input_helper_unavailable':'python_not_found');
    })();
    try{return await this.starting;}finally{this.starting=null;}
  }
  async send(mode,value){if(!['combo','key','text'].includes(String(mode)))throw new Error(`browser_ui_mode_forbidden:${mode}`);const child=await this.start(),id=String(++this.sequence);const result=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('windows_input_worker_timeout'));},this.timeoutMs);this.pending.set(id,{resolve,reject,timer});});child.stdin.write(JSON.stringify({id,mode:String(mode),value:String(value)})+'\n');return result;}
  async close(){const child=this.child;this.child=null;if(!child)return;try{child.stdin.end();}catch{}await new Promise(resolve=>{child.once?.('close',resolve);setTimeout(()=>{try{child.kill();}catch{}resolve();},300);});}
}
function createWindowsInputRunner(options={}){const worker=new WindowsInputWorker(options);const runner=(mode,value)=>worker.send(mode,value);runner.worker=worker;runner.close=()=>worker.close();return runner;}
module.exports={WindowsInputWorker,createWindowsInputRunner};
