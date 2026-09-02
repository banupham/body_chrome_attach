'use strict';

const path=require('node:path');
const {spawn}=require('node:child_process');

function runAttempt(spawnImpl,exe,args,cwd,value){
  return new Promise((resolve,reject)=>{
    let child;
    try{child=spawnImpl(exe,args,{cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});}catch(error){reject(error);return;}
    let out='',err='',settled=false;
    const fail=error=>{if(settled)return;settled=true;reject(error);};
    child.stdout?.on('data',d=>out+=String(d));
    child.stderr?.on('data',d=>err+=String(d));
    child.once?.('error',fail);
    child.once?.('close',code=>{
      if(settled)return;settled=true;
      if(code===0) resolve({ok:true,stdout:out.trim()});
      else reject(new Error(err.trim()||`windows_input_exit:${code}`));
    });
    try{child.stdin?.end(String(value));}catch(error){fail(error);}
  });
}

function createWindowsInputRunner({platform=process.platform,spawnImpl=spawn,baseDir=path.join(__dirname,'..')}={}){
  return async function runWindowsInput(mode,value){
    if(platform!=='win32') throw new Error('browser_ui_input_windows_only');
    if(!['combo','key','text'].includes(String(mode))) throw new Error(`browser_ui_mode_forbidden:${mode}`);
    const helper=path.join(baseDir,'native','windows_input.py');
    const candidates=[['python',[helper,String(mode)]],['py',['-3',helper,String(mode)]]];
    let lastError=null;
    for(const [exe,args] of candidates){
      try{return {...await runAttempt(spawnImpl,exe,args,baseDir,String(value)),mode:String(mode)};}
      catch(error){lastError=error;}
    }
    throw lastError||new Error('python_not_found');
  };
}

module.exports={createWindowsInputRunner};
