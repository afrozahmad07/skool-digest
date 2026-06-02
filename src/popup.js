// popup.js — Skool Daily Digest UI v4

import { Storage } from './storage.js';
import { generateDigest, PROVIDERS } from './api.js';

let settings = {};
let isRunning = false;
let currentDigest = null;
let isDark = true;

// ── Boot ──
document.addEventListener('DOMContentLoaded', async () => {
  settings = await Storage.getSettings();
  
  // Load theme preference
  const themeData = await Storage.get(['theme']);
  isDark = themeData.theme !== 'light';
  applyTheme();

  setupTabs();
  setupSettings();
  await initDigest();
});

// ── Theme ──
function applyTheme() {
  document.body.classList.toggle('light-mode', !isDark);
  const btn = document.getElementById('btnTheme');
  if (btn) btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  if (btn) btn.innerHTML = isDark ? sunIcon() : moonIcon();
}

function sunIcon() {
  return `<svg viewBox="0 0 14 14" fill="none" width="13" height="13"><circle cx="7" cy="7" r="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.93 2.93l1.06 1.06M10.01 10.01l1.06 1.06M2.93 11.07l1.06-1.06M10.01 3.99l1.06-1.06" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
}

function moonIcon() {
  return `<svg viewBox="0 0 14 14" fill="none" width="13" height="13"><path d="M11.5 8.5A5 5 0 0 1 5.5 2.5a5 5 0 1 0 6 6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
}

async function toggleTheme() {
  isDark = !isDark;
  await Storage.set({ theme: isDark ? 'dark' : 'light' });
  applyTheme();
}

// ── Tab switching ──
function setupTabs() {
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => switchTab(t.dataset.tab))
  );
  document.getElementById('btnSettings').addEventListener('click', () => switchTab('settings'));
  document.getElementById('btnRefresh').addEventListener('click', clearCache);
  document.getElementById('btnTheme').addEventListener('click', toggleTheme);
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name)
  );
  document.getElementById('panelDigest').style.display   = name === 'digest'   ? 'block' : 'none';
  document.getElementById('panelSettings').style.display = name === 'settings' ? 'block' : 'none';
}

// ── Digest panel init ──
async function initDigest() {
  const key = Storage.getActiveKey(settings);
  if (!key) { showNoKey(); return; }
  const cached = await Storage.getCachedDigest();
  if (cached) { currentDigest = cached; renderDigest(cached, true); return; }
  showReady();
}

function showNoKey() {
  document.getElementById('digestBody').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">🔑</div>
      <div class="empty-title">API Key Required</div>
      <div class="empty-text">Add an API key in the Settings tab to get started.</div>
    </div>`;
}

function showReady() {
  const providerName = PROVIDERS[settings.provider]?.name || 'AI';
  document.getElementById('digestBody').innerHTML = `
    <div class="run-wrap">
      <button class="run-btn" id="btnRun">
        <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 5v3l2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        Generate Feed Digest
      </button>
      <div class="status-bar">
        <span class="dot"></span>
        <span>Using <strong>${esc(providerName)}</strong> · Will auto-navigate to newest feed</span>
      </div>
    </div>`;
  document.getElementById('btnRun').addEventListener('click', runDigest);
}

async function clearCache() {
  await Storage.set({ lastDigest: null, lastDigestDate: null });
  currentDigest = null;
  showReady();
  switchTab('digest');
}

// ── Wait for a tab to finish loading ──
function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    // If already complete, resolve immediately
    chrome.tabs.get(tabId, t => {
      if (t?.status === 'complete') { resolve(); return; }
    });
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ── Run digest ──
async function runDigest() {
  if (isRunning) return;
  isRunning = true;

  // Find an existing Skool tab or create one, then navigate to community feed sorted by newest
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('skool.com')) {
    const [skoolTab] = await chrome.tabs.query({ url: 'https://www.skool.com/*' });
    tab = skoolTab || null;
  }

  const providerName = PROVIDERS[settings.provider]?.name || 'AI';
  setStatus('Loading community feed…');

  if (tab) {
    // Navigate existing Skool tab to community URL with newest sort
    await chrome.tabs.update(tab.id, { active: true, url: settings.communityUrl });
  } else {
    // No Skool tab at all — open one
    tab = await chrome.tabs.create({ url: settings.communityUrl });
  }

  // Wait for the page to fully load before scraping
  setStatus('Waiting for feed to load…');
  await waitForTabLoad(tab.id);

  setStatus('Scanning feed…');

  try {
    // content.js is already injected via manifest content_scripts — no need to re-inject
    const result = await chrome.tabs.sendMessage(tab.id, { action: 'scrapePosts' });
    const posts = result?.posts || [];
    const debug = result?.debug || [];

    if (posts.length === 0) {
      throw new Error(`No posts found.\nDebug: ${debug.join(' | ')}\n\nMake sure you are on the community feed page.`);
    }

    setStatus(`Found ${posts.length} posts · Sending to ${providerName}…`, true);

    const apiKey = Storage.getActiveKey(settings);
    const digest = await generateDigest(posts, settings.watchedMembers, apiKey, settings.provider);

    currentDigest = digest;
    await Storage.saveDigest(digest);
    clearStatusTimer();
    renderDigest(digest, false);

  } catch (err) {
    clearStatusTimer();
    document.getElementById('digestBody').innerHTML = `
      <div class="run-wrap">
        <button class="run-btn" id="btnRun">Try Again</button>
        <div class="error-box">${esc(err.message)}</div>
      </div>`;
    document.getElementById('btnRun')?.addEventListener('click', runDigest);
  } finally {
    isRunning = false;
  }
}

let _statusTimer = null;
function setStatus(msg, showElapsed = false) {
  if (_statusTimer) { clearInterval(_statusTimer); _statusTimer = null; }
  const id = 'statusElapsed';
  document.getElementById('digestBody').innerHTML = `
    <div class="run-wrap">
      <div class="status-bar">
        <span class="dot pulse"></span>
        <span>${esc(msg)}${showElapsed ? ` <span id="${id}" style="color:var(--muted)"></span>` : ''}</span>
      </div>
    </div>`;
  if (showElapsed) {
    let secs = 0;
    _statusTimer = setInterval(() => {
      const el = document.getElementById(id);
      if (el) el.textContent = `(${++secs}s…)`;
    }, 1000);
  }
}

function clearStatusTimer() {
  if (_statusTimer) { clearInterval(_statusTimer); _statusTimer = null; }
}

// ── Render digest ──
function renderDigest(digest, fromCache) {
  const posts = digest.all_posts || digest.top_posts || [];
  const trending = (digest.trending_topics || [])
    .map(t => `<span class="tag">${esc(t)}</span>`).join('');

  const postsHtml = posts.map(post => {
    const authorHtml = post.author_link
      ? `<a href="${esc(post.author_link)}" target="_blank">${esc(post.author)}</a>`
      : esc(post.author || 'Unknown');

    const tags = (post.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');
    const readLink = post.post_link
      ? `<a href="${esc(post.post_link)}" target="_blank" class="read-link">Read ↗</a>`
      : '';

    const likes    = post.likes    ?? post.engagement?.likes    ?? 0;
    const comments = post.comments ?? post.engagement?.comments ?? 0;

    return `
      <div class="post-card ${post.is_watched_member ? 'watched' : ''}">
        <div class="post-meta-top">
          <span class="rank">#${post.rank}</span>
          ${post.age ? `<span class="age-badge">${esc(post.age)}</span>` : ''}
          ${post.is_watched_member ? `<span class="watched-badge">⭐ Watched</span>` : ''}
        </div>
        <div class="post-title">${esc(post.title)}</div>
        <div class="post-why">${esc(post.why_it_matters)}</div>
        <div class="post-insight">${esc(post.key_insight)}</div>
        <div class="post-footer">
          <span class="post-author">by ${authorHtml}</span>
          <span class="engagement">
            <span class="eng-pill">
              <svg viewBox="0 0 14 14" fill="none" width="11" height="11"><path d="M2 9C2 9 1 8 1 6C1 4 2.5 2.5 4.5 2.5C5.5 2.5 6.3 3 7 4C7.7 3 8.5 2.5 9.5 2.5C11.5 2.5 13 4 13 6C13 8 7 12.5 7 12.5C7 12.5 2 9 2 9Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
              ${likes}
            </span>
            <span class="eng-pill">
              <svg viewBox="0 0 14 14" fill="none" width="11" height="11"><path d="M2 2h10v8H8.5L7 12l-1.5-2H2V2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
              ${comments}
            </span>
          </span>
          ${readLink}
        </div>
        ${tags ? `<div class="tags" style="margin-top:7px">${tags}</div>` : ''}
      </div>`;
  }).join('');

  document.getElementById('digestBody').innerHTML = `
    ${fromCache ? `<div class="cache-notice">Cached · <a id="linkFresh" href="#">Run fresh</a></div>` : ''}
    <div class="digest-header">
      <div class="digest-date">📅 ${esc(digest.digest_date || '')}</div>
      <div class="summary">${esc(digest.quick_summary || '')}</div>
      <div class="stats-row">
        <span class="stat-chip">📊 ${digest.total_posts_analyzed || posts.length} scanned</span>
        <span class="stat-chip">📋 ${posts.length} in digest</span>
        <span class="stat-chip">⭐ ${digest.posts_by_watched_members || 0} watched</span>
      </div>
    </div>

    <div class="export-row">
      <button class="export-btn" id="btnOpenMd" title="Open as Markdown in new tab">
        <svg viewBox="0 0 14 14" fill="none" width="12" height="12"><rect x="2" y="2" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M4.5 9V5l2 2 2-2v4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Open .md
      </button>
      <button class="export-btn" id="btnOpenHtml" title="Open as HTML in new tab">
        <svg viewBox="0 0 14 14" fill="none" width="12" height="12"><path d="M3 2l-2 5 2 5M11 2l2 5-2 5M6 11.5l2-9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        Open .html
      </button>
      <button class="export-btn" id="btnCopyMd" title="Copy Markdown to clipboard">
        <svg viewBox="0 0 14 14" fill="none" width="12" height="12"><rect x="4" y="4" width="8" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M2 10V2h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        Copy MD
      </button>
    </div>

    ${trending ? `<div class="section-label">Trending</div><div class="tags">${trending}</div>` : ''}
    <div class="section-label">All Posts · Ranked by Importance</div>
    ${postsHtml || '<div class="empty-text">No posts to show.</div>'}
  `;

  if (fromCache) {
    document.getElementById('linkFresh')?.addEventListener('click', e => { e.preventDefault(); clearCache(); });
  }
  document.getElementById('btnOpenMd')?.addEventListener('click',   () => openInTab(digest, 'md'));
  document.getElementById('btnOpenHtml')?.addEventListener('click', () => openInTab(digest, 'html'));
  document.getElementById('btnCopyMd')?.addEventListener('click',   () => copyToClipboard(digest));
}

// ── Open in new browser tab (no save needed) ──
function openInTab(digest, format) {
  const content = format === 'md' ? buildMarkdown(digest) : buildHTML(digest);
  const mime = format === 'md' ? 'text/plain' : 'text/html';
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  chrome.tabs.create({ url }, () => {
    // Revoke after a short delay to allow the tab to load the blob
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
}

// ── Copy MD to clipboard ──
function copyToClipboard(digest) {
  const md = buildMarkdown(digest);
  navigator.clipboard.writeText(md).then(() => flashBtn('btnCopyMd', '✓ Copied!'));
}

// ── Build Markdown ──
function buildMarkdown(digest) {
  const posts = digest.all_posts || digest.top_posts || [];
  let md = `# Skool Daily Digest — ${digest.digest_date || ''}\n\n`;
  md += `${digest.quick_summary || ''}\n\n`;
  if (digest.trending_topics?.length) {
    md += `**Trending:** ${digest.trending_topics.join(' · ')}\n\n`;
  }
  md += `---\n\n`;
  posts.forEach(post => {
    const likes    = post.likes    ?? post.engagement?.likes    ?? 0;
    const comments = post.comments ?? post.engagement?.comments ?? 0;
    md += `## #${post.rank} — ${post.title}\n`;
    md += `**By:** ${post.author || 'Unknown'}`;
    if (post.author_link) md += ` ([profile](${post.author_link}))`;
    md += `  \n`;
    md += `**Age:** ${post.age || '—'}  👍 **${likes}**  💬 **${comments}**\n\n`;
    md += `${post.why_it_matters || ''}\n\n`;
    if (post.key_insight) md += `> ${post.key_insight}\n\n`;
    if (post.tags?.length) md += `*Tags: ${post.tags.join(', ')}*\n\n`;
    if (post.post_link) md += `[Read post →](${post.post_link})\n\n`;
    md += `---\n\n`;
  });
  return md;
}

// ── Build styled HTML ──
function buildHTML(digest) {
  const posts = digest.all_posts || digest.top_posts || [];
  const dark = isDark;

  const bg      = dark ? '#0d0d0f' : '#f8f8f5';
  const surface = dark ? '#141418' : '#ffffff';
  const border  = dark ? '#2a2a33' : '#e2e2e8';
  const text     = dark ? '#e8e8ee' : '#1a1a24';
  const muted    = dark ? '#6b6b7d' : '#8888a0';
  const accent   = '#c8f561';
  const accentDark = '#5a7a1a';
  const accentText = dark ? accent : accentDark;

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Skool Digest — ${digest.digest_date || ''}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${bg}; color: ${text}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 760px; margin: 0 auto; padding: 32px 20px; line-height: 1.6; }
  h1 { font-size: 24px; font-weight: 800; margin-bottom: 8px; }
  .summary { font-size: 15px; color: ${muted}; margin-bottom: 16px; line-height: 1.7; }
  .trending { font-size: 13px; color: ${muted}; margin-bottom: 28px; }
  .trending strong { color: ${text}; }
  hr { border: none; border-top: 1px solid ${border}; margin: 24px 0; }
  .post { background: ${surface}; border: 1px solid ${border}; border-radius: 12px; padding: 20px 24px; margin-bottom: 16px; }
  .post-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 12px; color: ${muted}; }
  .rank { background: ${border}; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 11px; }
  .age { background: ${border}; padding: 2px 8px; border-radius: 4px; }
  h2 { font-size: 17px; font-weight: 700; margin-bottom: 8px; line-height: 1.4; color: ${text}; }
  .why { font-size: 14px; color: ${muted}; margin-bottom: 10px; }
  blockquote { border-left: 3px solid ${accentText}; padding-left: 14px; font-style: italic; color: ${accentText}; font-size: 14px; margin-bottom: 12px; }
  .post-footer { display: flex; align-items: center; gap: 14px; font-size: 13px; flex-wrap: wrap; }
  .author { color: ${muted}; }
  .author a { color: ${accentText}; text-decoration: none; }
  .eng { display: flex; gap: 8px; color: ${muted}; }
  .read-link { color: ${accentText}; text-decoration: none; font-weight: 600; border: 1px solid ${border}; padding: 3px 10px; border-radius: 6px; }
  .read-link:hover { background: ${border}; }
  .tags { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 5px; }
  .tag { font-size: 11px; padding: 2px 8px; background: ${border}; border-radius: 4px; color: ${muted}; }
  .stats { display: flex; gap: 12px; font-size: 12px; color: ${muted}; margin-bottom: 24px; flex-wrap: wrap; }
  .stat { background: ${surface}; border: 1px solid ${border}; padding: 4px 12px; border-radius: 20px; }
</style>
</head>
<body>
<h1>Skool Daily Digest — ${digest.digest_date || ''}</h1>
<p class="summary">${digest.quick_summary || ''}</p>
`;

  if (digest.trending_topics?.length) {
    html += `<p class="trending"><strong>Trending:</strong> ${digest.trending_topics.join(' &nbsp;·&nbsp; ')}</p>\n`;
  }

  const totalPosts = digest.total_posts_analyzed || posts.length;
  html += `<div class="stats">
  <span class="stat">📊 ${totalPosts} posts scanned</span>
  <span class="stat">📋 ${posts.length} in digest</span>
  <span class="stat">⭐ ${digest.posts_by_watched_members || 0} watched</span>
</div>\n<hr>\n`;

  posts.forEach(post => {
    const likes    = post.likes    ?? post.engagement?.likes    ?? 0;
    const comments = post.comments ?? post.engagement?.comments ?? 0;
    const safeAuthorLink = safeUrl(post.author_link);
    const safePostLink   = safeUrl(post.post_link);
    const authorHtml = safeAuthorLink
      ? `<a href="${safeAuthorLink}">${esc(post.author || 'Unknown')}</a>`
      : esc(post.author || 'Unknown');
    const tags = (post.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');

    html += `<div class="post">
  <div class="post-header">
    <span class="rank">#${esc(String(post.rank))}</span>
    ${post.age ? `<span class="age">${esc(post.age)}</span>` : ''}
    ${post.is_watched_member ? `<span class="age" style="color:${accentText}">⭐ Watched</span>` : ''}
  </div>
  <h2>${esc(post.title)}</h2>
  <p class="why">${esc(post.why_it_matters || '')}</p>
  ${post.key_insight ? `<blockquote>${esc(post.key_insight)}</blockquote>` : ''}
  <div class="post-footer">
    <span class="author">by ${authorHtml}</span>
    <span class="eng">👍 ${likes} &nbsp; 💬 ${comments}</span>
    ${safePostLink ? `<a href="${safePostLink}" class="read-link">Read post →</a>` : ''}
  </div>
  ${tags ? `<div class="tags">${tags}</div>` : ''}
</div>\n`;
  });

  html += `</body>\n</html>`;
  return html;
}

function flashBtn(id, msg) {
  const btn = document.getElementById(id);
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.textContent = msg;
  btn.style.color = 'var(--accent)';
  setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 2000);
}

// ── Settings ──
function setupSettings() {
  document.querySelectorAll('.provider-tab').forEach(btn => {
    btn.addEventListener('click', () => { _pendingProvider = btn.dataset.provider; updateProviderUI(); });
  });
  document.getElementById('btnAddMember').addEventListener('click', addMember);
  document.getElementById('inputMember').addEventListener('keydown', e => { if (e.key === 'Enter') addMember(); });
  document.getElementById('btnSave').addEventListener('click', saveSettings);
  updateProviderUI();
  document.getElementById('inputAnthropic').value = settings.anthropicKey || '';
  document.getElementById('inputOpenAI').value    = settings.openaiKey    || '';
  document.getElementById('inputGemini').value    = settings.geminiKey    || '';
  document.getElementById('inputCommunity').value = settings.communityUrl || '';
  renderMembers();
}

let _pendingProvider = null;

function updateProviderUI() {
  const p = _pendingProvider || settings.provider || 'anthropic';
  document.querySelectorAll('.provider-tab').forEach(b => b.classList.toggle('active', b.dataset.provider === p));
  document.querySelectorAll('.key-group').forEach(g => g.style.display = g.dataset.provider === p ? 'block' : 'none');
}

function renderMembers() {
  const list = document.getElementById('memberList');
  if (!settings.watchedMembers.length) {
    list.innerHTML = '<div class="empty-members">No watched members yet.</div>';
    return;
  }
  list.innerHTML = settings.watchedMembers.map((name, i) => `
    <div class="member-item">
      <span>${esc(name)}</span>
      <button class="btn-remove" data-i="${i}">✕</button>
    </div>`).join('');
  list.querySelectorAll('.btn-remove').forEach(btn =>
    btn.addEventListener('click', () => { settings.watchedMembers.splice(+btn.dataset.i, 1); renderMembers(); })
  );
}

function addMember() {
  const input = document.getElementById('inputMember');
  const name = input.value.trim();
  if (name && !settings.watchedMembers.includes(name)) { settings.watchedMembers.push(name); renderMembers(); }
  input.value = ''; input.focus();
}

async function saveSettings() {
  if (_pendingProvider) { settings.provider = _pendingProvider; _pendingProvider = null; }
  settings.anthropicKey = document.getElementById('inputAnthropic').value.trim();
  settings.openaiKey    = document.getElementById('inputOpenAI').value.trim();
  settings.geminiKey    = document.getElementById('inputGemini').value.trim();
  settings.communityUrl = document.getElementById('inputCommunity').value.trim();
  await Storage.saveSettings(settings);
  const confirm = document.getElementById('saveConfirm');
  confirm.style.opacity = '1';
  setTimeout(() => confirm.style.opacity = '0', 2000);
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Only allow https:// URLs — blocks javascript: and data: URLs
function safeUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? esc(url) : '';
  } catch {
    return '';
  }
}
