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

    /* Cloud mode is decided by supabase.js: with keys and a reachable client
       the database is the truth and this file is its cache; without them the
       localStorage engine below runs the whole system on one device. */
    const cloudOn = () => !!(global.CLOUD && global.CLOUD.enabled);

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
        // In cloud mode nothing is restored from disk: a stale local copy of
        // "table 7 is seated" would paint a floor that no longer exists.
        cache = Object.assign(blank(), cloudOn() ? {} : (readRaw() || {}));
        // Merge nested defaults so a stored blob from an older build still boots.
        cache.config = Object.assign(defaultConfig(), cache.config);
        cache.config.brand = Object.assign(defaultConfig().brand, cache.config.brand);
        cache.menu = Object.assign(blank().menu, cache.menu);
        return cache;
    }

    function persist() {
        if (cloudOn()) return;              // the database is the store
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

    // Local mode polls because file:// fires neither of the two above.
    // Cloud mode gets a websocket instead and skips the poll entirely.
    if (!cloudOn()) setInterval(() => { refresh({ type: 'sync' }); }, 1200);

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

    /* Ids are generated here, not by the database, so a ticket has the same
       identity in the guest's tab and in the row it becomes — which is what
       lets the two reconcile. They must therefore be real UUIDs. */
    const uid = () => (global.crypto && global.crypto.randomUUID
        ? global.crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        }));

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

        // Remember data.js as it shipped, before anything rewrites it.
        if (!global.__OPS_CATS) global.__OPS_CATS = CATEGORIES.slice();
        if (!global.__OPS_MENU) global.__OPS_MENU = MENU.slice();

        /* In cloud mode the menu is not a patch over data.js — it is the
           `categories` and `items` tables. Only the "Everything" tab, which
           is a guest-app device rather than a real category, is kept. */
        if (cloudOn() && s.cloudMenu) {
            const everything = global.__OPS_CATS.find((c) => c.id === 'all');
            const cats = (everything ? [everything] : [])
                .concat(s.cloudMenu.cats.filter((c) => !c.hidden));

            CATEGORIES.length = 0;
            cats.forEach((c) => CATEGORIES.push(c));

            const items = s.cloudMenu.items.filter((i) => !i.hidden);
            MENU.length = 0;
            items.forEach((i) => MENU.push(i));

            applyServices(s);
            applyBrand(s);
            return;
        }

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

        applyServices(s);
        applyBrand(s);
    }

    /* --- services the guest may call for --- */
    function applyServices(s) {
        if (typeof SERVICE_REASONS === 'undefined') return;
        if (!global.__OPS_SERVICES) global.__OPS_SERVICES = SERVICE_REASONS.slice();

        const list = global.__OPS_SERVICES
            .filter((r) => s.config.services[r.id] !== false)
            .concat(s.config.extraServices || []);

        SERVICE_REASONS.length = 0;
        list.forEach((r) => SERVICE_REASONS.push(r));
    }

    /* --- restaurant details --- */
    function applyBrand(s) {
        if (typeof RESTAURANT === 'undefined') return;
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

    /* ---------------------------------------------------------------------
       Cloud hydration
       The cache above becomes a read model of the database: one snapshot on
       load, then a fresh snapshot whenever realtime says something moved.
       Interfaces wait for OPS.ready() so they never paint an empty menu.
       ------------------------------------------------------------------ */
    let resolveReady;
    const readyPromise = new Promise((resolve) => { resolveReady = resolve; });

    function applySnapshot(snap) {
        if (!snap) return;
        if (snap.config) cache.config = Object.assign(defaultConfig(), snap.config);
        cache.cloudMenu = { cats: snap.cats, items: snap.items };
        cache.tables = snap.tables;
        cache.sessions = snap.sessions;
        cache.orders = snap.orders;
        cache.calls = snap.calls;
        cache.bills = snap.bills;
        cache.log = snap.log;
        cache.tokens = snap.tokens || {};
        cache.rev = (cache.rev || 0) + 1;
        applyMenu();
    }

    /* The back of house never signs in anonymously: a waiter's tablet would
       collect a junk user on every visit, and an anonymous session cannot
       read the floor anyway. */
    const isConsolePage = () => !!(document.body && document.body.classList.contains('console'));

    async function hydrate() {
        await global.CLOUD.ensureUser({ anonymous: !isConsolePage() });
        applySnapshot(await global.CLOUD.snapshot());
        fire({ type: 'sync' });
        document.documentElement.classList.remove('booting');
        resolveReady(OPS);

        global.CLOUD.listen(async () => {
            applySnapshot(await global.CLOUD.snapshot());
            fire({ type: 'sync' });
        });
    }

    /** The open session this device owns at a table, opening one if needed. */
    async function sessionFor(table, guests) {
        if (!table) return null;

        // Staff writing a manual ticket join the table's existing session
        // rather than opening a second one beside the guest's.
        if (global.CLOUD.isStaff()) {
            const open = (cache.sessions || []).find((s) => s.table_id === table && s.status === 'open');
            if (open) return open.id;
        } else {
            const mine = (cache.sessions || []).find(
                (s) => s.table_id === table && s.status === 'open' &&
                       global.CLOUD.user && s.created_by === global.CLOUD.user.id
            );
            if (mine) return mine.id;
        }

        const row = await global.CLOUD.openSession(table, guests, qrToken());
        if (!row) return null;
        cache.sessions = (cache.sessions || []).concat(row);
        return row.id;
    }

    /** A tokened QR carries ?k=… ; kept for the life of the tab. */
    let tokenSeen = null;
    function qrToken() {
        if (tokenSeen !== null) return tokenSeen;
        try {
            tokenSeen = new URLSearchParams(global.location.search).get('k') ||
                        sessionStorage.getItem('operix.k') || null;
            if (tokenSeen) sessionStorage.setItem('operix.k', tokenSeen);
        } catch (e) { tokenSeen = null; }
        return tokenSeen;
    }

    /* ---------------------------------------------------------------------
       Public API
       ------------------------------------------------------------------ */
    const OPS = {
        KEY: KEY,

        state() { return cache; },
        config() { return cache.config; },
        rev() { return cache.rev; },

        /** 'cloud' when a database is behind it, 'local' on one device. */
        mode() { return cloudOn() ? 'cloud' : 'local'; },

        /** Run once the restaurant is loaded — immediately in local mode.
            Returns a promise too, so callers can await the first snapshot. */
        ready(fn) {
            if (!cloudOn()) {
                if (fn) fn(OPS);
                return Promise.resolve(OPS);
            }
            return fn ? readyPromise.then(fn) : readyPromise;
        },

        /** Re-read everything — used after a staff sign-in changes what RLS
            is willing to hand over. */
        async reloadCloud() {
            if (!cloudOn()) return;
            applySnapshot(await global.CLOUD.snapshot());
            fire({ type: 'sync' });
        },

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
            const out = write((s) => {
                s.config = Object.assign(s.config, patch);
                if (patch.brand) s.config.brand = Object.assign(s.config.brand, patch.brand);
            }, meta || { type: 'config' });

            // `sound` is a preference of this device, not of the restaurant.
            if (cloudOn() && Object.keys(patch).some((k) => k !== 'sound')) {
                global.CLOUD.saveSettings(cache.config);
            }
            return out;
        },

        /* --- menu editing ------------------------------------------------
           Cloud mode writes the row and lets realtime bring the new menu
           back; the local patch keeps the dashboard responsive meanwhile. */
        patchItem(id, patch) {
            const out = write((s) => {
                s.menu.items[id] = Object.assign({}, s.menu.items[id], patch);
                if (s.cloudMenu) {
                    const item = s.cloudMenu.items.find((i) => i.id === id);
                    if (item) Object.assign(item, patch);
                }
            }, { type: 'menu' });

            if (cloudOn()) {
                const columns = {};
                if ('price' in patch) columns.price = patch.price;
                if ('available' in patch) columns.available = patch.available;
                if ('hidden' in patch) columns.hidden = patch.hidden;
                if ('cat' in patch) columns.category_id = patch.cat;
                if ('img' in patch) columns.img_url = patch.img;
                if ('tags' in patch) columns.tags = patch.tags;
                if ('time' in patch) columns.prep_min = patch.time;
                if ('kcal' in patch) columns.kcal = patch.kcal;
                if (patch.name) { columns.name_ar = patch.name.ar; columns.name_en = patch.name.en; }
                if (patch.desc) { columns.desc_ar = patch.desc.ar; columns.desc_en = patch.desc.en; }
                if (Object.keys(columns).length) global.CLOUD.patchItem(id, columns);
            }
            return out;
        },
        addItem(item) {
            const out = write((s) => {
                s.menu.custom.push(normalizeItem(item));
                if (s.cloudMenu) s.cloudMenu.items.push(normalizeItem(item));
            }, { type: 'menu' });
            if (cloudOn()) global.CLOUD.saveItem(normalizeItem(item));
            return out;
        },
        removeItem(id) {
            const out = write((s) => {
                const at = s.menu.custom.findIndex((i) => i.id === id);
                if (at !== -1) s.menu.custom.splice(at, 1);
                else s.menu.items[id] = Object.assign({}, s.menu.items[id], { hidden: true, deleted: true });
                s.menu.order = (s.menu.order || []).filter((x) => x !== id);
                if (s.cloudMenu) s.cloudMenu.items = s.cloudMenu.items.filter((i) => i.id !== id);
            }, { type: 'menu' });
            if (cloudOn()) global.CLOUD.deleteItem(id);
            return out;
        },
        setItemOrder(ids) {
            const out = write((s) => { s.menu.order = ids.slice(); }, { type: 'menu' });
            if (cloudOn()) global.CLOUD.setSort('items', ids);
            return out;
        },
        patchCat(id, patch) {
            const out = write((s) => {
                s.menu.cats[id] = Object.assign({}, s.menu.cats[id], patch);
                if (s.cloudMenu) {
                    const cat = s.cloudMenu.cats.find((c) => c.id === id);
                    if (cat) Object.assign(cat, patch);
                }
            }, { type: 'menu' });

            if (cloudOn()) {
                const columns = {};
                if ('ar' in patch) columns.name_ar = patch.ar;
                if ('en' in patch) columns.name_en = patch.en;
                if ('hidden' in patch) columns.hidden = patch.hidden;
                if (patch.note) { columns.note_ar = patch.note.ar || ''; columns.note_en = patch.note.en || ''; }
                if (Object.keys(columns).length) global.CLOUD.saveCategoryPatch(id, columns);
            }
            return out;
        },
        addCat(cat) {
            const out = write((s) => {
                s.menu.customCats.push(cat);
                if (s.cloudMenu) s.cloudMenu.cats.push(cat);
            }, { type: 'menu' });
            if (cloudOn()) global.CLOUD.saveCategory(cat);
            return out;
        },
        removeCat(id) {
            const out = write((s) => {
                const at = s.menu.customCats.findIndex((c) => c.id === id);
                if (at !== -1) s.menu.customCats.splice(at, 1);
                else s.menu.cats[id] = Object.assign({}, s.menu.cats[id], { hidden: true });
                s.menu.catOrder = (s.menu.catOrder || []).filter((x) => x !== id);
                if (s.cloudMenu) s.cloudMenu.cats = s.cloudMenu.cats.filter((c) => c.id !== id);
            }, { type: 'menu' });
            if (cloudOn()) global.CLOUD.deleteCategory(id);
            return out;
        },
        setCatOrder(ids) {
            const out = write((s) => { s.menu.catOrder = ids.slice(); }, { type: 'menu' });
            if (cloudOn()) global.CLOUD.setSort('categories', ids);
            return out;
        },

        /* --- tables ------------------------------------------------------ */
        table(num) {
            return cache.tables[num] || { status: 'free', guests: 0, since: 0 };
        },
        seat(num, guests) {
            if (!num) return;
            const out = write((s) => {
                const prev = s.tables[num] || {};
                s.tables[num] = {
                    status: 'seated',
                    guests: guests || prev.guests || 2,
                    since: prev.since || Date.now()
                };
            }, { type: 'seat', table: num });

            if (cloudOn()) sessionFor(num, guests);
            return out;
        },
        clearTable(num) {
            const out = write((s) => {
                delete s.tables[num];
                s.orders = s.orders.filter((o) => o.table !== num || o.status >= 4);
                s.calls.forEach((c) => { if (c.table === num && c.status === 'pending') c.status = 'done'; });
                s.bills.forEach((b) => { if (b.table === num && b.status === 'requested') b.status = 'settled'; });
                pushLog(s, 'table', num, { en: 'Table cleared', ar: 'تم إخلاء الطاولة' });
            }, { type: 'table', table: num });

            if (cloudOn()) global.CLOUD.closeTable(num);
            return out;
        },

        /* --- orders ------------------------------------------------------ */
        orderById(id) { return cache.orders.find((o) => o.id === id) || null; },

        addOrder(order) {
            const row = Object.assign({ id: uid(), status: null, accepted: false, at: Date.now() }, order);

            const out = write((s) => {
                s.orders.push(row);
                if (order.table) OPS._seatInline(s, order.table);
                pushLog(s, 'order', order.table, { en: 'New order', ar: 'طلب جديد' });
            }, { type: 'order', table: order.table });

            // The ticket needs a session; opening one is a round trip, so the
            // guest sees it locally first and the insert follows.
            if (cloudOn()) {
                sessionFor(row.table, (cache.tables[row.table] || {}).guests)
                    .then((session) => session && global.CLOUD.insertOrder(Object.assign({}, row, { session: session })));
            }
            return out;
        },

        /** Seat a table without a second write — used from inside a write(). */
        _seatInline(s, num) {
            const prev = s.tables[num] || {};
            s.tables[num] = { status: 'seated', guests: prev.guests || 2, since: prev.since || Date.now() };
        },

        setOrderStatus(id, status) {
            const out = write((s) => {
                const order = s.orders.find((o) => o.id === id);
                if (!order) return;
                order.status = status;
                order.statusAt = Date.now();
                if (status >= 1) order.accepted = true;
            }, { type: 'status', id: id, status: status });

            if (cloudOn()) global.CLOUD.setOrderStatus(id, status);
            return out;
        },

        rejectOrder(id, reason) {
            const out = write((s) => {
                const order = s.orders.find((o) => o.id === id);
                if (!order) return;
                order.status = -1;
                order.rejected = reason || '';
                order.statusAt = Date.now();
                pushLog(s, 'order', order.table, { en: 'Order rejected', ar: 'تم رفض الطلب' });
            }, { type: 'status', id: id, status: -1 });

            if (cloudOn()) global.CLOUD.rejectOrder(id, reason);
            return out;
        },

        /** The cashier trimmed the ticket before it went to the kitchen. */
        editOrderLines(id, lines) {
            const out = write((s) => {
                const order = s.orders.find((o) => o.id === id);
                if (!order) return;
                order.lines = lines;
                order.edited = true;
                order.statusAt = Date.now();
                pushLog(s, 'order', order.table, { en: 'Order edited by staff', ar: 'تم تعديل الطلب' });
            }, { type: 'edit', id: id });

            if (cloudOn()) global.CLOUD.replaceOrderLines(id, lines);
            return out;
        },

        /* --- service calls ----------------------------------------------- */
        addCall(call) {
            const row = Object.assign({ id: uid(), at: Date.now(), status: 'pending' }, call);
            const out = write((s) => {
                s.calls.push(row);
                if (call.table) OPS._seatInline(s, call.table);
                pushLog(s, 'call', call.table, { en: 'Waiter called', ar: 'طلب ويتر' });
            }, { type: 'call', table: call.table });

            if (cloudOn()) {
                sessionFor(row.table, (cache.tables[row.table] || {}).guests)
                    .then((session) => session && global.CLOUD.insertCall(Object.assign({}, row, { session: session })));
            }
            return out;
        },
        resolveCall(id, status) {
            const out = write((s) => {
                const call = s.calls.find((c) => c.id === id);
                if (call) { call.status = status || 'done'; call.doneAt = Date.now(); }
            }, { type: 'call-done', id: id });

            if (cloudOn()) global.CLOUD.resolveCall(id, status);
            return out;
        },

        /* --- bills -------------------------------------------------------- */
        addBill(bill) {
            const row = Object.assign({ id: uid(), at: Date.now(), status: 'requested' }, bill);
            const out = write((s) => {
                // One open bill per table is enough.
                s.bills.forEach((b) => { if (b.table === bill.table && b.status === 'requested') b.status = 'replaced'; });
                s.bills.push(row);
                pushLog(s, 'bill', bill.table, { en: 'Bill requested', ar: 'طلب فاتورة' });
            }, { type: 'bill', table: bill.table });

            if (cloudOn()) {
                sessionFor(row.table, (cache.tables[row.table] || {}).guests)
                    .then((session) => session && global.CLOUD.insertBill(Object.assign({}, row, { session: session })));
            }
            return out;
        },
        settleBill(id) {
            const out = write((s) => {
                const bill = s.bills.find((b) => b.id === id);
                if (bill) { bill.status = 'settled'; bill.settledAt = Date.now(); }
            }, { type: 'bill-done', id: id });

            if (cloudOn()) global.CLOUD.settleBill(id);
            return out;
        },

        /* --- live queries used by every interface ------------------------- */
        openCalls() { return cache.calls.filter((c) => c.status === 'pending'); },
        openBills() { return cache.bills.filter((b) => b.status === 'requested'); },
        liveOrders() { return cache.orders.filter((o) => o.status === null || (o.status >= 0 && o.status < 4)); },
        tableOrders(num) { return cache.orders.filter((o) => o.table === num); },

        /* --- staff presence -----------------------------------------------
           Only local mode needs this: it decides whether the guest app may
           simulate a kitchen. With a database there is nothing to fake, so
           the answer is always "a human is in charge". */
        markStaffOnline() {
            if (cloudOn()) return;
            const now = Date.now();
            if (now - (cache.staffSeen || 0) < 10000) return;   // heartbeat, not a flood
            write((s) => { s.staffSeen = now; }, { type: 'heartbeat' });
        },
        staffOnline() { return cloudOn() || Date.now() - (cache.staffSeen || 0) < STAFF_TTL; },

        /* --- housekeeping -------------------------------------------------- */
        resetAll() {
            // With a database, "reset" cannot mean wiping the restaurant from
            // a browser button: it re-reads it. db/99-clear-activity.sql is
            // the deliberate, auditable way to erase a service day.
            if (cloudOn()) { global.location.reload(); return; }

            cache = blank();
            cache.rev = Date.now();
            persist();
            announce({ type: 'reset' });
            fire({ type: 'reset' });
        },
        clearActivity() {
            const out = write((s) => {
                s.orders = []; s.calls = []; s.bills = []; s.log = []; s.tables = {};
            }, { type: 'reset-activity' });

            // Cloud: close the floor rather than delete history.
            if (cloudOn()) global.CLOUD.endDay();
            return out;
        },

        /** Absolute URL a table's QR code should carry, token included. */
        tableUrl(num) {
            const base = (cache.config.baseUrl || '').trim();
            const here = global.location.href.split('?')[0].split('#')[0];
            const root = base ? base.replace(/\/?$/, '/') : here.replace(/[^/]*$/, '');
            const token = (cache.tokens || {})[num];
            return root + 'index.html?table=' + num + (token ? '&k=' + token : '');
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

            /* sign in */
            signIn: 'Sign in',
            signInSub: 'This screen is for the restaurant team.',
            signOut: 'Sign out',
            email: 'E-mail',
            password: 'Password',
            signInFailed: 'Wrong e-mail or password',
            notStaff: 'This account is not registered as staff',
            offlineMode: 'Running on this device only',
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

            /* تسجيل الدخول */
            signIn: 'تسجيل الدخول',
            signInSub: 'هذه الشاشة لطاقم المطعم.',
            signOut: 'تسجيل الخروج',
            email: 'الإيميل',
            password: 'كلمة السر',
            signInFailed: 'الإيميل أو كلمة السر غير صحيحة',
            notStaff: 'هذا الحساب غير مسجّل كموظف',
            offlineMode: 'يعمل على هذا الجهاز فقط',
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
    if (!cloudOn()) OPS.subscribe(applyMenu);   // cloud snapshots apply it themselves

    if (cloudOn()) hydrate();

})(window);
