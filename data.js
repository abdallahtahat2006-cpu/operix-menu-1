/* =========================================================================
   Lumière — Digital Menu
   Content layer. Plain global script (no modules) so the site also runs
   straight from the filesystem via file:// without a dev server.
   ========================================================================= */

const RESTAURANT = {
    name: 'Lumière',
    tagline: {
        en: 'Wood fire · Slow mornings · Late nights',
        ar: 'نار الحطب · صباحات هادئة · سهرات طويلة'
    },
    hours: { open: 8, close: 23 },
    address: { en: '14 Rue Saint-Ange, Old Town', ar: '١٤ شارع سان أنج، البلدة القديمة' },
    phone: '+961 1 234 567',
    wifi: 'lumiere_guest',
    currency: '$',
    tables: 24,            // highest valid table number
    servicePct: 0.10
};

/* Reasons a guest waves a waiter over. `bill` opens the payment step. */
const SERVICE_REASONS = [
    { id: 'question', icon: 'info',    en: 'I have a question',   ar: 'عندي سؤال' },
    { id: 'water',    icon: 'wine',    en: 'Water, please',       ar: 'مي، لو سمحت' },
    { id: 'cutlery',  icon: 'utensils',en: 'Cutlery / napkins',   ar: 'شوك وسكاكين / محارم' },
    { id: 'bill',     icon: 'receipt', en: 'Bring the bill',      ar: 'أحضر الفاتورة', opensBill: true }
];

/* Kitchen ticket lifecycle, in order. */
const ORDER_STATUSES = [
    { id: 'sent',      icon: 'send',     en: 'Sent to kitchen', ar: 'أُرسل للمطبخ',
      subEn: 'Your ticket is in the queue.',        subAr: 'طلبك في الطابور.' },
    { id: 'confirmed', icon: 'check',    en: 'Confirmed',       ar: 'تم التأكيد',
      subEn: 'The kitchen accepted your order.',    subAr: 'المطبخ استلم طلبك.' },
    { id: 'preparing', icon: 'flame',    en: 'Being prepared',  ar: 'قيد التحضير',
      subEn: 'Your food is on the fire.',           subAr: 'أكلك على النار.' },
    { id: 'ready',     icon: 'bell',     en: 'Ready',           ar: 'جاهز',
      subEn: 'Plating up — on its way to you.',     subAr: 'يُجهَّز للتقديم — بطريقه إلك.' },
    { id: 'served',    icon: 'utensils', en: 'Served',          ar: 'تم التقديم',
      subEn: 'Enjoy your meal.',                    subAr: 'صحتين وعافية.' }
];

/* Dietary + highlight badges ------------------------------------------- */
const TAGS = {
    chef:  { icon: 'crown',    en: "Chef's pick", ar: 'اختيار الشيف', hero: true },
    new:   { icon: 'sparkle',  en: 'New',         ar: 'جديد',         hero: true },
    veg:   { icon: 'leaf',     en: 'Vegetarian',  ar: 'نباتي' },
    vegan: { icon: 'seedling', en: 'Vegan',       ar: 'نباتي صرف' },
    gf:    { icon: 'wheat',    en: 'Gluten free', ar: 'خالٍ من الغلوتين' },
    pesc:  { icon: 'fish',     en: 'Pescatarian', ar: 'سمكي' },
    spicy: { icon: 'pepper',   en: 'Spicy',       ar: 'حار' }
};

/* Categories ------------------------------------------------------------ */
const CATEGORIES = [
    { id: 'all',       en: 'Everything', ar: 'الكل',        img: 'assets/main.png',      note: { en: 'The full table', ar: 'الطاولة كاملة' } },
    { id: 'breakfast', en: 'Breakfast',  ar: 'فطور',        img: 'assets/breakfast.png', note: { en: 'Served till 12:30', ar: 'حتى ١٢:٣٠' } },
    { id: 'mains',     en: 'Mains',      ar: 'أطباق رئيسية', img: 'assets/main.png',      note: { en: 'From the wood fire', ar: 'من نار الحطب' } },
    { id: 'drinks',    en: 'Drinks',     ar: 'مشروبات',     img: 'assets/drink.png',     note: { en: 'Coffee & cold pours', ar: 'قهوة ومشروبات باردة' } },
    { id: 'desserts',  en: 'Desserts',   ar: 'حلويات',      img: 'assets/breakfast.png', note: { en: 'Made this morning', ar: 'من صنع اليوم' } }
];

/* Menu ------------------------------------------------------------------ */
const MENU = [
    {
        id: 'avocado-toast', cat: 'breakfast', img: 'assets/breakfast.png', price: 14,
        name: { en: 'Artisan Avocado Toast', ar: 'توست الأفوكادو' },
        desc: {
            en: 'Smashed Hass avocado, poached farm egg, microgreens and chili flakes on stone-baked sourdough.',
            ar: 'أفوكادو هاس مهروس، بيضة مسلوقة، أوراق صغيرة ورقائق الفلفل على خبز العجين المخمر.'
        },
        tags: ['veg', 'chef'], kcal: 430, time: 12, serves: 1, rating: 4.8,
        options: [
            {
                id: 'egg', required: true,
                name: { en: 'The egg', ar: 'البيضة' },
                choices: [
                    { id: 'poached', name: { en: 'Poached',    ar: 'مسلوقة' }, price: 0 },
                    { id: 'fried',   name: { en: 'Fried',      ar: 'مقلية' }, price: 0 },
                    { id: 'noegg',   name: { en: 'Without egg',ar: 'بدون بيضة' }, price: 0 }
                ]
            },
            {
                id: 'extras', multi: true,
                name: { en: 'Add extras', ar: 'إضافات' },
                choices: [
                    { id: 'feta',   name: { en: 'Crumbled feta', ar: 'جبنة فيتا' }, price: 2 },
                    { id: 'salmon', name: { en: 'Smoked salmon', ar: 'سلمون مدخن' }, price: 6 },
                    { id: 'chili',  name: { en: 'Extra chili',   ar: 'فلفل حار إضافي' }, price: 0 }
                ]
            }
        ],
        ingredients: [
            { en: 'Hass avocado', ar: 'أفوكادو هاس' },
            { en: 'Sourdough', ar: 'خبز عجين مخمر', allergen: { en: 'Gluten', ar: 'غلوتين' } },
            { en: 'Farm egg', ar: 'بيض بلدي', allergen: { en: 'Egg', ar: 'بيض' } },
            { en: 'Microgreens', ar: 'أوراق صغيرة' },
            { en: 'Chili flakes', ar: 'رقائق فلفل' }
        ],
        pairings: ['cold-brew', 'saffron-lemonade']
    },
    {
        id: 'ricotta-pancakes', cat: 'breakfast', img: 'assets/breakfast.png', price: 16,
        name: { en: 'Fluffy Ricotta Pancakes', ar: 'بان كيك الريكوتا' },
        desc: {
            en: 'Three airy ricotta pancakes, fresh mixed berries and organic maple syrup.',
            ar: 'ثلاث قطع بان كيك هشة بالريكوتا مع توت طازج وشراب القيقب العضوي.'
        },
        tags: ['veg'], kcal: 620, time: 15, serves: 1, rating: 4.7,
        ingredients: [
            { en: 'Ricotta', ar: 'ريكوتا', allergen: { en: 'Dairy', ar: 'ألبان' } },
            { en: 'Flour', ar: 'طحين', allergen: { en: 'Gluten', ar: 'غلوتين' } },
            { en: 'Mixed berries', ar: 'توت مشكل' },
            { en: 'Maple syrup', ar: 'شراب القيقب' }
        ],
        pairings: ['matcha', 'cold-brew']
    },
    {
        id: 'shakshuka', cat: 'breakfast', img: 'assets/breakfast.png', price: 15,
        name: { en: 'Ember Shakshuka', ar: 'شكشوكة الجمر' },
        desc: {
            en: 'Slow-cooked tomato and roasted pepper stew, two baked eggs, feta and warm flatbread.',
            ar: 'طماطم وفليفلة مشوية على نار هادئة، بيضتان بالفرن، جبنة فيتا وخبز ساخن.'
        },
        tags: ['veg', 'spicy'], kcal: 480, time: 18, serves: 1, rating: 4.9,
        ingredients: [
            { en: 'Vine tomatoes', ar: 'طماطم' },
            { en: 'Roasted peppers', ar: 'فليفلة مشوية' },
            { en: 'Eggs', ar: 'بيض', allergen: { en: 'Egg', ar: 'بيض' } },
            { en: 'Feta', ar: 'جبنة فيتا', allergen: { en: 'Dairy', ar: 'ألبان' } },
            { en: 'Flatbread', ar: 'خبز', allergen: { en: 'Gluten', ar: 'غلوتين' } }
        ],
        pairings: ['saffron-lemonade', 'cold-brew']
    },
    {
        id: 'granola-bowl', cat: 'breakfast', img: 'assets/breakfast.png', price: 11,
        name: { en: 'Honey Granola Bowl', ar: 'بول الجرانولا بالعسل' },
        desc: {
            en: 'House-toasted oat granola, thick yoghurt, wildflower honey and seasonal fruit.',
            ar: 'جرانولا شوفان محمصة في المطبخ، لبن كثيف، عسل بري وفواكه الموسم.'
        },
        tags: ['veg'], kcal: 390, time: 6, serves: 1, rating: 4.5,
        ingredients: [
            { en: 'Oat granola', ar: 'جرانولا شوفان', allergen: { en: 'Nuts', ar: 'مكسرات' } },
            { en: 'Greek yoghurt', ar: 'لبن يوناني', allergen: { en: 'Dairy', ar: 'ألبان' } },
            { en: 'Wildflower honey', ar: 'عسل بري' },
            { en: 'Seasonal fruit', ar: 'فواكه موسمية' }
        ],
        pairings: ['matcha', 'saffron-lemonade']
    },
    {
        id: 'salmon', cat: 'mains', img: 'assets/main.png', price: 28,
        name: { en: 'Wild Caught Salmon', ar: 'سلمون بري' },
        desc: {
            en: 'Pan-seared fillet cooked to medium, roasted asparagus, lemon butter and fresh dill.',
            ar: 'شريحة سلمون مشوية على المقلاة، هليون محمص، زبدة الليمون والشبت الطازج.'
        },
        tags: ['gf', 'pesc', 'chef'], kcal: 520, time: 22, serves: 1, rating: 4.9,
        ingredients: [
            { en: 'Atlantic salmon', ar: 'سلمون أطلسي', allergen: { en: 'Fish', ar: 'سمك' } },
            { en: 'Asparagus', ar: 'هليون' },
            { en: 'Lemon', ar: 'ليمون' },
            { en: 'Butter', ar: 'زبدة', allergen: { en: 'Dairy', ar: 'ألبان' } },
            { en: 'Fresh dill', ar: 'شبت طازج' }
        ],
        pairings: ['matcha', 'panna-cotta']
    },
    {
        id: 'truffle-risotto', cat: 'mains', img: 'assets/main.png', price: 24,
        name: { en: 'Truffle Mushroom Risotto', ar: 'ريزوتو الفطر بالكمأة' },
        desc: {
            en: 'Creamy Arborio rice, wild mushrooms, parmesan crisp and a drizzle of white truffle oil.',
            ar: 'أرز أربوريو كريمي، فطر بري، رقاقة بارميزان ورشة زيت الكمأة البيضاء.'
        },
        tags: ['veg', 'gf'], kcal: 610, time: 25, serves: 1, rating: 4.8,
        ingredients: [
            { en: 'Arborio rice', ar: 'أرز أربوريو' },
            { en: 'Wild mushrooms', ar: 'فطر بري' },
            { en: 'Parmesan', ar: 'بارميزان', allergen: { en: 'Dairy', ar: 'ألبان' } },
            { en: 'White truffle oil', ar: 'زيت الكمأة' }
        ],
        pairings: ['tiramisu', 'cold-brew']
    },
    {
        id: 'ribeye', cat: 'mains', img: 'assets/main.png', price: 45,
        name: { en: 'Prime Ribeye Steak', ar: 'ستيك ريب آي' },
        desc: {
            en: '12oz grass-fed ribeye over the wood fire, garlic herb butter and burnt onion.',
            ar: 'ريب آي ٣٤٠ غرام على نار الحطب، زبدة الثوم والأعشاب وبصل مشوي.'
        },
        tags: ['gf', 'chef'], kcal: 890, time: 28, serves: 1, rating: 5.0,
        options: [
            {
                id: 'doneness', required: true,
                name: { en: 'Cooked to', ar: 'درجة الاستواء' },
                choices: [
                    { id: 'rare',   name: { en: 'Rare',        ar: 'نيء' }, price: 0 },
                    { id: 'mrare',  name: { en: 'Medium rare', ar: 'نصف نيء' }, price: 0 },
                    { id: 'medium', name: { en: 'Medium',      ar: 'وسط' }, price: 0 },
                    { id: 'well',   name: { en: 'Well done',   ar: 'ناضج تماماً' }, price: 0 }
                ]
            },
            {
                id: 'side', required: true,
                name: { en: 'Choose a side', ar: 'اختر طبقاً جانبياً' },
                choices: [
                    { id: 'fries',   name: { en: 'Truffle fries',  ar: 'بطاطا بالكمأة' }, price: 0 },
                    { id: 'mash',    name: { en: 'Whipped potato', ar: 'بطاطا مهروسة' }, price: 0 },
                    { id: 'greens',  name: { en: 'Grilled greens', ar: 'خضار مشوية' }, price: 0 }
                ]
            },
            {
                id: 'extras', multi: true,
                name: { en: 'Add extras', ar: 'إضافات' },
                choices: [
                    { id: 'pepper', name: { en: 'Peppercorn sauce', ar: 'صلصة الفلفل' }, price: 4 },
                    { id: 'egg',    name: { en: 'Fried egg',        ar: 'بيضة مقلية' }, price: 3 },
                    { id: 'butter', name: { en: 'Extra herb butter',ar: 'زبدة أعشاب إضافية' }, price: 2 }
                ]
            }
        ],
        ingredients: [
            { en: 'Grass-fed ribeye', ar: 'لحم ريب آي' },
            { en: 'Garlic herb butter', ar: 'زبدة الثوم والأعشاب', allergen: { en: 'Dairy', ar: 'ألبان' } },
            { en: 'Burnt onion', ar: 'بصل مشوي' },
            { en: 'Sea salt', ar: 'ملح البحر' }
        ],
        pairings: ['truffle-risotto', 'basque-cheesecake']
    },
    {
        id: 'lamb-chops', cat: 'mains', img: 'assets/main.png', price: 38,
        name: { en: 'Herb Crusted Lamb Chops', ar: 'ريش الغنم بالأعشاب' },
        desc: {
            en: 'Three chops in a rosemary and pistachio crust, whipped potato and red wine jus.',
            ar: 'ثلاث قطع ريش بقشرة إكليل الجبل والفستق، بطاطا مهروسة وصلصة النبيذ الأحمر.'
        },
        tags: [], kcal: 760, time: 30, serves: 1, rating: 4.7,
        ingredients: [
            { en: 'Lamb chops', ar: 'ريش غنم' },
            { en: 'Pistachio crust', ar: 'قشرة الفستق', allergen: { en: 'Nuts', ar: 'مكسرات' } },
            { en: 'Whipped potato', ar: 'بطاطا مهروسة', allergen: { en: 'Dairy', ar: 'ألبان' } },
            { en: 'Rosemary', ar: 'إكليل الجبل' }
        ],
        pairings: ['ribeye', 'tiramisu']
    },
    {
        id: 'cacio-pepe', cat: 'mains', img: 'assets/main.png', price: 19,
        name: { en: 'Cacio e Pepe', ar: 'كاتشيو إي بيبي' },
        desc: {
            en: 'Hand-rolled tonnarelli, aged pecorino and cracked black pepper. Three ingredients, no hiding.',
            ar: 'معكرونة توناريلي يدوية، جبنة بيكورينو معتقة وفلفل أسود مجروش. ثلاثة مكونات فقط.'
        },
        tags: ['veg'], kcal: 640, time: 16, serves: 1, rating: 4.6,
        ingredients: [
            { en: 'Tonnarelli pasta', ar: 'معكرونة توناريلي', allergen: { en: 'Gluten', ar: 'غلوتين' } },
            { en: 'Pecorino romano', ar: 'بيكورينو رومانو', allergen: { en: 'Dairy', ar: 'ألبان' } },
            { en: 'Black pepper', ar: 'فلفل أسود' }
        ],
        pairings: ['tiramisu', 'saffron-lemonade']
    },
    {
        id: 'matcha', cat: 'drinks', img: 'assets/drink.png', price: 6,
        name: { en: 'Kyoto Matcha Latte', ar: 'ماتشا لاتيه كيوتو' },
        desc: {
            en: 'Ceremonial grade matcha whisked with oat milk and a touch of agave.',
            ar: 'ماتشا درجة احتفالية مخفوقة مع حليب الشوفان ولمسة من الأغاف.'
        },
        tags: ['vegan'], kcal: 140, time: 5, serves: 1, rating: 4.8,
        options: [
            {
                id: 'temp', required: true,
                name: { en: 'Hot or iced', ar: 'ساخن أو مثلج' },
                choices: [
                    { id: 'hot',  name: { en: 'Hot',  ar: 'ساخن' }, price: 0 },
                    { id: 'iced', name: { en: 'Iced', ar: 'مثلج' }, price: 0 }
                ]
            },
            {
                id: 'milk', required: true,
                name: { en: 'Milk', ar: 'الحليب' },
                choices: [
                    { id: 'oat',   name: { en: 'Oat',    ar: 'شوفان' }, price: 0 },
                    { id: 'almond',name: { en: 'Almond', ar: 'لوز' }, price: 0 },
                    { id: 'whole', name: { en: 'Whole',  ar: 'كامل الدسم' }, price: 0 },
                    { id: 'none',  name: { en: 'No milk',ar: 'بدون حليب' }, price: 0 }
                ]
            },
            {
                id: 'sweet', multi: true,
                name: { en: 'Extras', ar: 'إضافات' },
                choices: [
                    { id: 'shot',  name: { en: 'Extra matcha shot', ar: 'جرعة ماتشا إضافية' }, price: 2 },
                    { id: 'honey', name: { en: 'Honey instead of agave', ar: 'عسل بدل الأغاف' }, price: 0 }
                ]
            }
        ],
        ingredients: [
            { en: 'Ceremonial matcha', ar: 'ماتشا احتفالية' },
            { en: 'Oat milk', ar: 'حليب شوفان' },
            { en: 'Agave syrup', ar: 'شراب الأغاف' }
        ],
        pairings: ['basque-cheesecake', 'granola-bowl']
    },
    {
        id: 'cold-brew', cat: 'drinks', img: 'assets/drink.png', price: 5,
        name: { en: 'Nitro Cold Brew', ar: 'كولد برو نيترو' },
        desc: {
            en: 'Single-origin coffee steeped 18 hours, poured on nitrogen for a cream-thick head.',
            ar: 'قهوة أحادية المصدر منقوعة ١٨ ساعة، تُسكب بالنيتروجين لرغوة كثيفة.'
        },
        tags: ['vegan'], kcal: 15, time: 3, serves: 1, rating: 4.9,
        ingredients: [
            { en: 'Single-origin coffee', ar: 'قهوة أحادية المصدر' },
            { en: 'Filtered water', ar: 'ماء مفلتر' },
            { en: 'Nitrogen', ar: 'نيتروجين' }
        ],
        pairings: ['basque-cheesecake', 'avocado-toast']
    },
    {
        id: 'saffron-lemonade', cat: 'drinks', img: 'assets/drink.png', price: 7,
        name: { en: 'Saffron Rose Lemonade', ar: 'ليموناضة الزعفران والورد' },
        desc: {
            en: 'Cold-pressed lemon, saffron threads and a whisper of rose water over crushed ice.',
            ar: 'ليمون معصور بارد، خيوط الزعفران ولمسة ماء ورد على ثلج مجروش.'
        },
        tags: ['vegan', 'gf', 'new'], kcal: 110, time: 4, serves: 1, rating: 4.7,
        ingredients: [
            { en: 'Lemon', ar: 'ليمون' },
            { en: 'Saffron', ar: 'زعفران' },
            { en: 'Rose water', ar: 'ماء ورد' },
            { en: 'Cane sugar', ar: 'سكر قصب' }
        ],
        pairings: ['shakshuka', 'panna-cotta']
    },
    {
        id: 'tiramisu', cat: 'desserts', img: 'assets/drink.png', price: 12,
        name: { en: 'Classic Tiramisu', ar: 'تيراميسو كلاسيك' },
        desc: {
            en: 'Espresso-soaked ladyfingers layered with mascarpone cream, dusted with cocoa.',
            ar: 'أصابع بسكويت منقوعة بالإسبريسو مع كريمة المسكربوني ورشة كاكاو.'
        },
        tags: ['veg'], kcal: 450, time: 5, serves: 1, rating: 4.9,
        ingredients: [
            { en: 'Ladyfingers', ar: 'أصابع بسكويت', allergen: { en: 'Gluten', ar: 'غلوتين' } },
            { en: 'Mascarpone', ar: 'مسكربوني', allergen: { en: 'Dairy', ar: 'ألبان' } },
            { en: 'Espresso', ar: 'إسبريسو' },
            { en: 'Cocoa', ar: 'كاكاو' }
        ],
        pairings: ['cold-brew', 'matcha']
    },
    {
        id: 'panna-cotta', cat: 'desserts', img: 'assets/drink.png', price: 10,
        name: { en: 'Vanilla Panna Cotta', ar: 'بانا كوتا الفانيلا' },
        desc: {
            en: 'Silky vanilla bean panna cotta with a sharp passionfruit coulis.',
            ar: 'بانا كوتا حريرية بحبوب الفانيلا مع صلصة الباشن فروت الحامضة.'
        },
        tags: ['veg', 'gf'], kcal: 320, time: 5, serves: 1, rating: 4.6,
        ingredients: [
            { en: 'Cream', ar: 'قشطة', allergen: { en: 'Dairy', ar: 'ألبان' } },
            { en: 'Vanilla bean', ar: 'حبوب الفانيلا' },
            { en: 'Passionfruit', ar: 'باشن فروت' }
        ],
        pairings: ['matcha', 'salmon']
    },
    {
        id: 'basque-cheesecake', cat: 'desserts', img: 'assets/breakfast.png', price: 13,
        name: { en: 'Burnt Basque Cheesecake', ar: 'تشيز كيك باسك المحروق' },
        desc: {
            en: 'Deliberately scorched on top, molten in the middle. Served warm with sea salt.',
            ar: 'محروق من الأعلى عمداً، سائل من الداخل. يُقدَّم دافئاً مع ملح البحر.'
        },
        tags: ['veg', 'new'], kcal: 520, time: 8, serves: 1, rating: 4.9,
        ingredients: [
            { en: 'Cream cheese', ar: 'جبنة كريمية', allergen: { en: 'Dairy', ar: 'ألبان' } },
            { en: 'Eggs', ar: 'بيض', allergen: { en: 'Egg', ar: 'بيض' } },
            { en: 'Cane sugar', ar: 'سكر قصب' },
            { en: 'Sea salt', ar: 'ملح البحر' }
        ],
        pairings: ['cold-brew', 'matcha']
    }
];

/* UI strings ------------------------------------------------------------ */
const I18N = {
    en: {
        browse: 'Browse the menu',
        browseSub: 'Fifteen plates, cooked to order',
        search: 'Search dishes, ingredients…',
        searchShort: 'Search',
        picks: "Tonight's picks",
        picksSub: 'What the kitchen is proud of',
        openNow: 'Open now',
        closedNow: 'Closed',
        until: 'until',
        opensAt: 'opens at',
        theMenu: 'The Menu',
        results: 'dishes',
        oneResult: 'dish',
        nothing: 'Nothing on the menu matches that',
        nothingSub: 'Try a different word, or browse everything.',
        clear: 'Clear search',
        viewAll: 'View everything',
        addToOrder: 'Add to order',
        added: 'added to your order',
        removed: 'removed',
        yourOrder: 'Your order',
        emptyCart: 'Your order is empty',
        emptyCartSub: 'Tap any dish to add it here.',
        total: 'Total',
        subtotal: 'Subtotal',
        clearAll: 'Clear all',
        description: 'Description',
        ingredients: 'Ingredients & allergens',
        pairsWith: 'Pairs well with',
        min: 'min',
        kcal: 'kcal',
        serves: 'Serves',
        backToMenu: 'Back to menu',
        notFound: 'Dish not found',
        notFoundSub: 'It may have come off the menu.',
        chatTitle: 'Ask the sommelier',
        chatHello: 'Evening. Tell me what you feel like and I will point you at the right plate.',
        chatPlaceholder: 'Ask about a dish, an allergy, a pairing…',
        chatQ1: "What's good tonight?",
        chatQ2: 'Something vegetarian',
        chatQ3: 'Nut allergy',
        favAdded: 'Saved to favourites',
        favRemoved: 'Removed from favourites',
        hours: 'Hours',
        find: 'Find us',
        wifi: 'Wi-Fi',
        allergyNote: 'Tell your waiter about any allergy. Our kitchen handles nuts, gluten and dairy.',
        toTop: 'Back to top',

        /* Table session */
        welcome: 'Welcome to',
        welcomeSub: 'Order straight from your table. No app, no waiting.',
        whichTable: 'Which table are you at?',
        tableHint: 'The number is on the little card on your table.',
        table: 'Table',
        tableShort: 'T',
        startOrdering: 'Start ordering',
        justBrowsing: 'Just browsing the menu',
        changeTable: 'Change table',
        invalidTable: 'Enter a table between 1 and',
        guests: 'Guests',
        howManyGuests: 'How many of you?',
        sessionTitle: 'Your table',
        seatedSince: 'Seated since',
        endSession: 'End session',
        endSessionConfirm: 'Clear the table and start over?',
        needTable: 'Pick your table first',
        needTableSub: 'We need to know where to bring the food.',

        /* Options + notes */
        chooseOne: 'Choose one',
        chooseAny: 'Optional',
        requiredOpt: 'Required',
        addNote: 'Add a note for the kitchen',
        notePlaceholder: 'No onions, extra crispy, allergy…',
        noteLabel: 'Note',
        selectRequired: 'Choose an option first',

        /* Ordering */
        reviewOrder: 'Review your order',
        sendToKitchen: 'Send to kitchen',
        sending: 'Sending…',
        orderPlaced: 'Order sent',
        orderPlacedSub: 'The kitchen has your ticket.',
        orderNo: 'Order',
        addMoreItems: 'Add more dishes',
        backToMenuShort: 'Menu',
        allergyForOrder: 'Allergy or note for the whole order',
        allergyForOrderPh: 'Anything the kitchen must know…',

        /* Live status */
        orderStatus: 'Order status',
        trackOrder: 'Track order',
        readyIn: 'Ready in about',
        minutesShort: 'min',
        yourTab: 'Your tab',
        tabEmpty: 'Nothing ordered yet',
        tabEmptySub: 'Your sent orders will appear here.',
        runningTotal: 'Running total',
        placedAt: 'Placed at',
        simulated: 'Demo: status advances automatically',

        /* Service calls */
        service: 'Service',
        serviceSub: 'We will come to your table.',
        callWaiter: 'Call the waiter',
        waiterCalled: 'Waiter called',
        waiterComing: 'A waiter is on the way to table',
        callPending: 'Waiter on the way',
        cancelCall: 'Cancel',
        callCancelled: 'Call cancelled',

        /* Bill */
        bill: 'Bill',
        askForBill: 'Ask for the bill',
        howToPay: 'How would you like to pay?',
        payCash: 'Cash',
        payCashSub: 'The waiter brings your change',
        payCard: 'Card',
        payCardSub: 'The waiter brings the card machine',
        paySplit: 'Split the bill',
        paySplitSub: 'We will come and sort it with you',
        billRequested: 'Bill requested',
        billOnWay: 'The waiter is bringing your bill to table',
        nothingToPay: 'Nothing to pay yet',
        nothingToPaySub: 'Send an order first.',
        tip: 'Tip',
        noTip: 'None',
        grandTotal: 'Total to pay',

        /* Live link with the floor console */
        unavailable: 'Out of stock',
        unavailableSub: 'The kitchen has taken this off the menu for now.',
        waiterAck: 'A waiter has taken your call',
        billSettled: 'Payment confirmed — thank you',
        orderEdited: 'The waiter adjusted your order',
        orderRejected: 'The kitchen could not take that order',
        orderRejectedSub: 'A waiter is coming over to sort it out.',

        /* Generic */
        confirm: 'Confirm',
        cancel: 'Cancel',
        close: 'Close',
        done: 'Done',
        edit: 'Edit'
    },
    ar: {
        browse: 'تصفّح القائمة',
        browseSub: 'خمسة عشر طبقاً تُحضَّر عند الطلب',
        search: 'ابحث عن طبق أو مكوّن…',
        searchShort: 'بحث',
        picks: 'اختيارات الليلة',
        picksSub: 'ما يفتخر به المطبخ',
        openNow: 'مفتوح الآن',
        closedNow: 'مغلق',
        until: 'حتى',
        opensAt: 'يفتح',
        theMenu: 'القائمة',
        results: 'طبق',
        oneResult: 'طبق',
        nothing: 'لا يوجد طبق يطابق بحثك',
        nothingSub: 'جرّب كلمة أخرى، أو تصفّح كل شيء.',
        clear: 'مسح البحث',
        viewAll: 'عرض الكل',
        addToOrder: 'أضف للطلب',
        added: 'أُضيف إلى طلبك',
        removed: 'أُزيل',
        yourOrder: 'طلبك',
        emptyCart: 'طلبك فارغ',
        emptyCartSub: 'اضغط أي طبق لإضافته هنا.',
        total: 'الإجمالي',
        subtotal: 'المجموع',
        clearAll: 'مسح الكل',
        description: 'الوصف',
        ingredients: 'المكوّنات ومسبّبات الحساسية',
        pairsWith: 'يُقدَّم مع',
        min: 'دقيقة',
        kcal: 'سعرة',
        serves: 'يكفي',
        backToMenu: 'العودة للقائمة',
        notFound: 'الطبق غير موجود',
        notFoundSub: 'ربما رُفع عن القائمة.',
        chatTitle: 'اسأل الشيف',
        chatHello: 'مساء الخير. قل لي ما تشتهيه وسأدلّك على الطبق المناسب.',
        chatPlaceholder: 'اسأل عن طبق أو حساسية أو تنسيق…',
        chatQ1: 'ما الجيد الليلة؟',
        chatQ2: 'شيء نباتي',
        chatQ3: 'حساسية مكسرات',
        favAdded: 'حُفظ في المفضلة',
        favRemoved: 'أُزيل من المفضلة',
        hours: 'أوقات العمل',
        find: 'موقعنا',
        wifi: 'واي فاي',
        allergyNote: 'أخبر النادل بأي حساسية. مطبخنا يتعامل مع المكسرات والغلوتين والألبان.',
        toTop: 'إلى الأعلى',

        /* جلسة الطاولة */
        welcome: 'أهلاً بك في',
        welcomeSub: 'اطلب مباشرة من طاولتك. بدون تطبيق، وبدون انتظار.',
        whichTable: 'على أي طاولة أنت؟',
        tableHint: 'الرقم موجود على البطاقة الصغيرة على طاولتك.',
        table: 'طاولة',
        tableShort: 'ط',
        startOrdering: 'ابدأ الطلب',
        justBrowsing: 'أتصفّح القائمة فقط',
        changeTable: 'تغيير الطاولة',
        invalidTable: 'أدخل رقم طاولة بين ١ و',
        guests: 'الأشخاص',
        howManyGuests: 'كم شخصاً معك؟',
        sessionTitle: 'طاولتك',
        seatedSince: 'جالس منذ',
        endSession: 'إنهاء الجلسة',
        endSessionConfirm: 'إنهاء الجلسة والبدء من جديد؟',
        needTable: 'اختر طاولتك أولاً',
        needTableSub: 'لازم نعرف وين نوصّل الأكل.',

        /* الخيارات والملاحظات */
        chooseOne: 'اختر واحداً',
        chooseAny: 'اختياري',
        requiredOpt: 'مطلوب',
        addNote: 'أضف ملاحظة للمطبخ',
        notePlaceholder: 'بدون بصل، مقرمش زيادة، حساسية…',
        noteLabel: 'ملاحظة',
        selectRequired: 'اختر أحد الخيارات أولاً',

        /* الطلب */
        reviewOrder: 'راجع طلبك',
        sendToKitchen: 'أرسل للمطبخ',
        sending: 'جارٍ الإرسال…',
        orderPlaced: 'أُرسل الطلب',
        orderPlacedSub: 'المطبخ استلم طلبك.',
        orderNo: 'طلب',
        addMoreItems: 'أضف أطباقاً أخرى',
        backToMenuShort: 'القائمة',
        allergyForOrder: 'حساسية أو ملاحظة على الطلب كامل',
        allergyForOrderPh: 'أي شيء يجب أن يعرفه المطبخ…',

        /* الحالة الحيّة */
        orderStatus: 'حالة الطلب',
        trackOrder: 'تتبّع الطلب',
        readyIn: 'جاهز خلال حوالي',
        minutesShort: 'دقيقة',
        yourTab: 'حسابك',
        tabEmpty: 'لم تطلب شيئاً بعد',
        tabEmptySub: 'ستظهر طلباتك المُرسلة هنا.',
        runningTotal: 'المجموع الجاري',
        placedAt: 'أُرسل الساعة',
        simulated: 'عرض تجريبي: الحالة تتقدّم تلقائياً',

        /* استدعاء الخدمة */
        service: 'الخدمة',
        serviceSub: 'رح نجي على طاولتك.',
        callWaiter: 'نادِ النادل',
        waiterCalled: 'تم استدعاء النادل',
        waiterComing: 'النادل بطريقه إلى طاولة',
        callPending: 'النادل بالطريق',
        cancelCall: 'إلغاء',
        callCancelled: 'أُلغي الاستدعاء',

        /* الفاتورة */
        bill: 'الفاتورة',
        askForBill: 'اطلب الفاتورة',
        howToPay: 'كيف تحب تدفع؟',
        payCash: 'كاش',
        payCashSub: 'النادل يجيب لك الباقي',
        payCard: 'فيزا',
        payCardSub: 'النادل يجيب ماكينة الدفع',
        paySplit: 'تقسيم الفاتورة',
        paySplitSub: 'رح نجي ونرتبها معك',
        billRequested: 'طُلبت الفاتورة',
        billOnWay: 'النادل بيجيب فاتورتك إلى طاولة',
        nothingToPay: 'ما في شي للدفع بعد',
        nothingToPaySub: 'أرسل طلباً أولاً.',
        tip: 'إكرامية',
        noTip: 'بدون',
        grandTotal: 'الإجمالي المطلوب',

        /* الاتصال المباشر مع شاشة الصالة */
        unavailable: 'غير متوفر',
        unavailableSub: 'هذا الصنف مرفوع عن القائمة حالياً.',
        waiterAck: 'استلم النادل استدعاءك',
        billSettled: 'تم تأكيد الدفع — شكراً لك',
        orderEdited: 'عدّل النادل طلبك',
        orderRejected: 'تعذّر قبول الطلب',
        orderRejectedSub: 'النادل جايي عندك ليرتبها معك.',

        /* عام */
        confirm: 'تأكيد',
        cancel: 'إلغاء',
        close: 'إغلاق',
        done: 'تم',
        edit: 'تعديل'
    }
};

/* Canned sommelier replies (demo assistant) ----------------------------- */
const CHAT_REPLIES = [
    {
        match: ['good', 'best', 'recommend', 'tonight', 'جيد', 'أفضل', 'الليلة', 'انصح', 'نصح'],
        en: 'Three plates are singing tonight: the Prime Ribeye off the wood fire, the Wild Caught Salmon, and the Ember Shakshuka if you like heat.',
        ar: 'ثلاثة أطباق ممتازة الليلة: ستيك الريب آي على نار الحطب، السلمون البري، والشكشوكة إن كنت تحب الحار.',
        items: ['ribeye', 'salmon', 'shakshuka']
    },
    {
        match: ['vegetarian', 'vegan', 'veg', 'meat', 'نباتي', 'بدون لحم', 'خضار'],
        en: 'Plenty. The Truffle Mushroom Risotto is the one to beat, and the Cacio e Pepe is three ingredients done properly.',
        ar: 'خيارات كثيرة. ريزوتو الكمأة هو الأفضل، والكاتشيو إي بيبي ثلاثة مكونات مُتقنة.',
        items: ['truffle-risotto', 'cacio-pepe', 'granola-bowl']
    },
    {
        match: ['nut', 'allergy', 'allergen', 'gluten', 'dairy', 'حساسية', 'مكسرات', 'غلوتين', 'ألبان', 'حليب'],
        en: 'Tell your waiter and we will flag the ticket. Nuts appear in the granola and the lamb crust; everything else can be checked per dish on its page.',
        ar: 'أخبر النادل وسنؤشّر على الطلب. المكسرات موجودة في الجرانولا وقشرة ريش الغنم؛ وبقية الأطباق مفصّلة في صفحاتها.',
        items: ['salmon', 'panna-cotta']
    },
    {
        match: ['coffee', 'drink', 'thirsty', 'قهوة', 'مشروب', 'عطشان'],
        en: 'The Nitro Cold Brew is the house pour. If you want something without caffeine, the Saffron Rose Lemonade is new and worth it.',
        ar: 'الكولد برو نيترو هو مشروب البيت. وإن أردت بلا كافيين، ليموناضة الزعفران جديدة وتستحق.',
        items: ['cold-brew', 'saffron-lemonade', 'matcha']
    },
    {
        match: ['dessert', 'sweet', 'cake', 'حلو', 'حلويات', 'كيك'],
        en: 'The Burnt Basque Cheesecake goes out warm and molten in the middle. The Tiramisu is the classic if you want no surprises.',
        ar: 'تشيز كيك الباسك يخرج دافئاً وسائلاً من الوسط. والتيراميسو هو الكلاسيك بلا مفاجآت.',
        items: ['basque-cheesecake', 'tiramisu', 'panna-cotta']
    },
    {
        match: ['cheap', 'budget', 'price', 'رخيص', 'سعر', 'ارخص'],
        en: 'Under $12: the Nitro Cold Brew, the Matcha Latte, the Honey Granola Bowl and the Vanilla Panna Cotta.',
        ar: 'أقل من ١٢ دولاراً: الكولد برو، الماتشا لاتيه، بول الجرانولا وبانا كوتا الفانيلا.',
        items: ['cold-brew', 'matcha', 'granola-bowl', 'panna-cotta']
    },
    {
        match: ['fast', 'quick', 'hurry', 'سريع', 'مستعجل', 'بسرعة'],
        en: 'Out of the kitchen in under ten minutes: the Granola Bowl, the Cold Brew and both desserts.',
        ar: 'جاهز في أقل من عشر دقائق: بول الجرانولا، الكولد برو وكل الحلويات.',
        items: ['granola-bowl', 'cold-brew', 'tiramisu']
    }
];

const CHAT_FALLBACK = {
    en: 'I only know this menu, but I know it well. Ask me about a dish, an allergy, a budget or how long something takes.',
    ar: 'أعرف هذه القائمة فقط، لكنني أعرفها جيداً. اسألني عن طبق أو حساسية أو ميزانية أو مدة التحضير.'
};
