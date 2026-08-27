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
        sendResponse({
          ok: false,
          error: chrome.runtime.lastError?.message || "Could not open Letterboxd tab"
        });
        return;
      }

      await saveJob(tab.id, {
        imdbID,
        sourceTabId,
        createdAt: Date.now()
      });

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

    getJob(helperTabId).then((job) => {
      sendResponse(job ? { ok: true, ...job } : { ok: false });
    });
    return true;
  }

  if (message?.type === "letterboxd-result") {
    const helperTabId = sender.tab?.id;
    if (helperTabId == null) return;

    (async () => {
      const job = await getJob(helperTabId);
      if (!job) return;

      chrome.tabs.sendMessage(job.sourceTabId, {
        type: "moviescore-letterboxd-result",
        imdbID: job.imdbID,
        rating: message.rating,
        count: message.count,
        url: message.url
      }, () => void chrome.runtime.lastError);

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
      if (!job) return;

      chrome.tabs.sendMessage(job.sourceTabId, {
        type: "moviescore-letterboxd-error",
        imdbID: job.imdbID,
        error: message.error || "Letterboxd helper could not read the rating"
      }, () => void chrome.runtime.lastError);
    })();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearJob(tabId).catch(() => {});
});
