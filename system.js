/* =========================================================================
   Operix Restaurant System — the shared spine
   -------------------------------------------------------------------------
   Three interfaces sit on top of this file:

        index / menu / item-detail   → the guest, arriving from a table QR
        staff.html                   → the waiter + cashier floor console
        admin.html                   → the owner's dashboard

   In production these would all talk to one backend. Here the "backend" is
   a single JSON blob in localStorage plus a change bus, so the whole system
   runs from file:// with no server and still behaves like one product:
   a guest sends an order in one tab and it lands on the floor console in
   another, live. Everything a real API would own — orders, service calls,
   bills, table state, menu edits, settings — lives in OPS.

   Loaded after data.js and before the page script on every page.
   ========================================================================= */
(function (global) {
    'use strict';

    const KEY = 'operix.system';
    const CHANNEL = 'operix-system';
    const SCHEMA = 1;

    /* Staff console heartbeat: while a floor console is open the guest app
       stops simulating the kitchen and follows the real staff actions. */
    const STAFF_TTL = 45000;

    /* ---------------------------------------------------------------------
       Defaults — first run seeds itself from data.js so a fresh browser
       still shows a fully configured restaurant.
       ------------------------------------------------------------------ */
    /* data.js declares its globals with `const`, which lands in the script's
       lexical scope and never on `window` — so everything below reaches for
       the bare identifiers behind a typeof guard, never global.X. */
    function defaultConfig() {
        const r = (typeof RESTAURANT !== 'undefined' ? RESTAURANT : {});
        return {
            brand: {
                name: r.name || 'Restaurant',
                tagline: Object.assign({ en: '', ar: '' }, r.tagline),
                address: Object.assign({ en: '', ar: '' }, r.address),
                phone: r.phone || '',
                wifi: r.wifi || '',
                currency: r.currency || '$',
                openHour: (r.hours && r.hours.open) || 8,
                closeHour: (r.hours && r.hours.close) || 23,
                servicePct: r.servicePct != null ? r.servicePct : 0.1
            },
            tables: r.tables || 24,
            /* 'approval' — the ticket waits for the cashier.
               'direct'   — the ticket drops straight into the kitchen. */
            flow: 'approval',
            /* Which table services the guest is offered. Keys are service ids. */
            services: { question: true, water: true, cutlery: true, bill: true },
            extraServices: [],
            /* Payment methods offered on the bill sheet. */
            payments: { cash: true, card: true, split: true },
            sound: true,
            /* Where the table QR codes point. Set to the live domain before
               printing them; defaults to wherever this file is served from. */
            baseUrl: ''
        };
    }

    function blank() {
        return {
            schema: SCHEMA,
            rev: 0,
            config: defaultConfig(),
            menu: { items: {}, cats: {}, order: [], catOrder: [], custom: [], customCats: [] },
            tables: {},
            orders: [],
            calls: [],
            bills: [],
            log: [],
            staffSeen: 0
        };
    }

    /* ---------------------------------------------------------------------
       Storage (wrapped — file:// and private mode both throw)
       ------------------------------------------------------------------ */
    let cache = null;

    function readRaw() {
        try {
            const raw = localStorage.getItem(KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed && parsed.schema === SCHEMA ? parsed : null;
        } catch (e) {
            return null;
        }
    }

    function load() {
        cache = Object.assign(blank(), readRaw() || {});
        // Merge nested defaults so a stored blob from an older build still boots.
        cache.config = Object.assign(defaultConfig(), cache.config);
        cache.config.brand = Object.assign(defaultConfig().brand, cache.config.brand);
        cache.menu = Object.assign(blank().menu, cache.menu);
        return cache;
    }

    function persist() {
        try {
            localStorage.setItem(KEY, JSON.stringify(cache));
        } catch (e) { /* quota or no storage — the tab keeps working in memory */ }
    }

    /* ---------------------------------------------------------------------
       Change bus
       BroadcastChannel is the fast path, the storage event covers browsers
       that block it, and a slow poll covers file:// where neither fires.
       ------------------------------------------------------------------ */
    const listeners = [];
    let channel = null;
    let lastRev = 0;

    try {
        channel = new BroadcastChannel(CHANNEL);
    } catch (e) { channel = null; }

    function announce(meta) {
        if (channel) {
            try { channel.postMessage({ rev: cache.rev, meta: meta || null }); } catch (e) { /* ignore */ }
        }
    }

    function fire(meta) {
        lastRev = cache.rev;
        listeners.forEach((fn) => {
            try { fn(cache, meta || {}); } catch (e) { /* one bad listener must not stop the rest */ }
        });
    }

    /** Re-read from storage and notify, but only when something actually moved. */
    function refresh(meta) {
        const stored = readRaw();
        if (!stored || stored.rev === cache.rev) return false;
        load();
        fire(meta || { type: 'sync' });
        return true;
    }

    if (channel) {
        channel.onmessage = (e) => { refresh(e.data && e.data.meta); };
    }

    global.addEventListener('storage', (e) => {
        if (e.key === KEY) refresh({ type: 'sync' });
    });

    setInterval(() => { refresh({ type: 'sync' }); }, 1200);

    /* ---------------------------------------------------------------------
       Write path — every mutation goes through here so the revision counter,
       the save and the broadcast can never drift apart.
       ------------------------------------------------------------------ */
    function write(mutator, meta) {
        refresh();                       // never write on top of a stale read
        const result = mutator(cache);
        cache.rev = (cache.rev || 0) + 1;
        persist();
        announce(meta);
        fire(meta || { type: 'local' });
        return result;
    }

    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    /* ---------------------------------------------------------------------
       Activity log — what the dashboard's "recent activity" reads
       ------------------------------------------------------------------ */
    function pushLog(s, type, table, text) {
        s.log.unshift({ id: uid(), type: type, table: table, at: Date.now(), text: text });
        if (s.log.length > 80) s.log.length = 80;
    }

    /* ---------------------------------------------------------------------
       Menu overrides
       data.js stays the printed source of truth; the dashboard only records
       what it changed on top of it. Applying the overrides mutates the
       globals in place, so every page renders the edited menu without
       knowing this file exists.
       ------------------------------------------------------------------ */
    function normalizeItem(item) {
        return Object.assign({
            tags: [], ingredients: [], pairings: [],
            kcal: 0, time: 0, serves: 1, rating: 5,
            desc: { en: '', ar: '' }
        }, item);
    }

    function applyMenu() {
        const s = cache;
        if (typeof MENU === 'undefined' || typeof CATEGORIES === 'undefined') return;

        /* --- categories --- */
        if (!global.__OPS_CATS) global.__OPS_CATS = CATEGORIES.slice();
        let cats = global.__OPS_CATS.slice().concat((s.menu.customCats || []).map((c) => Object.assign({}, c)));

        cats = cats.map((cat) => {
            const patch = s.menu.cats[cat.id];
            return patch ? Object.assign({}, cat, patch) : cat;
        }).filter((cat) => !cat.hidden);

        if (s.menu.catOrder && s.menu.catOrder.length) {
            const rank = (id) => {
                const at = s.menu.catOrder.indexOf(id);
                return at === -1 ? 999 : at;
            };
            cats.sort((a, b) => (a.id === 'all' ? -1 : b.id === 'all' ? 1 : rank(a.id) - rank(b.id)));
        }

        CATEGORIES.length = 0;
        cats.forEach((c) => CATEGORIES.push(c));

        /* --- dishes --- */
        if (!global.__OPS_MENU) global.__OPS_MENU = MENU.slice();
        let items = global.__OPS_MENU.slice().concat((s.menu.custom || []).map(normalizeItem));

        items = items.map((item) => {
            const patch = s.menu.items[item.id];
            if (!patch) return item;
            const merged = Object.assign({}, item, patch);
            if (patch.name) merged.name = Object.assign({}, item.name, patch.name);
            if (patch.desc) merged.desc = Object.assign({}, item.desc, patch.desc);
            return merged;
        }).filter((item) => !item.hidden && CATEGORIES.some((c) => c.id === item.cat));

        if (s.menu.order && s.menu.order.length) {
            const rank = (id) => {
                const at = s.menu.order.indexOf(id);
                return at === -1 ? 999 : at;
            };
            items.sort((a, b) => rank(a.id) - rank(b.id));
        }

        MENU.length = 0;
        items.forEach((i) => MENU.push(i));

        /* --- services the guest may call for --- */
        if (typeof SERVICE_REASONS !== 'undefined') {
            if (!global.__OPS_SERVICES) global.__OPS_SERVICES = SERVICE_REASONS.slice();
            const list = global.__OPS_SERVICES
                .filter((r) => s.config.services[r.id] !== false)
                .concat(s.config.extraServices || []);
            SERVICE_REASONS.length = 0;
            list.forEach((r) => SERVICE_REASONS.push(r));
        }

        /* --- restaurant details --- */
        if (typeof RESTAURANT !== 'undefined') {
            const b = s.config.brand;
            RESTAURANT.name = b.name;
            RESTAURANT.tagline = b.tagline;
            RESTAURANT.address = b.address;
            RESTAURANT.phone = b.phone;
            RESTAURANT.wifi = b.wifi;
            RESTAURANT.currency = b.currency;
            RESTAURANT.hours = { open: b.openHour, close: b.closeHour };
            RESTAURANT.servicePct = b.servicePct;
            RESTAURANT.tables = s.config.tables;
        }
    }

    /* ---------------------------------------------------------------------
       Public API
       ------------------------------------------------------------------ */
    const OPS = {
        KEY: KEY,

        state() { return cache; },
        config() { return cache.config; },
        rev() { return cache.rev; },

        /** fn(state, meta) on every change, local or from another tab. */
        subscribe(fn) { listeners.push(fn); return () => {
            const at = listeners.indexOf(fn);
            if (at !== -1) listeners.splice(at, 1);
        }; },

        write: write,
        refresh: refresh,
        uid: uid,
        applyMenu: applyMenu,

        /* --- settings ---------------------------------------------------- */
        setConfig(patch, meta) {
            return write((s) => {
                s.config = Object.assign(s.config, patch);
                if (patch.brand) s.config.brand = Object.assign(s.config.brand, patch.brand);
            }, meta || { type: 'config' });
        },

        /* --- menu editing ------------------------------------------------ */
        patchItem(id, patch) {
            return write((s) => {
                s.menu.items[id] = Object.assign({}, s.menu.items[id], patch);
            }, { type: 'menu' });
        },
        addItem(item) {
            return write((s) => {
                s.menu.custom.push(normalizeItem(item));
            }, { type: 'menu' });
        },
        removeItem(id) {
            return write((s) => {
                const at = s.menu.custom.findIndex((i) => i.id === id);
                if (at !== -1) s.menu.custom.splice(at, 1);
                else s.menu.items[id] = Object.assign({}, s.menu.items[id], { hidden: true, deleted: true });
                s.menu.order = (s.menu.order || []).filter((x) => x !== id);
            }, { type: 'menu' });
        },
        setItemOrder(ids) {
            return write((s) => { s.menu.order = ids.slice(); }, { type: 'menu' });
        },
        patchCat(id, patch) {
            return write((s) => {
                s.menu.cats[id] = Object.assign({}, s.menu.cats[id], patch);
            }, { type: 'menu' });
        },
        addCat(cat) {
            return write((s) => { s.menu.customCats.push(cat); }, { type: 'menu' });
        },
        removeCat(id) {
            return write((s) => {
                const at = s.menu.customCats.findIndex((c) => c.id === id);
                if (at !== -1) s.menu.customCats.splice(at, 1);
                else s.menu.cats[id] = Object.assign({}, s.menu.cats[id], { hidden: true });
                s.menu.catOrder = (s.menu.catOrder || []).filter((x) => x !== id);
            }, { type: 'menu' });
        },
        setCatOrder(ids) {
            return write((s) => { s.menu.catOrder = ids.slice(); }, { type: 'menu' });
        },

        /* --- tables ------------------------------------------------------ */
        table(num) {
            return cache.tables[num] || { status: 'free', guests: 0, since: 0 };
        },
        seat(num, guests) {
            if (!num) return;
            return write((s) => {
                const prev = s.tables[num] || {};
                s.tables[num] = {
                    status: 'seated',
                    guests: guests || prev.guests || 2,
                    since: prev.since || Date.now()
                };
            }, { type: 'seat', table: num });
        },
        clearTable(num) {
            return write((s) => {
                delete s.tables[num];
                s.orders = s.orders.filter((o) => o.table !== num || o.status >= 4);
                s.calls.forEach((c) => { if (c.table === num && c.status === 'pending') c.status = 'done'; });
                s.bills.forEach((b) => { if (b.table === num && b.status === 'requested') b.status = 'settled'; });
                pushLog(s, 'table', num, { en: 'Table cleared', ar: 'تم إخلاء الطاولة' });
            }, { type: 'table', table: num });
        },

        /* --- orders ------------------------------------------------------ */
        orderById(id) { return cache.orders.find((o) => o.id === id) || null; },

        addOrder(order) {
            return write((s) => {
                s.orders.push(Object.assign({
                    id: uid(), status: null, accepted: false, at: Date.now()
                }, order));
                if (order.table) OPS._seatInline(s, order.table);
                pushLog(s, 'order', order.table, { en: 'New order', ar: 'طلب جديد' });
            }, { type: 'order', table: order.table });
        },

        /** Seat a table without a second write — used from inside a write(). */
        _seatInline(s, num) {
            const prev = s.tables[num] || {};
            s.tables[num] = { status: 'seated', guests: prev.guests || 2, since: prev.since || Date.now() };
        },

        setOrderStatus(id, status) {
            return write((s) => {
                const order = s.orders.find((o) => o.id === id);
                if (!order) return;
                order.status = status;
                order.statusAt = Date.now();
                if (status >= 1) order.accepted = true;
            }, { type: 'status', id: id, status: status });
        },

        rejectOrder(id, reason) {
            return write((s) => {
                const order = s.orders.find((o) => o.id === id);
                if (!order) return;
                order.status = -1;
                order.rejected = reason || '';
                order.statusAt = Date.now();
                pushLog(s, 'order', order.table, { en: 'Order rejected', ar: 'تم رفض الطلب' });
            }, { type: 'status', id: id, status: -1 });
        },

        /** The cashier trimmed the ticket before it went to the kitchen. */
        editOrderLines(id, lines) {
            return write((s) => {
                const order = s.orders.find((o) => o.id === id);
                if (!order) return;
                order.lines = lines;
                order.edited = true;
                order.statusAt = Date.now();
                pushLog(s, 'order', order.table, { en: 'Order edited by staff', ar: 'تم تعديل الطلب' });
            }, { type: 'edit', id: id });
        },

        /* --- service calls ----------------------------------------------- */
        addCall(call) {
            return write((s) => {
                s.calls.push(Object.assign({ id: uid(), at: Date.now(), status: 'pending' }, call));
                if (call.table) OPS._seatInline(s, call.table);
                pushLog(s, 'call', call.table, { en: 'Waiter called', ar: 'طلب ويتر' });
            }, { type: 'call', table: call.table });
        },
        resolveCall(id, status) {
            return write((s) => {
                const call = s.calls.find((c) => c.id === id);
                if (call) { call.status = status || 'done'; call.doneAt = Date.now(); }
            }, { type: 'call-done', id: id });
        },

        /* --- bills -------------------------------------------------------- */
        addBill(bill) {
            return write((s) => {
                // One open bill per table is enough.
                s.bills.forEach((b) => { if (b.table === bill.table && b.status === 'requested') b.status = 'replaced'; });
                s.bills.push(Object.assign({ id: uid(), at: Date.now(), status: 'requested' }, bill));
                pushLog(s, 'bill', bill.table, { en: 'Bill requested', ar: 'طلب فاتورة' });
            }, { type: 'bill', table: bill.table });
        },
        settleBill(id) {
            return write((s) => {
                const bill = s.bills.find((b) => b.id === id);
                if (bill) { bill.status = 'settled'; bill.settledAt = Date.now(); }
            }, { type: 'bill-done', id: id });
        },

        /* --- live queries used by every interface ------------------------- */
        openCalls() { return cache.calls.filter((c) => c.status === 'pending'); },
        openBills() { return cache.bills.filter((b) => b.status === 'requested'); },
        liveOrders() { return cache.orders.filter((o) => o.status === null || (o.status >= 0 && o.status < 4)); },
        tableOrders(num) { return cache.orders.filter((o) => o.table === num); },

        /* --- staff presence ----------------------------------------------- */
        markStaffOnline() {
            const now = Date.now();
            if (now - (cache.staffSeen || 0) < 10000) return;   // heartbeat, not a flood
            write((s) => { s.staffSeen = now; }, { type: 'heartbeat' });
        },
        staffOnline() { return Date.now() - (cache.staffSeen || 0) < STAFF_TTL; },

        /* --- housekeeping -------------------------------------------------- */
        resetAll() {
            cache = blank();
            cache.rev = Date.now();
            persist();
            announce({ type: 'reset' });
            fire({ type: 'reset' });
        },
        clearActivity() {
            return write((s) => {
                s.orders = []; s.calls = []; s.bills = []; s.log = []; s.tables = {};
            }, { type: 'reset-activity' });
        },

        /** Absolute URL a table's QR code should carry. */
        tableUrl(num) {
            const base = (cache.config.baseUrl || '').trim();
            if (base) return base.replace(/\/?$/, '/') + 'index.html?table=' + num;
            const here = global.location.href.split('?')[0].split('#')[0];
            return here.replace(/[^/]*$/, '') + 'index.html?table=' + num;
        }
    };

    load();
    lastRev = cache.rev;

    global.OPS = OPS;

    /* ---------------------------------------------------------------------
       Console strings — staff.html and admin.html only. Guest-facing copy
       stays in data.js with the rest of the content.
       ------------------------------------------------------------------ */
    global.I18N_OPS = {
        en: {
            /* shell */
            staffTitle: 'Service floor',
            adminTitle: 'Dashboard',
            live: 'Live',
            offline: 'Reconnecting',
            sound: 'Sound',
            demo: 'Demo event',
            openMenu: 'Guest menu',
            openStaff: 'Floor console',
            openAdmin: 'Dashboard',
            nowServing: 'Now',
            minsAgo: 'min ago',
            justNow: 'just now',
            secAgo: 's ago',
            none: 'Nothing here right now',
            confirmQ: 'Are you sure?',
            save: 'Save',
            saved: 'Saved',
            cancel: 'Cancel',
            edit: 'Edit',
            del: 'Delete',
            add: 'Add',
            close: 'Close',
            search: 'Search…',

            /* staff tabs */
            tabOrders: 'Orders',
            tabAlerts: 'Alerts',
            tabTables: 'Tables',
            tabBills: 'Payments',

            /* orders board */
            colNew: 'Needs review',
            colKitchen: 'In the kitchen',
            colReady: 'Ready to run',
            colDone: 'Served',
            accept: 'Accept & send',
            sendKitchen: 'Send to kitchen',
            startCooking: 'Start cooking',
            markReady: 'Mark ready',
            markServed: 'Mark served',
            reject: 'Reject',
            rejected: 'Rejected',
            editTicket: 'Edit ticket',
            ticketFor: 'Order',
            waitingApproval: 'Waiting for the cashier',
            autoSent: 'Sent straight to the kitchen',
            total: 'Total',
            noteForKitchen: 'Note for the kitchen',

            /* alerts */
            alertWaiter: 'requested a waiter',
            alertBill: 'requested the bill',
            alertCard: 'requested card payment',
            alertCash: 'will pay cash',
            alertSplit: 'wants to split the bill',
            alertOrder: 'placed a new order',
            handled: 'Handled',
            onMyWay: 'On my way',
            waiting: 'Waiting',

            /* tables */
            manualOrder: 'Manual order',
            manualHint: 'Take an order for a guest who ordered out loud — it reaches the kitchen already accepted.',
            manualBadge: 'Taken by staff',
            seatTable: 'Seat this table',
            emptyTicket: 'Pick at least one dish',
            free: 'Free',
            seated: 'Seated',
            calling: 'Calling',
            billOpen: 'Bill requested',
            cooking: 'Cooking',
            guestsShort: 'guests',
            openTable: 'Open table',
            closeTable: 'Close table',
            tableTotal: 'Table total',
            clearConfirm: 'Close this table and clear its session?',

            /* payments */
            paymentCash: 'Cash',
            paymentCard: 'Card',
            paymentSplit: 'Split',
            takeReader: 'Take the card reader to the table',
            bringChange: 'Bring the bill and change',
            markPaid: 'Mark as paid',
            paid: 'Paid',
            tip: 'Tip',

            /* dashboard nav */
            navOverview: 'Overview',
            navMenu: 'Menu',
            navTables: 'Tables & QR',
            navServices: 'Services',
            navOrders: 'Order settings',
            navRestaurant: 'Restaurant',

            /* overview */
            kpiOrders: 'Orders today',
            kpiRevenue: 'Revenue today',
            kpiTables: 'Active tables',
            kpiAvg: 'Average ticket',
            topDishes: 'Most ordered',
            recent: 'Recent activity',
            noActivity: 'No activity yet — orders will appear here.',

            /* menu manager */
            dishes: 'Dishes',
            categories: 'Categories',
            addDish: 'Add a dish',
            addCategory: 'Add a category',
            available: 'Available',
            unavailable: 'Out of stock',
            hiddenLabel: 'Hidden from the menu',
            nameEn: 'Name (English)',
            nameAr: 'Name (Arabic)',
            descEn: 'Description (English)',
            descAr: 'Description (Arabic)',
            price: 'Price',
            category: 'Category',
            image: 'Photo',
            uploadImage: 'Upload a photo',
            tagsLabel: 'Badges',
            prepTime: 'Prep time (min)',
            calories: 'Calories',
            moveUp: 'Move up',
            moveDown: 'Move down',
            deleteDish: 'Delete this dish from the menu?',
            deleteCat: 'Delete this category?',
            dishSaved: 'Dish saved',
            soldOut: 'Marked out of stock',
            backInStock: 'Back in stock',

            /* tables + qr */
            tableCount: 'Number of tables',
            qrFor: 'QR for',
            copyLink: 'Copy link',
            copied: 'Link copied',
            printQr: 'Print QR sheet',
            baseUrl: 'Public address of the menu',
            baseUrlHint: 'Set this to your domain before printing the QR codes.',
            qrHint: 'Scanning this seats the guest at the table automatically.',

            /* services */
            servicesHint: 'Pick what the guest can ask for from the table.',
            addService: 'Add a service',
            serviceName: 'Service name',
            paymentsHint: 'Payment methods offered on the bill.',

            /* order settings */
            flowTitle: 'How orders reach the kitchen',
            flowDirect: 'Direct to kitchen',
            flowDirectSub: 'The guest sends, the kitchen starts. Fastest, no gatekeeper.',
            flowApproval: 'Cashier approval',
            flowApprovalSub: 'The ticket waits on the floor console until staff accepts it.',
            serviceCharge: 'Service charge',

            /* restaurant */
            restName: 'Restaurant name',
            tagline: 'Tagline',
            address: 'Address',
            phone: 'Phone',
            wifiPass: 'Wi-Fi',
            currency: 'Currency',
            openHour: 'Opens',
            closeHour: 'Closes',
            dangerZone: 'Reset',
            resetActivity: 'Clear all orders and sessions',
            resetAll: 'Reset the whole system',
            resetConfirm: 'This clears every setting and menu edit. Continue?'
        },

        ar: {
            staffTitle: 'شاشة الصالة',
            adminTitle: 'لوحة التحكم',
            live: 'مباشر',
            offline: 'جارٍ إعادة الاتصال',
            sound: 'الصوت',
            demo: 'حدث تجريبي',
            openMenu: 'منيو العميل',
            openStaff: 'شاشة الصالة',
            openAdmin: 'لوحة التحكم',
            nowServing: 'الآن',
            minsAgo: 'دقيقة',
            justNow: 'الآن',
            secAgo: 'ثانية',
            none: 'لا يوجد شيء حالياً',
            confirmQ: 'متأكد؟',
            save: 'حفظ',
            saved: 'تم الحفظ',
            cancel: 'إلغاء',
            edit: 'تعديل',
            del: 'حذف',
            add: 'إضافة',
            close: 'إغلاق',
            search: 'بحث…',

            tabOrders: 'الطلبات',
            tabAlerts: 'التنبيهات',
            tabTables: 'الطاولات',
            tabBills: 'الدفع',

            colNew: 'بحاجة لمراجعة',
            colKitchen: 'في المطبخ',
            colReady: 'جاهز للتقديم',
            colDone: 'تم التقديم',
            accept: 'قبول وإرسال',
            sendKitchen: 'إرسال للمطبخ',
            startCooking: 'بدء التحضير',
            markReady: 'جاهز',
            markServed: 'تم التقديم',
            reject: 'رفض',
            rejected: 'مرفوض',
            editTicket: 'تعديل الطلب',
            ticketFor: 'طلب',
            waitingApproval: 'بانتظار موافقة الكاشير',
            autoSent: 'أُرسل مباشرة للمطبخ',
            total: 'المجموع',
            noteForKitchen: 'ملاحظة للمطبخ',

            alertWaiter: 'طلب ويتر',
            alertBill: 'طلب الفاتورة',
            alertCard: 'طلب الدفع بالبطاقة',
            alertCash: 'سيدفع كاش',
            alertSplit: 'يريد تقسيم الفاتورة',
            alertOrder: 'أرسل طلباً جديداً',
            handled: 'تم',
            onMyWay: 'بطريقي',
            waiting: 'بالانتظار',

            manualOrder: 'طلب يدوي',
            manualHint: 'سجّل طلب ضيف طلب شفهياً — بيوصل المطبخ مقبول مباشرة.',
            manualBadge: 'أخذه الموظف',
            seatTable: 'إشغال الطاولة',
            emptyTicket: 'اختر صنفاً واحداً على الأقل',
            free: 'فاضية',
            seated: 'مشغولة',
            calling: 'تنادي',
            billOpen: 'طلبت الفاتورة',
            cooking: 'قيد التحضير',
            guestsShort: 'ضيوف',
            openTable: 'فتح الطاولة',
            closeTable: 'إغلاق الطاولة',
            tableTotal: 'حساب الطاولة',
            clearConfirm: 'إغلاق الطاولة وإنهاء جلستها؟',

            paymentCash: 'كاش',
            paymentCard: 'بطاقة',
            paymentSplit: 'تقسيم',
            takeReader: 'خذ جهاز الدفع إلى الطاولة',
            bringChange: 'أحضر الفاتورة والباقي',
            markPaid: 'تم الدفع',
            paid: 'مدفوعة',
            tip: 'إكرامية',

            navOverview: 'نظرة عامة',
            navMenu: 'المنيو',
            navTables: 'الطاولات و QR',
            navServices: 'الخدمات',
            navOrders: 'إعدادات الطلبات',
            navRestaurant: 'بيانات المطعم',

            kpiOrders: 'طلبات اليوم',
            kpiRevenue: 'مبيعات اليوم',
            kpiTables: 'طاولات نشطة',
            kpiAvg: 'متوسط الفاتورة',
            topDishes: 'الأكثر طلباً',
            recent: 'آخر الأحداث',
            noActivity: 'لا يوجد نشاط بعد — ستظهر الطلبات هنا.',

            dishes: 'الأصناف',
            categories: 'الأقسام',
            addDish: 'إضافة صنف',
            addCategory: 'إضافة قسم',
            available: 'متوفر',
            unavailable: 'غير متوفر',
            hiddenLabel: 'مخفي من المنيو',
            nameEn: 'الاسم (إنجليزي)',
            nameAr: 'الاسم (عربي)',
            descEn: 'الوصف (إنجليزي)',
            descAr: 'الوصف (عربي)',
            price: 'السعر',
            category: 'القسم',
            image: 'الصورة',
            uploadImage: 'رفع صورة',
            tagsLabel: 'الشارات',
            prepTime: 'وقت التحضير (دقيقة)',
            calories: 'السعرات',
            moveUp: 'تحريك للأعلى',
            moveDown: 'تحريك للأسفل',
            deleteDish: 'حذف هذا الصنف من المنيو؟',
            deleteCat: 'حذف هذا القسم؟',
            dishSaved: 'تم حفظ الصنف',
            soldOut: 'تم تعليمه غير متوفر',
            backInStock: 'رجع متوفر',

            tableCount: 'عدد الطاولات',
            qrFor: 'QR للطاولة',
            copyLink: 'نسخ الرابط',
            copied: 'تم نسخ الرابط',
            printQr: 'طباعة أكواد QR',
            baseUrl: 'رابط المنيو على الإنترنت',
            baseUrlHint: 'ضع رابط موقعك قبل طباعة أكواد QR.',
            qrHint: 'مسح الكود يُدخل العميل على منيو الطاولة مباشرة.',

            servicesHint: 'اختر ما يستطيع العميل طلبه من الطاولة.',
            addService: 'إضافة خدمة',
            serviceName: 'اسم الخدمة',
            paymentsHint: 'طرق الدفع التي تظهر في الفاتورة.',

            flowTitle: 'كيف تصل الطلبات للمطبخ',
            flowDirect: 'مباشرة للمطبخ',
            flowDirectSub: 'العميل يرسل والمطبخ يبدأ فوراً. الأسرع، بدون وسيط.',
            flowApproval: 'موافقة الكاشير',
            flowApprovalSub: 'الطلب ينتظر على شاشة الصالة حتى يقبله الموظف.',
            serviceCharge: 'نسبة الخدمة',

            restName: 'اسم المطعم',
            tagline: 'الشعار النصي',
            address: 'العنوان',
            phone: 'الهاتف',
            wifiPass: 'الواي فاي',
            currency: 'العملة',
            openHour: 'الافتتاح',
            closeHour: 'الإغلاق',
            dangerZone: 'إعادة ضبط',
            resetActivity: 'مسح كل الطلبات والجلسات',
            resetAll: 'إعادة ضبط النظام بالكامل',
            resetConfirm: 'سيؤدي هذا لمسح كل الإعدادات وتعديلات المنيو. متابعة؟'
        }
    };

    /* Overrides are applied as soon as this file loads so the page scripts,
       which run after it, only ever see the edited menu. */
    applyMenu();
    OPS.subscribe(applyMenu);

})(window);
