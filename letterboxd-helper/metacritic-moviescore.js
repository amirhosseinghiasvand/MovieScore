let lastRequestedMetacritic = null;
let metacriticHelperBusy = false;

function requestMovieForMetacriticHelper() {
  return new Promise((resolve) => {
    const eventName = `moviescore-mc-current-${crypto.randomUUID()}`;
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      window.removeEventListener(eventName, onResponse);
      resolve(value);
    };

    const onResponse = (event) => {
      try {
        finish(event.detail ? JSON.parse(event.detail) : null);
      } catch (_) {
        finish(null);
      }
    };

    window.addEventListener(eventName, onResponse, { once: true });

    const script = document.createElement("script");
    script.textContent = `(() => {
      let value = null;
      try {
        if (typeof movie !== 'undefined' && movie) {
          value = { title: movie.Title || '', year: movie.Year || '' };
        }
      } catch (_) {}
      window.dispatchEvent(new CustomEvent(${JSON.stringify(eventName)}, { detail: JSON.stringify(value) }));
    })();`;
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();

    setTimeout(() => finish(null), 1000);
  });
}

function injectMetacriticResult(data) {
  const payload = {
    score: Number(data.score),
    reviews: Number(data.reviews),
    url: String(data.url || ""),
    source: "Metacritic browser helper",
    cached: false
  };

  const script = document.createElement("script");
  script.textContent = `(() => {
    const d = ${JSON.stringify(payload)};
    try {
      if (typeof scraped !== 'undefined' && typeof scrapeErrors !== 'undefined') {
        scraped.metacritic = d;
        scrapeErrors.metacritic = null;
        if (typeof setSourceLink === 'function' && typeof els !== 'undefined') {
          setSourceLink(els.mcSourceLink, d.url);
        }
        if (typeof calculateScore === 'function') calculateScore();
        if (typeof setScrapeStatus === 'function' && typeof els !== 'undefined') {
          setScrapeStatus(els.mcStatus, 'Automatic • browser helper', 'ok');
          if (els.scrapeSummary) els.scrapeSummary.textContent = 'Browser helpers supplied blocked source data';
        }
      }
    } catch (_) {}
  })();`;
  (document.documentElement || document.head || document.body).appendChild(script);
  script.remove();

  setTimeout(() => {
    const scoreRaw = document.querySelector("#mcRaw");
    const scoreInput = document.querySelector("#mcScoreOverride");
    const reviewsInput = document.querySelector("#mcReviews");
    const status = document.querySelector("#mcStatus");
    const displayed = Number(String(scoreRaw?.textContent || "").trim());

    if (!Number.isFinite(displayed) || Math.abs(displayed - payload.score) > 0.001) {
      if (scoreInput) {
        scoreInput.value = String(payload.score);
        scoreInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    if (reviewsInput) {
      reviewsInput.value = String(payload.reviews);
      reviewsInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (status) {
      status.textContent = "Automatic • browser helper";
      status.className = "scrape-status ok";
    }
  }, 150);
}

async function maybeUseMetacriticBrowserHelper() {
  const status = document.querySelector("#mcStatus");
  if (!status || metacriticHelperBusy) return;

  const text = status.textContent || "";
  if (!/auto failed:|critic count auto failed/i.test(text)) return;
  if (/run the app through/i.test(text)) return;

  const info = await requestMovieForMetacriticHelper();
  const title = String(info?.title || "").trim();
  const year = String(info?.year || "").match(/\d{4}/)?.[0] || "";
  if (!title) return;

  const key = `${title.toLowerCase()}|${year}`;
  if (lastRequestedMetacritic === key) return;

  metacriticHelperBusy = true;
  lastRequestedMetacritic = key;
  status.textContent = "Server blocked; trying Metacritic in normal Chrome…";
  status.className = "scrape-status";

  chrome.runtime.sendMessage({
    type: "moviescore-open-metacritic",
    title,
    year
  }, (response) => {
    metacriticHelperBusy = false;
    if (chrome.runtime.lastError || !response?.ok) {
      status.textContent = `Metacritic browser helper failed: ${chrome.runtime.lastError?.message || response?.error || "unknown error"}`;
      status.className = "scrape-status error";
      lastRequestedMetacritic = null;
    }
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "moviescore-metacritic-result") {
    requestMovieForMetacriticHelper().then((info) => {
      const currentTitle = String(info?.title || "").trim().toLowerCase();
      const currentYear = String(info?.year || "").match(/\d{4}/)?.[0] || "";
      if (currentTitle && currentTitle !== String(message.title || "").trim().toLowerCase()) return;
      if (currentYear && message.year && currentYear !== String(message.year)) return;
      injectMetacriticResult(message);
      metacriticHelperBusy = false;
    });
  }

  if (message?.type === "moviescore-metacritic-error") {
    requestMovieForMetacriticHelper().then((info) => {
      const currentTitle = String(info?.title || "").trim().toLowerCase();
      if (currentTitle && currentTitle !== String(message.title || "").trim().toLowerCase()) return;
      const status = document.querySelector("#mcStatus");
      if (status) {
        status.textContent = `Browser helper: ${message.error}`;
        status.className = "scrape-status error";
      }
      metacriticHelperBusy = false;
      if (!/verification/i.test(String(message.error || ""))) lastRequestedMetacritic = null;
    });
  }
});

const metacriticObserver = new MutationObserver(() => {
  maybeUseMetacriticBrowserHelper().catch(() => {});
});

metacriticObserver.observe(document.documentElement, {
  subtree: true,
  childList: true,
  characterData: true
});

maybeUseMetacriticBrowserHelper().catch(() => {});
