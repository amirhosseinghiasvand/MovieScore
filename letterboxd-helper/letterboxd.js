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

function extractLetterboxdRating() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');

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

function requestContext() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "letterboxd-request-context" }, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response?.ok ? response : null);
    });
  });
}

async function run() {
  const context = await requestContext();
  if (!context) return;

  let attempts = 0;
  const maxAttempts = 45;

  const timer = setInterval(() => {
    attempts += 1;
    const data = extractLetterboxdRating();

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
      const bodyText = String(document.body?.innerText || "").toLowerCase();
      const challenge = /verify you are human|checking your browser|captcha|access denied|challenge/.test(bodyText);
      chrome.runtime.sendMessage({
        type: "letterboxd-error",
        error: challenge
          ? "Letterboxd is also showing a challenge in the normal browser tab. Complete it there, then retry the movie."
          : "The public JSON-LD rating was not found on the loaded Letterboxd page."
      });
    }
  }, 700);
}

run().catch(() => {});
