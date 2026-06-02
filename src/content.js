// content.js — Skool feed scraper v5

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapePosts') {
    try {
      const result = scrapePosts();
      sendResponse(result);
    } catch (e) {
      sendResponse({ posts: [], error: e.message, debug: ['Error: ' + e.message] });
    }
    return true;
  }
});

// ── Main scraper ──
function scrapePosts() {
  const debug = [];
  let posts = [];

  // Strategy 1: Walk up from avatar images to find post cards
  const avatarImgs = Array.from(document.querySelectorAll('img')).filter(img => {
    const rect = img.getBoundingClientRect();
    return rect.width >= 24 && rect.width <= 72 && rect.height >= 24 && rect.height <= 72;
  });

  debug.push('Avatars found: ' + avatarImgs.length);

  const cardSet = new Set();
  for (const img of avatarImgs) {
    let el = img.parentElement;
    for (let depth = 0; depth < 10; depth++) {
      if (!el) break;
      const rect = el.getBoundingClientRect();
      const text = el.innerText || '';
      if (
        rect.width > 400 &&
        rect.height > 80 &&
        rect.height < 900 &&
        text.length > 40 &&
        /\b\d+[hmd]\b|Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep/i.test(text)
      ) {
        cardSet.add(el);
        break;
      }
      el = el.parentElement;
    }
  }

  debug.push('Card candidates: ' + cardSet.size);

  // Deduplicate nested elements
  const cards = dedupeNested(Array.from(cardSet));
  debug.push('Cards after dedup: ' + cards.length);

  posts = cards.map(extractPost).filter(Boolean);
  debug.push('Posts extracted: ' + posts.length);

  // Strategy 2: Find repeating sibling containers
  if (posts.length < 3) {
    debug.push('Trying sibling strategy...');
    const siblingPosts = findBySiblings();
    debug.push('Sibling posts found: ' + siblingPosts.length);
    if (siblingPosts.length > posts.length) posts = siblingPosts;
  }

  // Strategy 3: Raw text fallback
  if (posts.length === 0) {
    debug.push('Using raw text fallback');
    posts = rawFallback();
  }

  return { posts, debug, pageUrl: window.location.href };
}

// ── Strategy 2: Find sibling post containers ──
function findBySiblings() {
  let bestContainer = null;
  let bestCount = 0;

  for (const container of document.querySelectorAll('div, ul, main, section')) {
    const children = Array.from(container.children);
    if (children.length < 2 || children.length > 60) continue;

    let count = 0;
    for (const child of children) {
      const rect = child.getBoundingClientRect();
      const text = child.innerText || '';
      if (
        rect.width > 400 &&
        rect.height > 80 &&
        text.length > 40 &&
        /\b\d+[hmd]\b|Oct|Nov|Dec|Jan|Feb|Mar/i.test(text)
      ) count++;
    }

    if (count > bestCount) {
      bestCount = count;
      bestContainer = container;
    }
  }

  if (!bestContainer || bestCount < 2) return [];
  return Array.from(bestContainer.children).map(extractPost).filter(Boolean);
}

// ── Extract data from a single post card element ──
function extractPost(el) {
  const text = el.innerText || '';
  if (!text.trim() || text.length < 30) return null;

  // Timestamp — "1h", "6d", "2m", "Oct '25"
  let timestamp = '';
  const tsMatch = text.match(/\b(\d+[hmd])\b/) ||
    text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*'?\d{2,4}\b/i);
  if (tsMatch) timestamp = tsMatch[0];

  // Author — from avatar alt text
  let author = '';
  let authorLink = '';
  const imgWithAlt = el.querySelector('img[alt]');
  if (imgWithAlt?.alt?.trim().length > 1) {
    author = imgWithAlt.alt.trim();
  }

  // Links
  const links = Array.from(el.querySelectorAll('a[href]'));
  for (const a of links) {
    if (!authorLink && a.href.includes('skool.com')) authorLink = a.href;
    if (!author && a.textContent?.trim().length > 1) author = a.textContent.trim();
  }

  // Title — first meaningful bold/strong/heading, cleaned of DOM noise
  let title = '';
  for (const el2 of el.querySelectorAll('strong, b, h1, h2, h3, h4')) {
    let t = el2.textContent?.trim() || '';
    // Strip leading noise: digits + name + timestamp pattern like "6Marcin Szymczak11h •"
    t = t.replace(/^\d+[^a-zA-Z]*[A-Z][a-z]+\s+[A-Z][a-z]+\d+[hmd].*?(?:•|·)\s*/u, '');
    // Strip emoji badges at start
    t = t.replace(/^[\p{Emoji}\s👑🔥💖✨🎯]+/u, '').trim();
    // Strip category suffixes like "• Sharing Is Caring" or "• Discussion"  
    t = t.replace(/[•·]\s*(Sharing Is Caring|Discussion|Loom Bites|Your Intro!|Wins).*$/i, '').trim();
    if (t && t.length > 4 && t.length < 400 && t !== author) {
      title = t;
      break;
    }
  }

  // Body — first substantial text block
  let body = '';
  for (const p of el.querySelectorAll('p, span, div')) {
    const t = p.textContent?.trim();
    if (t && t.length > 40 && t !== title && t !== author && !/^\d+$/.test(t)) {
      body = t.slice(0, 400);
      break;
    }
  }

  // Post link — deepest skool.com link
  let postLink = '';
  for (const a of links) {
    if (a.href.includes('skool.com') && a.href.split('/').length >= 5) {
      postLink = a.href;
      break;
    }
  }

  // Engagement — look for numbers immediately after the thumbs-up and comment icons
  // Skool layout: [👍 icon] [count] [💬 icon] [count]
  // We find the two numbers that appear in the engagement row (bottom of card)
  let likes = 0;
  let comments = 0;

  // Try to find engagement numbers by proximity to icons in DOM
  const engagementArea = el.querySelector('[class*="reaction"], [class*="like"], [class*="comment"], [class*="engage"]');
  if (engagementArea) {
    const engNums = (engagementArea.textContent || '').match(/\b(\d{1,4})\b/g);
    if (engNums) {
      likes    = parseInt(engNums[0] || '0');
      comments = parseInt(engNums[1] || '0');
    }
  }

  // Fallback: scan raw text but exclude year-like numbers (2020-2030) and timestamps
  if (!likes && !comments) {
    const safeNums = [...text.matchAll(/\b(\d{1,4})\b/g)]
      .map(m => parseInt(m[1]))
      .filter(n => {
        const s = String(n);
        // Exclude: years (2020-2030), numbers in timestamps
        if (n >= 2020 && n <= 2030) return false;
        if (timestamp.includes(s)) return false;
        return true;
      });
    likes    = safeNums[0] || 0;
    comments = safeNums[1] || 0;
  }

  // Category label
  const catMatch = text.match(/Discussion|Sharing Is Caring|Loom Bites|Your Intro!|Wins/);
  const category = catMatch?.[0] || '';

  const isPinned = /\bPinned\b/i.test(text);

  if (!title && body.length < 20) return null;

  return {
    title: title || body.slice(0, 80),
    author: author || 'Unknown',
    authorLink,
    postLink,
    body,
    likes,
    comments,
    timestamp,
    category,
    isPinned,
  };
}

function dedupeNested(els) {
  const result = [];
  for (const el of els) {
    if (!result.some(r => r.contains(el) || el.contains(r))) result.push(el);
  }
  return result;
}

function rawFallback() {
  const lines = (document.body.innerText || '')
    .split('\n').map(l => l.trim()).filter(l => l.length > 15);
  return [{
    title: 'Raw Feed Content',
    author: 'Multiple authors',
    authorLink: '',
    postLink: window.location.href,
    body: lines.slice(0, 200).join('\n').slice(0, 3000),
    likes: 0, comments: 0, timestamp: '', category: '', isPinned: false,
    isRawScan: true,
  }];
}
