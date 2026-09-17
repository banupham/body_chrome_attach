'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {atomicWrite}=require('./experience_memory');

function esc(value){return String(value??'').replace(/\|/g,'\\|').replace(/\r?\n/g,' ');}
function topicCounts(snapshot){const counts={};for(const row of snapshot?.candidates||[]){const topic=row.classification?.primary||'unknown';counts[topic]=(counts[topic]||0)+1;}return counts;}
function foundMethod(found){if(!found)return null;if(found.surface==='home_feed')return 'home';if(found.surface==='related')return 'next_video';if(found.surface==='mix_queue')return 'mix_queue';if(found.surface==='search_results')return 'search';return found.surface||found.method||'unknown';}
function reportMarkdown(report){
  const lines=[];
  lines.push(`# BODY YouTube Discovery — ${report.runId}`,'');
  lines.push(`- Target video ID: \`${report.target.videoId}\``);
  lines.push(`- Target title: ${report.target.title||'(API title unavailable)'}`);
  lines.push(`- Status: **${report.status}**`);
  lines.push(`- Planner: ${report.autonomy?.planner||'legacy'}`);
  lines.push(`- Autonomy mode: ${report.autonomy?.mode||'unknown'}`);
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Updated: ${report.updatedAt}`);
  lines.push(`- Source revision: ${esc(report.source?.revision||'unknown')} / commit ${esc(report.source?.commit||'unknown')} / dirty=${report.source?.dirty??'unknown'}`);
  lines.push(`- Report scope: ${esc(report.reportScope||'legacy_batch')} / summary: ${esc(report.summaryScope||'run_cumulative')}`);
  lines.push(`- Session ledger: ${esc(report.sessionFile||'unknown')}`);
  lines.push(`- Batch steps: ${report.batch?.firstStep??'none'} → ${report.batch?.lastStep??'none'}`);
  lines.push(`- Steps: ${report.summary.steps}`);
  lines.push(`- Steps without target progress: ${report.summary.stagnationCount??0}`);
  lines.push(`- Unique videos observed: ${report.summary.uniqueVideosObserved}`);
  lines.push(`- Topics observed: ${report.summary.uniqueTopicsObserved}`);
  lines.push(`- Queries attempted: ${report.summary.queryAttempts}`);
  lines.push(`- BODY actions: ${report.summary.bodyActions}`);
  lines.push('');
  if(report.account){const a=report.account;lines.push('## Account context','');lines.push(`- Account key: \`${esc(a.accountKey||'unknown')}\``);lines.push(`- Account state: **${esc(a.accountState||'UNKNOWN')}**`);lines.push(`- Organic history sample: ${a.historySampleCount??0} videos`);lines.push(`- Home baseline sample: ${a.homeSampleCount??0} videos`);lines.push(`- Raw history observed: ${a.baseline?.rawHistoryObserved??a.historySampleCount??0}`);lines.push(`- Brain-generated history excluded: ${a.baseline?.excludedBrainGeneratedHistoryCount??0}`);lines.push(`- Profile confidence: ${a.profileConfidence??0}`);lines.push(`- Target relationship: **${esc(a.relationship?.kind||'UNKNOWN')}**`);lines.push(`- Relationship reason: ${esc(a.relationship?.reason||'n/a')}`);lines.push(`- Target previously watched: ${a.relationship?.targetPreviouslyWatched?'yes':'no'}`);lines.push(`- Account-aware plan: **${esc(a.plan?.mode||'none')}**`);lines.push(`- Dominant topics: ${(a.habits?.dominantTopics||[]).map(x=>`${esc(x.key)}=${x.count}`).join(', ')||'n/a'}`);lines.push(`- Preferred formats: ${(a.habits?.preferredFormats||[]).map(x=>`${esc(x.key)}=${x.count}`).join(', ')||'n/a'}`);lines.push(`- Confirmed Brain preview exposures: ${a.brainActivity?.previewConfirmedCount??0}`);lines.push(`- Home personalization seeded during run: ${a.runtime?.personalizationSeeded===true?'yes':'no'}`);lines.push(`- Last Home candidate count: ${a.runtime?.lastHomeCandidateCount??'n/a'}`);lines.push(`- Last Home target-relevant share: ${a.runtime?.lastHomeRelevantShare??'n/a'}`);lines.push(`- Profiling BODY actions: ${a.profileActions??0}`,'');}
  if(report.autonomy?.taskModel){const t=report.autonomy.taskModel;lines.push('## Brain task understanding','');lines.push(`- Objective: **${esc(t.objective)}**`);lines.push(`- Target topic: ${esc(t.targetTopic)}`);lines.push(`- Target language: ${esc(t.targetLanguage)}`);if(t.accountContext){lines.push(`- Account state used by planner: ${esc(t.accountContext.accountState||'UNKNOWN')}`);lines.push(`- Account relationship used by planner: ${esc(t.accountContext.relationship?.kind||'UNKNOWN')}`);}lines.push(`- Constraints: ${(t.constraints||[]).map(esc).join(', ')||'none'}`);lines.push(`- Success evidence: ${(t.successEvidence||[]).map(esc).join(', ')||'n/a'}`,'');}
  if(report.targetDiscovery){const d=report.targetDiscovery;lines.push('## Target discovery','');lines.push(`- Found via: **${foundMethod(d)}**`);lines.push(`- Surface: \`${d.surface}\``);lines.push(`- Rank: ${d.rank??'n/a'}`);lines.push(`- From video: ${d.fromVideoId||'(Home/Search)'}`);lines.push(`- From topic: ${d.fromTopic||'unknown'}`);lines.push(`- Planner: ${d.strategy||'agent'}`);lines.push(`- Opened target: ${d.opened===true?'yes':'no'}`,'');}
  lines.push('## Path taken','');
  if(report.autonomy?.mode==='FULL_BODY_AGENT'){
    lines.push('| Step | Subgoal | Account relation | Capability | Purpose | Query/Video | Changed? | Change evidence | Reward | Success |');
    lines.push('|---:|---|---|---|---|---|---|---|---:|---|');
    for(const row of report.path||[])lines.push(`| ${row.step} | ${esc(row.subgoal)} | ${esc(row.accountRelationship||'')} | ${esc(row.capability)} | ${esc(row.purpose)} | ${esc(row.query||row.videoId||'')} | ${row.changed?'yes':'no'} | ${esc((row.changeReasons||[]).join(','))} | ${row.reward??''} | ${row.success?'yes':'no'} |`);
  }else{
    lines.push('| Step | Strategy | Source | Source topic | Action | Selected/Query | Surface | Rank | Dwell | Reward |');
    lines.push('|---:|---|---|---|---|---|---|---:|---:|---:|');
    for(const row of report.path||[])lines.push(`| ${row.step} | ${esc(row.strategy)} | ${esc(row.sourceVideoId||row.pageType||'')} | ${esc(row.sourceTopic)} | ${esc(row.action)} | ${esc(row.selectedTitle||row.query||row.selectedVideoId||'')} | ${esc(row.surface||'')} | ${row.rank??''} | ${row.dwellSec??''} | ${row.reward??''} |`);
  }
  lines.push('','## What YouTube showed after each checkpoint','');
  for(const snapshot of report.snapshots||[]){const counts=topicCounts(snapshot);lines.push(`### Checkpoint ${snapshot.index} — ${snapshot.reason}`);lines.push(`Current: ${snapshot.currentVideoId||snapshot.pageType||'unknown'} / topic **${snapshot.currentTopic||'unknown'}**`);lines.push(`Topic mix: ${Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}=${v}`).join(', ')||'no candidates'}`,'');lines.push('| Surface | Rank | Topic | Confidence | Video | Title | Target? |');lines.push('|---|---:|---|---:|---|---|---|');for(const c of (snapshot.candidates||[]).slice(0,25))lines.push(`| ${esc(c.surface)} | ${c.position??''} | ${esc(c.classification?.primary||'unknown')} | ${c.classification?.confidence??0} | ${esc(c.videoId)} | ${esc(c.title||'')} | ${c.targetMatch?'YES':''} |`);lines.push('');}
  if(report.agent){lines.push('## Autonomous planner trace','');lines.push(`- Planner decisions: ${report.agent.plannerDecisions??0}`);lines.push(`- Used queries: ${(report.agent.usedQueries||[]).join(' → ')||'none yet'}`);lines.push(`- Dynamic queries learned from environment: ${(report.agent.dynamicQueries||[]).map(x=>x.query).join(' | ')||'none yet'}`,'');}
  lines.push('## Learned experience','');lines.push('### Action/context statistics','');lines.push('| Capability-purpose/context | Attempts | Mean reward | Successes | New topics | New transitions | Target seen |');lines.push('|---|---:|---:|---:|---:|---:|---:|');for(const s of report.memory?.strategies||[])lines.push(`| ${esc(`${s.id} / ${s.context}`)} | ${s.attempts} | ${s.meanReward} | ${s.successes} | ${s.newTopicCount} | ${s.newTransitionCount} | ${s.targetSeenCount} |`);
  lines.push('','### Strongest observed topic transitions','');lines.push('| From | To | Surface | Count |');lines.push('|---|---|---|---:|');for(const t of (report.memory?.transitions||[]).slice(0,30))lines.push(`| ${esc(t.fromTopic)} | ${esc(t.toTopic)} | ${esc(t.surface)} | ${t.count} |`);
  lines.push('','### Query audit','');lines.push('| Query | Kind/source | Allowed | Reason | Title overlap |');lines.push('|---|---|---|---|---:|');for(const q of report.queryAudit||[])lines.push(`| ${esc(q.query)} | ${esc(q.kind||q.source||'')} | ${q.allowed?'yes':'no'} | ${esc(q.reason)} | ${q.titleOverlap??0} |`);
  lines.push('','> The target video ID/title remain success/profile evidence and are not permitted as direct YouTube search queries or cold-start preview seeds. Account watch history is sampled before discovery; known Brain-generated preview/open activity is tracked separately and excluded from the pre-existing habit baseline when it can be identified.');
  return lines.join('\n')+'\n';
}

class Reporter{constructor(root,runId){this.root=root;this.runId=runId;fs.mkdirSync(root,{recursive:true});}paths(batchIndex){const base=`${this.runId}-batch-${String(batchIndex).padStart(4,'0')}`;return {json:path.join(this.root,`${base}.json`),md:path.join(this.root,`${base}.md`),latest:path.join(this.root,`${this.runId}-latest.json`)};}writeLatest(report){const history=report.agent?.history||report.path||[],latest={...report,reportScope:'checkpoint',pathScope:'run_history_tail',path:history,historyFirstStep:history[0]?.step??null,historyLastStep:history.at(-1)?.step??null};atomicWrite(this.paths(0).latest,latest);return this.paths(0).latest;}write(report,batchIndex){const p=this.paths(batchIndex);atomicWrite(p.json,report);fs.writeFileSync(p.md,reportMarkdown(report));this.writeLatest(report);return p;}}
module.exports={Reporter,reportMarkdown,foundMethod,topicCounts};
