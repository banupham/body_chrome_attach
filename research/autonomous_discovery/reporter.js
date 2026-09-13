'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {atomicWrite}=require('./experience_memory');

function esc(value){return String(value??'').replace(/\|/g,'\\|').replace(/\r?\n/g,' ');}
function topicCounts(snapshot){const counts={};for(const row of snapshot?.candidates||[]){const topic=row.classification?.primary||'unknown';counts[topic]=(counts[topic]||0)+1;}return counts;}
function foundMethod(found){if(!found)return null;if(found.surface==='home_feed')return 'home';if(found.surface==='related')return 'next_video';if(found.surface==='mix_queue')return 'mix_queue';if(found.surface==='search_results')return 'search';return found.surface||'unknown';}
function reportMarkdown(report){
  const lines=[];
  lines.push(`# BODY YouTube Discovery — ${report.runId}`,'');
  lines.push(`- Target video ID: \`${report.target.videoId}\``);
  lines.push(`- Target title: ${report.target.title||'(API title unavailable)'}`);
  lines.push(`- Status: **${report.status}**`);
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Updated: ${report.updatedAt}`);
  lines.push(`- Steps: ${report.summary.steps}`);
  lines.push(`- Unique videos observed: ${report.summary.uniqueVideosObserved}`);
  lines.push(`- Topics observed: ${report.summary.uniqueTopicsObserved}`);
  lines.push(`- Queries attempted: ${report.summary.queryAttempts}`);
  lines.push(`- BODY actions: ${report.summary.bodyActions}`);
  lines.push('');
  if(report.targetDiscovery){
    const d=report.targetDiscovery;
    lines.push('## Target discovery','');
    lines.push(`- Found via: **${foundMethod(d)}**`);
    lines.push(`- Surface: \`${d.surface}\``);
    lines.push(`- Rank: ${d.rank??'n/a'}`);
    lines.push(`- From video: ${d.fromVideoId||'(Home/Search)'}`);
    lines.push(`- From topic: ${d.fromTopic||'unknown'}`);
    lines.push(`- Strategy: ${d.strategy||'unknown'}`);
    lines.push(`- Opened target: ${d.opened===true?'yes':'no'}`,'');
  }
  lines.push('## Path taken','');
  lines.push('| Step | Strategy | Source | Source topic | Action | Selected/Query | Surface | Rank | Dwell | Reward |');
  lines.push('|---:|---|---|---|---|---|---|---:|---:|---:|');
  for(const row of report.path||[])lines.push(`| ${row.step} | ${esc(row.strategy)} | ${esc(row.sourceVideoId||row.pageType||'')} | ${esc(row.sourceTopic)} | ${esc(row.action)} | ${esc(row.selectedTitle||row.query||row.selectedVideoId||'')} | ${esc(row.surface||'')} | ${row.rank??''} | ${row.dwellSec??''} | ${row.reward??''} |`);
  lines.push('','## What YouTube showed after each checkpoint','');
  for(const snapshot of report.snapshots||[]){
    const counts=topicCounts(snapshot);
    lines.push(`### Checkpoint ${snapshot.index} — ${snapshot.reason}`);
    lines.push(`Current: ${snapshot.currentVideoId||snapshot.pageType||'unknown'} / topic **${snapshot.currentTopic||'unknown'}**`);
    lines.push(`Topic mix: ${Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}=${v}`).join(', ')||'no candidates'}`,'');
    lines.push('| Surface | Rank | Topic | Confidence | Video | Title | Target? |');
    lines.push('|---|---:|---|---:|---|---|---|');
    for(const c of (snapshot.candidates||[]).slice(0,25))lines.push(`| ${esc(c.surface)} | ${c.position??''} | ${esc(c.classification?.primary||'unknown')} | ${c.classification?.confidence??0} | ${esc(c.videoId)} | ${esc(c.title||'')} | ${c.targetMatch?'YES':''} |`);
    lines.push('');
  }
  lines.push('## Learned experience','');
  lines.push('### Strategy statistics','');
  lines.push('| Strategy/context | Attempts | Mean reward | Successes | New topics | New transitions | Target seen |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for(const s of report.memory?.strategies||[])lines.push(`| ${esc(`${s.id} / ${s.context}`)} | ${s.attempts} | ${s.meanReward} | ${s.successes} | ${s.newTopicCount} | ${s.newTransitionCount} | ${s.targetSeenCount} |`);
  lines.push('','### Strongest observed topic transitions','');
  lines.push('| From | To | Surface | Count |');lines.push('|---|---|---|---:|');
  for(const t of (report.memory?.transitions||[]).slice(0,30))lines.push(`| ${esc(t.fromTopic)} | ${esc(t.toTopic)} | ${esc(t.surface)} | ${t.count} |`);
  lines.push('','### Query audit','');
  lines.push('| Query | Kind | Allowed | Reason | Title overlap |');lines.push('|---|---|---|---|---:|');
  for(const q of report.queryAudit||[])lines.push(`| ${esc(q.query)} | ${esc(q.kind||'')} | ${q.allowed?'yes':'no'} | ${esc(q.reason)} | ${q.titleOverlap??0} |`);
  lines.push('','> Query planner never receives permission to search the target video ID, target URL, exact title, or near-exact title. The exact target ID is used only for API profiling and success verification.');
  return lines.join('\n')+'\n';
}

class Reporter{
  constructor(root,runId){this.root=root;this.runId=runId;fs.mkdirSync(root,{recursive:true});}
  paths(batchIndex){const base=`${this.runId}-batch-${String(batchIndex).padStart(4,'0')}`;return {json:path.join(this.root,`${base}.json`),md:path.join(this.root,`${base}.md`),latest:path.join(this.root,`${this.runId}-latest.json`)};}
  write(report,batchIndex){const p=this.paths(batchIndex);atomicWrite(p.json,report);fs.writeFileSync(p.md,reportMarkdown(report));atomicWrite(p.latest,report);return p;}
}

module.exports={Reporter,reportMarkdown,foundMethod,topicCounts};
