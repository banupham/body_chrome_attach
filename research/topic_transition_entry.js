'use strict';

const { BrainClient, TopicTransitionRunner, parseArgs } = require('./topic_transition_runner');

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
    online: browser.online === true,
    state: browser.state || null,
    stateReason: browser.stateReason || null,
    environmentStatus: browser.environment?.status || null,
    environmentEligible: browser.environment?.eligible === true,
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

async function waitForEligibleBrowser(config, { waitSec = waitSeconds() } = {}) {
  const client = new BrainClient({ url: config.url, tokenPath: config.tokenPath, controllerId: 'topic-transition-preflight' });
  const deadline = Date.now() + waitSec * 1000;
  let lastStatus = null;
  let probeAttempted = false;
  try {
    while (Date.now() <= deadline) {
      lastStatus = await client.request('BODY_STATUS');
      if (hasEligibleBrowser(lastStatus, config.browser)) {
        const row = diagnosticRows(lastStatus).find(x => x.environmentEligible && (!config.browser || x.browserInstanceId === config.browser));
        console.log('[PREFLIGHT] eligible browser ready:', JSON.stringify(row));
        return row;
      }

      const diagnostics = diagnosticRows(lastStatus);
      console.log('[PREFLIGHT] waiting for eligible browser:', JSON.stringify(diagnostics));

      const online = diagnostics.filter(x => x.online);
      if (!probeAttempted && online.length) {
        probeAttempted = true;
        try {
          await client.request('ENVIRONMENT_PROBE_ALL');
          console.log('[PREFLIGHT] requested Environment Guardian re-probe.');
        } catch (error) {
          console.log('[PREFLIGHT] Guardian re-probe did not complete:', String(error?.message || error));
        }
      }
      await sleep(1000);
    }
  } finally {
    await client.close().catch(() => {});
  }

  const diagnostics = diagnosticRows(lastStatus);
  const error = new Error(`no_eligible_browser_after_${waitSec}s:${JSON.stringify(diagnostics)}`);
  error.code = 'no_eligible_browser';
  throw error;
}

async function main() {
  const config = parseArgs();
  await waitForEligibleBrowser(config);
  const runner = new TopicTransitionRunner(config);
  return runner.run();
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { diagnosticRows, hasEligibleBrowser, waitForEligibleBrowser, waitSeconds, main };
