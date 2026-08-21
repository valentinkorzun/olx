# Searching OLX Poland via playwright-cli

Runtime instructions for Claude. Every number and parameter name here is **verified against the live site on
2026-08-21**; anything unverified is marked as such. Implementation lives in `docs/snippets/*.js`, the category
reference in `docs/olx-pl-categories.json`, the local cache in `docs/olx-pl-cities.json` and
`docs/olx-pl-searches.json` (see "Cache and history").

## How this works

Data comes from the internal JSON API at `https://www.olx.pl/api/v1/*`, but **from a live browser session**:
`curl` against the same URL gets a `403` from CloudFront even with a spoofed User-Agent. The browser here is the
pass, not a way to read markup. DOM scraping is kept as a fallback (see "Fallback").

## Session lifecycle

```bash
playwright-cli -s=olx open https://www.olx.pl --persistent   # once; the on-disk profile keeps cookies and the cookie consent
# ... commands ...
playwright-cli -s=olx close                                   # only when the session is no longer needed
```

The session is named and reused across tasks. `--persistent` is what keeps you from warming up cookies again
and catching a 403 after a restart.

## Call protocol

Parameters are passed through `window.__P`, the snippet runs as a separate command. Snippet files are **never edited**.

```bash
playwright-cli -s=olx eval "window.__P={query:'rower',cityId:8959,priceFrom:200,priceTo:500,state:'used'}"
playwright-cli -s=olx --raw run-code --filename=docs/snippets/olx-search.js
```

| Snippet | What it does |
|---|---|
| `olx-city.js` | city name → `cityId` (`window.__P.city`) |
| `olx-count.js` | number of matches for the filters, with no result ceiling |
| `olx-search.js` | search → normalized array of listings |
| `olx-offer.js` | details of a single listing (`window.__P.id`) |

## Required order of operations

1. **Translate the query into Polish.** Search works on Polish words. Always name the term you used explicitly in
   your answer: "searching for `rower` (bicycle)" — so the user can correct it.
2. **Resolve the city** if one was named — but check `scripts/olx-cache.py city <name>` first. A hit returns the
   `cityId` with no network call, a miss exits `3`, and only then do you go to `olx-city.js`. The resolver returns
   up to 5 candidates and **they are not ordered by relevance**: for `krakow` the real Kraków (`8959`) comes back
   fourth, after the villages of Krakowiany (with diacritics, `Kraków`, it comes first). Pick by exact name match;
   when it is ambiguous, ask the user instead of guessing. Write the chosen candidate straight into the cache with
   `city-add`.
3. **Count the matches** with `olx-count.js` before the search itself. If the counter is in the thousands, do not
   dump junk: say "too broad" and offer concrete narrowings (price, city, condition, category).
4. **Search** with `olx-search.js`.
5. **Show a top-N table**: title, price (+"negotiable"), city/district, creation date, bump date, condition,
   seller type, link. Raw JSON stays an intermediate artifact. **Take the link only from the `url` field**:
   in the address `/d/oferta/<slug>-CID<cat>-ID<base36>.html` the server only parses the `ID` suffix, the slug is
   decorative. A hand-assembled suffix does not give you a `404`, it returns `200` and opens an unrelated listing
   (verified 2026-08-21: a forged id in a PS5 link opened `majtki-dla-dziewczynki-134-140-CID88`).
6. **Log the query** to the history: `scripts/olx-cache.py log --params '<same as window.__P>' --total <count>`.

## Filters

Verified with the `metadata/search` counter on the query `rower` (baseline — 330,777 matches):

| `window.__P` | API parameter | check | status |
|---|---|---|---|
| `priceFrom` / `priceTo` | `filter_float_price:from` / `:to` | `from=2000` → 53,587 | ✅ |
| `cityId` | `city_id` | Kraków `8959` → 15,194 | ✅ |
| `distance` | `distance` (km, only together with `city_id`) | `8959 + 15` → 18,693 | ✅ |
| `state` | `filter_enum_state[0]` | `used` → 198,875, `new` → 90,388 | ✅ |
| `ownerType` | `owner_type` | `private` → 247,172, `business` → 83,598 | ✅ |
| `courier` | `courier=1` | → 106,162 | ✅ |
| `categoryId` | `category_id` | `1651` → 43,240 | ✅ |
| `sortBy` | `sort_by` | `created_at:desc`, `filter_float_price:asc/desc` | ✅ |

**Parameter names must never be guessed.** The API answers `200 OK` to unknown parameters and silently ignores
them. That is how the plausible-looking `private_business=private` (330,772 against a baseline of 330,777) and
`delivery=1` (330,780) both failed — each looked like it worked until the counter was checked. Verify any new
filter the same way: counter before and after.

## Cache and history

A session does not remember the previous conversation, so the same questions ("Szczecin? Kraków?") kept going out
to the API over and over. Two version-controlled files close that gap; both are served by `scripts/olx-cache.py`
(Python 3 stdlib only).

| File | What is inside | Commands |
|---|---|---|
| `docs/olx-pl-cities.json` | `name → cityId` plus region, county, aliases, resolve date. Seeded with 20 major cities (verified 2026-08-21) | `city <name>` → JSON or `exit 3`; `city-add --name … --id … [--region … --region-id … --county … --alias …]` |
| `docs/olx-pl-searches.json` | search history: date, `params` (exactly what goes into `window.__P`), `total`, note. Newest first, 100 kept | `log --params '<json>' [--total N] [--note …]`; `history [--limit N] [--query …]` |

Name lookup is case- and diacritics-insensitive: `szczecin`, `Szczecin`, `krakow`, `Kraków` are all one key.
`history` prints a ready-to-run `playwright-cli … eval 'window.__P={…}'` line — a past query is repeated by
copy-paste.

Limits worth knowing about:

- `city-add` only catches a **mismatch** with an already cached id ("already 6169, got 6681"). It does not verify
  the id of a new city — enter only what `olx-city.js` returned, never something "from memory".
- The cache does not expire on its own. OLX `cityId`s are stable, but if results look strange, re-resolve and fix
  it with `city-add`.
- The history is a local file in the repository and ends up in commits. Do not log anything that should not be there.

## Categories

`docs/olx-pl-categories.json` — 19 top-level categories and 249 subcategories (`id`, `slug`, `name`), collected
2026-08-21. OLX has no public reference: `/api/v1/categories/`, `/categories/tree/` and `/api/v2/` all return 404,
and `/api/partner/categories` requires a developer OAuth token. The dictionary was assembled from `/sitemap/`
(names and slugs) plus the `category_id` from each category page.

Rebuild it if you suspect the tree is stale:
- top level: `GET /api/v1/friendly-links/query-params/{slug}/` → `{data:{category_id}}` (works **only** for the top level);
- subcategories: `GET /{parent}/{child}/` and the regex `category_id\\*":\s*(\d+)` over the HTML (~3.7 MB per page,
  the server ignores Range).

## Limits you cannot work around

- **Result ceiling of 1000.** `metadata.total_elements` is always `1000`, `offset=5000` → `400 Bad Request`.
  With a `visible_total_count` of 7862 you still cannot reach past a thousand listings. "Collect everything" for a
  broad query is impossible — you can only narrow with filters. The snippet sets the flag `capped: true` when it
  hits the wall.
- **`limit` maxes out at 50.** `limit=100` → `400 Data validation error`.
- **The response is longer than requested.** `limit=10` → 13 objects, `limit=40` → 52, `limit=50` → 65: OLX mixes
  in promoted listings. That is why `offset` is computed as `i * 50` rather than from the number of elements
  received; duplicates are cut by `id`.
- **Promoted listings break sorting.** OLX pins promoted listings to the top and they ignore `sort_by`: with
  `filter_float_price:asc` the first results were 5249 zł, 3.5 zł, 2999 zł, and only then the organic ones —
  strictly ascending. Promoted listings do **respect** the filters (verified: 59 cards, 10 promoted, not a single
  violation of price, condition or city), so there is no junk in the results — only the order is off. Every card
  is marked with a `promoted` flag; if you need a strict price order, sort locally on the `price` field.
- **`seller_type` is almost always `null`.** For private sellers the field is empty; the boolean `business` is
  authoritative. The snippets output a derived `private` / `business` instead of the raw field.
- **`created_time` ≠ freshness.** OLX bumps old listings up (`pushup_time`, `last_refresh_time`). Sorting by
  `created_at:desc` mixes new listings with bumped old ones — show both dates in the table.

## Fallback: DOM

If the API starts returning 403 or an empty `data`, the results markup (verified 2026-08-21):

| element | selector |
|---|---|
| card | `[data-cy="l-card"]`, the `id` attribute is the listing id |
| link and title | `[data-testid="card-title-link"]` |
| price | `[data-testid="ad-price"]` (as a string, `"1 300 zł"`) |
| city and date | `[data-testid="location-date"]` (`"Gliwice, Sikornik - 06 sierpnia 2026"`) |
| breadcrumbs | `[data-cy="categories-breadcrumbs"]` |

Through the DOM, price and date arrive as Polish strings and need parsing, and condition and seller type are not
there at all — this is a degradation, not an equivalent path.

## Acceptance smoke run

Run on 2026-08-21, `rower` / Kraków / 200–500 zł / used:

```bash
playwright-cli -s=olx open https://www.olx.pl --persistent
playwright-cli -s=olx eval "window.__P={city:'krakow'}"
playwright-cli -s=olx --raw run-code --filename=docs/snippets/olx-city.js
# → Kraków cityId 8959 (fourth in the list!)
playwright-cli -s=olx eval "window.__P={query:'rower',cityId:8959,priceFrom:200,priceTo:500,state:'used'}"
playwright-cli -s=olx --raw run-code --filename=docs/snippets/olx-count.js
# → {"total":1424,...}
playwright-cli -s=olx --raw run-code --filename=docs/snippets/olx-search.js
# → returned: 55, capped: false
```

Actual result:

| id | title | price | city / district | created | condition | seller |
|---|---|---|---|---|---|---|
| 1091864382 | Rower dziecięcy 5-8 lat koła 20" | 320 zł | Kraków / Prądnik Biały | 2026-08-17 | Używane | private |
| 1092642025 | Rower KROSS Level JR 1.0 | 400 zł | Kraków / Bieżanów-Prokocim | 2026-08-20 | Używane | private |
| 1087276993 | Rower Kross / oferta do 23/08 | 400 zł | Kraków / Grzegórzki | 2026-07-24 | Używane | private |
| 1092884644 | Rower w dobrym stanie średnica kół 24 | 250 zł | Kraków / Prądnik Biały | 2026-08-21 | Używane | private |
| 1010073816 | Rower Romet Mars PRL | 300 zł | Kraków / Czyżyny | 2025-06-24 | Używane | private |

The spec counts as working if this run reproduces: the counter returns a number, the search returns a non-empty
list, every card is from Kraków, every one is `Używane`, and every price is within 200–500.

## Out of scope for v1

- **Monitoring new listings** — deliberately left out: it needs state kept between runs, a deduplication key, and a
  decision about what counts as "new" when old listings get bumped.
- **Seller phone number** — `/api/v1/users/me/` returns `401`, the contact endpoints require authentication. Not tested.
- **Category-level filters** (brand, wheel size, frame material) — available via
  `/api/v1/offers/metadata/filters/?category_id=N`, but not wired up in v1.
