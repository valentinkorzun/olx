// Резолв города в city_id. window.__P.city — название на любом языке ('krakow', 'Краков' работает хуже, пиши латиницей).
async page => {
  return await page.evaluate(async () => {
    const q = (window.__P || {}).city;
    if (!q) throw new Error('window.__P.city не задан');
    const res = await fetch('https://www.olx.pl/api/v1/geo-encoder/location-autocomplete/?query=' + encodeURIComponent(q));
    if (!res.ok) throw new Error(`location-autocomplete ${res.status}`);
    const json = await res.json();
    return json.data.slice(0, 5).map((d) => ({
      cityId: d.city?.id,
      city: d.city?.name,
      region: d.region?.name,
      regionId: d.region?.id,
      county: d.county?.name,
    }));
  });
}
