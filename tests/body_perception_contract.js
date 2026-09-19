'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { nodeView } = require('../src/dom_perception');
const { youtubeSemanticObservation, interactiveAffordances, candidateFromAnchor, searchControls } = require('../src/youtube_semantic_observer');

const rect = { x: 20, y: 200, width: 200, height: 100 };
const style = { display: 'block', visibility: 'visible', opacity: '1' };
const win = { innerWidth: 1000, innerHeight: 700, getComputedStyle: n => n.style || style };
function node(extra = {}) {
  return {
    tagName: 'A', textContent: 'Video example', parentElement: null,
    getBoundingClientRect: () => rect,
    getAttribute: name => ({ href: '/watch?v=candidate01', title: 'Video example' })[name] || null,
    closest: () => null, querySelectorAll: () => [], ...extra
  };
}

const link = node(), doc = { querySelectorAll: () => [link], elementFromPoint: () => link };
link.ownerDocument = doc;
assert.equal(interactiveAffordances(doc, win).length, 1);
link.style = { ...style, visibility: 'hidden' };
assert.equal(interactiveAffordances(doc, win).length, 0);
delete link.style;
link.parentElement = node({ hidden: true });
const hiddenView=nodeView(link, rect, { documentRef: doc, windowRef: win });
assert.equal(hiddenView.visible, false);
assert.equal(hiddenView.evidence.explicitHidden, true);
assert.equal(Object.hasOwn(hiddenView, 'reason'), false);
link.parentElement = null;
doc.elementFromPoint = () => node({ tagName: 'DIALOG' });
const covered = candidateFromAnchor(link, 'related', 1, { windowRef: win });
assert.equal(covered.visible, true);
assert.equal(covered.hitTested, true);
assert.equal(covered.hitSamples.some(row => row.owned), false);
assert.equal(Object.hasOwn(covered, 'actionable'), false);
assert.equal(Object.hasOwn(covered, 'actionPoint'), false);
assert.equal(Object.hasOwn(covered, 'reason'), false);
doc.elementFromPoint = x => x > 150 ? link : node({ tagName: 'DIALOG' });
const partial = nodeView(link, rect, { documentRef: doc, windowRef: win });
assert.equal(partial.hitTested, true);
assert.ok(partial.hitSamples.some(row => row.owned && row.x > 150));
assert.equal(Object.hasOwn(partial, 'actionable'), false);
assert.equal(Object.hasOwn(partial, 'actionPoint'), false);
link.parentElement = node({ style: { ...style, overflow: 'hidden' }, getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 100 }) });
const clipped=nodeView(link, rect, { documentRef: doc, windowRef: win });
assert.equal(clipped.evidence.rectIntersectsViewport, true);
assert.equal(clipped.evidence.clippedByContainer, true);
assert.equal(clipped.evidence.clippedRect, null);
assert.equal(clipped.hitTested, true);
assert.equal(Object.hasOwn(clipped, 'reason'), false);
link.parentElement = null;

const hiddenInput = node({ hidden: true, tagName: 'INPUT' });
const input = node({ tagName: 'INPUT', value: 'private input value' });
const inputDoc = { activeElement: input, querySelectorAll: s => s === 'input#search' ? [hiddenInput, input] : [], elementFromPoint: () => input };
assert.equal(searchControls(inputDoc, win).searchInput.visible, true);
assert.equal(searchControls(inputDoc, win).searchInput.active, true);
const password = node({ tagName: 'INPUT', value: 'secret password', getAttribute: n => n === 'type' ? 'password' : null });
const passwordView = interactiveAffordances({ querySelectorAll: () => [password], elementFromPoint: () => password }, win)[0];
assert.equal(passwordView.editable, false);
assert.equal(Object.hasOwn(passwordView.state, 'valueFingerprint'), false);

const ad = node({ textContent: 'Get quote', closest: selector => selector.includes('companion') ? {} : null });
assert.equal(interactiveAffordances({ querySelectorAll: () => [ad] }, win)[0].sponsored, true);
const error = node({ tagName: 'DIV', textContent: 'Không xem được nội dung này. Vui lòng thử lại sau.', getAttribute: () => null });
const dialog = node({ tagName: 'DIALOG', textContent: 'Page dialog', getAttribute: n => ({ role: 'dialog', 'aria-modal': 'true' })[n] || null });
const channelRoot = { querySelectorAll: () => [link], getBoundingClientRect: () => rect };
const channelDoc = {
  hasFocus: () => false, visibilityState: 'visible',
  querySelector: s => s === 'ytd-browse[page-subtype="channels"]' ? channelRoot : null,
  querySelectorAll: s => s.includes('.ytp-error-content') ? [error] : s.includes('dialog[open]') ? [dialog] : [],
  elementFromPoint: () => error
};
dialog.contains = hit => hit === error;

// Reject any DOM writes or event/action calls during an entire observation.
const attemptedWrites = [];
const reject = name => () => { attemptedWrites.push(name); throw new Error(`observer attempted ${name}`); };
for (const target of [link, error, dialog, channelRoot, channelDoc, win]) {
  for (const method of ['click', 'focus', 'blur', 'scroll', 'scrollTo', 'scrollIntoView', 'dispatchEvent', 'setAttribute', 'appendChild', 'removeChild', 'remove', 'insertAdjacentHTML', 'addEventListener']) target[method] = reject(method);
  for (const key of ['innerHTML', 'outerHTML']) Object.defineProperty(target, key, { set: reject(key) });
  Object.freeze(target);
}
const scene = youtubeSemanticObservation({ documentRef: channelDoc, windowRef: win, locationRef: { href: 'https://www.youtube.com/channel/example' } });
assert.equal(scene.route.pageType, 'channel');
assert.equal(scene.surfaces[0].surface, 'channel_feed');
assert.equal(scene.surfaces[0].items[0].videoId, 'candidate01');
assert.ok(scene.scene.errors[0].label.includes('Không xem được'));
assert.equal(scene.scene.dialogs[0].modal, true);
assert.equal(scene.scene.browserUi.observed, false);
assert.equal(scene.scene.browserUi.state, 'focus_outside_document');
assert.equal(scene.scene.browserUi.reason, 'native_chrome_ui_outside_dom');
assert.deepEqual(attemptedWrites, []);
assert.equal(JSON.stringify(scene).includes('private input value'), false);

for (const file of ['dom_perception.js', 'youtube_semantic_observer.js']) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
  for (const forbidden of ['.click(', '.focus(', '.scrollIntoView(', '.dispatchEvent(', '.setAttribute(', '.appendChild(', 'chrome.debugger', 'Input.dispatch', 'Runtime.evaluate', 'sendCommand(']) {
    assert.equal(source.includes(forbidden), false, `${file}: forbidden action ${forbidden}`);
  }
}
console.log('body_perception_contract: PASS (read-only raw geometry/style/hit evidence, focus, dialogs, errors, controls, channel feed)');
