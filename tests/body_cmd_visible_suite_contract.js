'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {MOTOR_TYPES,BROWSER_UI_ACTIONS}=require('../research/autonomous_discovery/body_capabilities');

const source=fs.readFileSync(path.resolve(__dirname,'..','desktop','body_cmd.py'),'utf8');

const motorCommand={
  click:'click',
  doubleClick:'doubleclick',
  moveTo:'move',
  hover:'hover',
  drag:'drag',
  scrollVertical:'scroll',
  scrollHorizontal:'hscroll',
  typeText:'type',
  pressKey:'key',
  keyCombo:'combo'
};

const browserCommand={
  back:'back',
  forward:'forward',
  reload:'reload',
  hardreload:'hardreload',
  stop:'browserstop',
  newtab:'browsernewtab',
  closetab:'browserclosetab',
  reopentab:'browserreopentab',
  nexttab:'browsernexttab',
  prevtab:'browserprevtab',
  newwindow:'browsernewwindow',
  addressbar:'browseraddressbar',
  find:'browserfind',
  downloads:'browserdownloads',
  history:'browserhistory',
  devtools:'browserdevtools',
  fullscreen:'browserfullscreen',
  bookmark:'browserbookmark',
  zoomin:'browserzoomin',
  zoomout:'browserzoomout',
  zoomreset:'browserzoomreset',
  address:'address',
  findtext:'browserfindtext'
};

for(const capability of MOTOR_TYPES){
  assert.ok(motorCommand[capability],`missing test mapping for motor.${capability}`);
  assert.ok(source.includes(motorCommand[capability]),`BodyCmd suite missing motor.${capability}`);
}
for(const capability of BROWSER_UI_ACTIONS){
  assert.ok(browserCommand[capability],`missing test mapping for browser_ui.${capability}`);
  assert.ok(source.includes(browserCommand[capability]),`BodyCmd suite missing browser_ui.${capability}`);
}
assert.ok(source.includes('__DYNAMIC_TAB_SWITCH__'),'BodyCmd suite missing tab_switch');
assert.ok(source.includes('client.command("tabs")'),'tab_switch must use live tab ids');
assert.ok(source.includes('--log'),'BodyCmd must expose log tail');
assert.ok(source.includes('--suite-visible'),'BodyCmd must expose visible suite');

console.log('body_cmd_visible_suite_contract: PASS');
