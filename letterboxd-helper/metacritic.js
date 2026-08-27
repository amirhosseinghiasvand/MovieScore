function cleanText(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
}

function extractMetacritic() {
  const text = cleanText(document.body?.innerText || "");
  const title = cleanText(document.title || "");

  const challenge = /verify you are human|checking your browser|captcha|access denied|security check|challenge/i.test(text);
  const notFound = /page not found|404|we can't find that page|we couldn.t find that page/i.test(text + " " + title);

  let reviews = null;
  const countPatterns = [
    /Showing\s+([\d,]+)\s+Critic Reviews?/i,
    /Based on\s+([\d,]+)\s+Critic Reviews?/i,
    /([\d,]+)\s+Critic Reviews?/i
  ];
  for (const re of countPatterns) {
    const m = text.match(re);
    if (m) {
      reviews = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(reviews)) break;
      reviews = null;
    }
  }

  let score = null;
  const scorePatterns = [
    /(?:^|\n)\s*(100|[1-9]?\d)\s*\n\s*Metascore\b/i,
    /\bMetascore\s*(?:[:\-]?\s*)?(100|[1-9]?\d)\b/i,
    /\b(100|[1-9]?\d)\s*Metascore\b/i
  ];
  for (const re of scorePatterns) {
    const m = text.match(re);
    if (m) {
      score = Number(m[1]);
      if (Number.isFinite(score) && score >= 0 && score <= 100) break;
      score = null;
    }
  }

  return { score, reviews, challenge, notFound };
}

function requestContext() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "metacritic-request-context" }, (response) => {
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
  let challengeReported = false;
  const maxAttempts = 120;

  const timer = setInterval(() => {
    attempts += 1;
    const data = extractMetacritic();

    if (data.score != null && data.reviews != null) {
      clearInterval(timer);
      chrome.runtime.sendMessage({
        type: "metacritic-result",
        score: data.score,
        reviews: data.reviews,
        url: location.href.split("#")[0]
      });
      return;
    }

    if (data.notFound && attempts >= 4) {
      clearInterval(timer);
      chrome.runtime.sendMessage({
        type: "metacritic-error",
        code: "not_found",
        error: "Metacritic page not found; trying the alternate title slug."
      });
      return;
    }

    if (data.challenge && !challengeReported && attempts >= 3) {
      challengeReported = true;
      chrome.runtime.sendMessage({
        type: "metacritic-error",
        code: "challenge",
        error: "Metacritic is showing a normal-browser verification page. Complete it in the opened tab; MovieScore will keep watching for the critic data."
      });
    }

    if (attempts >= maxAttempts) {
      clearInterval(timer);
      chrome.runtime.sendMessage({
        type: "metacritic-error",
        code: data.challenge ? "challenge" : "no_data",
        error: data.challenge
          ? "Metacritic verification is still open. Complete it, then press Refresh scraped ratings in MovieScore."
          : "Metacritic critic score/review count was not found on the loaded page."
      });
    }
  }, 500);
}

run().catch(() => {});
