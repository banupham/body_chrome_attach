
'use strict';

const fs = require('node:fs');
const path = require('node:path');

class DatasetStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    fs.mkdirSync(baseDir, {recursive:true});

    this.humanSamplesPath = path.join(baseDir, 'human_samples.jsonl');
    this.humanEventsPath = path.join(baseDir, 'human_events.jsonl');
    this.agentEventsPath = path.join(baseDir, 'agent_events.jsonl');

    this.counts = {
      humanSamples: this._lineCount(this.humanSamplesPath),
      humanEvents: this._lineCount(this.humanEventsPath),
      agentEvents: this._lineCount(this.agentEventsPath)
    };
  }

  _lineCount(file) {
    if (!fs.existsSync(file)) return 0;
    const text = fs.readFileSync(file, 'utf8');
    if (!text.trim()) return 0;
    return text.split(/\r?\n/).filter(Boolean).length;
  }

  _append(file, obj) {
    fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8');
  }

  appendEvent(tabId, event) {
    const row = { tabId, ...event };

    if (event.source === 'agent') {
      this._append(this.agentEventsPath, row);
      this.counts.agentEvents++;
      return;
    }

    if (event.source === 'human') {
      this._append(this.humanEventsPath, row);
      this.counts.humanEvents++;
    }
  }

  appendHumanSample(sample) {
    if (sample?.source !== 'human') {
      throw new Error('only_human_samples_can_be_ground_truth');
    }
    this._append(this.humanSamplesPath, sample);
    this.counts.humanSamples++;
  }

  loadHumanSamples() {
    if (!fs.existsSync(this.humanSamplesPath)) return [];
    return fs.readFileSync(this.humanSamplesPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line));
  }

  stats() {
    return {...this.counts};
  }
}

module.exports = { DatasetStore };
