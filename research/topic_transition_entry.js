'use strict';

const { BrainClient, parseArgs } = require('./topic_transition_runner');
const { YouTubeEnrichedTopicTransitionRunner } = require('./youtube_enriched_runner');

const UNIQUENESS_REASONS = new Set(['DUPLICATE_PUBLIC_EGRESS', 'DUPLICATE_ENVIRONMENT_SIGNATURE']);

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0))); }
function waitSeconds(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i++) {
    const raw = String(argv[i] || '');
    if (raw.startsWith('--browser-wait-sec=')) return Math.max(1, Number(raw.split('=')[1]) || 30);
    if (raw === '--browser-wait-sec' && argv[i + 1]) return Math.max(1, Number(argv[i + 1]) || 30);
  }
  return Math.max(1, Number(process.env.BODY_RESEARCH_BROWSER_WAIT_SEC || 30) || 30);
}

function diagnosticRows(status) {
  return (status?.browsers || []).map(browser => ({
    browserInstanceId: browser.browserInstanceId,
    extensionInstanceId: browser.extensionInstanceId || null,
    deviceId: browser.deviceId || null,
    online: browser.online === true,
    state: browser.state || null,
    stateReason: browser.stateReason || null,
    environmentStatus: browser.environment?.status || null,
    environmentEligible: browser.environment?.eligible === true,
    publicIp: browser.environment?.publicIp || null,
    environmentSignature: browser.environment?.environmentSignature || null,
    reasons: Array.isArray(browser.environment?.reasons) ? browser.environment.reasons : [],
    tabCount: Number(browser.tabCount || browser.tabs?.length || 0),
    youtubeTabs: (browser.tabs || []).filter(tab => String(tab.siteKey || '').includes('youtube.com')).map(tab => ({ id: tab.id, active: tab.active === true, title: tab.title || '' }))
  }));
}

function hasEligibleBrowser(status, explicitBrowser = null) {
  return (status?.browsers || []).some(browser =>
    browser.online === true &&
    browser.environment?.eligible === true &&
    !['QUARANTINED', 'ERROR', 'OFFLINE'].includes(String(browser.state || '')) &&
    (!explicitBrowser || browser.browserInstanceId === explicitBrowser)
  );
}

function chooseProbeTarget(status, explicitBrowser = null) {
  const online = diagnosticRows(status).filter(row => row.online);
  if (explicitBrowser) return online.find(row => row.browserInstanceId === explicitBrowser)?.browserInstanceId || null;
  const youtube = online.filter(row => row.youtubeTabs.length > 0);
  if (youtube.length === 1) return youtube[0].browserInstanceId;
  if (online.length === 1) return online[0].browserInstanceId;
  return null;
}

function uniquenessConflict(status, explicitBrowser = null) {
  const online = diagnosticRows(status).filter(row => row.online);
  const targets = explicitBrowser
    ? online.filter(row => row.browserInstanceId === explicitBrowser)
    : online.filter(row => row.youtubeTabs.length > 0);
  for (const target of targets) {
    for (const reason of target.reasons) {
      if (!UNIQUENESS_REASONS.has(reason)) continue;
      const peers = online.filter(peer => {
        if (peer.browserInstanceId === target.browserInstanceId || !peer.reasons.includes(reason)) return false;
        if (reason === 'DUPLICATE_PUBLIC_EGRESS' && target.publicIp && peer.publicIp) return target.publicIp === peer.publicIp;
        if (reason === 'DUPLICATE_ENVIRONMENT_SIGNATURE' && target.environmentSignature && peer.environmentSignature) return target.environmentSignature === peer.environmentSignature;
        return true;
      });
      if (peers.length) {
        return {
          reason,
          targetBrowserInstanceId: target.browserInstanceId,
          targetTabIds: target.youtubeTabs.map(tab => tab.id),
          peerBrowserInstanceIds: peers.map(peer => peer.browserInstanceId),
          peerYoutubeTabCounts: peers.map(peer => ({ browserInstanceId: peer.browserInstanceId, youtubeTabCount: peer.youtubeTabs.length }))
        };
      }
    }
  }
  return null;
}

function compactDiagnostics(status) {
  const rows = diagnosticRows(status);
  return {
    online: rows.filter(row => row.online).map(row => ({
      browserInstanceId: row.browserInstanceId,
      state: row.state,
      environmentStatus: row.environmentStatus,
      environmentEligible: row.environmentEligible,
      reasons: row.reasons,
      tabCount: row.tabCount,
      youtubeTabs: row.youtubeTabs
    })),
    offlineCount: rows.filter(row => !row.online).length
  };
}

function conflictHint(conflict) {
  if (!conflict) return null;
  const peers = conflict.peerBrowserInstanceIds.join(',');
  if (conflict.reason === 'DUPLICATE_PUBLIC_EGRESS') {
    return `Environment Guardian blocked ${conflict.targetBrowserInstanceId}: DUPLICATE_PUBLIC_EGRESS with ${peers}. Close the extra BODY-managed Browser instance(s), or give each Browser a distinct direct egress if uniqueness is intentional. The research runner will not disable this guardrail.`;
  }
  return `Environment Guardian blocked ${conflict.targetBrowserInstanceId}: DUPLICATE_ENVIRONMENT_SIGNATURE with ${peers}. Close the duplicate BODY-managed Browser instance(s) or correct the Browser identity/environment separation. The research runner will not disable this guardrail.`;
}

async function waitForEligibleBrowser(config, { waitSec = waitSeconds() } = {}) {
  const client = new BrainClient({ url: config.url, tokenPath: config.tokenPath, controllerId: 'topic-transition-preflight' });
  const deadline = Date.now() + waitSec * 1000;
  let lastStatus = null;
  let probeAttempted = false;
  let lastPrinted = null;
  let lastConflictText = null;
  try {
    while (Date.now() <= deadline) {
      lastStatus = await client.request('BODY_STATUS');
      if (hasEligibleBrowser(lastStatus, config.browser)) {
        const row = diagnosticRows(lastStatus).find(x => x.environmentEligible && (!config.browser || x.browserInstanceId === config.browser));
        console.log('[PREFLIGHT] eligible browser ready:', JSON.stringify(row));
        return row;
      }

      const compact = compactDiagnostics(lastStatus);
      const signature = JSON.stringify(compact);
      if (signature !== lastPrinted) {
        lastPrinted = signature;
        console.log('[PREFLIGHT] waiting for eligible browser:', signature);
      }

      const online = compact.online;
      if (!probeAttempted && online.length) {
        probeAttempted = true;
        const probeTarget = chooseProbeTarget(lastStatus, config.browser);
        try {
          if (probeTarget) {
            await client.request('ENVIRONMENT_PROBE', { browserInstanceId: probeTarget });
            console.log(`[PREFLIGHT] requested Environment Guardian re-probe for ${probeTarget}.`);
          } else {
            await client.request('ENVIRONMENT_PROBE_ALL');
            console.log('[PREFLIGHT] requested Environment Guardian re-probe for all online Browsers.');
          }
        } catch (error) {
          console.log('[PREFLIGHT] Guardian re-probe did not complete:', String(error?.message || error));
        }
      }

      const conflict = uniquenessConflict(lastStatus, config.browser);
      const hint = conflictHint(conflict);
      if (hint && hint !== lastConflictText) {
        lastConflictText = hint;
        console.log('[PREFLIGHT] environment conflict:', hint);
      }
      await sleep(1000);
    }
  } finally {
    await client.close().catch(() => {});
  }

  const conflict = uniquenessConflict(lastStatus, config.browser);
  const error = conflict
    ? new Error(`no_eligible_browser_after_${waitSec}s:${conflict.reason}:target=${conflict.targetBrowserInstanceId}:peers=${conflict.peerBrowserInstanceIds.join(',')}`)
    : new Error(`no_eligible_browser_after_${waitSec}s:${JSON.stringify(compactDiagnostics(lastStatus))}`);
  error.code = conflict ? 'environment_uniqueness_conflict' : 'no_eligible_browser';
  error.conflict = conflict;
  throw error;
}

async function main() {
  const config = parseArgs();
  await waitForEligibleBrowser(config);
  const runner = new YouTubeEnrichedTopicTransitionRunner(config);
  return runner.run();
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { UNIQUENESS_REASONS, diagnosticRows, hasEligibleBrowser, chooseProbeTarget, uniquenessConflict, compactDiagnostics, conflictHint, waitForEligibleBrowser, waitSeconds, main };
