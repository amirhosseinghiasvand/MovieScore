# Scraper design

## Letterboxd

Input: IMDb ID returned by OMDb.

Request:

`https://letterboxd.com/imdb/{IMDbID}/`

Letterboxd redirects this to the matching film page. The scraper follows the normal public redirect and parses `application/ld+json`. It recursively looks for `aggregateRating.ratingValue` and `aggregateRating.ratingCount` (falling back to `reviewCount` if necessary).

## Metacritic

Input: movie title and four-digit year.

The scraper generates conservative candidate slugs:

1. `title-year`
2. `title`

It reads the public movie page, verifies the page title against the requested movie title, then extracts the public text pattern:

`Based on N Critic Reviews`

and the Metascore associated with that critic block.

The app still retains OMDb's Metascore as a fallback if Metacritic's critic count cannot be fetched.

## Guardrails

- localhost only (`127.0.0.1`)
- 6-hour in-memory cache
- one request per source for a movie, normally
- 12-second request timeout
- no credentials/cookies
- no challenge/CAPTCHA bypass
- manual fallback always available
