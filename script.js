/* =========================================================================
   Lumière — Digital Menu (dine-in)
   Behaviour layer. Plain global script so the site runs from file:// too.

   Models a full table session: scan → seat → build order → send to kitchen
   → watch it cook → call the waiter → ask for the bill. There is no backend,
   so kitchen progress and waiter arrival are simulated on a clock; every
   simulated bit is marked SIMULATED so it is obvious what to replace.
   ========================================================================= */
(function () {
    'use strict';

    /* ---------------------------------------------------------------------
       Storage (wrapped — file:// and private mode can both throw)
       ------------------------------------------------------------------ */
    const KEY = {
        theme: 'lum.theme', lang: 'lum.lang',
        cart: 'lum.cart', favs: 'lum.favs', session: 'lum.session'
    };

    const store = {
        get(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                return raw === null ? fallback : JSON.parse(raw);
            } catch (e) {
                return fallback;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
            } catch (e) { /* storage unavailable — session-only state is fine */ }
        }
    };

    /* SIMULATED — seconds after sending at which each status is reached.
       Real deployments would receive these from the kitchen display system. */
    const STATUS_AT = [0, 4, 12, 55, 85];
    const WAITER_ARRIVES_AFTER = 18;   // SIMULATED — seconds until a call clears

    const newSession = () => ({
        table: null, guests: 2, since: Date.now(),
        browsing: false, orders: [], calls: [], bill: null
    });

    const state = {
        lang: store.get(KEY.lang, 'en'),
        theme: store.get(KEY.theme, 'dark'),
        cart: store.get(KEY.cart, []),
        favs: store.get(KEY.favs, []),
        session: Object.assign(newSession(), store.get(KEY.session, {})),
        cat: 'all',
        query: ''
    };

    /* ---------------------------------------------------------------------
       Helpers
       ------------------------------------------------------------------ */
    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

    const t = (key) => (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key;
    const L = (obj) => (obj ? (obj[state.lang] || obj.en || '') : '');
    const money = (n) => RESTAURANT.currency + (Math.round(n * 100) / 100);
    const byId = (id) => MENU.find((m) => m.id === id);
    /* Orders, calls and bills carry this id into the database, so it has to
       be a UUID; cart line ids share the generator for simplicity. */
    const uid = () => (window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : Math.random().toString(36).slice(2, 9) + Date.now().toString(36));

    const esc = (str) => String(str).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

    const clock = (ts) => new Date(ts).toLocaleTimeString(
        state.lang === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' }
    );

    const sinceText = (ts) => {
        const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
        if (mins < 60) return mins + ' ' + t('minutesShort');
        return Math.floor(mins / 60) + 'h ' + (mins % 60) + ' ' + t('minutesShort');
    };

    const plate = (item, cls) =>
        `<div class="plate ${cls || ''}"><img src="${item.img}" alt="${esc(L(item.name))}" loading="lazy"></div>`;

    const tagChip = (key) => {
        const tag = TAGS[key];
        if (!tag) return '';
        return `<span class="chip ${tag.hero ? 'chip--hero' : ''}">${icon(tag.icon)}${esc(L(tag))}</span>`;
    };

    const heartIcon = (on) => icon('heart', on ? 'ic--fill' : '');

    /* Percentage is derived, never written into the translations — the label
       and the arithmetic can then never disagree. */
    const serviceLabel = () => t('service') + ' (' + Math.round(RESTAURANT.servicePct * 100) + '%)';

    /* ---------------------------------------------------------------------
       Theme + language
       ------------------------------------------------------------------ */
    function applyTheme() {
        document.documentElement.dataset.theme = state.theme;
        const btn = $('#themeBtn');
        if (btn) {
            const dark = state.theme === 'dark';
            btn.innerHTML = icon(dark ? 'moon' : 'sun');
            btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
        }
    }

    function applyLang() {
        const rtl = state.lang === 'ar';
        document.documentElement.lang = state.lang;
        document.documentElement.dir = rtl ? 'rtl' : 'ltr';

        const btn = $('#langBtn');
        if (btn) {
            btn.textContent = rtl ? 'EN' : 'ع';
            btn.setAttribute('aria-label', rtl ? 'Switch to English' : 'التبديل إلى العربية');
        }

        $$('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
        $$('[data-i18n-ph]').forEach((n) => { n.placeholder = t(n.dataset.i18nPh); });
        $$('[data-i18n-label]').forEach((n) => { n.setAttribute('aria-label', t(n.dataset.i18nLabel)); });
    }

    /* ---------------------------------------------------------------------
       Toasts
       ------------------------------------------------------------------ */
    function toast(message, iconName) {
        const host = $('#toasts');
        if (!host) return;
        const node = document.createElement('div');
        node.className = 'toast';
        node.setAttribute('role', 'status');
        node.innerHTML = icon(iconName || 'check') + `<span>${esc(message)}</span>`;
        host.appendChild(node);
        setTimeout(() => {
            node.classList.add('out');
            node.addEventListener('animationend', () => node.remove(), { once: true });
        }, 2600);
    }

    /* ---------------------------------------------------------------------
       Session
       ------------------------------------------------------------------ */
    const saveSession = () => store.set(KEY.session, state.session);
    const hasTable = () => state.session.table !== null;

    function setTable(num, guests) {
        state.session.table = num;
        if (guests) state.session.guests = guests;
        state.session.browsing = false;
        if (!state.session.since) state.session.since = Date.now();
        saveSession();
        if (window.OPS) OPS.seat(num, state.session.guests);
        paintTableChips();
    }

    function endSession() {
        if (window.OPS && hasTable()) OPS.clearTable(state.session.table);
        state.session = newSession();
        state.cart = [];
        saveSession();
        store.set(KEY.cart, state.cart);
        paintTableChips();
        renderCart();
        renderTracker();
        closeSheets();
        toast(t('endSession'), 'reset');
        setTimeout(openTableModal, 300);
    }

    /** A QR code can carry the table: ?table=12 — consume it and clean the URL. */
    function readTableFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const raw = params.get('table');
        if (!raw) return false;

        const num = parseInt(raw, 10);
        if (!isNaN(num) && num >= 1 && num <= RESTAURANT.tables) setTable(num);

        params.delete('table');
        const qs = params.toString();
        history.replaceState(null, '', qs ? '?' + qs : window.location.pathname);
        return hasTable();
    }

    function paintTableChips() {
        $$('.table-chip').forEach((chip) => {
            if (hasTable()) {
                chip.hidden = false;
                chip.innerHTML = icon('tableIcon') +
                    `<span>${esc(t('table'))} ${state.session.table}</span>`;
            } else {
                chip.hidden = false;
                chip.innerHTML = icon('qr') + `<span>${esc(t('whichTable'))}</span>`;
            }
        });
    }

    /* ---------------------------------------------------------------------
       Cart lines
       ------------------------------------------------------------------ */
    /** Two lines merge only when dish, options and note all match. */
    const lineSignature = (line) =>
        line.id + '|' + JSON.stringify(line.opts || {}) + '|' + (line.note || '').trim().toLowerCase();

    function linePrice(line) {
        const item = byId(line.id);
        if (!item) return 0;
        let price = item.price;
        (item.options || []).forEach((group) => {
            const picked = line.opts ? line.opts[group.id] : null;
            if (picked === undefined || picked === null) return;
            const ids = Array.isArray(picked) ? picked : [picked];
            ids.forEach((cid) => {
                const choice = group.choices.find((c) => c.id === cid);
                if (choice) price += choice.price || 0;
            });
        });
        return price;
    }

    /** "Medium rare · Truffle fries · + Fried egg" */
    function lineOptionsText(line) {
        const item = byId(line.id);
        if (!item || !item.options) return '';
        const parts = [];
        item.options.forEach((group) => {
            const picked = line.opts ? line.opts[group.id] : null;
            if (picked === undefined || picked === null) return;
            const ids = Array.isArray(picked) ? picked : [picked];
            ids.forEach((cid) => {
                const choice = group.choices.find((c) => c.id === cid);
                if (choice) parts.push((group.multi ? '+ ' : '') + L(choice.name));
            });
        });
        return parts.join(' · ');
    }

    const cartCount = () => state.cart.reduce((s, l) => s + l.qty, 0);
    const cartSubtotal = () => state.cart.reduce((s, l) => s + linePrice(l) * l.qty, 0);

    function saveCart() {
        store.set(KEY.cart, state.cart);
        renderCart();
    }

    const soldOut = (item) => !!item && item.available === false;

    function addLine(id, qty, opts, note) {
        const item = byId(id);
        if (!item) return;

        // The dashboard can pull a dish mid-service; nothing may be added
        // to a ticket after that, whatever page the guest is looking at.
        if (soldOut(item)) {
            toast(L(item.name) + ' — ' + t('unavailableSub'), 'info');
            return;
        }

        const line = { lineId: uid(), id: id, qty: qty || 1, opts: opts || {}, note: (note || '').trim() };
        const twin = state.cart.find((l) => lineSignature(l) === lineSignature(line));

        if (twin) twin.qty += line.qty;
        else state.cart.push(line);

        saveCart();
        bumpBadge();
        toast(L(item.name) + ' — ' + t('added'), 'basket');
    }

    function setLineQty(lineId, qty) {
        const line = state.cart.find((l) => l.lineId === lineId);
        if (!line) return;
        if (qty <= 0) state.cart = state.cart.filter((l) => l.lineId !== lineId);
        else line.qty = qty;
        saveCart();
    }

    function bumpBadge() {
        $$('.cart-btn__badge').forEach((badge) => {
            badge.classList.remove('bump');
            void badge.offsetWidth;
            badge.classList.add('bump');
        });
    }

    /* ---------------------------------------------------------------------
       Orders — the kitchen ticket
       ------------------------------------------------------------------ */
    const orderTotal = (order) => order.lines.reduce((s, l) => s + l.price * l.qty, 0);
    const tabSubtotal = () => state.session.orders.reduce((s, o) => s + orderTotal(o), 0);

    /** The ticket as the floor console sees it, if the system is loaded. */
    const opsOrder = (order) => (window.OPS && order.id ? OPS.orderById(order.id) : null);

    const isRejected = (order) => {
        const rec = opsOrder(order);
        return !!rec && rec.status === -1;
    };

    /** Real status when staff are driving; a simulated clock when nobody is.
        The demo has to feel alive on its own, but must never overrule a
        human who just tapped "ready" on the floor console. */
    function statusIndex(order) {
        const rec = opsOrder(order);
        if (rec && rec.status != null) return Math.max(0, rec.status);

        if (window.OPS) {
            // Waiting for the cashier to accept, or waiting for a staff tap.
            if (OPS.config().flow === 'approval' || OPS.staffOnline()) return 0;
        }

        const elapsed = (Date.now() - order.placedAt) / 1000;
        let idx = 0;
        STATUS_AT.forEach((at, i) => { if (elapsed >= at) idx = i; });
        return idx;
    }

    const activeOrders = () => state.session.orders.filter((o) => statusIndex(o) < ORDER_STATUSES.length - 1);

    function placeOrder(noteForKitchen) {
        if (!state.cart.length) return null;

        const order = {
            id: uid(),
            code: String.fromCharCode(65 + Math.floor(Math.random() * 6)) + (10 + Math.floor(Math.random() * 89)),
            placedAt: Date.now(),
            table: state.session.table,
            note: (noteForKitchen || '').trim(),
            // Snapshot name and price: the menu may change, the ticket must not.
            lines: state.cart.map((l) => ({
                id: l.id,
                qty: l.qty,
                price: linePrice(l),
                name: byId(l.id) ? Object.assign({}, byId(l.id).name) : { en: l.id, ar: l.id },
                img: byId(l.id) ? byId(l.id).img : '',
                optsText: lineOptionsText(l),
                note: l.note
            }))
        };

        state.session.orders.push(order);
        state.cart = [];
        saveSession();
        saveCart();

        // Hand the ticket to the rest of the system — the floor console
        // picks it up in the same second, on whatever device it runs on.
        if (window.OPS) {
            OPS.addOrder({
                id: order.id, table: order.table, code: order.code,
                placedAt: order.placedAt, note: order.note, lines: order.lines,
                guests: state.session.guests
            });
        }

        startTicker();
        return order;
    }

    /* ---------------------------------------------------------------------
       Waiter calls + bill
       ------------------------------------------------------------------ */
    const pendingCall = () => state.session.calls.find((c) => c.status === 'pending');

    function callWaiter(reasonId) {
        const reason = SERVICE_REASONS.find((r) => r.id === reasonId);
        if (!reason) return;

        if (pendingCall()) {   // one call at a time is plenty
            toast(t('callPending'), 'hourglass');
            return;
        }

        const call = { id: uid(), reason: reasonId, at: Date.now(), status: 'pending' };
        state.session.calls.push(call);
        saveSession();

        if (window.OPS) OPS.addCall({ id: call.id, table: state.session.table, reason: reasonId });

        startTicker();
        renderTracker();
        toast(t('waiterComing') + ' ' + state.session.table, 'bell');
    }

    function cancelCall() {
        const call = pendingCall();
        if (!call) return;
        call.status = 'cancelled';
        saveSession();
        if (window.OPS) OPS.resolveCall(call.id, 'cancelled');
        renderTracker();
        toast(t('callCancelled'), 'x');
    }

    function requestBill(method, tipPct) {
        const sub = tabSubtotal();
        const amount = sub * (1 + RESTAURANT.servicePct) + sub * ((tipPct || 0) / 100);

        state.session.bill = { id: uid(), method: method, tip: tipPct || 0, at: Date.now(), status: 'requested' };
        saveSession();

        if (window.OPS) {
            OPS.addBill({
                id: state.session.bill.id, table: state.session.table,
                method: method, tip: tipPct || 0, amount: Math.round(amount * 100) / 100
            });
        }

        renderTracker();
        closeSheets();
        toast(t('billOnWay') + ' ' + state.session.table, 'receipt');
    }

    /* ---------------------------------------------------------------------
       Clock — advances simulated statuses and re-renders
       ------------------------------------------------------------------ */
    let ticker = null;

    function tick() {
        let changed = false;

        // SIMULATED — a waiter "arrives" and clears the call. Only while no
        // floor console is open; a real waiter clears their own calls.
        if (!(window.OPS && OPS.staffOnline())) {
            state.session.calls.forEach((call) => {
                if (call.status === 'pending' && (Date.now() - call.at) / 1000 >= WAITER_ARRIVES_AFTER) {
                    call.status = 'done';
                    if (window.OPS) OPS.resolveCall(call.id, 'done');
                    changed = true;
                }
            });
        }

        state.session.orders.forEach((order) => {
            const idx = statusIndex(order);
            if (order._shown !== idx) {
                if (order._shown !== undefined) {
                    toast(L({ en: ORDER_STATUSES[idx].en, ar: ORDER_STATUSES[idx].ar }) +
                          ' · ' + t('orderNo') + ' ' + order.code, ORDER_STATUSES[idx].icon);
                }
                order._shown = idx;
                changed = true;
            }
        });

        if (changed) { saveSession(); renderTracker(); renderTab(); }
        if (!activeOrders().length && !pendingCall()) stopTicker();
    }

    /* ---------------------------------------------------------------------
       Listening to the floor
       Staff actions land in OPS; this pulls them back into the guest's own
       session so the tracker, the tab and the toasts all agree with what
       the waiter just tapped.
       ------------------------------------------------------------------ */
    /** Everything a guest page paints from the menu, in one comparable string. */
    const menuStamp = () =>
        MENU.map((m) => m.id + ':' + m.price + ':' + (m.available === false ? 0 : 1) + ':' + L(m.name)).join('|') +
        '#' + CATEGORIES.map((c) => c.id + ':' + L(c)).join('|');

    /** `silent` is the first pass after a reload: catch up on everything that
        happened while the page was closed, without replaying its toasts. */
    function syncFromOps(silent) {
        const s = OPS.state();
        let changed = false;
        const say = (key, ic) => { if (!silent) toast(t(key), ic); };

        state.session.calls.forEach((call) => {
            const rec = s.calls.find((c) => c.id === call.id);
            if (rec && rec.status !== call.status) {
                call.status = rec.status;
                if (rec.status === 'done') say('waiterAck', 'check');
                changed = true;
            }
        });

        const bill = state.session.bill;
        if (bill && bill.id) {
            const rec = s.bills.find((b) => b.id === bill.id);
            if (rec && rec.status !== bill.status) {
                bill.status = rec.status;
                if (rec.status === 'settled') say('billSettled', 'check');
                changed = true;
            }
        }

        state.session.orders.forEach((order) => {
            if (isRejected(order) && !order._rejected) {
                order._rejected = true;
                say('orderRejected', 'info');
                changed = true;
            }

            // The cashier trimmed the ticket — the guest's copy of it, and
            // therefore the running total, has to follow.
            const rec = s.orders.find((o) => o.id === order.id);
            if (rec && rec.edited && order._editedAt !== rec.statusAt) {
                order._editedAt = rec.statusAt;
                order.lines = rec.lines;
                say('orderEdited', 'pencil');
                changed = true;
            }
        });

        if (changed) saveSession();
        renderTracker();
        renderTab();
        if (activeOrders().length || pendingCall()) startTicker();
    }

    function startTicker() {
        state.session.orders.forEach((o) => { if (o._shown === undefined) o._shown = statusIndex(o); });
        if (ticker) return;
        ticker = setInterval(tick, 1000);
    }

    function stopTicker() {
        if (!ticker) return;
        clearInterval(ticker);
        ticker = null;
    }

    /* ---------------------------------------------------------------------
       Sheets + modal plumbing
       ------------------------------------------------------------------ */
    const SHEETS = ['cartSheet', 'tabSheet', 'serviceSheet', 'billSheet', 'sessionSheet'];

    function closeSheets() {
        SHEETS.forEach((id) => $('#' + id) && $('#' + id).classList.remove('show'));
        $('#chat') && $('#chat').classList.remove('show');
        $('#scrim').classList.remove('show');
        $('#fabStack').classList.remove('hidden');
    }

    function openSheet(id) {
        closeSheets();
        const sheet = $('#' + id);
        if (!sheet) return;

        if (id === 'cartSheet') renderCart();
        if (id === 'tabSheet') renderTab();
        if (id === 'serviceSheet') renderService();
        if (id === 'billSheet') renderBill();
        if (id === 'sessionSheet') renderSessionSheet();

        sheet.classList.add('show');
        $('#scrim').classList.add('show');
        $('#fabStack').classList.add('hidden');
    }

    function openChat() {
        closeSheets();
        $('#chat').classList.add('show');
        $('#scrim').classList.add('show');
        $('#fabStack').classList.add('hidden');
    }

    /* ---------------------------------------------------------------------
       Table modal — the first thing after scanning the QR
       ------------------------------------------------------------------ */
    let padValue = '';

    function openTableModal() {
        padValue = hasTable() ? String(state.session.table) : '';
        renderTableModal();
        $('#tableModal').classList.add('show');
        $('#fabStack').classList.add('hidden');
    }

    function closeTableModal() {
        $('#tableModal').classList.remove('show');
        $('#fabStack').classList.remove('hidden');
    }

    function renderTableModal() {
        const max = RESTAURANT.tables;
        const num = parseInt(padValue, 10);
        const valid = !isNaN(num) && num >= 1 && num <= max;

        $('#tableModalBody').innerHTML = `
            <div class="welcome">
                <span class="eyebrow">${esc(t('welcome'))}</span>
                <h1 class="welcome__brand">${esc(RESTAURANT.name)}</h1>
                <div class="ornament" aria-hidden="true"><span></span></div>
                <p class="welcome__sub">${esc(t('welcomeSub'))}</p>
            </div>

            <div class="pad">
                <h2 class="pad__q">${esc(t('whichTable'))}</h2>
                <div class="pad__display ${padValue ? 'filled' : ''}">
                    ${padValue ? esc(padValue) : '—'}
                </div>
                <p class="pad__hint">${valid || !padValue
                    ? esc(t('tableHint'))
                    : `<span class="pad__err">${esc(t('invalidTable'))} ${max}</span>`}</p>

                <div class="pad__keys">
                    ${[1,2,3,4,5,6,7,8,9].map((n) => `<button class="pad__key" type="button" data-pad="${n}">${n}</button>`).join('')}
                    <button class="pad__key pad__key--ghost" type="button" data-pad="clear">C</button>
                    <button class="pad__key" type="button" data-pad="0">0</button>
                    <button class="pad__key pad__key--ghost" type="button" data-pad="back">${icon('arrowLeft')}</button>
                </div>

                <div class="pad__guests">
                    <span>${esc(t('howManyGuests'))}</span>
                    <div class="stepper">
                        <button type="button" data-guests="-1" aria-label="-">${icon('minus')}</button>
                        <span class="stepper__value">${state.session.guests}</span>
                        <button type="button" data-guests="1" aria-label="+">${icon('plus')}</button>
                    </div>
                </div>

                <button class="btn btn--gold btn--block" id="tableConfirm" type="button" ${valid ? '' : 'disabled'}>
                    ${icon('check')}<span>${esc(t('startOrdering'))}</span>
                </button>
                <button class="btn btn--plain btn--block" id="tableSkip" type="button">
                    ${esc(t('justBrowsing'))}
                </button>
            </div>`;
    }

    function bindTableModal() {
        $('#tableModalBody').addEventListener('click', (e) => {
            const key = e.target.closest('[data-pad]');
            const guest = e.target.closest('[data-guests]');

            if (key) {
                const v = key.dataset.pad;
                if (v === 'clear') padValue = '';
                else if (v === 'back') padValue = padValue.slice(0, -1);
                else if (padValue.length < 2) padValue += v;
                renderTableModal();
                return;
            }

            if (guest) {
                state.session.guests = Math.min(20, Math.max(1, state.session.guests + parseInt(guest.dataset.guests, 10)));
                saveSession();
                renderTableModal();
                return;
            }

            if (e.target.closest('#tableConfirm')) {
                const num = parseInt(padValue, 10);
                if (isNaN(num) || num < 1 || num > RESTAURANT.tables) return;
                setTable(num, state.session.guests);
                closeTableModal();
                toast(t('table') + ' ' + num + ' · ' + t('confirm'), 'tableIcon');
                return;
            }

            if (e.target.closest('#tableSkip')) {
                state.session.browsing = true;
                saveSession();
                closeTableModal();
            }
        });
    }

    /** Guard: anything that reaches the kitchen needs a table first. */
    function requireTable(then) {
        if (hasTable()) { then(); return; }
        toast(t('needTableSub'), 'tableIcon');
        openTableModal();
    }

    /* ---------------------------------------------------------------------
       Order review sheet (the cart)
       ------------------------------------------------------------------ */
    function renderCart() {
        const count = cartCount();
        $$('.cart-btn__badge').forEach((b) => {
            b.textContent = count;
            b.classList.toggle('show', count > 0);
        });

        const body = $('#cartBody');
        const foot = $('#cartFoot');
        if (!body || !foot) return;

        if (!state.cart.length) {
            body.innerHTML = `
                <div class="empty show" style="padding:2.5rem 1rem">
                    <div class="empty__icon">${icon('utensils')}</div>
                    <h3 class="empty__title">${esc(t('emptyCart'))}</h3>
                    <p class="empty__sub">${esc(t('emptyCartSub'))}</p>
                </div>`;
            foot.hidden = true;
            return;
        }

        foot.hidden = false;

        body.innerHTML = state.cart.map((line) => {
            const item = byId(line.id);
            if (!item) return '';
            const opts = lineOptionsText(line);
            return `
                <div class="line-item">
                    ${plate(item)}
                    <div class="line-item__body">
                        <div class="line-item__name">${esc(L(item.name))}</div>
                        ${opts ? `<div class="line-item__opts">${esc(opts)}</div>` : ''}
                        ${line.note ? `<div class="line-item__note">${icon('note')}${esc(line.note)}</div>` : ''}
                        <div class="line-item__price">${money(linePrice(line))} × ${line.qty} = <strong>${money(linePrice(line) * line.qty)}</strong></div>
                    </div>
                    <div class="stepper">
                        <button type="button" data-line-dec="${line.lineId}" aria-label="-">${icon(line.qty === 1 ? 'trash' : 'minus')}</button>
                        <span class="stepper__value">${line.qty}</span>
                        <button type="button" data-line-inc="${line.lineId}" aria-label="+">${icon('plus')}</button>
                    </div>
                </div>`;
        }).join('') + `
            <label class="field">
                <span class="field__label">${icon('note')}${esc(t('allergyForOrder'))}</span>
                <input class="field__input" id="orderNote" placeholder="${esc(t('allergyForOrderPh'))}">
            </label>`;

        const sub = cartSubtotal();
        const service = sub * RESTAURANT.servicePct;

        $('#cartTotals').innerHTML = `
            <div class="totals__row"><span>${esc(t('subtotal'))}</span><span>${money(sub)}</span></div>
            <div class="totals__row"><span>${esc(serviceLabel())}</span><span>${money(service)}</span></div>
            <div class="totals__row totals__row--grand"><span>${esc(t('total'))}</span><span>${money(sub + service)}</span></div>`;

        $('#cartSendLabel').textContent = hasTable()
            ? t('sendToKitchen') + ' · ' + t('table') + ' ' + state.session.table
            : t('sendToKitchen');
    }

    /* ---------------------------------------------------------------------
       Tab sheet — everything already sent, with live status
       ------------------------------------------------------------------ */
    function statusTimeline(order) {
        const idx = statusIndex(order);
        return `<ol class="timeline">` + ORDER_STATUSES.map((st, i) => `
            <li class="timeline__step ${i < idx ? 'done' : ''} ${i === idx ? 'now' : ''}">
                <span class="timeline__dot">${icon(i < idx ? 'check' : st.icon)}</span>
                <div>
                    <div class="timeline__name">${esc(L({ en: st.en, ar: st.ar }))}</div>
                    ${i === idx ? `<div class="timeline__sub">${esc(state.lang === 'ar' ? st.subAr : st.subEn)}</div>` : ''}
                </div>
            </li>`).join('') + `</ol>`;
    }

    function renderTab() {
        const body = $('#tabBody');
        const foot = $('#tabFoot');
        if (!body) return;

        if (!state.session.orders.length) {
            body.innerHTML = `
                <div class="empty show" style="padding:2.5rem 1rem">
                    <div class="empty__icon">${icon('receipt')}</div>
                    <h3 class="empty__title">${esc(t('tabEmpty'))}</h3>
                    <p class="empty__sub">${esc(t('tabEmptySub'))}</p>
                </div>`;
            foot.hidden = true;
            return;
        }

        foot.hidden = false;

        body.innerHTML = state.session.orders.slice().reverse().map((order) => `
            <article class="ticket">
                <header class="ticket__head">
                    <div>
                        <span class="ticket__code">${esc(t('orderNo'))} ${esc(order.code)}</span>
                        <span class="ticket__time">${esc(t('placedAt'))} ${clock(order.placedAt)}</span>
                    </div>
                    <span class="ticket__total">${money(orderTotal(order))}</span>
                </header>
                ${isRejected(order)
                    ? `<p class="ticket__note">${icon('info')}${esc(t('orderRejected'))} — ${esc(t('orderRejectedSub'))}</p>`
                    : statusTimeline(order)}
                <ul class="ticket__lines">
                    ${order.lines.map((l) => `
                        <li>
                            <span class="ticket__qty">${l.qty}×</span>
                            <span>
                                ${esc(L(l.name))}
                                ${l.optsText ? `<em class="ticket__opts">${esc(l.optsText)}</em>` : ''}
                                ${l.note ? `<em class="ticket__opts">${esc(t('noteLabel'))}: ${esc(l.note)}</em>` : ''}
                            </span>
                            <span class="ticket__price">${money(l.price * l.qty)}</span>
                        </li>`).join('')}
                </ul>
                ${order.note ? `<p class="ticket__note">${icon('info')}${esc(order.note)}</p>` : ''}
            </article>`).join('') +
            // Only true while nobody is driving from the floor console.
            (window.OPS && OPS.staffOnline() ? '' : `<p class="sim-note">${icon('info')}${esc(t('simulated'))}</p>`);

        const sub = tabSubtotal();
        const service = sub * RESTAURANT.servicePct;
        $('#tabTotals').innerHTML = `
            <div class="totals__row"><span>${esc(t('subtotal'))}</span><span>${money(sub)}</span></div>
            <div class="totals__row"><span>${esc(serviceLabel())}</span><span>${money(service)}</span></div>
            <div class="totals__row totals__row--grand"><span>${esc(t('runningTotal'))}</span><span>${money(sub + service)}</span></div>`;
    }

    /* ---------------------------------------------------------------------
       Service sheet
       ------------------------------------------------------------------ */
    function renderService() {
        const call = pendingCall();

        $('#serviceBody').innerHTML = `
            <p class="sheet__lead">${esc(t('serviceSub'))} ${hasTable()
                ? `<strong>${esc(t('table'))} ${state.session.table}</strong>` : ''}</p>

            ${call ? `
                <div class="call-live">
                    <span class="call-live__pulse">${icon('bell')}</span>
                    <div>
                        <div class="call-live__title">${esc(t('callPending'))}</div>
                        <div class="call-live__sub">${esc(t('waiterComing'))} ${state.session.table}</div>
                    </div>
                    <button class="btn btn--ghost btn--sm" id="cancelCallBtn" type="button">${esc(t('cancelCall'))}</button>
                </div>` : ''}

            <div class="reason-grid">
                ${SERVICE_REASONS.map((r) => `
                    <button class="reason" type="button" data-reason="${r.id}">
                        <span class="reason__icon">${icon(r.icon)}</span>
                        <span class="reason__label">${esc(L(r))}</span>
                    </button>`).join('')}
            </div>`;
    }

    /* ---------------------------------------------------------------------
       Bill sheet
       ------------------------------------------------------------------ */
    let tipPct = 0;

    function renderBill() {
        const body = $('#billBody');

        if (!state.session.orders.length) {
            body.innerHTML = `
                <div class="empty show" style="padding:2.5rem 1rem">
                    <div class="empty__icon">${icon('receipt')}</div>
                    <h3 class="empty__title">${esc(t('nothingToPay'))}</h3>
                    <p class="empty__sub">${esc(t('nothingToPaySub'))}</p>
                </div>`;
            return;
        }

        const sub = tabSubtotal();
        const service = sub * RESTAURANT.servicePct;
        const tip = sub * (tipPct / 100);

        body.innerHTML = `
            <div class="bill-lines">
                ${state.session.orders.map((o) => o.lines.map((l) => `
                    <div class="bill-line">
                        <span class="bill-line__qty">${l.qty}×</span>
                        <span class="bill-line__name">${esc(L(l.name))}</span>
                        <span class="bill-line__price">${money(l.price * l.qty)}</span>
                    </div>`).join('')).join('')}
            </div>

            <div class="totals">
                <div class="totals__row"><span>${esc(t('subtotal'))}</span><span>${money(sub)}</span></div>
                <div class="totals__row"><span>${esc(serviceLabel())}</span><span>${money(service)}</span></div>
                ${tip ? `<div class="totals__row"><span>${esc(t('tip'))}</span><span>${money(tip)}</span></div>` : ''}
                <div class="totals__row totals__row--grand"><span>${esc(t('grandTotal'))}</span><span>${money(sub + service + tip)}</span></div>
            </div>

            <div class="tip-row">
                <span class="field__label">${esc(t('tip'))}</span>
                <div class="tip-opts">
                    ${[0, 5, 10, 15].map((p) => `
                        <button class="tip-opt ${tipPct === p ? 'active' : ''}" type="button" data-tip="${p}">
                            ${p === 0 ? esc(t('noTip')) : p + '%'}
                        </button>`).join('')}
                </div>
            </div>

            <h3 class="field__label" style="margin-top:1.4rem">${esc(t('howToPay'))}</h3>
            <div class="pay-grid">
                ${[
                    { id: 'cash', ic: 'cash', name: 'payCash', sub: 'payCashSub' },
                    { id: 'card', ic: 'card', name: 'payCard', sub: 'payCardSub' },
                    { id: 'split', ic: 'split', name: 'paySplit', sub: 'paySplitSub' }
                ].filter((p) => !window.OPS || OPS.config().payments[p.id] !== false).map((p) => `
                    <button class="pay" type="button" data-pay="${p.id}">
                        <span class="pay__icon">${icon(p.ic)}</span>
                        <span><strong>${esc(t(p.name))}</strong><em>${esc(t(p.sub))}</em></span>
                    </button>`).join('')}
            </div>`;
    }

    /* ---------------------------------------------------------------------
       Session sheet
       ------------------------------------------------------------------ */
    function renderSessionSheet() {
        $('#sessionBody').innerHTML = `
            <div class="session-hero">
                <span class="session-hero__icon">${icon('tableIcon')}</span>
                <div class="session-hero__num">${hasTable() ? state.session.table : '—'}</div>
                <div class="session-hero__label">${esc(t('table'))}</div>
            </div>

            <div class="info-grid" style="margin-bottom:1.2rem">
                <div class="info-card">
                    <div class="info-card__icon">${icon('users')}</div>
                    <div>
                        <div class="info-card__label">${esc(t('guests'))}</div>
                        <div class="info-card__value">${state.session.guests}</div>
                    </div>
                </div>
                <div class="info-card">
                    <div class="info-card__icon">${icon('clock')}</div>
                    <div>
                        <div class="info-card__label">${esc(t('seatedSince'))}</div>
                        <div class="info-card__value">${sinceText(state.session.since)}</div>
                    </div>
                </div>
                <div class="info-card">
                    <div class="info-card__icon">${icon('receipt')}</div>
                    <div>
                        <div class="info-card__label">${esc(t('runningTotal'))}</div>
                        <div class="info-card__value">${money(tabSubtotal() * (1 + RESTAURANT.servicePct))}</div>
                    </div>
                </div>
            </div>

            <button class="btn btn--ghost btn--block" id="changeTableBtn" type="button">
                ${icon('pencil')}<span>${esc(t('changeTable'))}</span>
            </button>
            <button class="btn btn--plain btn--block" id="endSessionBtn" type="button">
                ${esc(t('endSession'))}
            </button>`;
    }

    /* ---------------------------------------------------------------------
       Tracker — the persistent strip along the bottom
       ------------------------------------------------------------------ */
    function renderTracker() {
        const bar = $('#tracker');
        if (!bar) return;

        // The detail page owns the bottom edge with its own add-to-order bar.
        if (document.body.classList.contains('page-detail')) { bar.classList.remove('show'); return; }

        const bill = state.session.bill;
        const call = pendingCall();
        const orders = activeOrders();

        let view = null;

        if (bill && bill.status === 'requested') {
            const label = bill.method === 'cash' ? t('payCash') : bill.method === 'card' ? t('payCard') : t('paySplit');
            view = { icon: 'receipt', title: t('billRequested'), sub: label + ' · ' + t('table') + ' ' + state.session.table, sheet: 'billSheet' };
        } else if (call) {
            const reason = SERVICE_REASONS.find((r) => r.id === call.reason);
            view = { icon: 'bell', title: t('callPending'), sub: reason ? L(reason) : '', sheet: 'serviceSheet', pulse: true };
        } else if (orders.length) {
            const order = orders[orders.length - 1];
            const st = ORDER_STATUSES[statusIndex(order)];
            view = {
                icon: st.icon,
                title: L({ en: st.en, ar: st.ar }) + ' · ' + t('orderNo') + ' ' + order.code,
                sub: state.lang === 'ar' ? st.subAr : st.subEn,
                sheet: 'tabSheet',
                pulse: true
            };
        }

        if (!view) { bar.classList.remove('show'); document.body.classList.remove('has-tracker'); return; }

        bar.dataset.sheet = view.sheet;
        bar.innerHTML = `
            <span class="tracker__icon ${view.pulse ? 'pulse' : ''}">${icon(view.icon)}</span>
            <span class="tracker__text">
                <strong>${esc(view.title)}</strong>
                <em>${esc(view.sub)}</em>
            </span>
            ${icon('chevronDown', 'tracker__chevron')}`;
        bar.classList.add('show');
        document.body.classList.add('has-tracker');
    }

    /* ---------------------------------------------------------------------
       Shared shell
       ------------------------------------------------------------------ */
    function sheet(id, titleKey, bodyId, extraHead) {
        return `
            <aside class="sheet" id="${id}" role="dialog" aria-modal="true">
                <div class="sheet__grip"></div>
                <div class="sheet__head">
                    <h2 class="sheet__title" data-i18n="${titleKey}"></h2>
                    <div style="display:flex;gap:.4rem">
                        ${extraHead || ''}
                        <button class="icon-btn sheet-close" type="button" aria-label="Close">${icon('x')}</button>
                    </div>
                </div>
                <div class="sheet__body" id="${bodyId}"></div>`;
    }

    function injectShell() {
        const shell = document.createElement('div');
        shell.innerHTML = `
            <div class="scrim" id="scrim"></div>

            <!-- Welcome / table picker -->
            <div class="modal" id="tableModal" role="dialog" aria-modal="true">
                <div class="modal__card" id="tableModalBody"></div>
            </div>

            <!-- Draft order -->
            ${sheet('cartSheet', 'reviewOrder', 'cartBody',
                `<button class="icon-btn" id="cartClearBtn" data-i18n-label="clearAll" type="button">${icon('reset')}</button>`)}
                <div class="sheet__foot" id="cartFoot" hidden>
                    <div class="totals" id="cartTotals"></div>
                    <button class="btn btn--gold btn--block" id="cartSendBtn" type="button">
                        ${icon('send')}<span id="cartSendLabel"></span>
                    </button>
                </div>
            </aside>

            <!-- Sent orders -->
            ${sheet('tabSheet', 'yourTab', 'tabBody')}
                <div class="sheet__foot" id="tabFoot" hidden>
                    <div class="totals" id="tabTotals"></div>
                    <div class="sheet__actions">
                        <a class="btn btn--ghost" href="menu.html">${icon('plus')}<span data-i18n="addMoreItems"></span></a>
                        <button class="btn btn--gold" id="tabBillBtn" type="button">${icon('receipt')}<span data-i18n="askForBill"></span></button>
                    </div>
                </div>
            </aside>

            <!-- Service -->
            ${sheet('serviceSheet', 'service', 'serviceBody')}</aside>

            <!-- Bill -->
            ${sheet('billSheet', 'bill', 'billBody')}</aside>

            <!-- Session -->
            ${sheet('sessionSheet', 'sessionTitle', 'sessionBody')}</aside>

            <!-- Sommelier -->
            <section class="chat" id="chat" role="dialog" aria-labelledby="chatTitle">
                <header class="chat__head">
                    <div class="chat__avatar">${icon('wine')}</div>
                    <div style="flex:1;min-width:0">
                        <div class="chat__name" id="chatTitle" data-i18n="chatTitle"></div>
                        <div class="chat__status"><span class="live-dot"></span> ${RESTAURANT.name}</div>
                    </div>
                    <button class="icon-btn" id="chatCloseBtn" type="button" aria-label="Close">${icon('x')}</button>
                </header>
                <div class="chat__body" id="chatBody"></div>
                <div class="chat__quick" id="chatQuick"></div>
                <form class="chat__foot" id="chatForm">
                    <input class="chat__input" id="chatInput" data-i18n-ph="chatPlaceholder" autocomplete="off">
                    <button class="chat__send" type="submit" aria-label="Send">${icon('send')}</button>
                </form>
            </section>

            <!-- Live status strip -->
            <button class="tracker" id="tracker" type="button"></button>

            <!-- Floating actions -->
            <div class="fab-stack" id="fabStack">
                <button class="fab fab--sm" id="chatFab" type="button" data-i18n-label="chatTitle">${icon('wine')}</button>
                <button class="fab" id="serviceFab" type="button" data-i18n-label="callWaiter">${icon('bell')}</button>
            </div>

            <div class="toasts" id="toasts" aria-live="polite"></div>`;

        while (shell.firstElementChild) document.body.appendChild(shell.firstElementChild);
    }

    /* ---------------------------------------------------------------------
       Chat
       ------------------------------------------------------------------ */
    function resetChat() {
        const body = $('#chatBody');
        if (!body) return;
        body.innerHTML = `<div class="bubble bubble--bot">${esc(t('chatHello'))}</div>`;
        $('#chatQuick').innerHTML = ['chatQ1', 'chatQ2', 'chatQ3']
            .map((k) => `<button class="quick" type="button">${esc(t(k))}</button>`).join('');
    }

    function chatSay(text, mine) {
        const body = $('#chatBody');
        const node = document.createElement('div');
        node.className = 'bubble ' + (mine ? 'bubble--me' : 'bubble--bot');
        node.textContent = text;
        body.appendChild(node);
        body.scrollTop = body.scrollHeight;
    }

    function chatAnswer(question) {
        const body = $('#chatBody');
        const q = question.toLowerCase();

        const typing = document.createElement('div');
        typing.className = 'typing';
        typing.innerHTML = '<i></i><i></i><i></i>';
        body.appendChild(typing);
        body.scrollTop = body.scrollHeight;

        const hit = CHAT_REPLIES.find((r) => r.match.some((m) => q.indexOf(m) !== -1));

        setTimeout(() => {
            typing.remove();
            chatSay(hit ? L(hit) : L(CHAT_FALLBACK), false);
            if (hit && hit.items) {
                const row = document.createElement('div');
                row.className = 'suggests';
                row.innerHTML = hit.items.map((id) => {
                    const item = byId(id);
                    if (!item) return '';
                    return `<a class="suggest" href="item-detail.html?id=${item.id}">
                                <img src="${item.img}" alt="">${esc(L(item.name))} · ${money(item.price)}
                            </a>`;
                }).join('');
                body.appendChild(row);
            }
            body.scrollTop = body.scrollHeight;
        }, 620);
    }

    /* ---------------------------------------------------------------------
       Wiring
       ------------------------------------------------------------------ */
    function bindShell() {
        $('#themeBtn')?.addEventListener('click', () => {
            state.theme = state.theme === 'dark' ? 'light' : 'dark';
            store.set(KEY.theme, state.theme);
            applyTheme();
        });

        $('#langBtn')?.addEventListener('click', () => {
            state.lang = state.lang === 'en' ? 'ar' : 'en';
            store.set(KEY.lang, state.lang);
            applyLang();
            paintTableChips();
            renderPage();
            renderCart();
            renderTracker();
            resetChat();
            if ($('#tableModal').classList.contains('show')) renderTableModal();
        });

        $$('.cart-btn').forEach((b) => b.addEventListener('click', () => openSheet('cartSheet')));
        $$('.table-chip').forEach((b) => b.addEventListener('click', () => {
            if (hasTable()) openSheet('sessionSheet'); else openTableModal();
        }));

        $('#scrim').addEventListener('click', closeSheets);
        $$('.sheet-close').forEach((b) => b.addEventListener('click', closeSheets));

        $('#tracker').addEventListener('click', (e) => openSheet(e.currentTarget.dataset.sheet || 'tabSheet'));
        $('#serviceFab').addEventListener('click', () => openSheet('serviceSheet'));
        $('#chatFab').addEventListener('click', openChat);
        $('#chatCloseBtn').addEventListener('click', closeSheets);

        /* --- draft order --- */
        $('#cartClearBtn').addEventListener('click', () => {
            if (!state.cart.length) return;
            state.cart = [];
            saveCart();
            toast(t('clearAll'), 'reset');
        });

        $('#cartBody').addEventListener('click', (e) => {
            const inc = e.target.closest('[data-line-inc]');
            const dec = e.target.closest('[data-line-dec]');
            if (inc) {
                const l = state.cart.find((x) => x.lineId === inc.dataset.lineInc);
                setLineQty(inc.dataset.lineInc, (l ? l.qty : 0) + 1);
            } else if (dec) {
                const l = state.cart.find((x) => x.lineId === dec.dataset.lineDec);
                setLineQty(dec.dataset.lineDec, (l ? l.qty : 0) - 1);
            }
        });

        $('#cartSendBtn').addEventListener('click', () => {
            if (!state.cart.length) return;
            requireTable(() => {
                const note = $('#orderNote') ? $('#orderNote').value : '';
                const order = placeOrder(note);
                if (!order) return;
                closeSheets();
                renderTracker();
                toast(t('orderPlaced') + ' · ' + t('orderNo') + ' ' + order.code, 'check');
                setTimeout(() => openSheet('tabSheet'), 700);
            });
        });

        /* --- tab --- */
        $('#tabBillBtn').addEventListener('click', () => openSheet('billSheet'));

        /* --- service --- */
        $('#serviceBody').addEventListener('click', (e) => {
            if (e.target.closest('#cancelCallBtn')) { cancelCall(); renderService(); return; }

            const btn = e.target.closest('[data-reason]');
            if (!btn) return;

            const reason = SERVICE_REASONS.find((r) => r.id === btn.dataset.reason);
            requireTable(() => {
                if (reason && reason.opensBill) { openSheet('billSheet'); return; }
                callWaiter(btn.dataset.reason);
                renderService();
            });
        });

        /* --- bill --- */
        $('#billBody').addEventListener('click', (e) => {
            const tipBtn = e.target.closest('[data-tip]');
            if (tipBtn) { tipPct = parseInt(tipBtn.dataset.tip, 10); renderBill(); return; }

            const payBtn = e.target.closest('[data-pay]');
            if (payBtn) requireTable(() => requestBill(payBtn.dataset.pay, tipPct));
        });

        /* --- session --- */
        $('#sessionBody').addEventListener('click', (e) => {
            if (e.target.closest('#changeTableBtn')) { closeSheets(); openTableModal(); }
            if (e.target.closest('#endSessionBtn')) {
                if (window.confirm(t('endSessionConfirm'))) endSession();
            }
        });

        /* --- chat --- */
        $('#chatForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const input = $('#chatInput');
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            chatSay(text, true);
            chatAnswer(text);
        });

        $('#chatQuick').addEventListener('click', (e) => {
            const btn = e.target.closest('.quick');
            if (!btn) return;
            chatSay(btn.textContent, true);
            chatAnswer(btn.textContent);
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { closeSheets(); closeTableModal(); }
        });

        bindTableModal();
    }

    /* ---------------------------------------------------------------------
       Scroll reveal
       ------------------------------------------------------------------ */
    let observer = null;

    function observeReveals(root) {
        if (!('IntersectionObserver' in window)) {
            $$('.reveal', root).forEach((n) => n.classList.add('in'));
            return;
        }
        if (!observer) {
            observer = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.add('in');
                    observer.unobserve(entry.target);
                });
            }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
        }
        $$('.reveal:not(.in)', root).forEach((node, i) => {
            node.style.transitionDelay = Math.min(i, 8) * 55 + 'ms';
            observer.observe(node);
        });
    }

    /* ---------------------------------------------------------------------
       Landing
       ------------------------------------------------------------------ */
    function renderLanding() {
        const title = $('#heroTitle');
        if (title) {
            title.innerHTML = RESTAURANT.name.split('').map((ch, i) =>
                `<span style="animation-delay:${180 + i * 65}ms">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`
            ).join('');
        }

        $('#heroTag').textContent = L(RESTAURANT.tagline);

        // The dashboard can swap the venue photo without touching the file.
        const heroImg = $('.hero__media img');
        if (heroImg && window.OPS && OPS.config().brand.hero) heroImg.src = OPS.config().brand.hero;

        const hour = new Date().getHours();
        const open = hour >= RESTAURANT.hours.open && hour < RESTAURANT.hours.close;
        const statusEl = $('#status');
        statusEl.classList.toggle('status--closed', !open);
        statusEl.innerHTML = `<span class="status__dot"></span>` + (open
            ? `${esc(t('openNow'))} · ${esc(t('until'))} ${RESTAURANT.hours.close}:00`
            : `${esc(t('closedNow'))} · ${esc(t('opensAt'))} ${RESTAURANT.hours.open}:00`);

        $('#catGrid').innerHTML = CATEGORIES.map((cat, i) => {
            const count = cat.id === 'all' ? MENU.length : MENU.filter((m) => m.cat === cat.id).length;
            const art = cat.id === 'all' ? MENU[4] : (MENU.find((m) => m.cat === cat.id) || MENU[0]);
            return `
                <a class="cat ${i === 0 ? 'cat--wide' : ''} reveal" href="menu.html?cat=${cat.id}">
                    <span class="halo cat__halo"></span>
                    <span class="cat__count">${count}</span>
                    ${plate(art, 'cat__plate')}
                    <h3 class="cat__name">${esc(L(cat))}</h3>
                    <p class="cat__note">${esc(L(cat.note))}</p>
                </a>`;
        }).join('');

        const picks = MENU.filter((m) => m.tags.indexOf('chef') !== -1 || m.tags.indexOf('new') !== -1);
        $('#picksRow').innerHTML = picks.map((item) => `
            <a class="pick" href="item-detail.html?id=${item.id}">
                ${plate(item)}
                <h3 class="pick__name">${esc(L(item.name))}</h3>
                <div class="pick__price">${money(item.price)}</div>
            </a>`).join('');

        $('#infoGrid').innerHTML = [
            { ic: 'clock', label: t('hours'), value: `${RESTAURANT.hours.open}:00 — ${RESTAURANT.hours.close}:00` },
            { ic: 'pin', label: t('find'), value: L(RESTAURANT.address) },
            { ic: 'wifi', label: t('wifi'), value: RESTAURANT.wifi }
        ].map((row) => `
            <div class="info-card reveal">
                <div class="info-card__icon">${icon(row.ic)}</div>
                <div>
                    <div class="info-card__label">${esc(row.label)}</div>
                    <div class="info-card__value">${esc(row.value)}</div>
                </div>
            </div>`).join('');

        $('#footerNote').textContent = t('allergyNote');
        observeReveals();
    }

    function bindLanding() {
        $('#landingSearch').addEventListener('submit', (e) => {
            e.preventDefault();
            const q = $('#landingSearchInput').value.trim();
            window.location.href = 'menu.html' + (q ? '?q=' + encodeURIComponent(q) : '');
        });
    }

    /* ---------------------------------------------------------------------
       Menu list
       ------------------------------------------------------------------ */
    function matches(item, query) {
        if (!query) return true;
        const q = query.toLowerCase();
        return [
            item.name.en, item.name.ar, item.desc.en, item.desc.ar,
            item.ingredients.map((i) => i.en + ' ' + i.ar).join(' '),
            item.tags.map((k) => (TAGS[k] ? TAGS[k].en + ' ' + TAGS[k].ar : '')).join(' ')
        ].join(' ').toLowerCase().indexOf(q) !== -1;
    }

    const visibleItems = () => MENU.filter((item) =>
        (state.cat === 'all' || item.cat === state.cat) && matches(item, state.query));

    function renderPills() {
        $('#rail').innerHTML = CATEGORIES.map((cat) => {
            const count = cat.id === 'all'
                ? MENU.filter((m) => matches(m, state.query)).length
                : MENU.filter((m) => m.cat === cat.id && matches(m, state.query)).length;
            return `<button class="pill ${state.cat === cat.id ? 'active' : ''}" type="button" data-cat="${cat.id}">
                        ${esc(L(cat))}<span class="pill__count">${count}</span>
                    </button>`;
        }).join('');
    }

    function renderList() {
        const items = visibleItems();
        const list = $('#menuList');

        $('#resultMeta').innerHTML = `<span>${items.length} ${esc(items.length === 1 ? t('oneResult') : t('results'))}</span>`;
        $('#emptyState').classList.toggle('show', items.length === 0);

        list.innerHTML = items.map((item) => `
            <article class="dish reveal ${soldOut(item) ? 'dish--off' : ''}">
                ${plate(item, 'dish__plate')}
                <div class="dish__body">
                    <div class="dish__line">
                        <h2 class="dish__name">
                            <a class="dish__link" href="item-detail.html?id=${item.id}">${esc(L(item.name))}</a>
                        </h2>
                        <span class="dish__leader"></span>
                        <span class="dish__price"><small>${RESTAURANT.currency}</small>${item.price}</span>
                    </div>
                    <p class="dish__desc">${esc(L(item.desc))}</p>
                    <div class="dish__meta">
                        ${soldOut(item)
                            ? `<span class="chip chip--off">${icon('info')}${esc(t('unavailable'))}</span>`
                            : `<span class="dish__rating">${icon('star', 'ic--fill')}${item.rating}</span>`}
                        ${item.tags.slice(0, 2).map(tagChip).join('')}
                        <span class="dish__actions">
                            <button class="fav ${isFav(item.id) ? 'on' : ''}" type="button" data-fav="${item.id}" aria-label="Favourite">
                                ${heartIcon(isFav(item.id))}
                            </button>
                            ${soldOut(item) ? '' : `
                            <button class="quick-add" type="button" data-add="${item.id}" aria-label="${esc(t('addToOrder'))}">
                                ${icon('plus')}
                            </button>`}
                        </span>
                    </div>
                </div>
            </article>`).join('');

        observeReveals(list);
    }

    const isFav = (id) => state.favs.indexOf(id) !== -1;

    function toggleFav(id, node) {
        if (isFav(id)) {
            state.favs = state.favs.filter((f) => f !== id);
            toast(t('favRemoved'), 'heartCrack');
        } else {
            state.favs.push(id);
            toast(t('favAdded'), 'heart');
        }
        store.set(KEY.favs, state.favs);
        if (node) {
            const on = isFav(id);
            node.classList.toggle('on', on);
            node.innerHTML = heartIcon(on);
            node.classList.remove('pop');
            void node.offsetWidth;
            node.classList.add('pop');
        }
    }

    function syncUrl() {
        const params = new URLSearchParams();
        if (state.cat !== 'all') params.set('cat', state.cat);
        if (state.query) params.set('q', state.query);
        const qs = params.toString();
        history.replaceState(null, '', qs ? '?' + qs : window.location.pathname);
    }

    function renderMenu() {
        const params = new URLSearchParams(window.location.search);
        const cat = params.get('cat');
        if (cat && CATEGORIES.some((c) => c.id === cat)) state.cat = cat;
        state.query = params.get('q') || '';

        const input = $('#menuSearchInput');
        input.value = state.query;
        if (state.query) {
            $('#headerSearch').classList.add('open');
            $('#searchClear').classList.add('show');
        }

        renderPills();
        renderList();

        $('#rail').addEventListener('click', (e) => {
            const pill = e.target.closest('.pill');
            if (!pill) return;
            state.cat = pill.dataset.cat;
            renderPills();
            renderList();
            syncUrl();
            pill.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        });

        let timer = null;
        input.addEventListener('input', () => {
            $('#searchClear').classList.toggle('show', input.value.length > 0);
            clearTimeout(timer);
            timer = setTimeout(() => {
                state.query = input.value.trim();
                renderPills();
                renderList();
                syncUrl();
            }, 160);
        });

        $('#searchToggle').addEventListener('click', () => {
            if ($('#headerSearch').classList.toggle('open')) setTimeout(() => input.focus(), 220);
        });

        $('#searchClear').addEventListener('click', () => {
            input.value = '';
            state.query = '';
            $('#searchClear').classList.remove('show');
            renderPills(); renderList(); syncUrl();
            input.focus();
        });

        $('#emptyReset').addEventListener('click', () => {
            input.value = '';
            state.query = ''; state.cat = 'all';
            $('#searchClear').classList.remove('show');
            renderPills(); renderList(); syncUrl();
        });

        $('#menuList').addEventListener('click', (e) => {
            const fav = e.target.closest('[data-fav]');
            const add = e.target.closest('[data-add]');
            if (fav) {
                e.preventDefault(); e.stopPropagation();
                toggleFav(fav.dataset.fav, fav);
            } else if (add) {
                e.preventDefault(); e.stopPropagation();
                const item = byId(add.dataset.add);
                // Dishes with required choices must be configured on their own page.
                if (item && item.options && item.options.some((g) => g.required)) {
                    window.location.href = 'item-detail.html?id=' + item.id;
                    return;
                }
                addLine(add.dataset.add, 1, {}, '');
            }
        });
    }

    /* ---------------------------------------------------------------------
       Detail page — options, note, add to order
       ------------------------------------------------------------------ */
    let detailQty = 1;
    let detailOpts = {};
    let detailItem = null;

    function optionGroupHtml(group) {
        const picked = detailOpts[group.id];
        return `
            <fieldset class="optgroup" data-group="${group.id}">
                <legend class="optgroup__head">
                    <span class="optgroup__name">${esc(L(group.name))}</span>
                    <span class="optgroup__badge ${group.required ? 'req' : ''}">
                        ${esc(group.required ? t('requiredOpt') : t('chooseAny'))}
                    </span>
                </legend>
                <div class="optgroup__list">
                    ${group.choices.map((choice) => {
                        const on = group.multi
                            ? Array.isArray(picked) && picked.indexOf(choice.id) !== -1
                            : picked === choice.id;
                        return `
                            <button class="opt ${on ? 'on' : ''}" type="button"
                                    data-opt="${group.id}" data-choice="${choice.id}">
                                <span class="opt__mark ${group.multi ? 'opt__mark--box' : ''}">${on ? icon('check', 'ic--fill') : ''}</span>
                                <span class="opt__name">${esc(L(choice.name))}</span>
                                ${choice.price ? `<span class="opt__price">+${money(choice.price)}</span>` : ''}
                            </button>`;
                    }).join('')}
                </div>
            </fieldset>`;
    }

    function paintAddBar() {
        if (!detailItem) return;
        const line = { id: detailItem.id, opts: detailOpts };
        $('#qtyValue').textContent = detailQty;

        // A dish pulled from the dashboard keeps its page, loses its button —
        // and its price, which would only read as an offer.
        const off = soldOut(detailItem);
        $('#addPrice').textContent = off ? '' : money(linePrice(line) * detailQty);

        const btn = $('#addBtn');
        if (btn) {
            btn.disabled = off;
            const label = btn.querySelector('[data-i18n="addToOrder"]');
            if (label) label.textContent = off ? t('unavailable') : t('addToOrder');
            const dot = btn.querySelector('[aria-hidden="true"]');
            if (dot) dot.hidden = off;
        }
    }

    function renderDetail() {
        const id = new URLSearchParams(window.location.search).get('id');
        const item = byId(id);
        const root = $('#detailRoot');
        detailItem = item;

        if (!item) {
            root.innerHTML = `
                <div class="container">
                    <div class="empty show">
                        <div class="empty__icon">${icon('plate')}</div>
                        <h1 class="empty__title">${esc(t('notFound'))}</h1>
                        <p class="empty__sub">${esc(t('notFoundSub'))}</p>
                        <a class="btn btn--gold" href="menu.html">${icon('arrowLeft')}${esc(t('backToMenu'))}</a>
                    </div>
                </div>`;
            $('#orderBar').classList.remove('show');
            return;
        }

        document.title = L(item.name) + ' · ' + RESTAURANT.name;
        const pairings = (item.pairings || []).map(byId).filter(Boolean);

        root.innerHTML = `
            <section class="detail-hero">
                <div class="detail-hero__bg"><img src="${item.img}" alt="" aria-hidden="true"></div>
                <div class="detail-hero__fade"></div>
                ${plate(item, 'detail-plate')}
                <h1 class="detail-title">${esc(L(item.name))}</h1>
                <div class="detail-price">${money(item.price)}</div>
                <div class="chip-row detail-tags">
                    ${soldOut(item)
                        ? `<span class="chip chip--off">${icon('info')}${esc(t('unavailable'))}</span>`
                        : `<span class="chip chip--hero">${icon('star', 'ic--fill')}${item.rating}</span>`}
                    ${item.tags.map(tagChip).join('')}
                </div>
            </section>

            <div class="container detail-body">
                <div class="stats">
                    <div class="stat">${icon('clock')}<span class="stat__value">${item.time}</span><span class="stat__label">${esc(t('min'))}</span></div>
                    <div class="stat">${icon('flame')}<span class="stat__value">${item.kcal}</span><span class="stat__label">${esc(t('kcal'))}</span></div>
                    <div class="stat">${icon('utensils')}<span class="stat__value">${item.serves}</span><span class="stat__label">${esc(t('serves'))}</span></div>
                </div>

                <section class="block reveal">
                    <h2 class="block__title">${esc(t('description'))}</h2>
                    <p class="prose">${esc(L(item.desc))}</p>
                </section>

                ${item.options ? `
                <section class="block reveal" id="optionsBlock">
                    ${item.options.map(optionGroupHtml).join('')}
                </section>` : ''}

                <section class="block reveal">
                    <label class="field">
                        <span class="field__label">${icon('note')}${esc(t('addNote'))}</span>
                        <input class="field__input" id="itemNote" placeholder="${esc(t('notePlaceholder'))}">
                    </label>
                </section>

                <section class="block reveal">
                    <h2 class="block__title">${esc(t('ingredients'))}</h2>
                    <ul class="ing-list">
                        ${item.ingredients.map((ing) => `
                            <li>${esc(L(ing))}${ing.allergen ? `<span class="allergen">${esc(L(ing.allergen))}</span>` : ''}</li>
                        `).join('')}
                    </ul>
                    <p class="allergy-note">${icon('info')}<span>${esc(t('allergyNote'))}</span></p>
                </section>

                ${pairings.length ? `
                <section class="block reveal">
                    <h2 class="block__title">${esc(t('pairsWith'))}</h2>
                    <div class="hscroll bleed">
                        ${pairings.map((p) => `
                            <a class="pair" href="item-detail.html?id=${p.id}">
                                ${plate(p)}
                                <div>
                                    <div class="pair__name">${esc(L(p.name))}</div>
                                    <div class="pair__price">${money(p.price)}</div>
                                </div>
                            </a>`).join('')}
                    </div>
                </section>` : ''}
            </div>`;

        const favBtn = $('#detailFav');
        const paintFav = () => {
            const on = isFav(item.id);
            favBtn.classList.toggle('on', on);
            favBtn.innerHTML = heartIcon(on);
        };
        paintFav();
        favBtn.onclick = () => toggleFav(item.id, favBtn);

        // Option picking
        root.addEventListener('click', (e) => {
            const opt = e.target.closest('[data-opt]');
            if (!opt) return;

            const group = (item.options || []).find((g) => g.id === opt.dataset.opt);
            if (!group) return;

            if (group.multi) {
                const list = Array.isArray(detailOpts[group.id]) ? detailOpts[group.id].slice() : [];
                const at = list.indexOf(opt.dataset.choice);
                if (at === -1) list.push(opt.dataset.choice); else list.splice(at, 1);
                detailOpts[group.id] = list;
            } else {
                detailOpts[group.id] = opt.dataset.choice;
            }

            $('#optionsBlock').innerHTML = item.options.map(optionGroupHtml).join('');
            paintAddBar();
        });

        detailQty = 1;
        detailOpts = {};
        paintAddBar();

        $('#qtyMinus').onclick = () => { detailQty = Math.max(1, detailQty - 1); paintAddBar(); };
        $('#qtyPlus').onclick = () => { detailQty = Math.min(20, detailQty + 1); paintAddBar(); };

        $('#addBtn').onclick = () => {
            // Every required group must be answered before this can go to a kitchen.
            const missing = (item.options || []).find((g) => g.required && !detailOpts[g.id]);
            if (missing) {
                const node = $(`[data-group="${missing.id}"]`);
                node.scrollIntoView({ block: 'center', behavior: 'smooth' });
                node.classList.remove('shake'); void node.offsetWidth; node.classList.add('shake');
                toast(t('selectRequired') + ' — ' + L(missing.name), 'info');
                return;
            }
            addLine(item.id, detailQty, detailOpts, $('#itemNote') ? $('#itemNote').value : '');
            detailQty = 1;
            detailOpts = {};
            if ($('#itemNote')) $('#itemNote').value = '';
            $('#optionsBlock') && ($('#optionsBlock').innerHTML = (item.options || []).map(optionGroupHtml).join(''));
            paintAddBar();
        };

        setTimeout(() => $('#orderBar').classList.add('show'), 260);
        observeReveals(root);
    }

    /* ---------------------------------------------------------------------
       Boot
       ------------------------------------------------------------------ */
    function renderPage() {
        const page = document.body.classList;
        if (page.contains('page-landing')) renderLanding();
        else if (page.contains('page-menu')) { renderPills(); renderList(); }
        else if (page.contains('page-detail')) renderDetail();
    }

    // OPS.ready fires at once on a local install, and after the first
    // snapshot lands when a database is behind it — so the guest never sees
    // a menu that is about to be replaced.
    document.addEventListener('DOMContentLoaded', () => OPS.ready(() => {
        hydrateIcons();
        applyTheme();
        injectShell();
        applyLang();
        bindShell();
        resetChat();

        readTableFromUrl();
        paintTableChips();
        renderCart();
        renderTracker();
        if (activeOrders().length || pendingCall()) startTicker();

        // The floor console, the dashboard and this page share one state.
        if (window.OPS) {
            // A dashboard edit has to reach an open guest page. Which change
            // arrived is not reliable — a poll and a broadcast can race — so
            // the menu is compared against its own last fingerprint instead.
            let stamp = menuStamp();
            syncFromOps(true);

            OPS.subscribe(() => {
                syncFromOps();
                const next = menuStamp();
                if (next !== stamp) {
                    stamp = next;
                    // The detail page rebinds its option handlers on render,
                    // so it stays put and picks the change up on navigation.
                    if (!document.body.classList.contains('page-detail')) renderPage();
                }
            });
        }

        const page = document.body.classList;
        if (page.contains('page-landing')) { renderLanding(); bindLanding(); }
        else if (page.contains('page-menu')) renderMenu();
        else if (page.contains('page-detail')) renderDetail();

        // First contact: ask where they are sitting.
        if (!hasTable() && !state.session.browsing) setTimeout(openTableModal, 420);
    }));
})();
