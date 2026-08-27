const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8765);
const ROOT = __dirname;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(html) {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function normalizeTitle(s) {
  return decodeHtmlEntities(String(s || ''))
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugify(title) {
  return normalizeTitle(title)
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function walkForAggregateRating(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.aggregateRating && typeof value.aggregateRating === 'object') {
    const ar = value.aggregateRating;
    const ratingValue = Number(ar.ratingValue);
    const ratingCount = Number(ar.ratingCount ?? ar.reviewCount);
    if (Number.isFinite(ratingValue)) {
      return {
        rating: ratingValue,
        count: Number.isFinite(ratingCount) ? ratingCount : null,
      };
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = walkForAggregateRating(item);
      if (hit) return hit;
    }
  } else {
    for (const item of Object.values(value)) {
      const hit = walkForAggregateRating(item);
      if (hit) return hit;
    }
  }
  return null;
}

function parseLetterboxd(html) {
  const scripts = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) scripts.push(m[1]);

  for (let raw of scripts) {
    raw = decodeHtmlEntities(raw)
      .replace(/^\s*<!--/, '')
      .replace(/-->\s*$/, '')
      .replace(/^\s*\/\*\s*<!\[CDATA\[\s*\*\//, '')
      .replace(/\/\*\s*\]\]>\s*\*\/\s*$/, '')
      .trim();
    try {
      const parsed = JSON.parse(raw);
      const agg = walkForAggregateRating(parsed);
      if (agg) return agg;
    } catch (_) {}
  }

  const rating = html.match(/["']ratingValue["']\s*:\s*["']?([0-5](?:\.\d+)?)/i);
  const count = html.match(/["'](?:ratingCount|reviewCount)["']\s*:\s*["']?([\d,]+)/i);
  return rating ? {
    rating: Number(rating[1]),
    count: count ? Number(count[1].replace(/,/g, '')) : null,
  } : null;
}

function parseMetaTitle(html) {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) return stripTags(t[1]).replace(/\s+Reviews\s*-\s*Metacritic.*$/i, '').trim();
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return h1 ? stripTags(h1[1]).trim() : '';
}

function parseMetaYear(html) {
  const structured = html.match(/["']datePublished["']\s*:\s*["'](\d{4})/i);
  if (structured) return structured[1];
  const released = stripTags(html).match(/(?:Release Date|Released?)\s*:?\s*[^0-9]{0,20}(19\d{2}|20\d{2})/i);
  return released ? released[1] : '';
}

function parseMetacritic(html) {
  const text = stripTags(html);
  const countMatch = text.match(/Based on\s+([\d,]+)\s+Critic Reviews?/i);

  let score = null;
  if (countMatch) {
    const pos = countMatch.index + countMatch[0].length;
    const tail = text.slice(pos, pos + 100);
    const x = tail.match(/\b(100|[1-9]?\d)\b/);
    if (x) score = Number(x[1]);
  }

  if (score == null) {
    const block = text.match(/Metascore[\s\S]{0,220}?Based on\s+[\d,]+\s+Critic Reviews?\s+(100|[1-9]?\d)\b/i);
    if (block) score = Number(block[1]);
  }

  return {
    title: parseMetaTitle(html),
    year: parseMetaYear(html),
    score: Number.isFinite(score) ? score : null,
    reviews: countMatch ? Number(countMatch[1].replace(/,/g, '')) : null,
  };
}

async function politeFetch(url, { timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Safari/537.36 MovieScorePrivate/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

async function scrapeLetterboxd(imdbID) {
  if (!/^tt\d{7,9}$/i.test(imdbID || '')) throw new Error('Invalid IMDb ID');
  const url = `https://letterboxd.com/imdb/${imdbID}/`;
  const { response, text } = await politeFetch(url);
  if (!response.ok) throw new Error(`Letterboxd returned HTTP ${response.status}`);
  if (/captcha|cf-chl|access denied/i.test(text)) throw new Error('Letterboxd returned an anti-bot/challenge page');
  const data = parseLetterboxd(text);
  if (!data) throw new Error('Letterboxd rating was not found in public JSON-LD');
  return {
    ...data,
    url: response.url,
    source: 'Letterboxd public JSON-LD',
  };
}

async function scrapeMetacritic(title, year) {
  if (!title) throw new Error('Missing movie title');
  const slug = slugify(title);
  if (!slug) throw new Error('Could not build Metacritic slug');

  const candidates = [];
  if (year && /^\d{4}$/.test(String(year))) candidates.push(`${slug}-${year}`);
  candidates.push(slug);

  const wanted = normalizeTitle(title);
  let lastError = null;

  for (const candidate of [...new Set(candidates)]) {
    const url = `https://www.metacritic.com/movie/${candidate}/`;
    try {
      const { response, text } = await politeFetch(url);
      if (response.status === 404) continue;
      if (!response.ok) {
        lastError = new Error(`Metacritic returned HTTP ${response.status}`);
        if ([403, 429].includes(response.status)) break;
        continue;
      }
      if (/captcha|cf-chl|access denied|verify you are human/i.test(text)) {
        lastError = new Error('Metacritic returned an anti-bot/challenge page');
        break;
      }

      const data = parseMetacritic(text);
      const got = normalizeTitle(data.title);
      if (year && data.year && String(data.year) !== String(year)) continue;
      if (got && wanted && got !== wanted && !got.startsWith(`${wanted} `) && !wanted.startsWith(`${got} `)) {
        continue;
      }
      if (data.reviews == null && data.score == null) continue;

      return {
        score: data.score,
        reviews: data.reviews,
        title: data.title || title,
        url: response.url,
        source: 'Metacritic public movie page',
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Matching Metacritic page was not found');
}

async function cached(key, fn, force = false) {
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, cached: true };
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return { ...value, cached: false };
}

async function handleScrape(req, res, u) {
  const imdb = (u.searchParams.get('imdb') || '').trim();
  const title = (u.searchParams.get('title') || '').trim();
  const year = (u.searchParams.get('year') || '').match(/\d{4}/)?.[0] || '';
  const force = u.searchParams.get('refresh') === '1';

  const output = {
    letterboxd: { ok: false },
    metacritic: { ok: false },
  };

  const jobs = [];
  if (imdb) {
    jobs.push(
      cached(`lb:${imdb}`, () => scrapeLetterboxd(imdb), force)
        .then(data => { output.letterboxd = { ok: true, ...data }; })
        .catch(err => { output.letterboxd = { ok: false, error: err.message }; })
    );
  } else {
    output.letterboxd.error = 'IMDb ID missing';
  }

  if (title) {
    jobs.push(
      cached(`mc:${normalizeTitle(title)}:${year}`, () => scrapeMetacritic(title, year), force)
        .then(data => { output.metacritic = { ok: true, ...data }; })
        .catch(err => { output.metacritic = { ok: false, error: err.message }; })
    );
  } else {
    output.metacritic.error = 'Movie title missing';
  }

  await Promise.all(jobs);
  sendJson(res, 200, output);
}

function serveStatic(req, res, u) {
  let pathname = decodeURIComponent(u.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
    if (u.pathname === '/api/scrape') return await handleScrape(req, res, u);
    if (u.pathname === '/api/health') return sendJson(res, 200, { ok: true, cacheEntries: cache.size });
    serveStatic(req, res, u);
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`MovieScore Private is running at http://127.0.0.1:${PORT}`);
    console.log('Press Ctrl+C to stop.');
  });
}

module.exports = {
  parseLetterboxd,
  parseMetacritic,
  slugify,
  normalizeTitle,
  confidence: (count, k) => count / (count + k),
};
