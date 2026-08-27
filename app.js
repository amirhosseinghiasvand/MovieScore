const $ = (id) => document.getElementById(id);

const els = {
  searchForm: $("searchForm"),
  searchInput: $("searchInput"),
  searchHint: $("searchHint"),
  status: $("status"),
  results: $("results"),
  moviePanel: $("moviePanel"),
  settingsBtn: $("settingsBtn"),
  settingsDialog: $("settingsDialog"),
  apiKeyInput: $("apiKeyInput"),
  saveKeyBtn: $("saveKeyBtn"),
  clearKeyBtn: $("clearKeyBtn"),

  poster: $("poster"),
  posterFallback: $("posterFallback"),
  movieTitle: $("movieTitle"),
  movieMeta: $("movieMeta"),
  plot: $("plot"),
  finalScore: $("finalScore"),
  criticScore: $("criticScore"),
  audienceScore: $("audienceScore"),
  criticConfidence: $("criticConfidence"),
  audienceConfidence: $("audienceConfidence"),
  qualityNote: $("qualityNote"),
  refreshSourcesBtn: $("refreshSourcesBtn"),
  scrapeSummary: $("scrapeSummary"),

  imdbRaw: $("imdbRaw"),
  imdbVotes: $("imdbVotes"),
  imdbConf: $("imdbConf"),

  lbRaw: $("lbRaw"),
  lbVotesText: $("lbVotesText"),
  lbStatus: $("lbStatus"),
  lbSourceLink: $("lbSourceLink"),
  lbRating: $("lbRating"),
  lbVotes: $("lbVotes"),
  lbConf: $("lbConf"),

  mcRaw: $("mcRaw"),
  mcReviewsText: $("mcReviewsText"),
  mcStatus: $("mcStatus"),
  mcSourceLink: $("mcSourceLink"),
  mcScoreOverride: $("mcScoreOverride"),
  mcReviews: $("mcReviews"),
  mcConf: $("mcConf"),

  rtRaw: $("rtRaw"),
};

const STORAGE_KEY = "moviescore.omdbKey";
let movie = null;
let scraped = {
  letterboxd: null,
  metacritic: null,
};
let scrapeErrors = {
  letterboxd: null,
  metacritic: null,
};

function apiKey() {
  return localStorage.getItem(STORAGE_KEY) || "";
}

function setStatus(message, kind = "info") {
  els.status.textContent = message;
  els.status.classList.remove("hidden");
  els.status.dataset.kind = kind;
}

function clearStatus() {
  els.status.classList.add("hidden");
  els.status.textContent = "";
}

function n(value) {
  if (value == null) return null;
  const s = String(value).trim().replace(/,/g, "");
  if (!s || s === "N/A") return null;
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}

function parseVotes(value) {
  return n(value);
}

function pct(x) {
  return x == null ? "—" : `${(x * 100).toFixed(1)}%`;
}

function one(x) {
  return x == null || !Number.isFinite(x) ? "—" : x.toFixed(1);
}

function formatCount(x) {
  return x == null ? "—" : Math.round(x).toLocaleString();
}

function confidence(count, k) {
  if (count == null || count < 0) return null;
  return count / (count + k);
}

function weightedAvailable(items) {
  const usable = items.filter(x =>
    x.value != null && x.conf != null && x.baseWeight > 0
  );
  if (!usable.length) return { score: null, confidence: null };

  const baseSum = usable.reduce((s, x) => s + x.baseWeight, 0);
  const normalized = usable.map(x => ({ ...x, w: x.baseWeight / baseSum }));

  const denom = normalized.reduce((s, x) => s + x.w * x.conf, 0);
  if (denom <= 0) return { score: null, confidence: 0 };

  const score = normalized.reduce((s, x) => s + x.value * x.w * x.conf, 0) / denom;
  const conf = normalized.reduce((s, x) => s + x.w * x.conf, 0);

  return { score, confidence: conf };
}

function effectiveInputs() {
  const manualLbRating = n(els.lbRating.value);
  const manualLbVotes = n(els.lbVotes.value);
  const manualMcScore = n(els.mcScoreOverride.value);
  const manualMcReviews = n(els.mcReviews.value);

  const lbRating = manualLbRating ?? n(scraped.letterboxd?.rating);
  const lbVotes = manualLbVotes ?? n(scraped.letterboxd?.count);

  const scrapedMcScore = n(scraped.metacritic?.score);
  const omdbMcScore = n(movie?.Metascore);
  const mcScore = manualMcScore ?? scrapedMcScore ?? omdbMcScore;
  const mcReviews = manualMcReviews ?? n(scraped.metacritic?.reviews);

  return {
    lbRating,
    lbVotes,
    mcScore,
    mcReviews,
    manualLb: manualLbRating != null || manualLbVotes != null,
    manualMc: manualMcScore != null || manualMcReviews != null,
  };
}

function setScrapeStatus(el, text, cls = "") {
  el.textContent = text;
  el.className = `scrape-status ${cls}`.trim();
}

function setSourceLink(el, url) {
  if (url) {
    el.href = url;
    el.classList.remove("hidden");
  } else {
    el.removeAttribute("href");
    el.classList.add("hidden");
  }
}

function calculateScore() {
  if (!movie) return;

  const imdbRating = n(movie.imdbRating);
  const imdbVotes = parseVotes(movie.imdbVotes);
  const { lbRating, lbVotes, mcScore, mcReviews, manualLb, manualMc } = effectiveInputs();

  const ci = confidence(imdbVotes, 10000);
  const cl = confidence(lbVotes, 2000);
  const cm = confidence(mcReviews, 20);

  const audience = weightedAvailable([
    { value: imdbRating == null ? null : imdbRating * 10, conf: ci, baseWeight: 0.60 },
    { value: lbRating == null ? null : lbRating * 20, conf: cl, baseWeight: 0.40 }
  ]);

  const criticScore = mcScore;
  const criticConf = cm;

  let final = null;
  const sides = [];

  if (criticScore != null && criticConf != null) {
    sides.push({ value: criticScore, baseWeight: 0.55, conf: criticConf });
  }
  if (audience.score != null && audience.confidence != null) {
    sides.push({ value: audience.score, baseWeight: 0.45, conf: audience.confidence });
  }

  if (sides.length) {
    const baseSum = sides.reduce((s, x) => s + x.baseWeight, 0);
    const normalized = sides.map(x => ({ ...x, w: x.baseWeight / baseSum }));
    const denom = normalized.reduce((s, x) => s + x.w * x.conf, 0);
    if (denom > 0) {
      final = normalized.reduce((s, x) => s + x.value * x.w * x.conf, 0) / denom;
    }
  }

  els.imdbConf.textContent = pct(ci);
  els.lbConf.textContent = pct(cl);
  els.mcConf.textContent = pct(cm);
  els.audienceScore.textContent = one(audience.score);
  els.audienceConfidence.textContent = audience.confidence == null ? "No audience confidence" : `${pct(audience.confidence)} confidence`;
  els.criticScore.textContent = criticScore == null ? "—" : one(criticScore);
  els.criticConfidence.textContent = criticConf == null ? "Need Metacritic review count" : `${pct(criticConf)} confidence`;
  els.finalScore.textContent = one(final);

  els.lbRaw.textContent = lbRating == null ? "—" : one(lbRating);
  els.lbVotesText.textContent = lbVotes == null ? "Rating count unavailable" : `${formatCount(lbVotes)} ratings`;
  els.mcRaw.textContent = mcScore == null ? "—" : one(mcScore).replace(/\.0$/, "");
  els.mcReviewsText.textContent = mcReviews == null ? "Critic count unavailable" : `${formatCount(mcReviews)} critic reviews`;

  if (manualLb) {
    setScrapeStatus(els.lbStatus, "Manual override active", "warn");
  } else if (scraped.letterboxd) {
    setScrapeStatus(els.lbStatus, scraped.letterboxd.cached ? "Automatic • cached" : "Automatic • live", "ok");
  } else if (scrapeErrors.letterboxd) {
    setScrapeStatus(els.lbStatus, `Auto failed: ${scrapeErrors.letterboxd}`, "error");
  }

  if (manualMc) {
    setScrapeStatus(els.mcStatus, "Manual override active", "warn");
  } else if (scraped.metacritic) {
    setScrapeStatus(els.mcStatus, scraped.metacritic.cached ? "Automatic • cached" : "Automatic • live", "ok");
  } else if (scrapeErrors.metacritic) {
    const usingOmdb = n(movie.Metascore) != null;
    setScrapeStatus(els.mcStatus, usingOmdb ? `Critic count auto failed; OMDb Metascore kept` : `Auto failed: ${scrapeErrors.metacritic}`, "error");
  }

  const missing = [];
  if (lbRating == null || lbVotes == null) missing.push("Letterboxd rating/count");
  if (criticScore != null && mcReviews == null) missing.push("Metacritic critic count");

  if (missing.length) {
    els.qualityNote.textContent = `Provisional score. Missing ${missing.join(" and ")}.`;
  } else {
    els.qualityNote.textContent = "Full formula active: Letterboxd and Metacritic confidence data are included.";
  }
}

function getRtRating(ratings) {
  if (!Array.isArray(ratings)) return null;
  const row = ratings.find(r => r.Source === "Rotten Tomatoes");
  if (!row) return null;
  const match = String(row.Value).match(/([\d.]+)%/);
  return match ? Number(match[1]) : null;
}

async function refreshScrapedSources(force = false) {
  if (!movie) return;
  if (location.protocol === "file:") {
    scrapeErrors.letterboxd = "Run the app through start.bat/server.js";
    scrapeErrors.metacritic = "Run the app through start.bat/server.js";
    calculateScore();
    return;
  }

  scraped = { letterboxd: null, metacritic: null };
  scrapeErrors = { letterboxd: null, metacritic: null };
  setScrapeStatus(els.lbStatus, "Fetching public JSON-LD…");
  setScrapeStatus(els.mcStatus, "Fetching critic data…");
  els.scrapeSummary.textContent = "Updating…";
  setSourceLink(els.lbSourceLink, null);
  setSourceLink(els.mcSourceLink, null);
  calculateScore();

  const year = String(movie.Year || "").match(/\d{4}/)?.[0] || "";
  const params = new URLSearchParams({ imdb: movie.imdbID || "", title: movie.Title || "", year });
  if (force) params.set("refresh", "1");

  try {
    const res = await fetch(`/api/scrape?${params.toString()}`);
    if (!res.ok) throw new Error(`Local scraper HTTP ${res.status}`);
    const data = await res.json();

    if (data.letterboxd?.ok) {
      scraped.letterboxd = data.letterboxd;
      setSourceLink(els.lbSourceLink, data.letterboxd.url);
    } else {
      scrapeErrors.letterboxd = data.letterboxd?.error || "Not available";
    }

    if (data.metacritic?.ok) {
      scraped.metacritic = data.metacritic;
      setSourceLink(els.mcSourceLink, data.metacritic.url);
    } else {
      scrapeErrors.metacritic = data.metacritic?.error || "Not available";
    }

    const good = Number(Boolean(data.letterboxd?.ok)) + Number(Boolean(data.metacritic?.ok));
    els.scrapeSummary.textContent = `${good}/2 scraped sources available`;
  } catch (err) {
    scrapeErrors.letterboxd = err.message;
    scrapeErrors.metacritic = err.message;
    els.scrapeSummary.textContent = "Local scraper unavailable";
  }

  calculateScore();
}

function showMovie(data) {
  movie = data;
  scraped = { letterboxd: null, metacritic: null };
  scrapeErrors = { letterboxd: null, metacritic: null };
  els.results.classList.add("hidden");
  els.moviePanel.classList.remove("hidden");

  els.movieTitle.textContent = data.Title || "Unknown title";
  const bits = [data.Year, data.Rated, data.Runtime, data.Genre].filter(x => x && x !== "N/A");
  els.movieMeta.textContent = bits.join(" • ");
  els.plot.textContent = data.Plot && data.Plot !== "N/A" ? data.Plot : "";

  if (data.Poster && data.Poster !== "N/A") {
    els.poster.src = data.Poster;
    els.poster.alt = `${data.Title} poster`;
    els.poster.style.display = "block";
    els.posterFallback.style.display = "none";
  } else {
    els.poster.removeAttribute("src");
    els.poster.style.display = "none";
    els.posterFallback.style.display = "grid";
  }

  els.imdbRaw.textContent = data.imdbRating && data.imdbRating !== "N/A" ? data.imdbRating : "—";
  els.imdbVotes.textContent = data.imdbVotes && data.imdbVotes !== "N/A" ? `${data.imdbVotes} ratings` : "Rating count unavailable";

  const rt = getRtRating(data.Ratings);
  els.rtRaw.textContent = rt == null ? "—" : String(rt);

  els.lbRating.value = "";
  els.lbVotes.value = "";
  els.mcScoreOverride.value = "";
  els.mcReviews.value = "";
  setSourceLink(els.lbSourceLink, null);
  setSourceLink(els.mcSourceLink, null);
  setScrapeStatus(els.lbStatus, "Fetching…");
  setScrapeStatus(els.mcStatus, "Fetching…");
  els.scrapeSummary.textContent = "";

  calculateScore();
  refreshScrapedSources(false);
  els.moviePanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function omdb(params) {
  const key = apiKey();
  if (!key) throw new Error("NO_KEY");

  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("apikey", key);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.Response === "False") throw new Error(data.Error || "OMDb request failed");
  return data;
}

async function searchMovies(query) {
  setStatus("Searching…");
  els.results.classList.add("hidden");

  try {
    const data = await omdb({ s: query, type: "movie" });
    clearStatus();

    const rows = (data.Search || []).slice(0, 10);
    if (!rows.length) {
      setStatus("No movie results found.");
      return;
    }

    els.results.innerHTML = "";
    for (const item of rows) {
      const btn = document.createElement("button");
      btn.className = "result";
      btn.type = "button";

      const img = document.createElement("img");
      img.className = "mini-poster";
      if (item.Poster && item.Poster !== "N/A") {
        img.src = item.Poster;
        img.alt = "";
      }

      const copy = document.createElement("div");
      copy.innerHTML = `<strong></strong><span></span>`;
      copy.querySelector("strong").textContent = item.Title;
      copy.querySelector("span").textContent = item.Year || "";

      const arrow = document.createElement("div");
      arrow.className = "arrow";
      arrow.textContent = "›";

      btn.append(img, copy, arrow);
      btn.addEventListener("click", async () => {
        setStatus(`Loading ${item.Title}…`);
        try {
          const full = await omdb({ i: item.imdbID, plot: "full" });
          clearStatus();
          showMovie(full);
        } catch (err) {
          setStatus(`Could not load movie: ${err.message}`, "error");
        }
      });

      els.results.appendChild(btn);
    }

    els.results.classList.remove("hidden");
  } catch (err) {
    if (err.message === "NO_KEY") {
      setStatus("Add your free OMDb API key in API Settings to enable live movie search.", "warn");
      els.settingsDialog.showModal();
    } else {
      setStatus(`Search failed: ${err.message}`, "error");
    }
  }
}

els.searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = els.searchInput.value.trim();
  if (q) searchMovies(q);
});

[els.lbRating, els.lbVotes, els.mcScoreOverride, els.mcReviews].forEach(el => {
  el.addEventListener("input", calculateScore);
});

els.refreshSourcesBtn.addEventListener("click", () => refreshScrapedSources(true));

els.settingsBtn.addEventListener("click", () => {
  els.apiKeyInput.value = apiKey();
  els.settingsDialog.showModal();
});

els.saveKeyBtn.addEventListener("click", () => {
  const key = els.apiKeyInput.value.trim();
  if (key) {
    localStorage.setItem(STORAGE_KEY, key);
    els.searchHint.textContent = "Live movie search connected.";
  } else {
    localStorage.removeItem(STORAGE_KEY);
    els.searchHint.textContent = "Add an OMDb key in API Settings to enable movie search.";
  }
  els.settingsDialog.close();
});

els.clearKeyBtn.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  els.apiKeyInput.value = "";
  els.searchHint.textContent = "API key cleared.";
});

if (location.protocol === "file:") {
  els.searchHint.textContent = "Private scraping requires the local server. Run start.bat (Windows) or node server.js.";
} else if (apiKey()) {
  els.searchHint.textContent = "Live movie search connected. Letterboxd + Metacritic scraping enabled.";
} else {
  els.searchHint.textContent = "First use: add a free OMDb key in API Settings. Private scrapers are ready.";
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
