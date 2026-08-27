# Letterboxd browser helper

MovieScore's Node scraper can be blocked by Letterboxd's anti-bot/challenge page even though the public film page contains the rating in JSON-LD.

This optional Chrome helper reads that public JSON-LD in your **normal browser tab** and sends the rating back to your local MovieScore page.

It does not log into Letterboxd, bypass CAPTCHAs, or defeat access controls.

## One-time installation in Chrome

1. Download or clone this MovieScore repository.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** in the upper-right corner.
4. Click **Load unpacked**.
5. Select the repository folder named:

   `letterboxd-helper`

6. Keep **MovieScore Letterboxd Helper** enabled.
7. Reload MovieScore at:

   `http://127.0.0.1:8765`

## What happens after installation

1. Search/select a movie normally in MovieScore.
2. MovieScore first tries its lightweight Node scraper.
3. If Letterboxd returns an anti-bot/challenge response, the extension detects that failure.
4. It automatically opens the matching Letterboxd film through the movie's IMDb ID in a background Chrome tab.
5. The extension reads the film page's public `application/ld+json` rating data.
6. It sends the Letterboxd weighted rating and rating count back to MovieScore.
7. MovieScore recalculates the audience and final score.
8. The helper Letterboxd tab closes automatically after a successful read.

## If Letterboxd shows a challenge in Chrome too

The helper intentionally does not solve or bypass challenges.

If a Letterboxd tab remains open with a normal browser verification page, complete that verification yourself. Then return to MovieScore and use **Refresh scraped ratings**, or select the movie again.

## Permissions

The extension only requests access to:

- `https://letterboxd.com/*` — to read public film-page JSON-LD;
- `http://127.0.0.1:8765/*` — to detect your local MovieScore page;
- Chrome `tabs` — to open/close the temporary Letterboxd helper tab;
- Chrome session storage — to remember which temporary Letterboxd tab belongs to which MovieScore movie while it loads.

No OMDb API key is read by the extension.
