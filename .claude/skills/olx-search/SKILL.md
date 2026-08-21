---
name: olx-search
description: Use when the user asks to find, search, price-check or browse listings on OLX Poland (olx.pl) — used goods, bikes, phones, furniture, cars, offers in Polish cities like Warszawa or Kraków.
---

# Поиск по OLX Poland

Данные берутся из внутреннего JSON API `olx.pl` **из живой браузерной сессии**: `curl` к тому же URL
получает 403 от CloudFront. Реализация — `docs/snippets/*.js`, полная спека с доказательствами —
`docs/olx-pl-search.md`, категории — `docs/olx-pl-categories.json`, города и история запросов —
`docs/olx-pl-cities.json` / `docs/olx-pl-searches.json` через `scripts/olx-cache.py`.
Команды запускать из корня проекта.

## Из чего состоит ответ пользователю

1. Названный польский термин: «ищу по `rower` (велосипед)».
2. Число совпадений из счётчика.
3. Таблица топ-N: название, цена (+«торг»), город/район, дата создания, дата поднятия, состояние, продавец, ссылка.
4. Перечисленные применённые фильтры.

Сырой JSON — промежуточный артефакт, не ответ.

## Порядок

```bash
scripts/olx-cache.py history --query rower       # повторяет ли пользователь прошлый поиск?
scripts/olx-cache.py city krakow                 # → cityId из кэша; exit 3 = промах, идём в API

playwright-cli -s=olx open https://www.olx.pl --persistent          # один раз на сессию

# только на промахе кэша:
playwright-cli -s=olx eval "window.__P={city:'krakow'}"
playwright-cli -s=olx --raw run-code --filename=docs/snippets/olx-city.js   # → cityId
scripts/olx-cache.py city-add --name Kraków --id 8959 --region Małopolskie --region-id 4 --alias krakow

playwright-cli -s=olx eval "window.__P={query:'rower',cityId:8959,priceFrom:200,priceTo:500,state:'used'}"
playwright-cli -s=olx --raw run-code --filename=docs/snippets/olx-count.js  # → сколько всего
playwright-cli -s=olx --raw run-code --filename=docs/snippets/olx-search.js # → объявления

# после ответа пользователю — зафиксировать запрос:
scripts/olx-cache.py log --params '{"query":"rower","cityId":8959,"priceFrom":200,"priceTo":500,"state":"used"}' \
  --total 812 --note "велосипед Краков до 500 zł"
```

`olx-offer.js` с `window.__P={id:...}` — детали одного объявления. `history` печатает готовую строку
`eval` — прошлый поиск повторяется копипастой, без повторного резолва города. Файлы сниппетов не редактировать,
параметры передавать только через `window.__P`.

## Фильтры

`priceFrom` `priceTo` `cityId` `distance` `state`('used'|'new'|'damaged') `ownerType`('private'|'business')
`courier` `categoryId` `sortBy` `pages`. Значения и доказательства — в `docs/olx-pl-search.md`.

## Что здесь ломается

| Ловушка | Как правильно |
|---|---|
| Ссылка собрана из id или названия | Только поле `url` из выдачи. Слаг сервер игнорирует, адресует суффикс `ID<base36>`; выдуманный суффикс даёт `200` и открывает **чужое** объявление — проверено: подделанная ссылка на PS5 привела к `majtki-dla-dziewczynki` |
| Имя параметра угадано | API отвечает `200 OK` на неизвестные параметры и **молча их игнорирует**. Любой параметр вне списка выше — проверить счётчиком до и после |
| Город резолвится заново каждый раз | Сначала `scripts/olx-cache.py city <имя>`. В API идти только на `exit 3`, результат сразу дописывать `city-add` — иначе следующий поиск снова платит за тот же запрос |
| Поиск сделан и забыт | После ответа — `scripts/olx-cache.py log --params ... --total ...`. Без этого «как в прошлый раз» придётся собирать заново |
| В `city-add` вписан id «по памяти» | Только значение, которое вернул `olx-city.js` в этой же сессии. Сторож ловит лишь расхождение с уже закэшированным, выдуманный id для нового города он пропустит |
| Взят `data[0]` из резолва города | На `krakow` настоящий Kraków идёт четвёртым, после деревень Krakowiany (с диакритикой — первым). Выбирать по точному имени, при неоднозначности спросить |
| Ждём строгий порядок при `sortBy` | Промо пришпилены наверх и игнорируют сортировку (фильтры — соблюдают). Есть флаг `promoted`; строгий порядок — сортировать локально |
| Просим больше 50 за раз | `limit` жёстко 50, `limit=100` → `400`. Больше — через `pages` |
| «Соберём всю выдачу» | Потолок 1000, `offset=5000` → `400`. При `capped:true` — не обещать полноту, а предлагать сузить фильтры |
| `created_at:desc` = только свежее | OLX поднимает старые объявления. Показывать обе даты: создания и поднятия |

## Красные флаги

- «Параметр наверняка называется `delivery`» — проверено, игнорируется; правильный `courier`.
- «Тут быстрее через `curl`» — 403 от CloudFront даже с User-Agent.
- Счётчик показал тысячи, а я всё равно вываливаю список — сначала предложить сужение.
- «Ссылку соберу из id, там же виден шаблон» — 404 не будет, будет чужой товар в таблице.
- «Szczecin я же резолвил в прошлый раз» — прошлая сессия ничего не помнит, помнит `docs/olx-pl-cities.json`.
