'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {sourceInfo}=require('../research/autonomous_discovery/build_info');
const info=sourceInfo();
if(!info.commit||info.dirty!==false)throw new Error('discovery_build_requires_clean_git_revision');
const output=path.join(__dirname,'../research/autonomous_discovery/build_metadata.json');
fs.writeFileSync(output,JSON.stringify({commit:info.commit,builtAt:new Date().toISOString(),dirty:false},null,2)+'\n');
console.log(`Discovery build source: ${info.commit}`);
