/* =========================================================================
   Operix Restaurant System — floor console (waiter + cashier)
   -------------------------------------------------------------------------
   One screen for the person carrying the plates: everything the tables ask
   for arrives here. It is deliberately a single device role — in most
   restaurants the waiter and the cashier are the same person on the same
   tablet, so there is no second app to switch to.

   Four views: the order board, the alert queue, the table map, payments.
   All of them read OPS and re-render whole; changes are rare enough (a few
   a minute) that diffing would only add bugs.
   ========================================================================= */
(function () {
    'use strict';

    const $ = CUI.$, $$ = CUI.$$, esc = CUI.esc, t = CUI.t, L = CUI.L, money = CUI.money;

    const VIEWS = [
        { id: 'orders', icon: 'receipt', label: 'tabOrders' },
        { id: 'alerts', icon: 'bell', label: 'tabAlerts' },
        { id: 'tables', icon: 'tableIcon', label: 'tabTables' },
        { id: 'bills', icon: 'cash', label: 'tabBills' }
    ];

    let view = 'orders';
    let known = { order: {}, call: {}, bill: {} };   // id → first seen, drives the "fresh" flash

    /* ---------------------------------------------------------------------
       Small shared bits
       ------------------------------------------------------------------ */
    const orderTotal = (o) => (o.lines || []).reduce((s, l) => s + l.price * l.qty, 0);

    const statusName = (idx) => {
        const st = ORDER_STATUSES[idx];
        return st ? L({ en: st.en, ar: st.ar }) : '';
    };

    const TONES = {
        new: 'var(--hot)',
        kitchen: 'var(--warn)',
        ready: 'var(--ok)',
        done: 'var(--text-3)',
        bill: 'var(--cool)'
    };

    /** Which board column a ticket belongs in. */
    function columnOf(order) {
        if (order.status === -1 || order.status === 4) return 'done';
        if (order.status === 3) return 'ready';
        if (order.status === 1 || order.status === 2) return 'kitchen';
        // Untouched: the flow decides whether it waits for a human.
        return OPS.config().flow === 'approval' ? 'new' : 'kitchen';
    }

    const isFresh = (kind, id) => {
        const at = known[kind][id];
        return at != null && Date.now() - at < 12000;
    };

    /** Remember what has already been on screen, and announce what has not. */
    function noticeNew() {
        const s = OPS.state();
        let loudest = null;

        const scan = (kind, list, label) => {
            list.forEach((row) => {
                if (known[kind][row.id] === undefined) {
                    // First paint of the session must not fire a wall of chimes.
                    known[kind][row.id] = booted ? Date.now() : 0;
                    if (booted) loudest = { kind: kind, row: row, label: label };
                }
            });
        };

        scan('order', s.orders, 'alertOrder');
        scan('call', OPS.openCalls(), 'alertWaiter');
        scan('bill', OPS.openBills(), 'alertBill');

        if (loudest) {
            const table = loudest.row.table;
            CUI.chime(loudest.kind !== 'order');
            CUI.toast(t('table') + ' ' + table + ' — ' + t(loudest.label),
                loudest.kind === 'call' ? 'bell' : loudest.kind === 'bill' ? 'receipt' : 'receipt');
        }
    }

    /* ---------------------------------------------------------------------
       Tabs
       ------------------------------------------------------------------ */
    function renderSeg() {
        const counts = {
            orders: OPS.liveOrders().length,
            alerts: OPS.openCalls().length + OPS.openBills().length,
            tables: Object.keys(OPS.state().tables).length,
            bills: OPS.openBills().length
        };

        $('#seg').innerHTML = VIEWS.map((v) => `
            <button class="seg__btn ${view === v.id ? 'active' : ''}" type="button" data-view="${v.id}">
                ${icon(v.icon)}<span>${esc(t(v.label))}</span>
                <span class="seg__count ${counts[v.id] && (v.id === 'alerts' || v.id === 'bills') ? 'hot' : ''}">${counts[v.id]}</span>
            </button>`).join('');
    }

    /* ---------------------------------------------------------------------
       View 1 — the order board
       ------------------------------------------------------------------ */
    function ticketHtml(order) {
        const col = columnOf(order);
        const tone = TONES[col];
        const idx = order.status == null ? 0 : order.status;
        const flow = OPS.config().flow;

        let actions = '';
        if (order.status === -1) {
            actions = `<span class="muted" style="font-size:.78rem">${esc(t('rejected'))}</span>`;
        } else if (order.status == null && flow === 'approval') {
            actions = `
                <button class="c-btn" type="button" data-act="edit" data-id="${order.id}">${icon('pencil')}</button>
                <button class="c-btn" type="button" data-act="reject" data-id="${order.id}">${esc(t('reject'))}</button>
                <button class="c-btn c-btn--gold" type="button" data-act="status" data-status="1" data-id="${order.id}">
                    ${icon('send')}<span>${esc(t('accept'))}</span>
                </button>`;
        } else if (order.status == null || order.status === 1) {
            actions = `
                <button class="c-btn" type="button" data-act="edit" data-id="${order.id}">${icon('pencil')}</button>
                <button class="c-btn c-btn--gold" type="button" data-act="status" data-status="2" data-id="${order.id}">
                    ${icon('flame')}<span>${esc(t('startCooking'))}</span>
                </button>`;
        } else if (order.status === 2) {
            actions = `<button class="c-btn c-btn--gold" type="button" data-act="status" data-status="3" data-id="${order.id}">
                    ${icon('bell')}<span>${esc(t('markReady'))}</span>
                </button>`;
        } else if (order.status === 3) {
            actions = `<button class="c-btn c-btn--gold" type="button" data-act="status" data-status="4" data-id="${order.id}">
                    ${icon('utensils')}<span>${esc(t('markServed'))}</span>
                </button>`;
        }

        const stateLine = order.status == null
            ? (flow === 'approval' ? t('waitingApproval') : t('autoSent'))
            : statusName(idx);

        return `
            <article class="tk ${isFresh('order', order.id) ? 'tk--fresh' : ''}" style="--tone:${tone}">
                <header class="tk__head">
                    <span class="tk__table">${esc(t('tableShort'))}<b>${order.table || '—'}</b></span>
                    <span class="tk__code">#${esc(order.code || '')}</span>
                    ${order.manual ? `<span class="tk__code" style="color:var(--gold-ink)">${icon('pencil')} ${esc(t('manualBadge'))}</span>` : ''}
                    <span class="tk__age" data-age="${order.at || order.placedAt}">${esc(CUI.timeAgo(order.at || order.placedAt))}</span>
                </header>

                <ul class="tk__lines">
                    ${(order.lines || []).map((l) => `
                        <li>
                            <span class="tk__qty">${l.qty}×</span>
                            <span>
                                ${esc(L(l.name))}
                                ${l.optsText ? `<em class="tk__opts">${esc(l.optsText)}</em>` : ''}
                                ${l.note ? `<em class="tk__opts">${icon('note')} ${esc(l.note)}</em>` : ''}
                            </span>
                            <span class="tk__price">${money(l.price * l.qty)}</span>
                        </li>`).join('')}
                </ul>

                ${order.note ? `<p class="tk__note">${icon('info')}<span>${esc(order.note)}</span></p>` : ''}
                ${order.edited ? `<div class="tk__state">${icon('pencil')}${esc(t('editTicket'))}</div>` : ''}
                <div class="tk__state">${icon('clock')}${esc(stateLine)}</div>

                <footer class="tk__foot">
                    <span class="tk__total">${money(orderTotal(order))}</span>
                    <span class="tk__actions">${actions}</span>
                </footer>
            </article>`;
    }

    function renderOrders() {
        const s = OPS.state();
        const today = new Date().setHours(0, 0, 0, 0);
        const orders = s.orders.filter((o) => (o.at || o.placedAt) >= today);

        const cols = [
            { id: 'new', label: 'colNew' },
            { id: 'kitchen', label: 'colKitchen' },
            { id: 'ready', label: 'colReady' },
            { id: 'done', label: 'colDone' }
        ].filter((c) => c.id !== 'new' || OPS.config().flow === 'approval');

        return `<div class="board">` + cols.map((col) => {
            const list = orders.filter((o) => columnOf(o) === col.id)
                .sort((a, b) => (b.at || 0) - (a.at || 0));
            return `
                <section class="col" style="--tone:${TONES[col.id]}">
                    <header class="col__head">
                        <span class="col__dot"></span>
                        <span class="col__name">${esc(t(col.label))}</span>
                        <span class="col__count">${list.length}</span>
                    </header>
                    <div class="col__list">
                        ${list.length ? list.map(ticketHtml).join('')
                            : `<div class="c-empty">${icon('plate')}<span>${esc(t('none'))}</span></div>`}
                    </div>
                </section>`;
        }).join('') + `</div>`;
    }

    /* ---------------------------------------------------------------------
       View 2 — alerts
       ------------------------------------------------------------------ */
    function alertRow(opts) {
        const late = CUI.minutesSince(opts.at) > 2;
        return `
            <article class="alert ${opts.live ? 'alert--live' : ''}" style="--tone:${opts.tone}">
                <span class="alert__icon">${icon(opts.icon)}</span>
                <div class="alert__body">
                    <div class="alert__title">${esc(t('table'))} <b>${opts.table}</b> — ${esc(opts.title)}</div>
                    <div class="alert__sub">
                        <span class="alert__age ${late ? 'late' : ''}" data-age="${opts.at}">${esc(CUI.timeAgo(opts.at))}</span>
                        ${opts.sub ? `<span>·</span><span>${esc(opts.sub)}</span>` : ''}
                    </div>
                </div>
                ${opts.action || ''}
            </article>`;
    }

    function billLabel(bill) {
        return bill.method === 'card' ? t('alertCard')
            : bill.method === 'split' ? t('alertSplit')
            : t('alertCash');
    }

    /** Every service the guest could have tapped, including ones the owner
        added and ones they have since switched off — an open call must still
        say what it was for. */
    const servicePool = () =>
        (window.__OPS_SERVICES || SERVICE_REASONS).concat(OPS.config().extraServices || []);

    function renderAlerts() {
        const calls = OPS.openCalls().map((c) => {
            const reason = servicePool().find((r) => r.id === c.reason);
            return {
                at: c.at, sort: c.at, live: true, tone: TONES.new, icon: reason ? reason.icon : 'bell',
                // The reason is the headline — "bring the bill" is not the
                // same job as "I have a question", and the waiter picks up
                // what to carry over from one glance.
                table: c.table, title: reason ? L(reason) : t('alertWaiter'), sub: t('alertWaiter'),
                action: `<button class="c-btn c-btn--gold" type="button" data-act="call-done" data-id="${c.id}">
                            ${icon('check')}<span>${esc(t('handled'))}</span></button>`
            };
        });

        const bills = OPS.openBills().map((b) => ({
            at: b.at, sort: b.at, live: true, tone: TONES.bill,
            icon: b.method === 'card' ? 'card' : b.method === 'split' ? 'split' : 'cash',
            table: b.table, title: billLabel(b),
            sub: (b.amount ? money(b.amount) + ' · ' : '') + (b.method === 'card' ? t('takeReader') : t('bringChange')),
            action: `<button class="c-btn c-btn--gold" type="button" data-act="bill-paid" data-id="${b.id}">
                        ${icon('check')}<span>${esc(t('markPaid'))}</span></button>`
        }));

        const fresh = OPS.state().orders
            .filter((o) => o.status == null && OPS.config().flow === 'approval')
            .map((o) => ({
                at: o.at, sort: o.at, tone: TONES.kitchen, icon: 'receipt',
                table: o.table, title: t('alertOrder'),
                sub: (o.lines || []).length + ' ' + t('dishes') + ' · ' + money(orderTotal(o)),
                action: `<button class="c-btn" type="button" data-act="goto" data-view="orders">
                            ${esc(t('tabOrders'))}${icon('chevronRight')}</button>`
            }));

        const all = calls.concat(bills, fresh).sort((a, b) => b.sort - a.sort);

        if (!all.length) {
            return `<div class="panel"><div class="c-empty">${icon('bell')}<span>${esc(t('none'))}</span></div></div>`;
        }
        return `<div class="alerts">${all.map(alertRow).join('')}</div>`;
    }

    /* ---------------------------------------------------------------------
       View 3 — the table map
       ------------------------------------------------------------------ */
    function tableState(num) {
        if (OPS.openCalls().some((c) => c.table === num)) return 'calling';
        if (OPS.openBills().some((b) => b.table === num)) return 'bill';
        if (OPS.liveOrders().some((o) => o.table === num)) return 'cooking';
        if (OPS.state().tables[num]) return 'seated';
        return 'free';
    }

    const STATE_META = {
        calling: { tone: TONES.new, label: 'calling', flag: 'bell' },
        bill: { tone: TONES.bill, label: 'billOpen', flag: 'receipt' },
        cooking: { tone: TONES.kitchen, label: 'cooking', flag: 'flame' },
        seated: { tone: 'var(--gold-ink)', label: 'seated', flag: 'users' },
        free: { tone: 'var(--text-3)', label: 'free', flag: '' }
    };

    function renderTables() {
        const count = OPS.config().tables;
        let html = `<div class="tables">`;
        for (let n = 1; n <= count; n++) {
            const st = tableState(n);
            const meta = STATE_META[st];
            const seat = OPS.state().tables[n];
            const spend = OPS.tableOrders(n)
                .filter((o) => o.status !== -1)
                .reduce((s, o) => s + orderTotal(o), 0);

            html += `
                <button class="tcard" type="button" data-act="table" data-table="${n}"
                        data-state="${st}" style="--tone:${meta.tone}">
                    ${meta.flag ? `<span class="tcard__flag">${icon(meta.flag)}</span>` : ''}
                    <span class="tcard__num">${n}</span>
                    <span class="tcard__state">${esc(t(meta.label))}</span>
                    <span class="tcard__meta">${seat ? esc(seat.guests + ' ' + t('guestsShort')) : ''}${spend ? ' · ' + money(spend) : ''}</span>
                </button>`;
        }
        return html + `</div>`;
    }

    /* A table is not only opened by a QR scan: guests walk in, sit down and
       order out loud. The waiter seats the table here and takes the order on
       their behalf, so the floor console stays the truth for every table. */
    let seatDraft = 2;

    function openTableSheet(num) {
        const orders = OPS.tableOrders(num).filter((o) => o.status !== -1);
        const seat = OPS.state().tables[num];
        const total = orders.reduce((s, o) => s + orderTotal(o), 0);
        const service = total * OPS.config().brand.servicePct;
        seatDraft = seat ? seat.guests : 2;

        const body = `
            <div class="panel" style="margin-bottom:1rem">
                <div class="srow">
                    <span class="srow__ic">${icon('users')}</span>
                    <span class="srow__body">
                        <span class="srow__name">${esc(t('guests'))}</span>
                        <span class="srow__sub">${esc(seat ? t('seated') + ' · ' + t('seatedSince') + ' ' + CUI.clockText(seat.since) : t('free'))}</span>
                    </span>
                    <span class="stepper">
                        <button type="button" data-act="seat-guests" data-table="${num}" data-d="-1" aria-label="-">${icon('minus')}</button>
                        <span class="stepper__value" id="seatGuests">${seatDraft}</span>
                        <button type="button" data-act="seat-guests" data-table="${num}" data-d="1" aria-label="+">${icon('plus')}</button>
                    </span>
                </div>
                <div class="srow">
                    <span class="srow__ic">${icon('receipt')}</span>
                    <span class="srow__body">
                        <span class="srow__name">${esc(t('tableTotal'))}</span>
                        <span class="srow__sub">${orders.length} ${esc(t('ticketFor'))}</span>
                    </span>
                    <span class="tk__total">${money(total + service)}</span>
                </div>
            </div>

            ${orders.length
                ? orders.slice().reverse().map(ticketHtml).join('')
                : `<div class="c-empty">${icon('plate')}<span>${esc(t('none'))}</span></div>`}`;

        const foot = `
            ${seat
                ? `<button class="btn btn--ghost" type="button" data-act="close-table" data-table="${num}">
                        ${icon('reset')}<span>${esc(t('closeTable'))}</span>
                   </button>`
                : `<button class="btn btn--ghost" type="button" data-act="seat-table" data-table="${num}">
                        ${icon('users')}<span>${esc(t('seatTable'))}</span>
                   </button>`}
            <button class="btn btn--gold" type="button" data-act="manual" data-table="${num}">
                ${icon('plus')}<span>${esc(t('manualOrder'))}</span>
            </button>`;

        CUI.openModal('modal', t('table') + ' ' + num, body, foot);
    }

    /* ---------------------------------------------------------------------
       Manual order builder — the waiter's own pad
       ------------------------------------------------------------------ */
    let builder = null;

    function openBuilder(table) {
        builder = { table: table, qty: {}, cat: 'all', query: '' };

        const body = `
            <p class="panel__sub" style="margin-bottom:.9rem">${esc(t('manualHint'))}</p>

            <input class="field__input" id="bSearch" placeholder="${esc(t('search'))}" autocomplete="off">

            <nav class="seg" id="bCats" style="margin:.7rem 0">
                ${CATEGORIES.map((cat) => `
                    <button class="seg__btn ${cat.id === 'all' ? 'active' : ''}" type="button"
                            data-act="b-cat" data-cat="${cat.id}">${esc(L(cat))}</button>`).join('')}
            </nav>

            <div id="bList"></div>

            <label class="field">
                <span class="field__label">${icon('note')}<span>${esc(t('noteForKitchen'))}</span></span>
                <input class="field__input" id="bNote" placeholder="${esc(t('allergyForOrderPh'))}">
            </label>`;

        const foot = `
            <button class="btn btn--ghost" type="button" data-act="close-modal">${esc(t('cancel'))}</button>
            <button class="btn btn--gold" type="button" data-act="b-send">
                ${icon('send')}<span>${esc(t('sendKitchen'))}</span><span id="bTotal"></span>
            </button>`;

        CUI.openModal('modal', t('manualOrder') + ' · ' + t('table') + ' ' + table, body, foot);
        paintBuilder();
    }

    const builderLines = () => Object.keys(builder.qty)
        .filter((id) => builder.qty[id] > 0)
        .map((id) => ({ item: MENU.find((m) => m.id === id), qty: builder.qty[id] }))
        .filter((row) => row.item);

    /** Only the list and the total repaint, so the search box keeps its caret. */
    function paintBuilder() {
        const q = builder.query.toLowerCase();
        const items = MENU.filter((item) =>
            (builder.cat === 'all' || item.cat === builder.cat) &&
            (!q || (L(item.name) + ' ' + item.name.en + ' ' + item.name.ar).toLowerCase().indexOf(q) !== -1));

        $('#bList').innerHTML = items.length ? items.map((item) => {
            const n = builder.qty[item.id] || 0;
            const off = item.available === false;
            return `
                <div class="erow ${off ? 'erow--off' : ''}" style="padding-inline:0">
                    <span class="erow__plate"><img src="${esc(item.img)}" alt=""></span>
                    <div class="erow__body">
                        <div class="erow__name">${esc(L(item.name))}</div>
                        <div class="erow__meta">
                            <span>${money(item.price)}</span>
                            ${off ? `<span style="color:var(--hot)">${esc(t('unavailable'))}</span>` : ''}
                        </div>
                    </div>
                    ${off ? '' : `
                        <span class="stepper">
                            <button type="button" data-act="b-qty" data-id="${item.id}" data-d="-1"
                                    ${n ? '' : 'disabled'} aria-label="-">${icon('minus')}</button>
                            <span class="stepper__value">${n}</span>
                            <button type="button" data-act="b-qty" data-id="${item.id}" data-d="1" aria-label="+">${icon('plus')}</button>
                        </span>`}
                </div>`;
        }).join('') : `<div class="c-empty">${icon('search')}<span>${esc(t('none'))}</span></div>`;

        const total = builderLines().reduce((s, row) => s + row.item.price * row.qty, 0);
        const label = $('#bTotal');
        if (label) label.textContent = total ? ' · ' + money(total) : '';
    }

    function sendBuilder() {
        const rows = builderLines();
        if (!rows.length) { CUI.toast(t('emptyTicket'), 'info'); return; }

        const id = OPS.uid();
        known.order[id] = 0;              // our own ticket: no chime, no flash

        OPS.seat(builder.table, (OPS.state().tables[builder.table] || {}).guests || seatDraft);
        OPS.addOrder({
            id: id,
            table: builder.table,
            code: 'M' + (10 + Math.floor(Math.random() * 89)),
            placedAt: Date.now(),
            note: ($('#bNote') || {}).value || '',
            manual: true,
            // The waiter took it in person, so it never waits for approval.
            status: 1,
            accepted: true,
            lines: rows.map((row) => ({
                id: row.item.id, qty: row.qty, price: row.item.price,
                name: Object.assign({}, row.item.name), img: row.item.img,
                optsText: '', note: ''
            }))
        });

        CUI.closeModal('modal');
        CUI.toast(t('sendToKitchen') + ' · ' + t('table') + ' ' + builder.table, 'send');
        view = 'orders';
        render();
    }

    /* ---------------------------------------------------------------------
       View 4 — payments
       ------------------------------------------------------------------ */
    function renderBills() {
        const open = OPS.openBills();
        const today = new Date().setHours(0, 0, 0, 0);
        const settled = OPS.state().bills.filter((b) => b.status === 'settled' && b.at >= today);

        const openHtml = open.length
            ? `<div class="alerts">${open.map((b) => alertRow({
                at: b.at, live: true, tone: TONES.bill, table: b.table,
                icon: b.method === 'card' ? 'card' : b.method === 'split' ? 'split' : 'cash',
                title: billLabel(b),
                sub: (b.amount ? money(b.amount) : '') + (b.tip ? ' · ' + t('tip') + ' ' + b.tip + '%' : ''),
                action: `<button class="c-btn c-btn--gold" type="button" data-act="bill-paid" data-id="${b.id}">
                            ${icon('check')}<span>${esc(t('markPaid'))}</span></button>`
            })).join('')}</div>`
            : `<div class="panel"><div class="c-empty">${icon('cash')}<span>${esc(t('none'))}</span></div></div>`;

        const settledHtml = settled.length ? `
            <div class="panel" style="margin-top:1rem">
                <div class="panel__head"><h2 class="panel__title">${esc(t('paid'))}</h2>
                    <span class="panel__sub" style="margin-inline-start:auto">${settled.length}</span></div>
                <div class="panel__body panel__body--flush">
                    ${settled.slice().reverse().map((b) => `
                        <div class="feed__row" style="--tone:var(--ok)">
                            <span class="feed__ic">${icon('check')}</span>
                            <span>${esc(t('table'))} ${b.table} · ${esc(billLabel(b))}${b.amount ? ' · ' + money(b.amount) : ''}</span>
                            <span class="feed__time">${esc(CUI.clockText(b.settledAt || b.at))}</span>
                        </div>`).join('')}
                </div>
            </div>` : '';

        return openHtml + settledHtml;
    }

    /* ---------------------------------------------------------------------
       Ticket editor — the cashier trims a ticket before the kitchen sees it
       ------------------------------------------------------------------ */
    let editing = null;

    function openEditor(id) {
        const order = OPS.orderById(id);
        if (!order) return;
        editing = { id: id, lines: (order.lines || []).map((l) => Object.assign({}, l)) };
        paintEditor();
    }

    function paintEditor() {
        const body = editing.lines.map((l, i) => `
            <div class="edit-line ${l.qty === 0 ? 'gone' : ''}">
                <span class="tk__qty">${l.qty}×</span>
                <span class="edit-line__name">${esc(L(l.name))}${l.optsText ? `<em class="tk__opts">${esc(l.optsText)}</em>` : ''}</span>
                <span class="tk__price">${money(l.price * l.qty)}</span>
                <span class="erow__tools">
                    <button class="icon-mini" type="button" data-act="line" data-i="${i}" data-d="-1">${icon('minus')}</button>
                    <button class="icon-mini" type="button" data-act="line" data-i="${i}" data-d="1">${icon('plus')}</button>
                </span>
            </div>`).join('');

        const total = editing.lines.reduce((s, l) => s + l.price * l.qty, 0);

        CUI.openModal('modal', t('editTicket'),
            body + `<div class="tk__foot" style="margin-top:1rem">
                        <span class="muted">${esc(t('total'))}</span>
                        <span class="tk__total" style="margin-inline-start:auto">${money(total)}</span>
                    </div>`,
            `<button class="btn btn--ghost" type="button" data-act="close-modal">${esc(t('cancel'))}</button>
             <button class="btn btn--gold" type="button" data-act="save-lines">${icon('check')}<span>${esc(t('save'))}</span></button>`);
    }

    /* ---------------------------------------------------------------------
       Demo generator — lets the console be shown without a second device
       ------------------------------------------------------------------ */
    function demoEvent() {
        const table = 1 + Math.floor(Math.random() * Math.min(OPS.config().tables, 12));
        const roll = Math.random();

        const services = SERVICE_REASONS.length ? SERVICE_REASONS : servicePool();
        if (roll < 0.35 && services.length) {
            const reason = services[Math.floor(Math.random() * services.length)];
            OPS.addCall({ table: table, reason: reason.id });
            return;
        }

        if (roll < 0.5) {
            const methods = ['cash', 'card', 'split'];
            OPS.addBill({
                table: table,
                method: methods[Math.floor(Math.random() * methods.length)],
                tip: 0,
                amount: Math.round((18 + Math.random() * 60) * 100) / 100
            });
            return;
        }

        const lines = [];
        const picks = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < picks; i++) {
            const item = MENU[Math.floor(Math.random() * MENU.length)];
            if (!item || lines.some((l) => l.id === item.id)) continue;
            lines.push({
                id: item.id, qty: 1 + Math.floor(Math.random() * 2), price: item.price,
                name: Object.assign({}, item.name), img: item.img, optsText: '', note: ''
            });
        }
        if (!lines.length) return;

        OPS.addOrder({
            table: table,
            code: String.fromCharCode(65 + Math.floor(Math.random() * 6)) + (10 + Math.floor(Math.random() * 89)),
            placedAt: Date.now(),
            lines: lines,
            note: ''
        });
    }

    /* ---------------------------------------------------------------------
       Render + events
       ------------------------------------------------------------------ */
    let booted = false;

    function render() {
        renderSeg();
        const host = $('#view');
        if (view === 'orders') host.innerHTML = renderOrders();
        else if (view === 'alerts') host.innerHTML = renderAlerts();
        else if (view === 'tables') host.innerHTML = renderTables();
        else host.innerHTML = renderBills();
    }

    /** Ages tick on their own so a live screen never re-renders for a clock. */
    function tickAges() {
        $$('[data-age]').forEach((node) => {
            const at = Number(node.dataset.age);
            node.textContent = CUI.timeAgo(at);
            node.classList.toggle('late', CUI.minutesSince(at) > 2);
        });
    }

    document.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-view]');
        const act = e.target.closest('[data-act]');

        if (tab && !act) {
            view = tab.dataset.view;
            render();
            return;
        }

        if (e.target.closest('.modal-close') || e.target.classList.contains('cmodal')) {
            CUI.closeModal('modal');
            return;
        }

        if (!act) return;
        const id = act.dataset.id;

        switch (act.dataset.act) {
            case 'status':
                OPS.setOrderStatus(id, Number(act.dataset.status));
                CUI.toast(statusName(Number(act.dataset.status)), ORDER_STATUSES[Number(act.dataset.status)].icon);
                break;

            case 'reject':
                if (confirm(t('confirmQ'))) OPS.rejectOrder(id, '');
                break;

            case 'edit':
                openEditor(id);
                break;

            case 'line': {
                const line = editing.lines[Number(act.dataset.i)];
                line.qty = Math.max(0, Math.min(30, line.qty + Number(act.dataset.d)));
                paintEditor();
                break;
            }

            case 'save-lines':
                OPS.editOrderLines(editing.id, editing.lines.filter((l) => l.qty > 0));
                CUI.closeModal('modal');
                CUI.toast(t('saved'), 'check');
                break;

            case 'call-done':
                OPS.resolveCall(id, 'done');
                break;

            case 'bill-paid':
                OPS.settleBill(id);
                CUI.toast(t('paid'), 'check');
                break;

            case 'table':
                openTableSheet(Number(act.dataset.table));
                break;

            case 'seat-guests': {
                seatDraft = Math.max(1, Math.min(20, seatDraft + Number(act.dataset.d)));
                const label = $('#seatGuests');
                if (label) label.textContent = seatDraft;
                // A seated table takes the change straight away; a free one
                // waits for the waiter to actually open it.
                if (OPS.state().tables[act.dataset.table]) OPS.seat(Number(act.dataset.table), seatDraft);
                break;
            }

            case 'seat-table': {
                const num = Number(act.dataset.table);
                OPS.seat(num, seatDraft);
                CUI.toast(t('table') + ' ' + num + ' — ' + t('seated'), 'users');
                openTableSheet(num);
                break;
            }

            case 'manual':
                openBuilder(Number(act.dataset.table));
                break;

            case 'b-cat':
                builder.cat = act.dataset.cat;
                $$('#bCats .seg__btn').forEach((b) => b.classList.toggle('active', b.dataset.cat === builder.cat));
                paintBuilder();
                break;

            case 'b-qty': {
                const at = act.dataset.id;
                builder.qty[at] = Math.max(0, Math.min(30, (builder.qty[at] || 0) + Number(act.dataset.d)));
                paintBuilder();
                break;
            }

            case 'b-send':
                sendBuilder();
                break;

            case 'close-table':
                if (confirm(t('clearConfirm'))) {
                    OPS.clearTable(Number(act.dataset.table));
                    CUI.closeModal('modal');
                }
                break;

            case 'goto':
                view = act.dataset.view;
                render();
                break;

            case 'close-modal':
                CUI.closeModal('modal');
                break;
        }
    });

    /* ---------------------------------------------------------------------
       Boot
       ------------------------------------------------------------------ */
    document.addEventListener('DOMContentLoaded', () => {
        hydrateIcons();
        CUI.bindChrome(render);

        $('#brandName').textContent = OPS.config().brand.name;
        $('#demoBtn').innerHTML = icon('sparkle');
        $('#demoBtn').addEventListener('click', demoEvent);

        noticeNew();          // seed: everything already on the floor is "known"
        booted = true;
        render();

        OPS.subscribe(() => {
            noticeNew();
            render();
        });

        // Tell the guest app a human is watching, so it stops simulating.
        OPS.markStaffOnline();
        setInterval(() => OPS.markStaffOnline(), 12000);
        setInterval(tickAges, 1000);

        // Search inside the manual order pad, without repainting the field.
        document.addEventListener('input', (e) => {
            if (e.target.id !== 'bSearch' || !builder) return;
            builder.query = e.target.value.trim();
            // Typing searches the whole menu — a waiter in a hurry should not
            // hit an empty list because a category tab was still selected.
            if (builder.query && builder.cat !== 'all') {
                builder.cat = 'all';
                $$('#bCats .seg__btn').forEach((b) => b.classList.toggle('active', b.dataset.cat === 'all'));
            }
            paintBuilder();
        });
    });

})();
