// content.js — Skool feed scraper v6

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

  // ── Timestamp — "1h", "6d", "2m", "Oct '25" ──
  let timestamp = '';
  const tsMatch = text.match(/\b(\d+[hmd])\b/) ||
    text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*'?\d{2,4}\b/i);
  if (tsMatch) timestamp = tsMatch[0];

  // ── Author — avatar alt text is most reliable ──
  let author = '';
  let authorLink = '';
  const imgWithAlt = el.querySelector('img[alt]');
  if (imgWithAlt?.alt?.trim().length > 1) {
    author = imgWithAlt.alt.trim();
  }

  const links = Array.from(el.querySelectorAll('a[href]'));
  if (!author) {
    for (const a of links) {
      if (a.textContent?.trim().length > 1) { author = a.textContent.trim(); break; }
    }
  }
  for (const a of links) {
    if (a.href.includes('skool.com')) { authorLink = a.href; break; }
  }

  // ── Title — scan links first (post titles are clickable), then headings ──
  let title = '';

  // Noise patterns that must never become a title
  const titleNoise = /^(new comment|pinned|discussion|sharing is caring|loom bites|your intro|wins|\d+[hmd]? ago)/i;

  // Strategy A: find a link with substantial text that isn't the author and goes deeper into the site
  for (const a of links) {
    const t = (a.textContent || '').trim();
    if (
      t.length > 15 &&
      t.length < 400 &&
      t !== author &&
      !/^https?:\/\//.test(t) &&
      !/^\d+$/.test(t) &&
      !titleNoise.test(t) &&
      a.href.split('/').length >= 5
    ) {
      title = t;
      break;
    }
  }

  // Strategy B: headings and bold — strip the Skool meta noise
  if (!title) {
    for (const el2 of el.querySelectorAll('h1, h2, h3, h4, strong, b')) {
      let t = (el2.textContent || '').trim();

      // Strip level badge + author + timestamp prefix: "9Mark Kashef🔥 30d • Loom Bites"
      // Pattern: optional digits, then Name, then emojis/digits/timestamp/bullet/category
      t = t.replace(/^\d*\s*[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*[\s\p{Emoji}]*\d+[hmd][^a-zA-Z]{0,30}/u, '').trim();
      // Strip leading emojis
      t = t.replace(/^[\p{Emoji}\s]+/u, '').trim();
      // Strip trailing category suffix "• Sharing Is Caring" etc.
      t = t.replace(/\s*[•·]\s*(Sharing Is Caring|Discussion|Loom Bites|Your Intro!|Wins)\s*$/i, '').trim();
      // Skip if what's left is still just the author name, too short, or noise
      if (t && t.length > 8 && t.length < 400 && t !== author && !/^\d+$/.test(t) && !titleNoise.test(t)) {
        title = t;
        break;
      }
    }
  }

  // ── Body — first substantial paragraph after the title ──
  let body = '';
  for (const p of el.querySelectorAll('p, span, div')) {
    const t = (p.textContent || '').trim();
    if (t && t.length > 40 && t !== title && t !== author && !/^\d+$/.test(t)) {
      body = t.slice(0, 400);
      break;
    }
  }

  // ── Post link — deepest skool.com path ──
  let postLink = '';
  for (const a of links) {
    if (a.href.includes('skool.com') && a.href.split('/').length >= 5) {
      postLink = a.href;
      break;
    }
  }

  // ── Engagement — scan from the BOTTOM of the card text ──
  // Skool card innerText structure (top → bottom):
  //   [level]AuthorName [emojis] [timestamp] • [category]
  //   [Post title]
  //   [Body text...]
  //   [likes]       ← standalone number line
  //   [comments]    ← standalone number line
  //   [avatars] New comment Xd ago
  //
  // The level badge (e.g. "9") is at the TOP — scanning from bottom avoids it.
  let likes = 0;
  let comments = 0;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Collect standalone number lines from the bottom, skipping "ago/new comment" lines
  const engNums = [];
  for (let i = lines.length - 1; i >= 0 && engNums.length < 2; i--) {
    const line = lines[i];
    if (/new comment|ago/i.test(line)) continue;
    if (/^\d{1,5}$/.test(line)) {
      engNums.unshift(parseInt(line));
    }
    // Stop if we've moved past the engagement area (hit body text)
    if (line.length > 60) break;
  }

  if (engNums.length >= 2) {
    likes    = engNums[0];
    comments = engNums[1];
  } else if (engNums.length === 1) {
    likes = engNums[0];
  } else {
    // Last resort: find two numbers near the bottom half of the text,
    // excluding years, level badges (single digit before a capital name), and timestamps
    const bottomText = lines.slice(Math.floor(lines.length / 2)).join(' ');
    const nums = [...bottomText.matchAll(/\b(\d{1,4})\b/g)]
      .map(m => parseInt(m[1]))
      .filter(n => n > 0 && !(n >= 2020 && n <= 2030) && !timestamp.includes(String(n)));
    likes    = nums[0] || 0;
    comments = nums[1] || 0;
  }

  // ── Category ──
  const catMatch = text.match(/Discussion|Sharing Is Caring|Loom Bites|Your Intro!|Wins/);
  const category = catMatch?.[0] || '';

  const isPinned = /\bPinned\b/i.test(text);

  if (!title && body.length < 20) return null;

  return {
    title:      title || body.slice(0, 80),
    author:     author || 'Unknown',
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
