let lastRequestedMetacritic = null;
let metacriticHelperBusy = false;
const CHANNEL = "moviescore-browser-helper-v1";

function requestMovieForMetacriticHelper() {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    let finished = false;

    const done = (value) => {
      if (finished) return;
      finished = true;
      window.removeEventListener("message", onMessage);
      resolve(value);
    };

    const onMessage = (event) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const message = event.data;
      if (!message || message.channel !== CHANNEL || message.from !== "page") return;
      if (message.type !== "current-movie" || message.requestId !== requestId) return;
      done(message.movie || null);
    };

    window.addEventListener("message", onMessage);
    window.postMessage({
      channel: CHANNEL,
      from: "extension",
      type: "request-current-movie",
      requestId
    }, location.origin);

    setTimeout(() => done(null), 1200);
  });
}

function sendMetacriticResultToPage(message) {
  window.postMessage({
    channel: CHANNEL,
    from: "extension",
    type: "metacritic-result",
    title: message.title,
    year: message.year,
    score: message.score,
    reviews: message.reviews,
    url: message.url
  }, location.origin);
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
  if (!title) {
    status.textContent = "Browser helper could not read the current movie title";
    status.className = "scrape-status error";
    return;
  }

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
      sendMetacriticResultToPage(message);
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
      if (!/verification|challenge/i.test(String(message.error || ""))) lastRequestedMetacritic = null;
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
