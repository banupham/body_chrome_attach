'use strict';

const path=require('node:path');
const {execFileSync}=require('node:child_process');
const embedded=require('./build_metadata.json');
const REVISION='observation-feedback-recovery-v2';

function sourceInfo(){
  const info={revision:REVISION,commit:embedded.commit||null,builtAt:embedded.builtAt||null,dirty:embedded.dirty??null};
  if(process.pkg)return info;
  try{
    const cwd=path.resolve(__dirname,'../..');
    const options={cwd,encoding:'utf8',timeout:2000,stdio:['ignore','pipe','ignore'],windowsHide:true};
    const commit=execFileSync('git',['rev-parse','HEAD'],options).trim();
    if(/^[a-f0-9]{40}$/.test(commit))info.commit=commit;
    info.dirty=Boolean(execFileSync('git',['status','--porcelain','--untracked-files=no'],options).trim());
  }catch{/* Source archives without Git retain explicit unknown provenance. */}
  return info;
}

module.exports={sourceInfo,REVISION};
