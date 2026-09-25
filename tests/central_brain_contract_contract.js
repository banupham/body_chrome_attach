'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const protocol=JSON.parse(fs.readFileSync(path.join(root,'contracts','central-brain','v1','central-brain-protocol.json'),'utf8'));
const offer=JSON.parse(fs.readFileSync(path.join(root,'contracts','central-brain','v1','task-offer.schema.json'),'utf8'));
const result=JSON.parse(fs.readFileSync(path.join(root,'contracts','central-brain','v1','task-result.schema.json'),'utf8'));

assert.equal(protocol.protocolVersion,1);
assert.equal(protocol.status,'DESIGN_ONLY');
assert.deepEqual(protocol.objective.requiredFields,['targetId']);
assert.deepEqual(protocol.messages.TASK_OFFER.businessObjectiveFields,['targetId']);

for(const phrase of ['search query','keywords','strategy','plan','candidate choice','click coordinates','scroll direction','retry policy','dwell duration','BODY_STEP','browser UI action']){
  assert.ok(protocol.authorityBoundary.forbiddenCentralInfluence.some(x=>String(x).toLowerCase()===phrase.toLowerCase()));
}

assert.ok(protocol.preOfferRequirements.centralMustComplete.some(x=>/registered channel/i.test(x)));
assert.ok(protocol.preOfferRequirements.centralMustComplete.some(x=>/points reservation/i.test(x)));
assert.equal(protocol.points.owner,'Central');
assert.equal(protocol.points.brainMayMutate,false);
assert.equal(protocol.scoring.owner,'Central');
assert.equal(protocol.scoring.brainSubmitsScore,false);

assert.equal(offer.additionalProperties,false);
assert.deepEqual(
  Object.keys(offer.properties).sort(),
  ['authorizationRef','expiresAt','issuedAt','protocolVersion','targetId','taskId','type'].sort()
);
assert.ok(offer.required.includes('targetId'));

for(const forbidden of ['query','strategy','plan','action','points','score','cost']){
  assert.equal(Object.prototype.hasOwnProperty.call(offer.properties,forbidden),false);
}

assert.equal(result.additionalProperties,false);
for(const forbidden of ['score','points','reward','debit','balance']){
  assert.equal(Object.prototype.hasOwnProperty.call(result.properties,forbidden),false);
}
assert.ok(protocol.messages.TASK_REJECT.forbiddenReasons.includes('INSUFFICIENT_POINTS'));
assert.ok(protocol.messages.TASK_REJECT.forbiddenReasons.includes('TARGET_NOT_REGISTERED'));

console.log('central_brain_contract_contract: PASS');
