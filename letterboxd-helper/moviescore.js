let lastRequestedImdb = null;
let helperBusy = false;

function requestCurrentMovieFromPage() {
  return new Promise((resolve) => {
    const eventName = `moviescore-helper-current-${crypto.randomUUID()}`;
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
          value = { imdbID: movie.imdbID || '', title: movie.Title || '', year: movie.Year || '' };
        }
      } catch (_) {}
      window.dispatchEvent(new CustomEvent(${JSON.stringify(eventName)}, { detail: JSON.stringify(value) }));
    })();`;
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();

    setTimeout(() => finish(null), 1000);
  });
}

function injectLetterboxdResult(data) {
  const payload = {
    rating: Number(data.rating),
    count: data.count == null ? null : Number(data.count),
    url: String(data.url || ""),
    source: "Letterboxd browser helper",
    cached: false
  };

  const script = document.createElement("script");
  script.textContent = `(() => {
    const d = ${JSON.stringify(payload)};
    try {
      if (typeof scraped !== 'undefined' && typeof scrapeErrors !== 'undefined') {
        scraped.letterboxd = d;
        scrapeErrors.letterboxd = null;
        if (typeof setSourceLink === 'function' && typeof els !== 'undefined') {
          setSourceLink(els.lbSourceLink, d.url);
        }
        if (typeof calculateScore === 'function') calculateScore();
        if (typeof setScrapeStatus === 'function' && typeof els !== 'undefined') {
          setScrapeStatus(els.lbStatus, 'Automatic • browser helper', 'ok');
          if (els.scrapeSummary) els.scrapeSummary.textContent = 'Letterboxd captured in browser';
        }
      }
    } catch (_) {}
  })();`;
  (document.documentElement || document.head || document.body).appendChild(script);
  script.remove();

  // Fallback: if a future app refactor makes the page globals inaccessible,
  // write into the existing manual fields so the formula still recalculates.
  setTimeout(() => {
    const lbRaw = document.querySelector("#lbRaw");
    const ratingInput = document.querySelector("#lbRating");
    const votesInput = document.querySelector("#lbVotes");
    const status = document.querySelector("#lbStatus");
    const displayed = Number(String(lbRaw?.textContent || "").trim());

    if (!Number.isFinite(displayed) || Math.abs(displayed - payload.rating) > 0.001) {
      if (ratingInput) {
        ratingInput.value = String(payload.rating);
        ratingInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (votesInput && payload.count != null) {
        votesInput.value = String(payload.count);
        votesInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }

    if (status) {
      status.textContent = "Automatic • browser helper";
      status.className = "scrape-status ok";
    }
  }, 150);
}

async function maybeUseBrowserHelper() {
  const status = document.querySelector("#lbStatus");
  if (!status || helperBusy) return;

  const text = status.textContent || "";
  if (!/auto failed:/i.test(text)) return;
  if (/run the app through/i.test(text)) return;

  const info = await requestCurrentMovieFromPage();
  const imdbID = String(info?.imdbID || "").trim();
  if (!/^tt\d{7,9}$/i.test(imdbID)) return;
  if (lastRequestedImdb === imdbID) return;

  helperBusy = true;
  lastRequestedImdb = imdbID;
  status.textContent = "Server blocked; trying normal-browser helper…";
  status.className = "scrape-status";

  chrome.runtime.sendMessage({
    type: "moviescore-open-letterboxd",
    imdbID
  }, (response) => {
    helperBusy = false;

    if (chrome.runtime.lastError || !response?.ok) {
      status.textContent = `Browser helper failed: ${chrome.runtime.lastError?.message || response?.error || "unknown error"}`;
      status.className = "scrape-status error";
      lastRequestedImdb = null;
    }
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "moviescore-letterboxd-result") {
    requestCurrentMovieFromPage().then((info) => {
      if (info?.imdbID && info.imdbID !== message.imdbID) return;
      injectLetterboxdResult(message);
      helperBusy = false;
    });
  }

  if (message?.type === "moviescore-letterboxd-error") {
    requestCurrentMovieFromPage().then((info) => {
      if (info?.imdbID && info.imdbID !== message.imdbID) return;
      const status = document.querySelector("#lbStatus");
      if (status) {
        status.textContent = `Browser helper: ${message.error}`;
        status.className = "scrape-status error";
      }
      helperBusy = false;
    });
  }
});

const observer = new MutationObserver(() => {
  maybeUseBrowserHelper().catch(() => {});
});

observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  characterData: true
});

maybeUseBrowserHelper().catch(() => {});
