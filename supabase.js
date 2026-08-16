/* =========================================================================
   Operix Restaurant System — Supabase transport
   -------------------------------------------------------------------------
   Everything that talks to the backend lives here. The three interfaces
   never see a query: they keep calling OPS, and OPS calls this file.

   Two modes, decided once at load:
     • supabase-config.js filled in and the client library reachable
       → CLOUD.enabled, real database, realtime, one restaurant across
         every phone and tablet.
     • anything missing (no keys, no internet, opened from file://)
       → CLOUD stays disabled and OPS falls back to its localStorage
         engine, so a demo still runs on one machine.

   The guest is a real Supabase user created by signInAnonymously(), which
   is what lets row level security tie a ticket to the device that sent it.
   ========================================================================= */
(function (global) {
    'use strict';

    const cfg = global.SUPABASE_CONFIG || {};
    const lib = global.supabase;                 // UMD global from the CDN script

    const CLOUD = {
        enabled: !!(cfg.url && cfg.anonKey && lib && lib.createClient),
        client: null,
        user: null,
        staff: null,          // row from public.staff, or null for a guest
        lastError: null
    };

    if (!CLOUD.enabled) {
        global.CLOUD = CLOUD;
        return;
    }

    // Hold the paint until the first snapshot; system.js lifts this.
    document.documentElement.classList.add('booting');

    /* The guest and the back of house keep separate sessions. In a restaurant
       they are separate devices anyway, but on one laptop — which is how this
       gets demonstrated — a shared store would mean signing in as staff logs
       the guest tab out of its own orders. */
    const isConsole = !!(document.body && document.body.classList.contains('console'));

    const client = lib.createClient(cfg.url, cfg.anonKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            storageKey: isConsole ? 'operix.auth.staff' : 'operix.auth.guest'
        },
        realtime: { params: { eventsPerSecond: 8 } }
    });
    CLOUD.client = client;

    /* ---------------------------------------------------------------------
       Errors: never throw into a render path. Anything that fails is
       reported once, and the interface keeps showing the last good state.
       ------------------------------------------------------------------ */
    const listenersError = [];

    function fail(where, error) {
        if (!error) return null;
        CLOUD.lastError = { where: where, message: error.message || String(error) };
        console.warn('[operix] ' + where + ':', error.message || error);
        listenersError.forEach((fn) => { try { fn(CLOUD.lastError); } catch (e) { /* ignore */ } });
        return null;
    }

    CLOUD.onError = (fn) => { listenersError.push(fn); };

    /* ---------------------------------------------------------------------
       Auth
       ------------------------------------------------------------------ */

    /** Guest devices sign in anonymously; staff sign in with e-mail. */
    CLOUD.ensureUser = async function (opts) {
        const { data } = await client.auth.getSession();
        let session = data ? data.session : null;

        if (!session && (!opts || opts.anonymous !== false)) {
            const res = await client.auth.signInAnonymously();
            if (res.error) return fail('anonymous sign-in', res.error);
            session = res.data.session;
        }

        CLOUD.user = session ? session.user : null;
        await CLOUD.loadStaff();
        return CLOUD.user;
    };

    CLOUD.loadStaff = async function () {
        CLOUD.staff = null;
        if (!CLOUD.user || CLOUD.user.is_anonymous) return null;

        const res = await client.from('staff').select('*').eq('id', CLOUD.user.id).maybeSingle();
        if (res.error) return fail('staff lookup', res.error);
        CLOUD.staff = res.data || null;
        return CLOUD.staff;
    };

    CLOUD.signIn = async function (email, password) {
        const res = await client.auth.signInWithPassword({ email: email, password: password });
        if (res.error) return { error: res.error.message };

        CLOUD.user = res.data.user;
        await CLOUD.loadStaff();

        // Signing in is not the same as working here.
        if (!CLOUD.staff || !CLOUD.staff.active) {
            await client.auth.signOut();
            CLOUD.user = null;
            return { error: 'not-staff' };
        }
        return { staff: CLOUD.staff };
    };

    CLOUD.signOut = async function () {
        await client.auth.signOut();
        CLOUD.user = null;
        CLOUD.staff = null;
    };

    CLOUD.isStaff = () => !!(CLOUD.staff && CLOUD.staff.active);

    const uid = () => (CLOUD.user ? CLOUD.user.id : null);

    /* ---------------------------------------------------------------------
       Row ↔ app shape
       The interfaces speak the shape data.js established; the database
       speaks columns. All the translation happens in these four functions.
       ------------------------------------------------------------------ */
    const STATUS_TEXT = ['sent', 'confirmed', 'preparing', 'ready', 'served'];
    const DB_STATUS = { pending: null, confirmed: 1, preparing: 2, ready: 3, served: 4, rejected: -1 };

    const toDbStatus = (n) =>
        (n === -1 ? 'rejected' : n === null || n === undefined ? 'pending' : (['confirmed', 'confirmed', 'preparing', 'ready', 'served'][n] || 'confirmed'));

    function rowToItem(row) {
        return {
            id: row.id,
            cat: row.category_id,
            img: row.img_url || 'assets/main.png',
            price: Number(row.price),
            name: { ar: row.name_ar, en: row.name_en },
            desc: { ar: row.desc_ar, en: row.desc_en },
            tags: row.tags || [],
            kcal: row.kcal,
            time: row.prep_min,
            serves: row.serves,
            rating: Number(row.rating),
            options: row.options && row.options.length ? row.options : undefined,
            ingredients: row.ingredients || [],
            pairings: row.pairings || [],
            available: row.available,
            hidden: row.hidden,
            sort: row.sort
        };
    }

    function rowToCat(row) {
        return {
            id: row.id,
            ar: row.name_ar,
            en: row.name_en,
            note: { ar: row.note_ar, en: row.note_en },
            img: row.img_url || 'assets/main.png',
            hidden: row.hidden,
            sort: row.sort
        };
    }

    function rowToOrder(row) {
        return {
            id: row.id,
            code: row.code,
            table: row.table_id,
            session: row.session_id,
            status: DB_STATUS[row.status] === undefined ? null : DB_STATUS[row.status],
            accepted: row.status !== 'pending',
            manual: row.source === 'staff',
            note: row.note || '',
            edited: row.edited,
            at: new Date(row.placed_at).getTime(),
            placedAt: new Date(row.placed_at).getTime(),
            statusAt: new Date(row.status_at).getTime(),
            lines: (row.order_items || []).map((line) => ({
                id: line.item_id,
                rowId: line.id,
                qty: line.qty,
                price: Number(line.unit_price),
                name: { ar: line.name_ar, en: line.name_en },
                img: line.img_url || '',
                optsText: line.options_text || '',
                note: line.note || ''
            }))
        };
    }

    function rowToConfig(row) {
        return {
            brand: {
                name: row.name,
                tagline: { ar: row.tagline_ar, en: row.tagline_en },
                address: { ar: row.address_ar, en: row.address_en },
                phone: row.phone,
                wifi: row.wifi,
                currency: row.currency,
                openHour: row.open_hour,
                closeHour: row.close_hour,
                servicePct: Number(row.service_pct),
                hero: row.hero_url || ''
            },
            tables: row.tables_count,
            flow: row.flow,
            services: row.services || {},
            extraServices: row.extra_services || [],
            payments: row.payments || {},
            baseUrl: row.base_url || '',
            qrRequired: row.qr_required,
            sound: true                    // a per-device preference, not a restaurant one
        };
    }

    /* ---------------------------------------------------------------------
       Snapshot — one round of parallel reads, mapped into the shape OPS
       caches. Small enough at restaurant scale to re-read on every change
       instead of merging deltas by hand.
       ------------------------------------------------------------------ */
    const DAY = 24 * 60 * 60 * 1000;

    CLOUD.snapshot = async function () {
        const since = new Date(Date.now() - DAY).toISOString();

        const [settings, cats, items, sessions, orders, calls, bills, log, secrets] = await Promise.all([
            client.from('settings').select('*').eq('id', 1).maybeSingle(),
            client.from('categories').select('*').order('sort'),
            client.from('items').select('*').order('sort'),
            client.from('sessions').select('*').eq('status', 'open'),
            client.from('orders').select('*, order_items(*)').gte('placed_at', since).order('placed_at'),
            client.from('service_calls').select('*').gte('created_at', since).order('created_at'),
            client.from('bills').select('*').gte('created_at', since).order('created_at'),
            CLOUD.isStaff()
                ? client.from('activity_log').select('*').order('at', { ascending: false }).limit(40)
                : Promise.resolve({ data: [] }),
            CLOUD.isStaff()
                ? client.from('table_secrets').select('*')
                : Promise.resolve({ data: [] })
        ]);

        const firstError = [settings, cats, items, sessions, orders, calls, bills].find((r) => r && r.error);
        if (firstError) return fail('loading the restaurant', firstError.error);

        // Tables keep the shape the consoles already draw: { 12: {…} }
        const tables = {};
        (sessions.data || []).forEach((s) => {
            const at = new Date(s.opened_at).getTime();
            const prev = tables[s.table_id];
            tables[s.table_id] = {
                status: 'seated',
                guests: (prev ? prev.guests : 0) + s.guests,
                since: prev ? Math.min(prev.since, at) : at,
                sessions: (prev ? prev.sessions : []).concat(s.id)
            };
        });

        const tokens = {};
        (secrets.data || []).forEach((row) => { tokens[row.table_id] = row.qr_token; });

        return {
            config: settings.data ? rowToConfig(settings.data) : null,
            cats: (cats.data || []).map(rowToCat),
            items: (items.data || []).map(rowToItem),
            tables: tables,
            sessions: sessions.data || [],
            orders: (orders.data || []).map(rowToOrder),
            calls: (calls.data || []).map((c) => ({
                id: c.id, table: c.table_id, reason: c.reason, status: c.status,
                at: new Date(c.created_at).getTime()
            })),
            bills: (bills.data || []).map((b) => ({
                id: b.id, table: b.table_id, method: b.method, tip: b.tip_pct,
                amount: Number(b.amount), status: b.status,
                at: new Date(b.created_at).getTime(),
                settledAt: b.settled_at ? new Date(b.settled_at).getTime() : null
            })),
            log: (log.data || []).map((row) => ({
                id: String(row.id), type: row.kind, table: row.table_id,
                at: new Date(row.at).getTime(),
                text: { ar: row.text_ar, en: row.text_en }
            })),
            tokens: tokens
        };
    };

    /* ---------------------------------------------------------------------
       Sessions
       ------------------------------------------------------------------ */
    CLOUD.openSession = async function (table, guests, token) {
        const res = await client.rpc('open_session', {
            p_table: table, p_token: token || null, p_guests: guests || 2
        });
        if (res.error) return fail('opening table ' + table, res.error);
        return res.data;
    };

    /** Closing a table empties it: the RPC files a receipt, then deletes the
        session — which cascades to its tickets, lines, calls and bill. */
    CLOUD.closeTable = async function (table) {
        const res = await client.rpc('close_table', { p_table: table });
        return res.error ? fail('closing table ' + table, res.error) : res.data;
    };

    CLOUD.setGuests = async function (sessionId, guests) {
        const res = await client.from('sessions').update({ guests: guests }).eq('id', sessionId);
        return res.error ? fail('updating guests', res.error) : true;
    };

    /* ---------------------------------------------------------------------
       Orders
       ------------------------------------------------------------------ */
    CLOUD.insertOrder = async function (order) {
        const row = {
            id: order.id,
            session_id: order.session,
            table_id: order.table,
            created_by: uid(),
            note: order.note || '',
            source: order.manual ? 'staff' : 'guest',
            status: order.status == null ? 'pending' : toDbStatus(order.status)
        };
        if (order.code) row.code = order.code;

        const res = await client.from('orders').insert(row).select('id, code').single();
        if (res.error) return fail('sending the order', res.error);

        const lines = (order.lines || []).map((line) => ({
            order_id: res.data.id,
            item_id: line.id || null,
            name_ar: (line.name && line.name.ar) || '',
            name_en: (line.name && line.name.en) || '',
            img_url: line.img || null,
            unit_price: line.price,
            qty: line.qty,
            options_text: line.optsText || '',
            note: line.note || ''
        }));

        if (lines.length) {
            const add = await client.from('order_items').insert(lines);
            if (add.error) return fail('sending the order lines', add.error);
        }
        return res.data;
    };

    CLOUD.setOrderStatus = async function (id, status) {
        const res = await client.from('orders')
            .update({ status: toDbStatus(status), handled_by: uid() })
            .eq('id', id);
        return res.error ? fail('updating the ticket', res.error) : true;
    };

    CLOUD.rejectOrder = async function (id, reason) {
        const res = await client.from('orders')
            .update({ status: 'rejected', rejected_reason: reason || '', handled_by: uid() })
            .eq('id', id);
        return res.error ? fail('rejecting the ticket', res.error) : true;
    };

    /** The cashier trimmed a ticket: rewrite its lines, keep its identity. */
    CLOUD.replaceOrderLines = async function (id, lines) {
        const wipe = await client.from('order_items').delete().eq('order_id', id);
        if (wipe.error) return fail('editing the ticket', wipe.error);

        if (lines.length) {
            const add = await client.from('order_items').insert(lines.map((line) => ({
                order_id: id,
                item_id: line.id || null,
                name_ar: (line.name && line.name.ar) || '',
                name_en: (line.name && line.name.en) || '',
                img_url: line.img || null,
                unit_price: line.price,
                qty: line.qty,
                options_text: line.optsText || '',
                note: line.note || ''
            })));
            if (add.error) return fail('editing the ticket', add.error);
        }

        const mark = await client.from('orders').update({ edited: true, handled_by: uid() }).eq('id', id);
        return mark.error ? fail('editing the ticket', mark.error) : true;
    };

    /* ---------------------------------------------------------------------
       Service calls and bills
       ------------------------------------------------------------------ */
    CLOUD.insertCall = async function (call) {
        const res = await client.from('service_calls').insert({
            id: call.id, session_id: call.session, table_id: call.table,
            reason: call.reason, created_by: uid()
        });
        return res.error ? fail('calling the waiter', res.error) : true;
    };

    CLOUD.resolveCall = async function (id, status) {
        const res = await client.from('service_calls')
            .update({ status: status || 'done', resolved_at: new Date().toISOString(),
                      resolved_by: CLOUD.isStaff() ? uid() : null })
            .eq('id', id);
        return res.error ? fail('closing the call', res.error) : true;
    };

    CLOUD.insertBill = async function (bill) {
        const res = await client.from('bills').insert({
            id: bill.id, session_id: bill.session, table_id: bill.table,
            method: bill.method, tip_pct: bill.tip || 0, amount: bill.amount || 0,
            created_by: uid()
        });
        return res.error ? fail('asking for the bill', res.error) : true;
    };

    CLOUD.settleBill = async function (id) {
        const res = await client.from('bills')
            .update({ status: 'settled', settled_at: new Date().toISOString(), settled_by: uid() })
            .eq('id', id);
        return res.error ? fail('settling the bill', res.error) : true;
    };

    /* ---------------------------------------------------------------------
       Dashboard writes
       ------------------------------------------------------------------ */
    CLOUD.saveSettings = async function (config) {
        const b = config.brand || {};
        const row = {
            name: b.name, tagline_ar: b.tagline.ar, tagline_en: b.tagline.en,
            address_ar: b.address.ar, address_en: b.address.en,
            phone: b.phone, wifi: b.wifi, currency: b.currency,
            open_hour: b.openHour, close_hour: b.closeHour, service_pct: b.servicePct,
            hero_url: b.hero || null,
            tables_count: config.tables, flow: config.flow,
            services: config.services, extra_services: config.extraServices,
            payments: config.payments, base_url: config.baseUrl || ''
        };
        const res = await client.from('settings').update(row).eq('id', 1);
        if (res.error) return fail('saving settings', res.error);

        // Growing the floor plan has to create the missing tables too.
        await CLOUD.syncTables(config.tables);
        return true;
    };

    CLOUD.syncTables = async function (count) {
        const have = await client.from('tables').select('id');
        if (have.error) return fail('reading tables', have.error);

        const present = new Set((have.data || []).map((t) => t.id));
        const missing = [];
        for (let n = 1; n <= count; n++) if (!present.has(n)) missing.push({ id: n });

        if (missing.length) {
            const add = await client.from('tables').insert(missing);
            if (add.error) return fail('adding tables', add.error);
        }
        const extra = (have.data || []).filter((t) => t.id > count).map((t) => t.id);
        if (extra.length) {
            // Keep the rows (they may carry history) but take them off the floor.
            await client.from('tables').update({ active: false }).in('id', extra);
        }
        await client.from('tables').update({ active: true }).lte('id', count);
        return true;
    };

    CLOUD.saveItem = async function (item) {
        const row = {
            id: item.id,
            category_id: item.cat,
            name_ar: item.name.ar, name_en: item.name.en,
            desc_ar: (item.desc && item.desc.ar) || '', desc_en: (item.desc && item.desc.en) || '',
            price: item.price, img_url: item.img,
            tags: item.tags || [], kcal: item.kcal || 0, prep_min: item.time || 0,
            serves: item.serves || 1, rating: item.rating || 5,
            options: item.options || [], ingredients: item.ingredients || [],
            pairings: item.pairings || [],
            available: item.available !== false, hidden: !!item.hidden,
            sort: item.sort || 0
        };
        const res = await client.from('items').upsert(row);
        return res.error ? fail('saving the dish', res.error) : true;
    };

    CLOUD.patchItem = async function (id, patch) {
        const res = await client.from('items').update(patch).eq('id', id);
        return res.error ? fail('saving the dish', res.error) : true;
    };

    CLOUD.deleteItem = async function (id) {
        const res = await client.from('items').delete().eq('id', id);
        if (res.error) {
            // A dish that already appears on a ticket cannot vanish; hide it.
            return CLOUD.patchItem(id, { hidden: true });
        }
        return true;
    };

    CLOUD.saveCategory = async function (cat) {
        const res = await client.from('categories').upsert({
            id: cat.id, name_ar: cat.ar, name_en: cat.en,
            note_ar: (cat.note && cat.note.ar) || '', note_en: (cat.note && cat.note.en) || '',
            img_url: cat.img || null, hidden: !!cat.hidden, sort: cat.sort || 0
        });
        return res.error ? fail('saving the category', res.error) : true;
    };

    CLOUD.deleteCategory = async function (id) {
        const res = await client.from('categories').delete().eq('id', id);
        if (res.error) return CLOUD.saveCategoryPatch(id, { hidden: true });
        return true;
    };

    CLOUD.saveCategoryPatch = async function (id, patch) {
        const res = await client.from('categories').update(patch).eq('id', id);
        return res.error ? fail('saving the category', res.error) : true;
    };

    /** Order columns are cheap to rewrite in bulk; do it in one round trip. */
    CLOUD.setSort = async function (table, ids) {
        const updates = ids.map((id, i) => client.from(table).update({ sort: i }).eq('id', id));
        const results = await Promise.all(updates);
        const bad = results.find((r) => r.error);
        return bad ? fail('reordering', bad.error) : true;
    };

    /** End of service. Idempotent by design: it only archives and clears
        sessions opened before the restaurant's local midnight, so the floor
        console can call it on every boot without thinking about it. */
    CLOUD.endDay = async function () {
        const res = await client.rpc('end_day');
        return res.error ? fail('closing the day', res.error) : res.data;
    };

    /* ---------------------------------------------------------------------
       Figures for the dashboard — read from receipts, not from the floor,
       which is why they survive a table being cleared.
       ------------------------------------------------------------------ */
    CLOUD.stats = async function () {
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);

        const [days, top7, top30, today] = await Promise.all([
            client.from('v_stats_daily').select('*').limit(31),
            client.rpc('top_dishes', { p_days: 7 }),
            client.rpc('top_dishes', { p_days: 30 }),
            client.from('receipts').select('total, orders_count, guests')
                  .gte('closed_at', midnight.toISOString())
        ]);

        const closed = today.data || [];
        return {
            days: days.data || [],
            top7: top7.data || [],
            top30: top30.data || [],
            today: {
                tables: closed.length,
                revenue: closed.reduce((s, r) => s + Number(r.total), 0),
                orders: closed.reduce((s, r) => s + r.orders_count, 0),
                guests: closed.reduce((s, r) => s + r.guests, 0)
            }
        };
    };

    /* ---------------------------------------------------------------------
       Images
       ------------------------------------------------------------------ */
    CLOUD.uploadImage = async function (file, name) {
        const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        const path = (name || 'dish') + '-' + Date.now().toString(36) + '.' + ext;

        const res = await client.storage.from('menu').upload(path, file, {
            cacheControl: '31536000', upsert: false, contentType: file.type
        });
        if (res.error) return fail('uploading the photo', res.error);

        return client.storage.from('menu').getPublicUrl(path).data.publicUrl;
    };

    /* ---------------------------------------------------------------------
       Realtime — one channel, every table the interfaces care about
       ------------------------------------------------------------------ */
    let channel = null;

    CLOUD.listen = function (onChange) {
        if (channel) return channel;

        let timer = null;
        const hit = () => {
            clearTimeout(timer);
            timer = setTimeout(onChange, 180);      // a ticket writes two tables at once
        };

        channel = client.channel('operix-floor');
        ['settings', 'categories', 'items', 'tables', 'sessions',
         'orders', 'order_items', 'service_calls', 'bills', 'activity_log'
        ].forEach((table) => {
            channel.on('postgres_changes', { event: '*', schema: 'public', table: table }, hit);
        });

        channel.subscribe((status) => {
            CLOUD.realtime = status;
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                fail('realtime', { message: status });
            }
        });
        return channel;
    };

    global.CLOUD = CLOUD;

})(window);
