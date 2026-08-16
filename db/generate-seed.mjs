/* =========================================================================
   Turns the demo content in data.js into 02-seed.sql.

       node db/generate-seed.mjs

   Run it again whenever data.js changes and you want a fresh starting menu.
   It only writes the seed file; nothing here talks to Supabase.
   ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'data.js'), 'utf8');

// data.js is a plain script of top-level consts: run it and hand back the globals.
const data = vm.runInNewContext(
    source + ';({ RESTAURANT, CATEGORIES, MENU })',
    { window: {} }
);

const q = (value) => (value === null || value === undefined ? 'null' : `'${String(value).replace(/'/g, "''")}'`);
const json = (value) => `'${JSON.stringify(value ?? []).replace(/'/g, "''")}'::jsonb`;
const arr = (list) => (list && list.length
    ? `array[${list.map((v) => q(v)).join(', ')}]::text[]`
    : `'{}'::text[]`);

const out = [];

out.push(`-- =========================================================================
-- Operix Restaurant System — seed data
-- Generated from data.js by db/generate-seed.mjs — do not edit by hand.
-- Safe to re-run: every insert upserts on its primary key.
-- =========================================================================
`);

/* --- settings ---------------------------------------------------------- */
const r = data.RESTAURANT;
out.push(`insert into public.settings (
    id, name, tagline_ar, tagline_en, address_ar, address_en, phone, wifi,
    currency, hero_url, open_hour, close_hour, service_pct, tables_count
) values (
    1, ${q(r.name)}, ${q(r.tagline.ar)}, ${q(r.tagline.en)},
    ${q(r.address.ar)}, ${q(r.address.en)}, ${q(r.phone)}, ${q(r.wifi)},
    ${q(r.currency)}, ${q('assets/venue.png')},
    ${r.hours.open}, ${r.hours.close}, ${r.servicePct}, ${r.tables}
)
on conflict (id) do update set
    name = excluded.name, tagline_ar = excluded.tagline_ar, tagline_en = excluded.tagline_en,
    address_ar = excluded.address_ar, address_en = excluded.address_en,
    phone = excluded.phone, wifi = excluded.wifi, currency = excluded.currency,
    hero_url = excluded.hero_url, open_hour = excluded.open_hour,
    close_hour = excluded.close_hour, service_pct = excluded.service_pct,
    tables_count = excluded.tables_count;
`);

/* --- tables ------------------------------------------------------------ */
out.push(`-- One row per table on the floor; each keeps its own QR token.
insert into public.tables (id)
select generate_series(1, ${r.tables})
on conflict (id) do nothing;
`);

/* --- categories -------------------------------------------------------- */
// 'all' is a UI tab in the guest app, not a real category.
const cats = data.CATEGORIES.filter((c) => c.id !== 'all');
out.push('-- Categories ------------------------------------------------------------');
cats.forEach((cat, i) => {
    out.push(`insert into public.categories (id, name_ar, name_en, note_ar, note_en, img_url, sort)
values (${q(cat.id)}, ${q(cat.ar)}, ${q(cat.en)}, ${q(cat.note?.ar || '')}, ${q(cat.note?.en || '')}, ${q(cat.img)}, ${i})
on conflict (id) do update set
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    note_ar = excluded.note_ar, note_en = excluded.note_en,
    img_url = excluded.img_url, sort = excluded.sort;`);
});
out.push('');

/* --- items ------------------------------------------------------------- */
out.push('-- Dishes ----------------------------------------------------------------');
data.MENU.forEach((item, i) => {
    out.push(`insert into public.items (
    id, category_id, name_ar, name_en, desc_ar, desc_en, price, img_url,
    tags, kcal, prep_min, serves, rating, options, ingredients, pairings, sort
) values (
    ${q(item.id)}, ${q(item.cat)}, ${q(item.name.ar)}, ${q(item.name.en)},
    ${q(item.desc?.ar || '')}, ${q(item.desc?.en || '')}, ${item.price}, ${q(item.img)},
    ${arr(item.tags)}, ${item.kcal || 0}, ${item.time || 0}, ${item.serves || 1}, ${item.rating || 5},
    ${json(item.options || [])}, ${json(item.ingredients || [])}, ${arr(item.pairings)}, ${i}
)
on conflict (id) do update set
    category_id = excluded.category_id,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    desc_ar = excluded.desc_ar, desc_en = excluded.desc_en,
    price = excluded.price, img_url = excluded.img_url, tags = excluded.tags,
    kcal = excluded.kcal, prep_min = excluded.prep_min, serves = excluded.serves,
    rating = excluded.rating, options = excluded.options,
    ingredients = excluded.ingredients, pairings = excluded.pairings, sort = excluded.sort;`);
});

const target = path.join(here, '02-seed.sql');
fs.writeFileSync(target, out.join('\n') + '\n', 'utf8');

console.log(`02-seed.sql written — ${cats.length} categories, ${data.MENU.length} dishes, ${r.tables} tables.`);
