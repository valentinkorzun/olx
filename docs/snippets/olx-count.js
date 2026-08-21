// Сколько всего совпадений — БЕЗ потолка в 1000, в отличие от самой выдачи.
// Принимает те же window.__P, что и olx-search.js. Запускать ДО поиска,
// чтобы решить, не слишком ли широкий запрос.
async page => {
  return await page.evaluate(async () => {
    const P = window.__P || {};
    if (!P.query) throw new Error('window.__P.query не задан');
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
