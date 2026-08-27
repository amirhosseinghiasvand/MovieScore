let lastRequestedImdb = null;
let helperBusy = false;
const CHANNEL = "moviescore-browser-helper-v1";

function requestCurrentMovieFromPage() {
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

function sendLetterboxdResultToPage(message) {
  window.postMessage({
    channel: CHANNEL,
    from: "extension",
    type: "letterboxd-result",
    imdbID: message.imdbID,
    rating: message.rating,
    count: message.count,
    url: message.url
  }, location.origin);
}

async function maybeUseBrowserHelper() {
  const status = document.querySelector("#lbStatus");
  if (!status || helperBusy) return;

  const text = status.textContent || "";
  if (!/auto failed:/i.test(text)) return;
  if (/run the app through/i.test(text)) return;

  const info = await requestCurrentMovieFromPage();
  const imdbID = String(info?.imdbID || "").trim();
  if (!/^tt\d{7,9}$/i.test(imdbID)) {
    status.textContent = "Browser helper could not read the current IMDb ID";
    status.className = "scrape-status error";
    return;
  }
  if (lastRequestedImdb === imdbID) return;

  helperBusy = true;
  lastRequestedImdb = imdbID;
  status.textContent = "Server blocked; trying Letterboxd in normal Chrome…";
  status.className = "scrape-status";

  chrome.runtime.sendMessage({
    type: "moviescore-open-letterboxd",
    imdbID
  }, (response) => {
    helperBusy = false;
    if (chrome.runtime.lastError || !response?.ok) {
      status.textContent = `Letterboxd browser helper failed: ${chrome.runtime.lastError?.message || response?.error || "unknown error"}`;
      status.className = "scrape-status error";
      lastRequestedImdb = null;
    }
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "moviescore-letterboxd-result") {
    requestCurrentMovieFromPage().then((info) => {
      if (info?.imdbID && info.imdbID !== message.imdbID) return;
      sendLetterboxdResultToPage(message);
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
      if (!/verification|challenge/i.test(String(message.error || ""))) lastRequestedImdb = null;
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
