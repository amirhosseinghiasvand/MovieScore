# MovieScore Private MVP

Private/local movie-score app using the MovieScore confidence-adjusted formula.

## What this version does

- Searches movies through OMDb.
- Gets IMDb rating + vote count through OMDb.
- Gets Rotten Tomatoes positivity percentage through OMDb when available; RT remains display-only.
- **Automatically reads Letterboxd's public film-page JSON-LD** for its weighted rating and rating count.
- **Automatically reads Metacritic's public movie page** for Metascore and critic review count.
- Calculates audience, critic, confidence, and final MovieScore.
- Caches scraped results for 6 hours to avoid repeatedly requesting the same pages.
- Binds its local scraper server to `127.0.0.1` only.
- Keeps manual fallback fields if a source changes its page markup or refuses an automated request.

## Privacy / scraping behavior

This is designed for personal use on your own computer.

The scraper:

- reads only public, logged-out movie pages;
- does not log in to Letterboxd or Metacritic;
- does not access private/member data;
- does not solve or bypass CAPTCHAs, Cloudflare challenges, authentication, or access controls;
- stops and shows a manual fallback if a site blocks the request;
- caches successful results locally for six hours.

Letterboxd states in its FAQ that a film's rating is included in the film page's JSON-LD for use by search crawlers. The app uses Letterboxd's IMDb-ID redirect to locate the exact film.

Website markup can change, so scrapers are inherently less stable than official APIs.

## Windows: easiest way to run

1. Install **Node.js 18 or newer** if you do not already have it.
2. Extract this ZIP to a normal folder.
3. Double-click **`start.bat`**.
4. A local server window will open and your browser will go to:

   `http://127.0.0.1:8765`

5. In MovieScore, click **API Settings** and enter your OMDb API key.
6. Search for a movie. Letterboxd and Metacritic will then be fetched automatically.

Keep the server window open while using the app. Close it to stop the app.

## macOS / Linux

From the project folder:

```bash
node server.js
```

Then open `http://127.0.0.1:8765`.

On macOS you can also run `start.command`.

## No npm install is required

The server uses only Node.js built-in modules and the built-in `fetch` available in Node 18+.

## Formula v1.1

Normalize:

- IMDb = rating × 10
- Letterboxd = rating × 20
- Metacritic = already 0–100
- Rotten Tomatoes = display only

Confidence:

```
C = N / (N + K)
```

K values:

- IMDb: 10,000 ratings
- Letterboxd: 2,000 ratings
- Metacritic: 20 critic reviews

Audience base weights:

- IMDb: 60%
- Letterboxd: 40%

Final base weights:

- Critics: 55%
- Audience: 45%

Confidence is applied once. Missing data is re-normalized instead of being treated as zero.

## If automatic scraping fails

Possible reasons include:

- temporary network failure;
- HTTP 403/429 rate limiting;
- anti-bot/challenge page;
- site HTML/JSON-LD changed;
- the film has no matching page.

Open **Manual fallback** under that source and type the score/count yourself. The formula immediately recalculates.

## Development test

Run:

```bash
node test.js
```

This tests the Letterboxd JSON-LD parser, Metacritic critic-count/score parser, and slug generation.

## Files

- `server.js` — localhost server + scrapers + cache
- `index.html` — UI
- `app.js` — movie search + scoring logic + scraper integration
- `styles.css` — interface
- `FORMULA.md` — scoring formula reference
- `test.js` — parser tests
- `start.bat` — Windows launcher
- `start.command` — macOS launcher
