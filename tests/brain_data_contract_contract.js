'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const contractDir=path.join(root,'contracts','brain-data','v1');
const read=name=>JSON.parse(fs.readFileSync(path.join(contractDir,name),'utf8'));

const ready=read('brain-ready-record.schema.json');
const pack=read('brain-situation-pack.schema.json');
const feedback=read('brain-feedback-record.schema.json');

assert.equal(ready.properties.schemaVersion.const,'1.0');
assert.equal(ready.properties.recordType.const,'brain_ready_record');
assert.equal(ready.properties.provenance.properties.immutable.const,true);
assert.equal(ready.properties.inferences.items.properties.confidence.minimum,0);
assert.equal(ready.properties.inferences.items.properties.confidence.maximum,1);

const candidateProps=ready.properties.semantic.properties.capabilityCandidate.properties;
assert.equal(Object.prototype.hasOwnProperty.call(candidateProps,'autonomy'),false,'Analyst contract must never expose authoritative autonomy');
assert.equal(ready.properties.semantic.properties.capabilityCandidate.additionalProperties,false);

assert.equal(pack.properties.packVersion.const,'1.0');
assert.equal(pack.properties.capabilities.items.properties.autonomy.type,'integer');
assert.equal(pack.properties.capabilities.items.properties.autonomy.minimum,0);
assert.equal(pack.properties.capabilities.items.properties.autonomy.maximum,4);
assert.deepEqual(pack.properties.policy.properties.class.enum,['SAFE_AUTO','HUMAN_APPROVED','RESTRICTED']);
assert.ok(pack.required.includes('sourceRecordIds'));
assert.ok(pack.required.includes('policy'));
assert.ok(pack.required.includes('environment'));

assert.equal(feedback.properties.feedbackVersion.const,'1.0');
assert.equal(feedback.properties.source.const,'agent','Brain feedback must remain Agent provenance');
assert.deepEqual(feedback.properties.decision.properties.status.enum,['EXECUTE','WAIT','REQUEST_EVIDENCE','REPLAN','REJECT']);
assert.ok(feedback.required.includes('consumedRecordIds'));

for(const schema of [ready,pack,feedback]){
  assert.equal(schema.$schema,'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.type,'object');
}

console.log('Brain data contract v1: OK');
