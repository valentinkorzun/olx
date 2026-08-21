// How many matches there are in total — WITHOUT the ceiling of 1000 that the results themselves have.
// Takes the same window.__P as olx-search.js. Run it BEFORE the search,
// to decide whether the query is too broad.
async page => {
  return await page.evaluate(async () => {
    const P = window.__P || {};
    if (!P.query) throw new Error('window.__P.query is not set');
    const qs = new URLSearchParams();
    qs.set('query', P.query);
    if (P.cityId) qs.set('city_id', String(P.cityId));
    if (P.distance) qs.set('distance', String(P.distance));
    if (P.priceFrom != null) qs.set('filter_float_price:from', String(P.priceFrom));
    if (P.priceTo != null) qs.set('filter_float_price:to', String(P.priceTo));
    if (P.state) qs.set('filter_enum_state[0]', P.state);
    if (P.ownerType) qs.set('owner_type', P.ownerType);
    if (P.courier) qs.set('courier', '1');
    if (P.categoryId) qs.set('category_id', String(P.categoryId));
    const res = await fetch('https://www.olx.pl/api/v1/offers/metadata/search/?' + qs.toString());
    if (!res.ok) throw new Error(`metadata/search ${res.status}`);
    const json = await res.json();
    return { total: json.data?.total_count ?? null, filters: Object.fromEntries(qs) };
  });
}
