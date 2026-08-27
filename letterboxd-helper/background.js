const JOB_PREFIX = "moviescore_job_";

function jobKey(tabId) {
  return `${JOB_PREFIX}${tabId}`;
}

async function saveJob(tabId, job) {
  await chrome.storage.session.set({ [jobKey(tabId)]: job });
}

async function getJob(tabId) {
  const key = jobKey(tabId);
  const result = await chrome.storage.session.get(key);
  return result[key] || null;
}

async function clearJob(tabId) {
  await chrome.storage.session.remove(jobKey(tabId));
}

function slugify(title) {
  return String(title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function metacriticCandidates(title, year) {
  const slug = slugify(title);
  if (!slug) return [];
  const out = [];
  if (/^\d{4}$/.test(String(year || ""))) out.push(`${slug}-${year}`);
  out.push(slug);
  return [...new Set(out)].map(s => `https://www.metacritic.com/movie/${s}/critic-reviews/#moviescore=mc`);
}

function relay(tabId, message) {
  chrome.tabs.sendMessage(tabId, message, () => void chrome.runtime.lastError);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "moviescore-open-letterboxd") {
    const imdbID = String(message.imdbID || "").trim();
    const sourceTabId = sender.tab?.id;

    if (!/^tt\d{7,9}$/i.test(imdbID) || sourceTabId == null) {
      sendResponse({ ok: false, error: "Invalid MovieScore request" });
      return;
    }

    const url = `https://letterboxd.com/imdb/${imdbID}/#moviescore=${encodeURIComponent(imdbID)}`;

    chrome.tabs.create({ url, active: false }, async (tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        sendResponse({ ok: false, error: chrome.runtime.lastError?.message || "Could not open Letterboxd tab" });
        return;
      }

      await saveJob(tab.id, { kind: "letterboxd", imdbID, sourceTabId, createdAt: Date.now() });
      sendResponse({ ok: true, helperTabId: tab.id });
    });

    return true;
  }

  if (message?.type === "letterboxd-request-context") {
    const helperTabId = sender.tab?.id;
    if (helperTabId == null) {
      sendResponse({ ok: false });
      return;
    }
    getJob(helperTabId).then(job => sendResponse(job?.kind === "letterboxd" ? { ok: true, ...job } : { ok: false }));
    return true;
  }

  if (message?.type === "letterboxd-result") {
    const helperTabId = sender.tab?.id;
    if (helperTabId == null) return;

    (async () => {
      const job = await getJob(helperTabId);
      if (!job || job.kind !== "letterboxd") return;
      relay(job.sourceTabId, {
        type: "moviescore-letterboxd-result",
        imdbID: job.imdbID,
        rating: message.rating,
        count: message.count,
        url: message.url
      });
      await clearJob(helperTabId);
      chrome.tabs.remove(helperTabId, () => void chrome.runtime.lastError);
    })();
    return;
  }

  if (message?.type === "letterboxd-error") {
    const helperTabId = sender.tab?.id;
    if (helperTabId == null) return;

    (async () => {
      const job = await getJob(helperTabId);
      if (!job || job.kind !== "letterboxd") return;
      relay(job.sourceTabId, {
        type: "moviescore-letterboxd-error",
        imdbID: job.imdbID,
        error: message.error || "Letterboxd helper could not read the rating"
      });
      if (message.challenge) chrome.tabs.update(helperTabId, { active: true }, () => void chrome.runtime.lastError);
    })();
    return;
  }

  if (message?.type === "moviescore-open-metacritic") {
    const title = String(message.title || "").trim();
    const year = String(message.year || "").match(/\d{4}/)?.[0] || "";
    const sourceTabId = sender.tab?.id;
    const candidates = metacriticCandidates(title, year);

    if (!title || sourceTabId == null || !candidates.length) {
      sendResponse({ ok: false, error: "Invalid Metacritic helper request" });
      return;
    }

    chrome.tabs.create({ url: candidates[0], active: false }, async (tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        sendResponse({ ok: false, error: chrome.runtime.lastError?.message || "Could not open Metacritic tab" });
        return;
      }

      await saveJob(tab.id, {
        kind: "metacritic",
        title,
        year,
        sourceTabId,
        candidates,
        candidateIndex: 0,
        createdAt: Date.now()
      });
      sendResponse({ ok: true, helperTabId: tab.id });
    });

    return true;
  }

  if (message?.type === "metacritic-request-context") {
    const helperTabId = sender.tab?.id;
    if (helperTabId == null) {
      sendResponse({ ok: false });
      return;
    }
    getJob(helperTabId).then(job => sendResponse(job?.kind === "metacritic" ? { ok: true, ...job } : { ok: false }));
    return true;
  }

  if (message?.type === "metacritic-result") {
    const helperTabId = sender.tab?.id;
    if (helperTabId == null) return;

    (async () => {
      const job = await getJob(helperTabId);
      if (!job || job.kind !== "metacritic") return;
      relay(job.sourceTabId, {
        type: "moviescore-metacritic-result",
        title: job.title,
        year: job.year,
        score: message.score,
        reviews: message.reviews,
        url: message.url
      });
      await clearJob(helperTabId);
      chrome.tabs.remove(helperTabId, () => void chrome.runtime.lastError);
    })();
    return;
  }

  if (message?.type === "metacritic-error") {
    const helperTabId = sender.tab?.id;
    if (helperTabId == null) return;

    (async () => {
      const job = await getJob(helperTabId);
      if (!job || job.kind !== "metacritic") return;

      if (message.code === "not_found" && job.candidateIndex + 1 < job.candidates.length) {
        job.candidateIndex += 1;
        await saveJob(helperTabId, job);
        chrome.tabs.update(helperTabId, { url: job.candidates[job.candidateIndex], active: false }, () => void chrome.runtime.lastError);
        return;
      }

      relay(job.sourceTabId, {
        type: "moviescore-metacritic-error",
        title: job.title,
        year: job.year,
        error: message.error || "Metacritic helper could not read critic data"
      });

      if (message.code === "challenge") {
        chrome.tabs.update(helperTabId, { active: true }, () => void chrome.runtime.lastError);
      } else {
        await clearJob(helperTabId);
        chrome.tabs.remove(helperTabId, () => void chrome.runtime.lastError);
      }
    })();
    return;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearJob(tabId).catch(() => {});
});
