'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const root=path.join(__dirname,'..');

function gitBlobSha(relativePath){
  return execFileSync('git',['hash-object','--',relativePath],{
    cwd:root,
    encoding:'utf8',
    windowsHide:true
  }).trim();
}
const stable={
  'src/cdp_input_gateway.js':'6ec877a40d7a3311f26bdd489ae82878970dc906',
  'src/page_motor_core.js':'1e7123a5e3a136eac54773017eace1ac0552cf72',
  'src/canonical_motor_planner.js':'955190ea7d760f5ac300f57b32c0b39f7471954d',
  'src/daemon_bridge.js':'80729d0f9501f75d78e97375221d2ec3196900c3',
  'src/virtual_cursor_mirror.js':'2ba74fa05884c2b7044b4da56672fc17ce2374bb',
  'src/virtual_cursor_overlay.js':'acd2ef8bdd62d18a756a8b922e54c992a4eb5e27',
  'src/virtual_cursor_content.js':'fedb9c676c3eacd9ecceec83368d78a4b6cfc6d6',
  'daemon/src/motor_planner.js':'b5c443379faecc35796ed325818a934f4b83f4d8'
};

for(const [relative,expected] of Object.entries(stable)){
  const actual=gitBlobSha(relative);
  assert.equal(actual,expected,`${relative} changed from frozen stable CDP/motor baseline`);
}

console.log('stable_cdp_freeze_contract: PASS');
