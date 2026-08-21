---
name: olx-search
description: Use when the user asks to find, search, price-check or browse listings on OLX Poland (olx.pl) — used goods, bikes, phones, furniture, cars, offers in Polish cities like Warszawa or Kraków.
---

# Searching OLX Poland

Data comes from the internal `olx.pl` JSON API **from a live browser session**: `curl` against the same URL gets a
403 from CloudFront. Implementation is in `docs/snippets/*.js`, the full spec with evidence in
`docs/olx-pl-search.md`, categories in `docs/olx-pl-categories.json`, cities and query history in
`docs/olx-pl-cities.json` / `docs/olx-pl-searches.json` via `scripts/olx-cache.py`.
Run all commands from the project root.

## What the answer to the user consists of

1. The Polish term you used, named out loud: "searching for `rower` (bicycle)".
2. The number of matches from the counter.
3. A top-N table: title, price (+"negotiable"), city/district, creation date, bump date, condition, seller, link.
4. The applied filters, listed.

Raw JSON is an intermediate artifact, not an answer.

## Order

```bash
scripts/olx-cache.py history --query rower       # is the user repeating an earlier search?
scripts/olx-cache.py city krakow                 # → cityId from the cache; exit 3 = miss, go to the API

playwright-cli -s=olx open https://www.olx.pl --persistent          # once per session

# only on a cache miss:
playwright-cli -s=olx eval "window.__P={city:'krakow'}"
playwright-cli -s=olx --raw run-code --filename=docs/snippets/olx-city.js   # → cityId
scripts/olx-cache.py city-add --name Kraków --id 8959 --region Małopolskie --region-id 4 --alias krakow

playwright-cli -s=olx eval "window.__P={query:'rower',cityId:8959,priceFrom:200,priceTo:500,state:'used'}"
playwright-cli -s=olx --raw run-code --filename=docs/snippets/olx-count.js  # → how many in total
playwright-cli -s=olx --raw run-code --filename=docs/snippets/olx-search.js # → listings

# after answering the user — record the query:
scripts/olx-cache.py log --params '{"query":"rower","cityId":8959,"priceFrom":200,"priceTo":500,"state":"used"}' \
  --total 812 --note "bicycle, Kraków, up to 500 zł"
```

`olx-offer.js` with `window.__P={id:...}` gives the details of a single listing. `history` prints a ready-to-run
`eval` line — a past search is repeated by copy-paste, with no second city resolve. Never edit the snippet files;
pass parameters only through `window.__P`.

## Filters

`priceFrom` `priceTo` `cityId` `distance` `state`('used'|'new'|'damaged') `ownerType`('private'|'business')
`courier` `categoryId` `sortBy` `pages`. Values and evidence are in `docs/olx-pl-search.md`.

## What breaks here

| Trap | The right way |
|---|---|
| Link assembled from an id or a title | Only the `url` field from the results. The server ignores the slug and addresses by the `ID<base36>` suffix; an invented suffix returns `200` and opens **someone else's** listing — verified: a forged PS5 link led to `majtki-dla-dziewczynki` |
| Parameter name guessed | The API answers `200 OK` to unknown parameters and **silently ignores them**. Check any parameter outside the list above with the counter, before and after |
| City resolved from scratch every time | `scripts/olx-cache.py city <name>` first. Go to the API only on `exit 3`, and write the result back with `city-add` right away — otherwise the next search pays for the same query again |
| Search done and forgotten | After answering — `scripts/olx-cache.py log --params ... --total ...`. Without it, "same as last time" has to be rebuilt from nothing |
| An id entered into `city-add` "from memory" | Only the value `olx-city.js` returned in this same session. The guard catches only a mismatch with an already cached id; an invented id for a new city goes right through |
| `data[0]` taken from the city resolve | For `krakow` the real Kraków comes back fourth, after the villages of Krakowiany (with diacritics it comes first). Pick by exact name; when ambiguous, ask |
| Expecting a strict order from `sortBy` | Promoted listings are pinned to the top and ignore sorting (they do respect filters). There is a `promoted` flag; for a strict order, sort locally |
| Asking for more than 50 at a time | `limit` is hard-capped at 50, `limit=100` → `400`. For more, use `pages` |
| "Let's collect all the results" | The ceiling is 1000, `offset=5000` → `400`. On `capped:true`, do not promise completeness — offer narrower filters |
| `created_at:desc` = only fresh listings | OLX bumps old listings. Show both dates: created and bumped |

## Red flags

- "The parameter is surely called `delivery`" — checked, it is ignored; the right one is `courier`.
- "This is faster with `curl`" — 403 from CloudFront even with a User-Agent.
- The counter showed thousands and I am dumping the list anyway — offer a narrowing first.
- "I'll assemble the link from the id, the pattern is right there" — you will not get a 404, you will get someone
  else's item in your table.
- "I resolved Szczecin last time" — the previous session remembers nothing, `docs/olx-pl-cities.json` does.
