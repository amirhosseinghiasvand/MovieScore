function toNumber(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned) return null;
  const x = Number(cleaned);
  return Number.isFinite(x) ? x : null;
}

function walkForAggregateRating(value) {
  if (!value || typeof value !== "object") return null;
  if (value.aggregateRating && typeof value.aggregateRating === "object") {
    const ar = value.aggregateRating;
    const rating = toNumber(ar.ratingValue);
    const count = toNumber(ar.ratingCount ?? ar.reviewCount);
    if (rating != null) return { rating, count };
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

function extractFromJsonLd(root = document) {
  const scripts = root.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    const raw = String(script.textContent || "").trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const hit = walkForAggregateRating(parsed);
      if (hit) return hit;
    } catch (_) {}
  }
  return null;
}

function parseRatingText(value) {
  const m = String(value || "").match(/(?:^|\s)([0-5](?:\.\d{1,3})?)(?:\s*(?:\/\s*5|out of 5))?/i);
  if (!m) return null;
  const x = Number(m[1]);
  return Number.isFinite(x) && x >= 0 && x <= 5 ? x : null;
}

function extractVisibleRating(root = document) {
  const selectors = [
    ".average-rating",
    ".display-rating",
    "[data-average-rating]",
    "meta[name='twitter:data2']",
    "meta[property='twitter:data2']"
  ];

  for (const selector of selectors) {
    for (const el of root.querySelectorAll(selector)) {
      const raw = el.getAttribute?.("data-average-rating") || el.getAttribute?.("content") || el.textContent || "";
      const rating = parseRatingText(raw);
      if (rating != null) return rating;
    }
  }
  return null;
}

function extractCountFromRoot(root = document) {
  for (const el of root.querySelectorAll("[data-rating-count], [data-count]")) {
    const raw = el.getAttribute("data-rating-count") ?? el.getAttribute("data-count");
    const count = toNumber(raw);
    if (count != null && count > 0) return count;
  }

  const text = String(root.body?.innerText || root.documentElement?.innerText || "");
  const total = text.match(/([\d,.]+)\s+(?:member\s+)?ratings?\b/i);
  if (total) {
    const count = toNumber(total[1]);
    if (count != null && count > 0) return count;
  }

  // Histogram tooltip fallback: sum one count per star bucket.
  const bucketCounts = [];
  const seen = new Set();
  for (const el of root.querySelectorAll("[title]")) {
    const title = String(el.getAttribute("title") || "");
    if (!/rating/i.test(title)) continue;
    const m = title.match(/([\d,.]+)\s+(?:member\s+)?ratings?\b/i);
    if (!m) continue;
    const count = toNumber(m[1]);
    if (count == null || count < 0) continue;
    const key = `${title}|${count}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bucketCounts.push(count);
  }
  if (bucketCounts.length >= 5 && bucketCounts.length <= 12) {
    return bucketCounts.reduce((a, b) => a + b, 0);
  }

  return null;
}

async function extractFromHistogram() {
  const match = location.pathname.match(/^\/film\/([^/]+)\/?/i);
  if (!match) return null;
  const slug = match[1];
  const url = `https://letterboxd.com/csi/film/${encodeURIComponent(slug)}/rating-histogram/`;

  try {
    const res = await fetch(url, {
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" }
    });
    if (!res.ok) return null;
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rating = extractVisibleRating(doc) ?? extractFromJsonLd(doc)?.rating ?? null;
    const count = extractCountFromRoot(doc) ?? extractFromJsonLd(doc)?.count ?? null;
    return rating != null ? { rating, count, histogramUrl: url } : null;
  } catch (_) {
    return null;
  }
}

async function extractLetterboxdRating() {
  const json = extractFromJsonLd(document);
  if (json?.rating != null && json?.count != null) return json;

  const visible = extractVisibleRating(document);
  const visibleCount = extractCountFromRoot(document);
  if (visible != null && visibleCount != null) return { rating: visible, count: visibleCount };

  const histogram = await extractFromHistogram();
  if (histogram?.rating != null) {
    return {
      rating: histogram.rating,
      count: histogram.count ?? json?.count ?? visibleCount ?? null
    };
  }

  if (json?.rating != null) return json;
  if (visible != null) return { rating: visible, count: visibleCount };
  return null;
}

function requestContext() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "letterboxd-request-context" }, (response) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(response?.ok ? response : null);
    });
  });
}

async function run() {
  const context = await requestContext();
  if (!context) return;

  let attempts = 0;
  const maxAttempts = 24;
  let busy = false;

  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    attempts += 1;

    try {
      const bodyText = String(document.body?.innerText || "").toLowerCase();
      const challenge = /verify you are human|checking your browser|captcha|access denied|challenge/.test(bodyText);
      if (challenge && attempts >= 3) {
        clearInterval(timer);
        chrome.runtime.sendMessage({
          type: "letterboxd-error",
          error: "Letterboxd is showing a verification page in Chrome. Complete it there, then retry the movie."
        });
        return;
      }

      const data = await extractLetterboxdRating();
      if (data?.rating != null) {
        clearInterval(timer);
        chrome.runtime.sendMessage({
          type: "letterboxd-result",
          rating: data.rating,
          count: data.count,
          url: location.href.split("#")[0]
        });
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(timer);
        chrome.runtime.sendMessage({
          type: "letterboxd-error",
          error: "Letterboxd loaded, but neither its page rating nor rating-histogram data could be read."
        });
      }
    } finally {
      busy = false;
    }
  }, 750);
}

run().catch(() => {});
