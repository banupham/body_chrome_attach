'use strict';

const WATCH_PATH_RE = /^\/(?:watch|shorts\/)/i;
const DURATION_ONLY_RE = /^(?:▶\s*)?(?:\d{1,2}:)?\d{1,2}:\d{2}(?:\s*(?:Đang phát|Now playing))?$/iu;
const NOISE_ONLY_RE = /^(?:Đang phát|Now playing|Mix|Playlist|Shorts?)$/iu;
const CARD_SELECTORS = [
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-grid-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-playlist-panel-video-renderer',
  'yt-lockup-view-model',
  'ytm-shorts-lockup-view-model',
  'ytd-radio-renderer',
  'ytd-playlist-renderer'
];

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function safeUrl(raw, base = 'https://www.youtube.com/') {
  try { return new URL(String(raw || ''), base); } catch { return null; }
}

function youtubeRoute(locationRef = globalThis.location) {
  const u = safeUrl(locationRef?.href || 'https://www.youtube.com/');
  if (!u) return { pageType:'other', path:'/', videoId:'', listId:'', isRadio:false };
  const path = u.pathname || '/';
  const videoId = path.startsWith('/shorts/') ? cleanText(path.split('/')[2] || '') : cleanText(u.searchParams.get('v') || '');
  const listId = cleanText(u.searchParams.get('list') || '');
  const isRadio = /^RD/i.test(listId) || u.searchParams.get('start_radio') === '1';
  let pageType = 'other';
  if (path === '/') pageType = 'home';
  else if (path === '/results') pageType = 'search';
  else if (path === '/watch') pageType = isRadio ? 'watch_radio' : 'watch';
  else if (path.startsWith('/shorts/')) pageType = 'shorts';
  else if (path.startsWith('/playlist')) pageType = 'playlist';
  else if (path.startsWith('/feed/')) pageType = 'feed';
  else if (/^\/(?:@|channel\/|c\/|user\/)/.test(path)) pageType = 'channel';
  const allowed = new URLSearchParams();
  for (const key of ['v','list','index','start_radio']) if (u.searchParams.has(key)) allowed.set(key, u.searchParams.get(key));
  return {
    pageType,
    path: `${path}${allowed.toString() ? `?${allowed.toString()}` : ''}`,
    videoId,
    listId,
    isRadio
  };
}

function isDurationOnly(value) {
  const text = cleanText(value);
  return !text || DURATION_ONLY_RE.test(text) || NOISE_ONLY_RE.test(text);
}

function stripDurationNoise(value) {
  let text = cleanText(value);
  text = text.replace(/^(?:▶\s*)?(?:(?:\d{1,2}:)?\d{1,2}:\d{2}\s*){1,2}(?:Đang phát\s*)?/iu, '').trim();
  return text;
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const text = cleanText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function titleCandidates(card, anchor) {
  const rows = [];
  const push = (value, weight, source) => {
    const raw = cleanText(value);
    const text = stripDurationNoise(raw);
    if (!text || isDurationOnly(text)) return;
    rows.push({ text, weight, source });
  };

  push(anchor?.getAttribute?.('title'), 120, 'anchor.title');
  push(anchor?.getAttribute?.('aria-label'), 110, 'anchor.aria-label');

  const selectors = [
    '#video-title',
    'a#video-title',
    'yt-formatted-string#video-title',
    '.yt-lockup-metadata-view-model__title',
    '.yt-lockup-metadata-view-model__title span',
    'h3 a[href*="/watch"]',
    'h3 a[href*="/shorts/"]',
    'h3',
    '[data-title]'
  ];
  for (const selector of selectors) {
    let nodes = [];
    try { nodes = [...(card?.querySelectorAll?.(selector) || [])]; } catch {}
    for (const node of nodes) {
      push(node.getAttribute?.('title'), 115, `${selector}.title`);
      push(node.getAttribute?.('aria-label'), 108, `${selector}.aria-label`);
      push(node.getAttribute?.('data-title'), 105, `${selector}.data-title`);
      push(node.textContent, selector.includes('video-title') ? 100 : 82, `${selector}.text`);
    }
  }

  let parent = anchor?.parentElement || null;
  for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) {
    push(parent.getAttribute?.('aria-label'), 92 - depth, 'ancestor.aria-label');
    push(parent.getAttribute?.('title'), 88 - depth, 'ancestor.title');
  }

  return rows;
}

function chooseSemanticTitle(card, anchor) {
  const candidates = titleCandidates(card, anchor);
  if (!candidates.length) return { title:null, titleSource:null, semantic:false };
  candidates.sort((a,b) => {
    const score = row => row.weight + Math.min(50, row.text.length / 2) - (row.text.length < 6 ? 30 : 0);
    return score(b) - score(a);
  });
  const best = candidates[0];
  return { title:best.text, titleSource:best.source, semantic:true };
}

function closestCard(anchor) {
  for (const selector of CARD_SELECTORS) {
    try {
      const card = anchor?.closest?.(selector);
      if (card) return card;
    } catch {}
  }
  return anchor?.parentElement || anchor || null;
}

function rectOf(node) {
  try {
    const r = node?.getBoundingClientRect?.();
    if (!r || ![r.x,r.y,r.width,r.height].every(Number.isFinite) || r.width <= 1 || r.height <= 1) return null;
    return {
      x:r.x,
      y:r.y,
      width:r.width,
      height:r.height,
      centerX:r.x + r.width / 2,
      centerY:r.y + r.height / 2
    };
  } catch { return null; }
}

function isVisibleRect(rect, windowRef = globalThis.window) {
  if (!rect) return false;
  const w = Number(windowRef?.innerWidth || 0), h = Number(windowRef?.innerHeight || 0);
  return rect.width > 1 && rect.height > 1 && rect.x < w && rect.y < h && rect.x + rect.width > 0 && rect.y + rect.height > 0;
}

function candidateFromAnchor(anchor, surface, position, { windowRef = globalThis.window } = {}) {
  const href = anchor?.getAttribute?.('href') || anchor?.href || '';
  const u = safeUrl(href);
  if (!u || u.hostname && !/(^|\.)youtube\.com$/i.test(u.hostname)) return null;
  const path = u.pathname || '';
  if (!WATCH_PATH_RE.test(path)) return null;
  const videoId = path.startsWith('/shorts/') ? cleanText(path.split('/')[2] || '') : cleanText(u.searchParams.get('v') || '');
  if (!videoId) return null;
  const card = closestCard(anchor);
  const semantic = chooseSemanticTitle(card, anchor);
  const listId = cleanText(u.searchParams.get('list') || '');
  const isRadio = /^RD/i.test(listId) || u.searchParams.get('start_radio') === '1';
  const anchorRect = rectOf(anchor);
  const cardRect = rectOf(card);
  const actionRect = anchorRect || cardRect;
  const channelNodes = [];
  for (const selector of ['#channel-name', 'ytd-channel-name', '.yt-lockup-metadata-view-model__metadata', '[class*="channel-name"]']) {
    try { channelNodes.push(...(card?.querySelectorAll?.(selector) || [])); } catch {}
  }
  const channel = uniqueStrings(channelNodes.map(n => n.textContent))[0] || null;
  const metadataNodes = [];
  for (const selector of ['#metadata-line span', '#metadata span', '.inline-metadata-item', '.yt-content-metadata-view-model__metadata-text']) {
    try { metadataNodes.push(...(card?.querySelectorAll?.(selector) || [])); } catch {}
  }
  const metadata = uniqueStrings(metadataNodes.map(n => n.textContent)).slice(0, 8);
  const durationNodes = [];
  for (const selector of ['ytd-thumbnail-overlay-time-status-renderer', '[class*="badge-shape-wiz__text"]', '[aria-label*="minute"]', '[aria-label*="second"]']) {
    try { durationNodes.push(...(card?.querySelectorAll?.(selector) || [])); } catch {}
  }
  const durationText = uniqueStrings(durationNodes.map(n => n.textContent).filter(isDurationOnly))[0] || null;
  const kept = new URLSearchParams();
  for (const key of ['v','list','index','start_radio']) if (u.searchParams.has(key)) kept.set(key, u.searchParams.get(key));
  return {
    surface,
    position,
    videoId,
    listId:listId || null,
    isRadio,
    path:`${path}${kept.toString() ? `?${kept.toString()}` : ''}`,
    title:semantic.title,
    titleSource:semantic.titleSource,
    semanticTitle:semantic.semantic,
    channel,
    metadata,
    durationText,
    visible:isVisibleRect(actionRect, windowRef),
    actionRect
  };
}

function rootsForSurface(documentRef, surface) {
  const selectors = {
    home_feed:[
      'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer',
      'ytd-browse[page-subtype="home"] #contents',
      'ytd-browse[page-subtype="home"]',
      'ytd-rich-grid-renderer'
    ],
    search_results:['ytd-search #contents','ytd-search'],
    related:['#related','#secondary-inner','ytd-watch-next-secondary-results-renderer','#secondary'],
    mix_queue:['ytd-playlist-panel-renderer']
  }[surface] || [];
  for (const selector of selectors) {
    try {
      const root = documentRef?.querySelector?.(selector);
      if (root) return { root, rootSelector:selector };
    } catch {}
  }
  return { root:null, rootSelector:null };
}

function anchorsIn(root, surface) {
  if (!root) return [];
  let anchors = [];
  try { anchors = [...root.querySelectorAll('a[href*="/watch"], a[href*="/shorts/"]')]; } catch {}
  if (surface === 'related') {
    anchors = anchors.filter(a => {
      try { return !a.closest('ytd-playlist-panel-renderer'); } catch { return true; }
    });
  }
  return anchors;
}

function cardModelCounts(anchors) {
  const counts = {};
  for (const anchor of anchors) {
    const card = closestCard(anchor);
    const tag = cleanText(card?.tagName || '').toUpperCase();
    if (!tag) continue;
    counts[tag] = (counts[tag] || 0) + 1;
  }
  return counts;
}

function extractSurface(documentRef, surface, options = {}) {
  const { root, rootSelector } = rootsForSurface(documentRef, surface);
  const anchors = anchorsIn(root, surface);
  const maxItems = Math.max(1, Math.min(100, Number(options.maxItems || 50)));
  const items = [];
  const seen = new Set();
  for (const anchor of anchors) {
    const item = candidateFromAnchor(anchor, surface, items.length + 1, options);
    if (!item || seen.has(item.videoId)) continue;
    seen.add(item.videoId);
    item.position = items.length + 1;
    items.push(item);
    if (items.length >= maxItems) break;
  }
  const semanticCount = items.filter(x => x.semanticTitle && x.title).length;
  return {
    surface,
    diagnostics:{
      rootSelector,
      candidateAnchors:anchors.length,
      extractedItems:items.length,
      semanticTitleItems:semanticCount,
      semanticCoverage:items.length ? semanticCount / items.length : 0,
      cardModels:cardModelCounts(anchors),
      extractorVersion:3
    },
    items
  };
}

function controlDescriptor(node, name, windowRef = globalThis.window) {
  if (!node) return null;
  const rect = rectOf(node);
  if (!rect) return null;
  return { name, tag:cleanText(node.tagName || '').toLowerCase(), visible:isVisibleRect(rect, windowRef), actionRect:rect };
}

function firstNode(documentRef, selectors) {
  for (const selector of selectors) {
    try {
      const node = documentRef?.querySelector?.(selector);
      if (node) return node;
    } catch {}
  }
  return null;
}

function extractControls(documentRef, windowRef = globalThis.window) {
  const searchInput = firstNode(documentRef, [
    'input#search',
    'input[name="search_query"]',
    'ytd-searchbox input',
    'yt-searchbox input',
    'input[placeholder*="Search"]',
    'input[placeholder*="Tìm kiếm"]'
  ]);
  const searchButton = firstNode(documentRef, [
    'button#search-icon-legacy',
    'ytd-searchbox button[aria-label]',
    'yt-searchbox button[aria-label]',
    'button[aria-label*="Search"]',
    'button[aria-label*="Tìm kiếm"]'
  ]);
  const homeLink = firstNode(documentRef, [
    'ytd-topbar-logo-renderer a[href="/"]',
    'a#logo[href="/"]',
    'a[title="YouTube Home"]',
    'a[aria-label="YouTube Home"]',
    'a[href="/"]'
  ]);
  return {
    searchInput:controlDescriptor(searchInput, 'search_input', windowRef),
    searchButton:controlDescriptor(searchButton, 'search_button', windowRef),
    homeLink:controlDescriptor(homeLink, 'home_link', windowRef)
  };
}

function currentVideoDescriptor(documentRef, route) {
  if (!route?.videoId) return null;
  const titleNode = firstNode(documentRef, [
    'ytd-watch-metadata h1 yt-formatted-string',
    'ytd-watch-metadata h1',
    '#title h1 yt-formatted-string',
    '#title h1',
    'h1.title'
  ]);
  const channelNode = firstNode(documentRef, [
    'ytd-watch-metadata ytd-channel-name',
    '#owner ytd-channel-name',
    '#channel-name'
  ]);
  let title = stripDurationNoise(titleNode?.textContent || '');
  if (!title || isDurationOnly(title)) {
    const docTitle = cleanText(documentRef?.title || '').replace(/\s*-\s*YouTube\s*$/i, '').trim();
    if (docTitle && !isDurationOnly(docTitle)) title = docTitle;
  }
  return {
    videoId:route.videoId,
    listId:route.listId || null,
    isRadio:route.isRadio === true,
    title:title || null,
    semanticTitle:Boolean(title),
    channel:cleanText(channelNode?.textContent || '') || null,
    metadata:[]
  };
}

function signedInState(documentRef) {
  try {
    if (documentRef?.querySelector?.('a[href*="accounts.google.com/ServiceLogin"], a[href*="ServiceLogin"]')) return 'signed_out';
    if (documentRef?.querySelector?.('button#avatar-btn, ytd-topbar-menu-button-renderer button#avatar-btn')) return 'signed_in';
  } catch {}
  return 'unknown';
}

function youtubeObservation({ documentRef = globalThis.document, windowRef = globalThis.window, locationRef = globalThis.location, maxItems = 50 } = {}) {
  const route = youtubeRoute(locationRef);
  const surfaces = [];
  if (route.pageType === 'home') surfaces.push(extractSurface(documentRef, 'home_feed', { windowRef, maxItems }));
  if (route.pageType === 'search') surfaces.push(extractSurface(documentRef, 'search_results', { windowRef, maxItems }));
  if (['watch','watch_radio'].includes(route.pageType)) {
    surfaces.push(extractSurface(documentRef, 'related', { windowRef, maxItems }));
    surfaces.push(extractSurface(documentRef, 'mix_queue', { windowRef, maxItems }));
  }
  return {
    available:true,
    platform:'youtube',
    observedAt:Date.now(),
    route,
    currentVideo:currentVideoDescriptor(documentRef, route),
    signedInState:signedInState(documentRef),
    controls:extractControls(documentRef, windowRef),
    viewport:{ width:Number(windowRef?.innerWidth || 0), height:Number(windowRef?.innerHeight || 0) },
    surfaces
  };
}

module.exports = {
  CARD_SELECTORS,
  cleanText,
  isDurationOnly,
  stripDurationNoise,
  youtubeRoute,
  chooseSemanticTitle,
  candidateFromAnchor,
  extractSurface,
  extractControls,
  currentVideoDescriptor,
  youtubeObservation
};
