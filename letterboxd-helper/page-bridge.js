(() => {
  const CHANNEL = "moviescore-browser-helper-v1";

  function currentMovie() {
    try {
      if (typeof movie !== "undefined" && movie) {
        return {
          imdbID: String(movie.imdbID || ""),
          title: String(movie.Title || ""),
          year: String(movie.Year || "").match(/\d{4}/)?.[0] || ""
        };
      }
    } catch (_) {}
    return null;
  }

  function post(payload) {
    window.postMessage({ channel: CHANNEL, from: "page", ...payload }, location.origin);
  }

  function applyLetterboxd(message) {
    const current = currentMovie();
    if (!current) return;
    if (message.imdbID && current.imdbID && message.imdbID !== current.imdbID) return;

    const rating = Number(message.rating);
    const count = message.count == null ? null : Number(message.count);
    if (!Number.isFinite(rating)) return;

    try {
      scraped.letterboxd = {
        rating,
        count: Number.isFinite(count) ? count : null,
        url: String(message.url || ""),
        source: "Letterboxd browser helper",
        cached: false
      };
      scrapeErrors.letterboxd = null;
      if (typeof setSourceLink === "function") setSourceLink(els.lbSourceLink, scraped.letterboxd.url);
      if (typeof calculateScore === "function") calculateScore();
      if (typeof setScrapeStatus === "function") setScrapeStatus(els.lbStatus, "Automatic • browser helper", "ok");
      if (els?.scrapeSummary) els.scrapeSummary.textContent = "Browser helper supplied blocked source data";
    } catch (_) {}
  }

  function applyMetacritic(message) {
    const current = currentMovie();
    if (!current) return;
    const wantedTitle = String(message.title || "").trim().toLowerCase();
    const currentTitle = current.title.trim().toLowerCase();
    if (wantedTitle && currentTitle && wantedTitle !== currentTitle) return;
    if (message.year && current.year && String(message.year) !== current.year) return;

    const score = Number(message.score);
    const reviews = Number(message.reviews);
    if (!Number.isFinite(score) || !Number.isFinite(reviews)) return;

    try {
      scraped.metacritic = {
        score,
        reviews,
        url: String(message.url || ""),
        source: "Metacritic browser helper",
        cached: false
      };
      scrapeErrors.metacritic = null;
      if (typeof setSourceLink === "function") setSourceLink(els.mcSourceLink, scraped.metacritic.url);
      if (typeof calculateScore === "function") calculateScore();
      if (typeof setScrapeStatus === "function") setScrapeStatus(els.mcStatus, "Automatic • browser helper", "ok");
      if (els?.scrapeSummary) els.scrapeSummary.textContent = "Browser helper supplied blocked source data";
    } catch (_) {}
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL || message.from !== "extension") return;

    if (message.type === "request-current-movie") {
      post({
        type: "current-movie",
        requestId: message.requestId,
        movie: currentMovie()
      });
      return;
    }

    if (message.type === "letterboxd-result") {
      applyLetterboxd(message);
      return;
    }

    if (message.type === "metacritic-result") {
      applyMetacritic(message);
    }
  });

  post({ type: "bridge-ready" });
})();
