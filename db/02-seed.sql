-- =========================================================================
-- Operix Restaurant System — seed data
-- Generated from data.js by db/generate-seed.mjs — do not edit by hand.
-- Safe to re-run: every insert upserts on its primary key.
-- =========================================================================

insert into public.settings (
    id, name, tagline_ar, tagline_en, address_ar, address_en, phone, wifi,
    currency, hero_url, open_hour, close_hour, service_pct, tables_count
) values (
    1, 'Lumière', 'نار الحطب · صباحات هادئة · سهرات طويلة', 'Wood fire · Slow mornings · Late nights',
    '١٤ شارع سان أنج، البلدة القديمة', '14 Rue Saint-Ange, Old Town', '+961 1 234 567', 'lumiere_guest',
    '$', 'assets/venue.png',
    8, 23, 0.1, 24
)
on conflict (id) do update set
    name = excluded.name, tagline_ar = excluded.tagline_ar, tagline_en = excluded.tagline_en,
    address_ar = excluded.address_ar, address_en = excluded.address_en,
    phone = excluded.phone, wifi = excluded.wifi, currency = excluded.currency,
    hero_url = excluded.hero_url, open_hour = excluded.open_hour,
    close_hour = excluded.close_hour, service_pct = excluded.service_pct,
    tables_count = excluded.tables_count;

-- One row per table on the floor; each keeps its own QR token.
insert into public.tables (id)
select generate_series(1, 24)
on conflict (id) do nothing;

-- Categories ------------------------------------------------------------
insert into public.categories (id, name_ar, name_en, note_ar, note_en, img_url, sort)
values ('breakfast', 'فطور', 'Breakfast', 'حتى ١٢:٣٠', 'Served till 12:30', 'assets/breakfast.png', 0)
on conflict (id) do update set
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    note_ar = excluded.note_ar, note_en = excluded.note_en,
    img_url = excluded.img_url, sort = excluded.sort;
insert into public.categories (id, name_ar, name_en, note_ar, note_en, img_url, sort)
values ('mains', 'أطباق رئيسية', 'Mains', 'من نار الحطب', 'From the wood fire', 'assets/main.png', 1)
on conflict (id) do update set
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    note_ar = excluded.note_ar, note_en = excluded.note_en,
    img_url = excluded.img_url, sort = excluded.sort;
insert into public.categories (id, name_ar, name_en, note_ar, note_en, img_url, sort)
values ('drinks', 'مشروبات', 'Drinks', 'قهوة ومشروبات باردة', 'Coffee & cold pours', 'assets/drink.png', 2)
on conflict (id) do update set
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    note_ar = excluded.note_ar, note_en = excluded.note_en,
    img_url = excluded.img_url, sort = excluded.sort;
insert into public.categories (id, name_ar, name_en, note_ar, note_en, img_url, sort)
values ('desserts', 'حلويات', 'Desserts', 'من صنع اليوم', 'Made this morning', 'assets/breakfast.png', 3)
on conflict (id) do update set
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    note_ar = excluded.note_ar, note_en = excluded.note_en,
    img_url = excluded.img_url, sort = excluded.sort;

-- Dishes ----------------------------------------------------------------
insert into public.items (
    id, category_id, name_ar, name_en, desc_ar, desc_en, price, img_url,
    tags, kcal, prep_min, serves, rating, options, ingredients, pairings, sort
) values (
    'avocado-toast', 'breakfast', 'توست الأفوكادو', 'Artisan Avocado Toast',
    'أفوكادو هاس مهروس، بيضة مسلوقة، أوراق صغيرة ورقائق الفلفل على خبز العجين المخمر.', 'Smashed Hass avocado, poached farm egg, microgreens and chili flakes on stone-baked sourdough.', 14, 'assets/breakfast.png',
    array['veg', 'chef']::text[], 430, 12, 1, 4.8,
    '[{"id":"egg","required":true,"name":{"en":"The egg","ar":"البيضة"},"choices":[{"id":"poached","name":{"en":"Poached","ar":"مسلوقة"},"price":0},{"id":"fried","name":{"en":"Fried","ar":"مقلية"},"price":0},{"id":"noegg","name":{"en":"Without egg","ar":"بدون بيضة"},"price":0}]},{"id":"extras","multi":true,"name":{"en":"Add extras","ar":"إضافات"},"choices":[{"id":"feta","name":{"en":"Crumbled feta","ar":"جبنة فيتا"},"price":2},{"id":"salmon","name":{"en":"Smoked salmon","ar":"سلمون مدخن"},"price":6},{"id":"chili","name":{"en":"Extra chili","ar":"فلفل حار إضافي"},"price":0}]}]'::jsonb, '[{"en":"Hass avocado","ar":"أفوكادو هاس"},{"en":"Sourdough","ar":"خبز عجين مخمر","allergen":{"en":"Gluten","ar":"غلوتين"}},{"en":"Farm egg","ar":"بيض بلدي","allergen":{"en":"Egg","ar":"بيض"}},{"en":"Microgreens","ar":"أوراق صغيرة"},{"en":"Chili flakes","ar":"رقائق فلفل"}]'::jsonb, array['cold-brew', 'saffron-lemonade']::text[], 0
)
on conflict (id) do update set
    category_id = excluded.category_id,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    desc_ar = excluded.desc_ar, desc_en = excluded.desc_en,
    price = excluded.price, img_url = excluded.img_url, tags = excluded.tags,
    kcal = excluded.kcal, prep_min = excluded.prep_min, serves = excluded.serves,
    rating = excluded.rating, options = excluded.options,
    ingredients = excluded.ingredients, pairings = excluded.pairings, sort = excluded.sort;
insert into public.items (
    id, category_id, name_ar, name_en, desc_ar, desc_en, price, img_url,
    tags, kcal, prep_min, serves, rating, options, ingredients, pairings, sort
) values (
    'ricotta-pancakes', 'breakfast', 'بان كيك الريكوتا', 'Fluffy Ricotta Pancakes',
    'ثلاث قطع بان كيك هشة بالريكوتا مع توت طازج وشراب القيقب العضوي.', 'Three airy ricotta pancakes, fresh mixed berries and organic maple syrup.', 16, 'assets/breakfast.png',
    array['veg']::text[], 620, 15, 1, 4.7,
    '[]'::jsonb, '[{"en":"Ricotta","ar":"ريكوتا","allergen":{"en":"Dairy","ar":"ألبان"}},{"en":"Flour","ar":"طحين","allergen":{"en":"Gluten","ar":"غلوتين"}},{"en":"Mixed berries","ar":"توت مشكل"},{"en":"Maple syrup","ar":"شراب القيقب"}]'::jsonb, array['matcha', 'cold-brew']::text[], 1
)
on conflict (id) do update set
    category_id = excluded.category_id,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    desc_ar = excluded.desc_ar, desc_en = excluded.desc_en,
    price = excluded.price, img_url = excluded.img_url, tags = excluded.tags,
    kcal = excluded.kcal, prep_min = excluded.prep_min, serves = excluded.serves,
    rating = excluded.rating, options = excluded.options,
    ingredients = excluded.ingredients, pairings = excluded.pairings, sort = excluded.sort;
insert into public.items (
    id, category_id, name_ar, name_en, desc_ar, desc_en, price, img_url,
    tags, kcal, prep_min, serves, rating, options, ingredients, pairings, sort
) values (
    'shakshuka', 'breakfast', 'شكشوكة الجمر', 'Ember Shakshuka',
    'طماطم وفليفلة مشوية على نار هادئة، بيضتان بالفرن، جبنة فيتا وخبز ساخن.', 'Slow-cooked tomato and roasted pepper stew, two baked eggs, feta and warm flatbread.', 15, 'assets/breakfast.png',
    array['veg', 'spicy']::text[], 480, 18, 1, 4.9,
    '[]'::jsonb, '[{"en":"Vine tomatoes","ar":"طماطم"},{"en":"Roasted peppers","ar":"فليفلة مشوية"},{"en":"Eggs","ar":"بيض","allergen":{"en":"Egg","ar":"بيض"}},{"en":"Feta","ar":"جبنة فيتا","allergen":{"en":"Dairy","ar":"ألبان"}},{"en":"Flatbread","ar":"خبز","allergen":{"en":"Gluten","ar":"غلوتين"}}]'::jsonb, array['saffron-lemonade', 'cold-brew']::text[], 2
)
on conflict (id) do update set
    category_id = excluded.category_id,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    desc_ar = excluded.desc_ar, desc_en = excluded.desc_en,
    price = excluded.price, img_url = excluded.img_url, tags = excluded.tags,
    kcal = excluded.kcal, prep_min = excluded.prep_min, serves = excluded.serves,
    rating = excluded.rating, options = excluded.options,
    ingredients = excluded.ingredients, pairings = excluded.pairings, sort = excluded.sort;
insert into public.items (
    id, category_id, name_ar, name_en, desc_ar, desc_en, price, img_url,
    tags, kcal, prep_min, serves, rating, options, ingredients, pairings, sort
) values (
    'granola-bowl', 'breakfast', 'بول الجرانولا بالعسل', 'Honey Granola Bowl',
    'جرانولا شوفان محمصة في المطبخ، لبن كثيف، عسل بري وفواكه الموسم.', 'House-toasted oat granola, thick yoghurt, wildflower honey and seasonal fruit.', 11, 'assets/breakfast.png',
    array['veg']::text[], 390, 6, 1, 4.5,
    '[]'::jsonb, '[{"en":"Oat granola","ar":"جرانولا شوفان","allergen":{"en":"Nuts","ar":"مكسرات"}},{"en":"Greek yoghurt","ar":"لبن يوناني","allergen":{"en":"Dairy","ar":"ألبان"}},{"en":"Wildflower honey","ar":"عسل بري"},{"en":"Seasonal fruit","ar":"فواكه موسمية"}]'::jsonb, array['matcha', 'saffron-lemonade']::text[], 3
)
on conflict (id) do update set
    category_id = excluded.category_id,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    desc_ar = excluded.desc_ar, desc_en = excluded.desc_en,
    price = excluded.price, img_url = excluded.img_url, tags = excluded.tags,
    kcal = excluded.kcal, prep_min = excluded.prep_min, serves = excluded.serves,
    rating = excluded.rating, options = excluded.options,
    ingredients = excluded.ingredients, pairings = excluded.pairings, sort = excluded.sort;
insert into public.items (
    id, category_id, name_ar, name_en, desc_ar, desc_en, price, img_url,
    tags, kcal, prep_min, serves, rating, options, ingredients, pairings, sort
) values (
    'salmon', 'mains', 'سلمون بري', 'Wild Caught Salmon',
    'شريحة سلمون مشوية على المقلاة، هليون محمص، زبدة الليمون والشبت الطازج.', 'Pan-seared fillet cooked to medium, roasted asparagus, lemon butter and fresh dill.', 28, 'assets/main.png',
    array['gf', 'pesc', 'chef']::text[], 520, 22, 1, 4.9,
    '[]'::jsonb, '[{"en":"Atlantic salmon","ar":"سلمون أطلسي","allergen":{"en":"Fish","ar":"سمك"}},{"en":"Asparagus","ar":"هليون"},{"en":"Lemon","ar":"ليمون"},{"en":"Butter","ar":"زبدة","allergen":{"en":"Dairy","ar":"ألبان"}},{"en":"Fresh dill","ar":"شبت طازج"}]'::jsonb, array['matcha', 'panna-cotta']::text[], 4
)
on conflict (id) do update set
    category_id = excluded.category_id,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    desc_ar = excluded.desc_ar, desc_en = excluded.desc_en,
    price = excluded.price, img_url = excluded.img_url, tags = excluded.tags,
    kcal = excluded.kcal, prep_min = excluded.prep_min, serves = excluded.serves,
    rating = excluded.rating, options = excluded.options,
    ingredients = excluded.ingredients, pairings = excluded.pairings, sort = excluded.sort;
insert into public.items (
    id, category_id, name_ar, name_en, desc_ar, desc_en, price, img_url,
    tags, kcal, prep_min, serves, rating, options, ingredients, pairings, sort
) values (
    'truffle-risotto', 'mains', 'ريزوتو الفطر بالكمأة', 'Truffle Mushroom Risotto',
    'أرز أربوريو كريمي، فطر بري، رقاقة بارميزان ورشة زيت الكمأة البيضاء.', 'Creamy Arborio rice, wild mushrooms, parmesan crisp and a drizzle of white truffle oil.', 24, 'assets/main.png',
    array['veg', 'gf']::text[], 610, 25, 1, 4.8,
    '[]'::jsonb, '[{"en":"Arborio rice","ar":"أرز أربوريو"},{"en":"Wild mushrooms","ar":"فطر بري"},{"en":"Parmesan","ar":"بارميزان","allergen":{"en":"Dairy","ar":"ألبان"}},{"en":"White truffle oil","ar":"زيت الكمأة"}]'::jsonb, array['tiramisu', 'cold-brew']::text[], 5
)
on conflict (id) do update set
    category_id = excluded.category_id,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    desc_ar = excluded.desc_ar, desc_en = excluded.desc_en,
    price = excluded.price, img_url = excluded.img_url, tags = excluded.tags,
    kcal = excluded.kcal, prep_min = excluded.prep_min, serves = excluded.serves,
    rating = excluded.rating, options = excluded.options,
    ingredients = excluded.ingredients, pairings = excluded.pairings, sort = excluded.sort;
insert into public.items (
    id, category_id, name_ar, name_en, desc_ar, desc_en, price, img_url,
    tags, kcal, prep_min, serves, rating, options, ingredients, pairings, sort
) values (
    'ribeye', 'mains', 'ستيك ريب آي', 'Prime Ribeye Steak',
    'ريب آي ٣٤٠ غرام على نار الحطب، زبدة الثوم والأعشاب وبصل مشوي.', '12oz grass-fed ribeye over the wood fire, garlic herb butter and burnt onion.', 45, 'assets/main.png',
    array['gf', 'chef']::text[], 890, 28, 1, 5,
    '[{"id":"doneness","required":true,"name":{"en":"Cooked to","ar":"درجة الاستواء"},"choices":[{"id":"rare","name":{"en":"Rare","ar":"نيء"},"price":0},{"id":"mrare","name":{"en":"Medium rare","ar":"نصف نيء"},"price":0},{"id":"medium","name":{"en":"Medium","ar":"وسط"},"price":0},{"id":"well","name":{"en":"Well done","ar":"ناضج تماماً"},"price":0}]},{"id":"side","required":true,"name":{"en":"Choose a side","ar":"اختر طبقاً جانبياً"},"choices":[{"id":"fries","name":{"en":"Truffle fries","ar":"بطاطا بالكمأة"},"price":0},{"id":"mash","name":{"en":"Whipped potato","ar":"بطاطا مهروسة"},"price":0},{"id":"greens","name":{"en":"Grilled greens","ar":"خضار مشوية"},"price":0}]},{"id":"extras","multi":true,"name":{"en":"Add extras","ar":"إضافات"},"choices":[{"id":"pepper","name":{"en":"Peppercorn sauce","ar":"صلصة الفلفل"},"price":4},{"id":"egg","name":{"en":"Fried egg","ar":"بيضة مقلية"},"price":3},{"id":"butter","name":{"en":"Extra herb butter","ar":"زبدة أعشاب إضافية"},"price":2}]}]'::jsonb, '[{"en":"Grass-fed ribeye","ar":"لحم ريب آي"},{"en":"Garlic herb butter","ar":"زبدة الثوم والأعشاب","allergen":{"en":"Dairy","ar":"ألبان"}},{"en":"Burnt onion","ar":"بصل مشوي"},{"en":"Sea salt","ar":"ملح البحر"}]'::jsonb, array['truffle-risotto', 'basque-cheesecake']::text[], 6
)
on conflict (id) do update set
    category_id = excluded.category_id,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    desc_ar = excluded.desc_ar, desc_en = excluded.desc_en,
    price = excluded.price, img_url = excluded.img_url, tags = excluded.tags,
    kcal = excluded.kcal, prep_min = excluded.prep_min, serves = excluded.serves,
    rating = excluded.rating, options = excluded.options,
    ingredients = excluded.ingredients, pairings = excluded.pairings, sort = excluded.sort;
insert into public.items (
    id, category_id, name_ar, name_en, desc_ar, desc_en, price, img_url,
    tags, kcal, prep_min, serves, rating, options, ingredients, pairings, sort
) values (
    'lamb-chops', 'mains', 'ريش الغنم بالأعشاب', 'Herb Crusted Lamb Chops',
    'ثلاث قطع ريش بقشرة إكليل الجبل والفستق، بطاطا مهروسة وصلصة النبيذ الأحمر.', 'Three chops in a rosemary and pistachio crust, whipped potato and red wine jus.', 38, 'assets/main.png',
    '{}'::text[], 760, 30, 1, 4.7,
    '[]'::jsonb, '[{"en":"Lamb chops","ar":"ريش غنم"},{"en":"Pistachio crust","ar":"قشرة الفستق","allergen":{"en":"Nuts","ar":"مكسرات"}},{"en":"Whipped potato","ar":"بطاطا مهروسة","allergen":{"en":"Dairy","ar":"ألبان"}},{"en":"Rosemary","ar":"إكليل الجبل"}]'::jsonb, array['ribeye', 'tiramisu']::text[], 7
)
on conflict (id) do update set
    category_id = excluded.category_id,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    desc_ar = excluded.desc_ar, desc_en = excluded.desc_en,
    price = excluded.price, img_url = excluded.img_url, tags = excluded.tags,
    kcal = excluded.kcal, prep_min = excluded.prep_min, serves = excluded.serves,
    rating = excluded.rating, options = excluded.options,
    ingredients = excluded.ingredients, pairings = excluded.pairings, sort = excluded.sort;
insert into public.items (
    id, category_id, name_ar, name_en, desc_ar, desc_en, price, img_url,
    tags, kcal, prep_min, serves, rating, options, ingredients, pairings, sort
) values (
    'cacio-pepe', 'mains', 'كاتشيو إي بيبي', 'Cacio e Pepe',
    'معكرونة توناريلي يدوية، جبنة بيكورينو معتقة وفلفل أسود مجروش. ثلاثة مكونات فقط.', 'Hand-rolled tonnarelli, aged pecorino and cracked black pepper. Three ingredients, no hiding.', 19, 'assets/main.png',
    array['veg']::text[], 640, 16, 1, 4.6,
    '[]'::jsonb, '[{"en":"Tonnarelli pasta","ar":"معكرونة توناريلي","allergen":{"en":"Gluten","ar":"غلوتين"}},{"en":"Pecorino romano","ar":"بيكورينو رومانو","allergen":{"en":"Dairy","ar":"ألبان"}},{"en":"Black pepper","ar":"فلفل أسود"}]'::jsonb, array['tiramisu', 'saffron-lemonade']::text[], 8
)
on conflict (id) do update set
    category_id = excluded.category_id,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    desc_ar = excluded.desc_ar, desc_en = excluded.desc_en,
    price = excluded.price, img_url = excluded.img_url, tags = excluded.tags,
    kcal = excluded.kcal, prep_min = excluded.prep_min, serves = excluded.serves,
    rating = excluded.rating, options = excluded.options,
    ingredients = excluded.ingredients, pairings = excluded.pairings, sort = excluded.sort;
insert into public.items (
    id, category_id, name_ar, name_en, desc_ar, desc_en, price, img_url,
    tags, kcal, prep_min, serves, rating, options, ingredients, pairings, sort
) values (
    'matcha', 'drinks', 'ماتشا لاتيه كيوتو', 'Kyoto Matcha Latte',
    'ماتشا درجة احتفالية مخفوقة مع حليب الشوفان ولمسة من الأغاف.', 'Ceremonial grade matcha whisked with oat milk and a touch of agave.', 6, 'assets/drink.png',
    array['vegan']::text[], 140, 5, 1, 4.8,
    '[{"id":"temp","required":true,"name":{"en":"Hot or iced","ar":"ساخن أو مثلج"},"choices":[{"id":"hot","name":{"en":"Hot","ar":"ساخن"},"price":0},{"id":"iced","name":{"en":"Iced","ar":"مثلج"},"price":0}]},{"id":"milk","required":true,"name":{"en":"Milk","ar":"الحليب"},"choices":[{"id":"oat","name":{"en":"Oat","ar":"شوفان"},"price":0},{"id":"almond","name":{"en":"Almond","ar":"لوز"},"price":0},{"id":"whole","name":{"en":"Whole","ar":"كامل الدسم"},"price":0},{"id":"none","name":{"en":"No milk","ar":"بدون حليب"},"price":0}]},{"id":"sweet","multi":true,"name":{"en":"Extras","ar":"إضافات"},"choices":[{"id":"shot","name":{"en":"Extra matcha shot","ar":"جرعة ماتشا إضافية"},"price":2},{"id":"honey","name":{"en":"Honey instead of agave","ar":"عسل بدل الأغاف"},"price":0}]}]'::jsonb, '[{"en":"Ceremonial matcha","ar":"ماتشا احتفالية"},{"en":"Oat milk","ar":"حليب شوفان"},{"en":"Agave syrup","ar":"شراب الأغاف"}]'::jsonb, array['basque-cheesecake', 'granola-bowl']::text[], 9
)
on conflict (id) do update set
    category_id = excluded.category_id,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    desc_ar = excluded.desc_ar, desc_en = excluded.desc_en,
    price = excluded.price, img_url = excluded.img_url, tags = excluded.tags,
    kcal = excluded.kcal, prep_min = excluded.prep_min, serves = excluded.serves,
    rating = excluded.rating, options = excluded.options,
    ingredients = excluded.ingredients, pairings = excluded.pairings, sort = excluded.sort;
insert into public.items (
    id, category_id, name_ar, name_en, desc_ar, desc_en, price, img_url,
    tags, kcal, prep_min, serves, rating, options, ingredients, pairings, sort
) values (
    'cold-brew', 'drinks', 'كولد برو نيترو', 'Nitro Cold Brew',
    'قهوة أحادية المصدر منقوعة ١٨ ساعة، تُسكب بالنيتروجين لرغوة كثيفة.', 'Single-origin coffee steeped 18 hours, poured on nitrogen for a cream-thick head.', 5, 'assets/drink.png',
    array['vegan']::text[], 15, 3, 1, 4.9,
    '[]'::jsonb, '[{"en":"Single-origin coffee","ar":"قهوة أحادية المصدر"},{"en":"Filtered water","ar":"ماء مفلتر"},{"en":"Nitrogen","ar":"نيتروجين"}]'::jsonb, array['basque-cheesecake', 'avocado-toast']::text[], 10
)
on conflict (id) do update set
    category_id = excluded.category_id,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    desc_ar = excluded.desc_ar, desc_en = excluded.desc_en,
    price = excluded.price, img_url = excluded.img_url, tags = excluded.tags,
    kcal = excluded.kcal, prep_min = excluded.prep_min, serves = excluded.serves,
    rating = excluded.rating, options = excluded.options,
    ingredients = excluded.ingredients, pairings = excluded.pairings, sort = excluded.sort;
insert into public.items (
    id, category_id, name_ar, name_en, desc_ar, desc_en, price, img_url,
    tags, kcal, prep_min, serves, rating, options, ingredients, pairings, sort
) values (
    'saffron-lemonade', 'drinks', 'ليموناضة الزعفران والورد', 'Saffron Rose Lemonade',
    'ليمون معصور بارد، خيوط الزعفران ولمسة ماء ورد على ثلج مجروش.', 'Cold-pressed lemon, saffron threads and a whisper of rose water over crushed ice.', 7, 'assets/drink.png',
    array['vegan', 'gf', 'new']::text[], 110, 4, 1, 4.7,
    '[]'::jsonb, '[{"en":"Lemon","ar":"ليمون"},{"en":"Saffron","ar":"زعفران"},{"en":"Rose water","ar":"ماء ورد"},{"en":"Cane sugar","ar":"سكر قصب"}]'::jsonb, array['shakshuka', 'panna-cotta']::text[], 11
)
on conflict (id) do update set
    category_id = excluded.category_id,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    desc_ar = excluded.desc_ar, desc_en = excluded.desc_en,
    price = excluded.price, img_url = excluded.img_url, tags = excluded.tags,
    kcal = excluded.kcal, prep_min = excluded.prep_min, serves = excluded.serves,
    rating = excluded.rating, options = excluded.options,
    ingredients = excluded.ingredients, pairings = excluded.pairings, sort = excluded.sort;
insert into public.items (
    id, category_id, name_ar, name_en, desc_ar, desc_en, price, img_url,
    tags, kcal, prep_min, serves, rating, options, ingredients, pairings, sort
) values (
    'tiramisu', 'desserts', 'تيراميسو كلاسيك', 'Classic Tiramisu',
    'أصابع بسكويت منقوعة بالإسبريسو مع كريمة المسكربوني ورشة كاكاو.', 'Espresso-soaked ladyfingers layered with mascarpone cream, dusted with cocoa.', 12, 'assets/drink.png',
    array['veg']::text[], 450, 5, 1, 4.9,
    '[]'::jsonb, '[{"en":"Ladyfingers","ar":"أصابع بسكويت","allergen":{"en":"Gluten","ar":"غلوتين"}},{"en":"Mascarpone","ar":"مسكربوني","allergen":{"en":"Dairy","ar":"ألبان"}},{"en":"Espresso","ar":"إسبريسو"},{"en":"Cocoa","ar":"كاكاو"}]'::jsonb, array['cold-brew', 'matcha']::text[], 12
)
on conflict (id) do update set
    category_id = excluded.category_id,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    desc_ar = excluded.desc_ar, desc_en = excluded.desc_en,
    price = excluded.price, img_url = excluded.img_url, tags = excluded.tags,
    kcal = excluded.kcal, prep_min = excluded.prep_min, serves = excluded.serves,
    rating = excluded.rating, options = excluded.options,
    ingredients = excluded.ingredients, pairings = excluded.pairings, sort = excluded.sort;
insert into public.items (
    id, category_id, name_ar, name_en, desc_ar, desc_en, price, img_url,
    tags, kcal, prep_min, serves, rating, options, ingredients, pairings, sort
) values (
    'panna-cotta', 'desserts', 'بانا كوتا الفانيلا', 'Vanilla Panna Cotta',
    'بانا كوتا حريرية بحبوب الفانيلا مع صلصة الباشن فروت الحامضة.', 'Silky vanilla bean panna cotta with a sharp passionfruit coulis.', 10, 'assets/drink.png',
    array['veg', 'gf']::text[], 320, 5, 1, 4.6,
    '[]'::jsonb, '[{"en":"Cream","ar":"قشطة","allergen":{"en":"Dairy","ar":"ألبان"}},{"en":"Vanilla bean","ar":"حبوب الفانيلا"},{"en":"Passionfruit","ar":"باشن فروت"}]'::jsonb, array['matcha', 'salmon']::text[], 13
)
on conflict (id) do update set
    category_id = excluded.category_id,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    desc_ar = excluded.desc_ar, desc_en = excluded.desc_en,
    price = excluded.price, img_url = excluded.img_url, tags = excluded.tags,
    kcal = excluded.kcal, prep_min = excluded.prep_min, serves = excluded.serves,
    rating = excluded.rating, options = excluded.options,
    ingredients = excluded.ingredients, pairings = excluded.pairings, sort = excluded.sort;
insert into public.items (
    id, category_id, name_ar, name_en, desc_ar, desc_en, price, img_url,
    tags, kcal, prep_min, serves, rating, options, ingredients, pairings, sort
) values (
    'basque-cheesecake', 'desserts', 'تشيز كيك باسك المحروق', 'Burnt Basque Cheesecake',
    'محروق من الأعلى عمداً، سائل من الداخل. يُقدَّم دافئاً مع ملح البحر.', 'Deliberately scorched on top, molten in the middle. Served warm with sea salt.', 13, 'assets/breakfast.png',
    array['veg', 'new']::text[], 520, 8, 1, 4.9,
    '[]'::jsonb, '[{"en":"Cream cheese","ar":"جبنة كريمية","allergen":{"en":"Dairy","ar":"ألبان"}},{"en":"Eggs","ar":"بيض","allergen":{"en":"Egg","ar":"بيض"}},{"en":"Cane sugar","ar":"سكر قصب"},{"en":"Sea salt","ar":"ملح البحر"}]'::jsonb, array['cold-brew', 'matcha']::text[], 14
)
on conflict (id) do update set
    category_id = excluded.category_id,
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    desc_ar = excluded.desc_ar, desc_en = excluded.desc_en,
    price = excluded.price, img_url = excluded.img_url, tags = excluded.tags,
    kcal = excluded.kcal, prep_min = excluded.prep_min, serves = excluded.serves,
    rating = excluded.rating, options = excluded.options,
    ingredients = excluded.ingredients, pairings = excluded.pairings, sort = excluded.sort;
