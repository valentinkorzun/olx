// Details of a single listing. window.__P.id is the numeric id (the id field from the results).
async page => {
  return await page.evaluate(async () => {
    const id = (window.__P || {}).id;
    if (!id) throw new Error('window.__P.id is not set');
    const res = await fetch(`https://www.olx.pl/api/v1/offers/${id}/`);
    if (!res.ok) throw new Error(`offers/${id} ${res.status}`);
    const o = (await res.json()).data;
    const price = o.params?.find((p) => p.key === 'price')?.value || {};
    return {
      id: o.id,
      title: o.title,
      url: o.url,
      price: price.value ?? null,
      negotiable: price.negotiable ?? null,
      description: (o.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      created: o.created_time,
      refreshed: o.last_refresh_time,
      validTo: o.valid_to_time,
      status: o.status,
      params: o.params?.map((p) => ({ key: p.key, name: p.name, value: p.value?.label ?? p.value })),
      location: o.location,
      map: o.map,
      // seller_type comes back null for private sellers — the business flag is authoritative
      seller: o.user && {
        id: o.user.id,
        name: o.user.name,
        type: o.user.seller_type ?? (o.business ? 'business' : 'private'),
        since: o.user.created,
        lastSeen: o.user.last_seen,
      },
      hasPhone: o.contact?.phone ?? null, // presence only; the number itself requires authentication
      business: o.business,
      contact: o.contact,
      delivery: o.delivery,
      photos: o.photos?.map((p) => p.link || p.filename),
      categoryId: o.category?.id,
    };
  });
}
