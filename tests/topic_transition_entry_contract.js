'use strict';

const assert = require('node:assert/strict');
const {
  diagnosticRows,
  chooseEligibleBrowser,
  hasEligibleBrowser,
  chooseProbeTarget,
  uniquenessConflict,
  compactDiagnostics,
  conflictHint
} = require('../research/topic_transition_entry');

function browser({id,online=true,state='QUARANTINED',eligible=false,reasons=[],ip=null,signature=null,youtube=false,tabId=1,connectedAt=0,lastSeenAt=0}={}) {
  return {
    browserInstanceId:id,
    extensionInstanceId:`ext-${id}`,
    deviceId:'device-test',
    online,
    state,
    stateReason:eligible?'environment_eligible':'environment_policy_failed',
    connectedAt,
    lastSeenAt,
    tabCount:online?1:0,
    tabs:online?[{id:tabId,active:true,siteKey:youtube?'youtube.com':'example.com',title:youtube?'YouTube':'Other'}]:[],
    environment:{eligible,status:eligible?'ELIGIBLE':'INELIGIBLE',publicIp:ip,environmentSignature:signature,reasons}
  };
}

const duplicateStatus={browsers:[
  browser({id:'browser-youtube',youtube:true,tabId:188,reasons:['DUPLICATE_PUBLIC_EGRESS'],ip:'113.185.92.192',connectedAt:20}),
  browser({id:'browser-peer',youtube:false,reasons:['DUPLICATE_PUBLIC_EGRESS'],ip:'113.185.92.192',connectedAt:10}),
  browser({id:'browser-old',online:false,state:'OFFLINE',reasons:['ENVIRONMENT_NOT_CHECKED']})
]};

const rows=diagnosticRows(duplicateStatus);
assert.equal(rows.length,3);
assert.equal(rows[0].publicIp,'113.185.92.192');
assert.equal(chooseProbeTarget(duplicateStatus,null),'browser-youtube','current YouTube Browser should be re-probed instead of probing every Browser');
assert.equal(chooseProbeTarget(duplicateStatus,'browser-peer'),'browser-peer');
assert.equal(hasEligibleBrowser(duplicateStatus),false);

const conflict=uniquenessConflict(duplicateStatus,null);
assert.equal(conflict.reason,'DUPLICATE_PUBLIC_EGRESS');
assert.equal(conflict.targetBrowserInstanceId,'browser-youtube');
assert.deepEqual(conflict.targetTabIds,[188]);
assert.deepEqual(conflict.peerBrowserInstanceIds,['browser-peer']);
assert.match(conflictHint(conflict),/Close the extra BODY-managed Browser instance/);
assert.match(conflictHint(conflict),/will not disable this guardrail/);

const compact=compactDiagnostics(duplicateStatus);
assert.equal(compact.online.length,2,'preflight output should not repeat every historical offline Browser row');
assert.equal(compact.offlineCount,1);

const eligibleStatus={browsers:[browser({id:'browser-youtube',youtube:true,state:'ACTIVE',eligible:true,reasons:[],ip:'113.185.92.192',connectedAt:50})]};
assert.equal(hasEligibleBrowser(eligibleStatus),true);
assert.equal(chooseEligibleBrowser(eligibleStatus).browserInstanceId,'browser-youtube');
assert.equal(uniquenessConflict(eligibleStatus),null);

const newestEligible={browsers:[
  browser({id:'browser-older',youtube:true,tabId:101,state:'ACTIVE',eligible:true,connectedAt:100,lastSeenAt:150}),
  browser({id:'browser-fresh',youtube:true,tabId:202,state:'ACTIVE',eligible:true,connectedAt:200,lastSeenAt:220})
]};
assert.equal(chooseEligibleBrowser(newestEligible).browserInstanceId,'browser-fresh','dynamic mode should prefer the newest eligible YouTube Browser');
assert.equal(chooseProbeTarget(newestEligible).toString(),'browser-fresh','re-probe should follow the newest YouTube Browser');

const noYoutubeEligible={browsers:[browser({id:'browser-other',youtube:false,state:'ACTIVE',eligible:true,connectedAt:300})]};
assert.equal(hasEligibleBrowser(noYoutubeEligible),false,'an eligible non-YouTube Browser is not sufficient for research');

const signatureStatus={browsers:[
  browser({id:'browser-youtube',youtube:true,reasons:['DUPLICATE_ENVIRONMENT_SIGNATURE'],ip:'1.1.1.1',signature:'same'}),
  browser({id:'browser-peer',youtube:false,reasons:['DUPLICATE_ENVIRONMENT_SIGNATURE'],ip:'2.2.2.2',signature:'same'})
]};
const signatureConflict=uniquenessConflict(signatureStatus);
assert.equal(signatureConflict.reason,'DUPLICATE_ENVIRONMENT_SIGNATURE');
assert.deepEqual(signatureConflict.peerBrowserInstanceIds,['browser-peer']);

console.log('topic_transition_entry_contract: PASS');
