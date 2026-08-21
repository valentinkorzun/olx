// Search olx.pl listings through the internal JSON API.
// Parameters are read from window.__P (set them before running:
//   playwright-cli -s=olx eval "window.__P={query:'rower',limit:50}")
//
// __P fields:
//   query      string, Polish term (required)
//   cityId     number, from olx-city.js
//   distance   number, km around the city (only works together with cityId)
//   priceFrom  number, zł
//   priceTo    number, zł
//   state      'used' | 'new' | 'damaged'
//   ownerType  'private' | 'business'
//   courier    true — OLX delivery only
//   categoryId number, from docs/olx-pl-categories.json
//   sortBy     'created_at:desc' (default) | 'filter_float_price:asc' | 'filter_float_price:desc'
//   pages      how many pages to pull, 1 by default (limit is hard-capped at 50, offset ceiling is 1000)
async page => {
  return await page.evaluate(async () => {
    const P = window.__P || {};
    if (!P.query) throw new Error('window.__P.query is not set');

    const buildQS = (offset) => {
      const qs = new URLSearchParams();
      qs.set('offset', String(offset));
      qs.set('limit', '50');
      qs.set('query', P.query);
      qs.set('sort_by', P.sortBy || 'created_at:desc');
      if (P.cityId) qs.set('city_id', String(P.cityId));
      if (P.distance) qs.set('distance', String(P.distance));
      if (P.priceFrom != null) qs.set('filter_float_price:from', String(P.priceFrom));
      if (P.priceTo != null) qs.set('filter_float_price:to', String(P.priceTo));
      if (P.state) qs.set('filter_enum_state[0]', P.state);
      if (P.ownerType) qs.set('owner_type', P.ownerType);
      if (P.courier) qs.set('courier', '1');
      if (P.categoryId) qs.set('category_id', String(P.categoryId));
      return qs.toString();
    };

    const param = (o, key) => o.params?.find((p) => p.key === key)?.value;

    const normalize = (o) => {
      const price = param(o, 'price') || {};
      return {
        id: o.id,
        title: o.title,
        price: price.value ?? null,
        currency: price.currency ?? null,
        negotiable: price.negotiable ?? null,
        priceLabel: price.label ?? null,
        url: o.url,
        city: o.location?.city?.name ?? null,
        district: o.location?.district?.name ?? null,
        region: o.location?.region?.name ?? null,
        created: o.created_time,
        refreshed: o.last_refresh_time,
        state: param(o, 'state')?.label ?? null,
        business: o.business,
        sellerType: o.user?.seller_type ?? (o.business ? 'business' : 'private'),
        sellerName: o.user?.name ?? null,
        courier: o.delivery?.rock?.active ?? false,
        photos: o.photos?.length ?? 0,
        categoryId: o.category?.id ?? null,
        // promoted listings respect the filters, but are pinned to the top and break sort_by
        promoted: !!(o.promotion && (o.promotion.top_ad || o.promotion.highlighted || o.promotion.urgent)),
      };
    };

    const pages = Math.max(1, P.pages || 1);
    const seen = new Set();
    const items = [];
    let capped = false;

    for (let i = 0; i < pages; i++) {
      const offset = i * 50;
      if (offset > 1000) { capped = true; break; }
      const res = await fetch('https://www.olx.pl/api/v1/offers/?' + buildQS(offset));
      if (!res.ok) throw new Error(`offers ${res.status} at offset=${offset}`);
      const json = await res.json();
      // the response returns MORE than limit (promoted listings mixed in) — cut duplicates by id
      for (const o of json.data) {
        if (seen.has(o.id)) continue;
        seen.add(o.id);
        items.push(normalize(o));
      }
      if (!json.links?.next) break;
    }

    return {
      requested: { ...P },
      returned: items.length,
      promoted: items.filter((i) => i.promoted).length,
      capped,
      items,
    };
  });
}
