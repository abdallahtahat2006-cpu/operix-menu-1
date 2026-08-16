/* =========================================================================
   Operix Restaurant System — owner dashboard
   -------------------------------------------------------------------------
   Everything the restaurant controls without calling us: the menu, the
   tables and their QR codes, which services the guest may ask for, how
   orders reach the kitchen, and the restaurant's own details.

   Edits are stored as a patch on top of data.js rather than a rewrite of
   it, so the printed menu the client bought stays intact and any single
   change can be undone by dropping its patch.
   ========================================================================= */
(function () {
    'use strict';

    const $ = CUI.$, $$ = CUI.$$, esc = CUI.esc, t = CUI.t, L = CUI.L, money = CUI.money;

    const PANES = [
        { id: 'overview', icon: 'chartUp', label: 'navOverview' },
        { id: 'menu', icon: 'layers', label: 'navMenu' },
        { id: 'tables', icon: 'qr', label: 'navTables' },
        { id: 'services', icon: 'bell', label: 'navServices' },
        { id: 'orders', icon: 'sliders', label: 'navOrders' },
        { id: 'restaurant', icon: 'store', label: 'navRestaurant' }
    ];

    /* Photos that ship with the template; a client can upload their own. */
    const STOCK = ['assets/main.png', 'assets/breakfast.png', 'assets/drink.png', 'assets/venue.png'];

    let pane = 'overview';
    let editing = null;      // dish being edited in the modal

    /* ---------------------------------------------------------------------
       Reading the menu *including* what is hidden — the guest sees the
       filtered menu, the owner has to see everything to switch it back on.
       ------------------------------------------------------------------ */
    function withPatch(item, patch) {
        if (!patch) return Object.assign({}, item);
        const merged = Object.assign({}, item, patch);
        if (patch.name) merged.name = Object.assign({}, item.name, patch.name);
        if (patch.desc) merged.desc = Object.assign({}, item.desc, patch.desc);
        return merged;
    }

    function allDishes() {
        const s = OPS.state();
        const list = (window.__OPS_MENU || [])
            .concat(s.menu.custom || [])
            .map((item) => withPatch(item, s.menu.items[item.id]))
            .filter((item) => !item.deleted);

        const order = s.menu.order || [];
        if (order.length) {
            const rank = (id) => (order.indexOf(id) === -1 ? 999 : order.indexOf(id));
            list.sort((a, b) => rank(a.id) - rank(b.id));
        }
        return list;
    }

    function allCats() {
        const s = OPS.state();
        const list = (window.__OPS_CATS || [])
            .concat(s.menu.customCats || [])
            .filter((c) => c.id !== 'all')
            .map((c) => Object.assign({}, c, s.menu.cats[c.id]));

        const order = s.menu.catOrder || [];
        if (order.length) {
            const rank = (id) => (order.indexOf(id) === -1 ? 999 : order.indexOf(id));
            list.sort((a, b) => rank(a.id) - rank(b.id));
        }
        return list;
    }

    const isOn = (item) => item.available !== false && !item.hidden;

    /* ---------------------------------------------------------------------
       Nav
       ------------------------------------------------------------------ */
    function renderNav() {
        $('#nav').innerHTML = PANES.map((p) => `
            <button class="c-nav__btn ${pane === p.id ? 'active' : ''}" type="button" data-pane="${p.id}">
                ${icon(p.icon)}<span>${esc(t(p.label))}</span>
            </button>`).join('');
    }

    /* ---------------------------------------------------------------------
       Pane 1 — overview
       ------------------------------------------------------------------ */
    const orderTotal = (o) => (o.lines || []).reduce((s, l) => s + l.price * l.qty, 0);

    function renderOverview() {
        const s = OPS.state();
        const today = new Date().setHours(0, 0, 0, 0);
        const orders = s.orders.filter((o) => (o.at || o.placedAt) >= today && o.status !== -1);
        const revenue = orders.reduce((sum, o) => sum + orderTotal(o), 0);
        const tables = Object.keys(s.tables).length;

        const kpis = [
            { ic: 'receipt', label: 'kpiOrders', value: orders.length },
            { ic: 'coins', label: 'kpiRevenue', value: money(revenue) },
            { ic: 'tableIcon', label: 'kpiTables', value: tables },
            { ic: 'chartUp', label: 'kpiAvg', value: money(orders.length ? revenue / orders.length : 0) }
        ];

        /* Most ordered, all time — what the owner promotes next. */
        const tally = {};
        s.orders.forEach((o) => (o.lines || []).forEach((l) => {
            tally[l.id] = (tally[l.id] || 0) + l.qty;
        }));
        const top = Object.keys(tally)
            .map((id) => ({ id: id, n: tally[id] }))
            .sort((a, b) => b.n - a.n).slice(0, 5);
        const peak = top.length ? top[0].n : 1;
        const dishes = allDishes();

        const FEED_TONE = {
            order: 'var(--warn)', call: 'var(--hot)', bill: 'var(--cool)', table: 'var(--text-3)'
        };
        const FEED_IC = { order: 'receipt', call: 'bell', bill: 'cash', table: 'tableIcon' };

        return `
            <div class="c-head">
                <div>
                    <h1 class="c-title">${esc(t('navOverview'))}</h1>
                    <p class="c-sub">${esc(OPS.config().brand.name)}</p>
                </div>
            </div>

            <div class="kpis">
                ${kpis.map((k) => `
                    <div class="kpi">
                        <div class="kpi__label">${icon(k.ic)}<span>${esc(t(k.label))}</span></div>
                        <div class="kpi__value">${esc(String(k.value))}</div>
                    </div>`).join('')}
            </div>

            <div class="panel">
                <div class="panel__head"><h2 class="panel__title">${esc(t('topDishes'))}</h2></div>
                <div class="panel__body panel__body--flush">
                    ${top.length ? top.map((row, i) => {
                        const dish = dishes.find((d) => d.id === row.id);
                        return `
                            <div class="rank">
                                <span class="rank__no">${i + 1}</span>
                                <span style="min-width:9ch;font-size:.88rem">${esc(dish ? L(dish.name) : row.id)}</span>
                                <span class="rank__bar"><i style="width:${Math.round(row.n / peak * 100)}%"></i></span>
                                <span class="rank__n">${row.n}</span>
                            </div>`;
                    }).join('') : `<div class="c-empty">${icon('chartUp')}<span>${esc(t('noActivity'))}</span></div>`}
                </div>
            </div>

            <div class="panel">
                <div class="panel__head"><h2 class="panel__title">${esc(t('recent'))}</h2></div>
                <div class="panel__body panel__body--flush">
                    ${s.log.length ? s.log.slice(0, 12).map((row) => `
                        <div class="feed__row" style="--tone:${FEED_TONE[row.type] || 'var(--gold)'}">
                            <span class="feed__ic">${icon(FEED_IC[row.type] || 'info')}</span>
                            <span>${esc(L(row.text))}${row.table ? ' · ' + esc(t('table')) + ' ' + row.table : ''}</span>
                            <span class="feed__time">${esc(CUI.clockText(row.at))}</span>
                        </div>`).join('')
                        : `<div class="c-empty">${icon('info')}<span>${esc(t('noActivity'))}</span></div>`}
                </div>
            </div>`;
    }

    /* ---------------------------------------------------------------------
       Pane 2 — menu manager
       ------------------------------------------------------------------ */
    function renderMenu() {
        const cats = allCats();
        const dishes = allDishes();

        const catBlocks = cats.map((cat, ci) => {
            const rows = dishes.filter((d) => d.cat === cat.id);
            return `
                <div class="cat-head" ${cat.hidden ? 'style="opacity:.5"' : ''}>
                    <span>${esc(L(cat))}</span>
                    <span class="cat-head__count">${rows.length}</span>
                    <span class="erow__tools">
                        <button class="icon-mini" type="button" data-act="cat-move" data-id="${cat.id}" data-d="-1"
                                ${ci === 0 ? 'disabled' : ''} aria-label="${esc(t('moveUp'))}">${icon('arrowUp')}</button>
                        <button class="icon-mini" type="button" data-act="cat-move" data-id="${cat.id}" data-d="1"
                                ${ci === cats.length - 1 ? 'disabled' : ''} aria-label="${esc(t('moveDown'))}">${icon('arrowDown')}</button>
                        <button class="icon-mini" type="button" data-act="cat-hide" data-id="${cat.id}"
                                aria-label="${esc(t('hiddenLabel'))}">${icon(cat.hidden ? 'eyeOff' : 'eye')}</button>
                        <button class="icon-mini" type="button" data-act="cat-edit" data-id="${cat.id}"
                                aria-label="${esc(t('edit'))}">${icon('pencil')}</button>
                        <button class="icon-mini icon-mini--danger" type="button" data-act="cat-del" data-id="${cat.id}"
                                aria-label="${esc(t('del'))}">${icon('trash')}</button>
                    </span>
                </div>
                ${rows.map((item, i) => dishRow(item, i, rows.length)).join('') ||
                  `<div class="c-empty" style="padding:1.2rem">${icon('plate')}<span>${esc(t('none'))}</span></div>`}`;
        }).join('');

        return `
            <div class="c-head">
                <div>
                    <h1 class="c-title">${esc(t('navMenu'))}</h1>
                    <p class="c-sub">${dishes.length} ${esc(t('dishes'))} · ${cats.length} ${esc(t('categories'))}</p>
                </div>
                <div class="c-head__actions">
                    <button class="c-btn" type="button" data-act="cat-add">${icon('plus')}<span>${esc(t('addCategory'))}</span></button>
                    <button class="c-btn c-btn--gold" type="button" data-act="dish-add">${icon('plus')}<span>${esc(t('addDish'))}</span></button>
                </div>
            </div>

            <div class="panel">
                <div class="panel__body panel__body--flush">${catBlocks}</div>
            </div>`;
    }

    function dishRow(item, i, count) {
        const on = isOn(item);
        return `
            <div class="erow ${on ? '' : 'erow--off'}">
                <span class="erow__plate"><img src="${esc(item.img)}" alt=""></span>
                <div class="erow__body">
                    <div class="erow__name">${esc(L(item.name))}</div>
                    <div class="erow__meta">
                        <span>${esc(item.name.en)}</span>
                        ${item.hidden ? `<span style="color:var(--text-3)">${icon('eyeOff')} ${esc(t('hiddenLabel'))}</span>` : ''}
                        ${item.available === false ? `<span style="color:var(--hot)">${esc(t('unavailable'))}</span>` : ''}
                    </div>
                </div>
                <span class="erow__price">${money(item.price)}</span>
                <span class="erow__tools">
                    <button class="switch ${item.available === false ? '' : 'on'}" type="button"
                            data-act="dish-stock" data-id="${item.id}" aria-label="${esc(t('available'))}"></button>
                    <button class="icon-mini" type="button" data-act="dish-move" data-id="${item.id}" data-d="-1"
                            ${i === 0 ? 'disabled' : ''} aria-label="${esc(t('moveUp'))}">${icon('arrowUp')}</button>
                    <button class="icon-mini" type="button" data-act="dish-move" data-id="${item.id}" data-d="1"
                            ${i === count - 1 ? 'disabled' : ''} aria-label="${esc(t('moveDown'))}">${icon('arrowDown')}</button>
                    <button class="icon-mini" type="button" data-act="dish-hide" data-id="${item.id}"
                            aria-label="${esc(t('hiddenLabel'))}">${icon(item.hidden ? 'eyeOff' : 'eye')}</button>
                    <button class="icon-mini" type="button" data-act="dish-edit" data-id="${item.id}"
                            aria-label="${esc(t('edit'))}">${icon('pencil')}</button>
                    <button class="icon-mini icon-mini--danger" type="button" data-act="dish-del" data-id="${item.id}"
                            aria-label="${esc(t('del'))}">${icon('trash')}</button>
                </span>
            </div>`;
    }

    /* --- dish editor ---------------------------------------------------- */
    function openDishEditor(id) {
        const dishes = allDishes();
        const blank = {
            id: '', cat: (allCats()[0] || {}).id || 'mains', img: STOCK[0], price: 10,
            name: { en: '', ar: '' }, desc: { en: '', ar: '' },
            tags: [], time: 10, kcal: 0, serves: 1, rating: 5,
            ingredients: [], pairings: [], isNew: true
        };
        editing = id ? Object.assign({}, dishes.find((d) => d.id === id)) : blank;
        if (!editing) return;
        editing.tags = (editing.tags || []).slice();
        paintDishEditor();
    }

    function paintDishEditor() {
        const d = editing;
        const cats = allCats();
        const pics = STOCK.concat(STOCK.indexOf(d.img) === -1 && d.img ? [d.img] : []);

        const body = `
            <div class="field">
                <span class="field__label">${icon('image')}<span>${esc(t('image'))}</span></span>
                <div class="pics">
                    ${pics.map((src) => `
                        <button class="pic ${d.img === src ? 'on' : ''}" type="button" data-act="pic" data-src="${esc(src)}">
                            <img src="${esc(src)}" alt="">
                        </button>`).join('')}
                    <label class="pic pic--upload" title="${esc(t('uploadImage'))}">
                        ${icon('upload')}
                        <input type="file" accept="image/*" id="picFile" hidden>
                    </label>
                </div>
            </div>

            <div class="form-grid" style="margin-top:1rem">
                <label class="field">
                    <span class="field__label">${esc(t('nameAr'))}</span>
                    <input class="field__input" data-f="name.ar" value="${esc(d.name.ar || '')}" dir="rtl">
                </label>
                <label class="field">
                    <span class="field__label">${esc(t('nameEn'))}</span>
                    <input class="field__input" data-f="name.en" value="${esc(d.name.en || '')}" dir="ltr">
                </label>

                <label class="field field--wide">
                    <span class="field__label">${esc(t('descAr'))}</span>
                    <textarea class="field__input" data-f="desc.ar" dir="rtl">${esc(d.desc.ar || '')}</textarea>
                </label>
                <label class="field field--wide">
                    <span class="field__label">${esc(t('descEn'))}</span>
                    <textarea class="field__input" data-f="desc.en" dir="ltr">${esc(d.desc.en || '')}</textarea>
                </label>

                <label class="field">
                    <span class="field__label">${esc(t('price'))}</span>
                    <input class="field__input" type="number" min="0" step="0.5" data-f="price" value="${d.price}">
                </label>
                <label class="field">
                    <span class="field__label">${esc(t('category'))}</span>
                    <select class="field__input" data-f="cat">
                        ${cats.map((c) => `<option value="${c.id}" ${c.id === d.cat ? 'selected' : ''}>${esc(L(c))}</option>`).join('')}
                    </select>
                </label>
                <label class="field">
                    <span class="field__label">${esc(t('prepTime'))}</span>
                    <input class="field__input" type="number" min="0" data-f="time" value="${d.time || 0}">
                </label>
                <label class="field">
                    <span class="field__label">${esc(t('calories'))}</span>
                    <input class="field__input" type="number" min="0" data-f="kcal" value="${d.kcal || 0}">
                </label>
            </div>

            <div class="field" style="margin-top:1rem">
                <span class="field__label">${esc(t('tagsLabel'))}</span>
                <div class="tagpick">
                    ${Object.keys(TAGS).map((key) => `
                        <button class="${d.tags.indexOf(key) !== -1 ? 'on' : ''}" type="button" data-act="tag" data-tag="${key}">
                            ${icon(TAGS[key].icon)}<span>${esc(L(TAGS[key]))}</span>
                        </button>`).join('')}
                </div>
            </div>

            <div class="panel" style="margin-top:1.2rem">
                <button class="srow" type="button" data-act="edit-stock" style="width:100%">
                    <span class="srow__ic">${icon('check')}</span>
                    <span class="srow__body">
                        <span class="srow__name">${esc(t('available'))}</span>
                        <span class="srow__sub">${esc(t('unavailable'))} → ${esc(t('soldOut'))}</span>
                    </span>
                    <span class="switch ${d.available === false ? '' : 'on'}"></span>
                </button>
                <button class="srow" type="button" data-act="edit-hidden" style="width:100%">
                    <span class="srow__ic">${icon('eyeOff')}</span>
                    <span class="srow__body">
                        <span class="srow__name">${esc(t('hiddenLabel'))}</span>
                    </span>
                    <span class="switch ${d.hidden ? 'on' : ''}"></span>
                </button>
            </div>`;

        const foot = `
            <button class="btn btn--ghost" type="button" data-act="close-modal">${esc(t('cancel'))}</button>
            <button class="btn btn--gold" type="button" data-act="dish-save">${icon('check')}<span>${esc(t('save'))}</span></button>`;

        CUI.openModal('modal', editing.isNew ? t('addDish') : L(editing.name) || t('edit'), body, foot);
        bindDishFields();
    }

    /** Field edits write straight into `editing`; the modal never re-renders
        on keystroke, so the caret and the Arabic keyboard stay put. */
    function bindDishFields() {
        $$('[data-f]', $('#modal')).forEach((input) => {
            input.addEventListener('input', () => {
                const path = input.dataset.f.split('.');
                const value = input.type === 'number' ? Number(input.value) : input.value;
                if (path.length === 2) editing[path[0]][path[1]] = value;
                else editing[path[0]] = value;
            });
        });

        const file = $('#picFile');
        if (file) file.addEventListener('change', () => {
            const chosen = file.files && file.files[0];
            if (!chosen) return;
            shrink(chosen, (dataUrl) => {
                editing.img = dataUrl;
                paintDishEditor();
            });
        });
    }

    /** Photos go into localStorage, so they are resized before they land. */
    function shrink(file, done) {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const max = 480;
                const scale = Math.min(1, max / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                done(canvas.toDataURL('image/jpeg', 0.78));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    }

    const slug = (str) => String(str).toLowerCase().trim()
        .replace(/[^a-z0-9؀-ۿ]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'dish';

    function saveDish() {
        const d = editing;
        if (!d.name.ar && !d.name.en) { CUI.toast(t('nameAr'), 'info'); return; }
        if (!d.name.en) d.name.en = d.name.ar;
        if (!d.name.ar) d.name.ar = d.name.en;

        if (d.isNew) {
            delete d.isNew;
            d.id = slug(d.name.en) + '-' + Math.random().toString(36).slice(2, 5);
            OPS.addItem(d);
        } else {
            OPS.patchItem(d.id, {
                name: d.name, desc: d.desc, price: Number(d.price), cat: d.cat,
                img: d.img, tags: d.tags, time: Number(d.time), kcal: Number(d.kcal),
                available: d.available !== false, hidden: !!d.hidden
            });
        }
        CUI.closeModal('modal');
        CUI.toast(t('dishSaved'), 'check');
    }

    /* --- category editor -------------------------------------------------- */
    let editingCat = null;

    function openCatEditor(id) {
        const cats = allCats();
        editingCat = id
            ? Object.assign({}, cats.find((c) => c.id === id))
            : { id: '', en: '', ar: '', img: STOCK[0], note: { en: '', ar: '' }, isNew: true };
        if (!editingCat) return;

        const body = `
            <div class="form-grid">
                <label class="field">
                    <span class="field__label">${esc(t('nameAr'))}</span>
                    <input class="field__input" data-c="ar" value="${esc(editingCat.ar || '')}" dir="rtl">
                </label>
                <label class="field">
                    <span class="field__label">${esc(t('nameEn'))}</span>
                    <input class="field__input" data-c="en" value="${esc(editingCat.en || '')}" dir="ltr">
                </label>
                <label class="field">
                    <span class="field__label">${esc(t('descAr'))}</span>
                    <input class="field__input" data-c="note.ar" value="${esc((editingCat.note || {}).ar || '')}" dir="rtl">
                </label>
                <label class="field">
                    <span class="field__label">${esc(t('descEn'))}</span>
                    <input class="field__input" data-c="note.en" value="${esc((editingCat.note || {}).en || '')}" dir="ltr">
                </label>
            </div>`;

        CUI.openModal('modal', editingCat.isNew ? t('addCategory') : t('edit'), body,
            `<button class="btn btn--ghost" type="button" data-act="close-modal">${esc(t('cancel'))}</button>
             <button class="btn btn--gold" type="button" data-act="cat-save">${icon('check')}<span>${esc(t('save'))}</span></button>`);

        $$('[data-c]', $('#modal')).forEach((input) => {
            input.addEventListener('input', () => {
                const path = input.dataset.c.split('.');
                if (path.length === 2) {
                    editingCat.note = editingCat.note || {};
                    editingCat.note[path[1]] = input.value;
                } else {
                    editingCat[path[0]] = input.value;
                }
            });
        });
    }

    function saveCat() {
        const c = editingCat;
        if (!c.ar && !c.en) return;
        if (!c.en) c.en = c.ar;
        if (!c.ar) c.ar = c.en;

        if (c.isNew) {
            delete c.isNew;
            c.id = slug(c.en) + '-' + Math.random().toString(36).slice(2, 4);
            OPS.addCat(c);
        } else {
            OPS.patchCat(c.id, { en: c.en, ar: c.ar, note: c.note });
        }
        CUI.closeModal('modal');
        CUI.toast(t('saved'), 'check');
    }

    /* --- reordering ------------------------------------------------------- */
    function move(list, id, dir, commit) {
        const ids = list.map((x) => x.id);
        const at = ids.indexOf(id);
        const to = at + dir;
        if (at === -1 || to < 0 || to >= ids.length) return;
        ids.splice(to, 0, ids.splice(at, 1)[0]);
        commit(ids);
    }

    /* ---------------------------------------------------------------------
       Pane 3 — tables and QR codes
       ------------------------------------------------------------------ */
    /** Drawn in the page by qr.js — the sheet has to print with no internet. */
    function qrImg(url) {
        try {
            return QR.svg(url, { fg: '#0C0A09', bg: '#FFFFFF', quiet: 2 });
        } catch (e) {
            return `<span class="qr-card__fallback">${icon('qr')}<span>${esc(url)}</span></span>`;
        }
    }

    function renderTables() {
        const cfg = OPS.config();
        let cards = '';
        for (let n = 1; n <= cfg.tables; n++) {
            const url = OPS.tableUrl(n);
            cards += `
                <div class="qr-card">
                    <div class="qr-card__code">${qrImg(url)}</div>
                    <div class="qr-card__label">${esc(t('table'))} ${n}</div>
                    <div class="qr-card__url">${esc(url)}</div>
                    <div class="qr-card__tools no-print">
                        <button class="c-btn c-btn--icon" type="button" data-act="copy" data-url="${esc(url)}"
                                aria-label="${esc(t('copyLink'))}">${icon('copy')}</button>
                        <a class="c-btn c-btn--icon" href="${esc(url)}" target="_blank" rel="noopener"
                           aria-label="${esc(t('openMenu'))}">${icon('external')}</a>
                    </div>
                </div>`;
        }

        return `
            <div class="c-head">
                <div>
                    <h1 class="c-title">${esc(t('navTables'))}</h1>
                    <p class="c-sub">${esc(t('qrHint'))}</p>
                </div>
                <div class="c-head__actions">
                    <button class="c-btn" type="button" data-act="print">${icon('printer')}<span>${esc(t('printQr'))}</span></button>
                </div>
            </div>

            <div class="panel no-print" style="margin-bottom:1rem">
                <div class="panel__body">
                    <div class="form-grid">
                        <label class="field">
                            <span class="field__label">${esc(t('tableCount'))}</span>
                            <input class="field__input" type="number" min="1" max="120" data-cfg="tables" value="${cfg.tables}">
                        </label>
                        <label class="field field--wide">
                            <span class="field__label">${esc(t('baseUrl'))}</span>
                            <input class="field__input" data-cfg="baseUrl" dir="ltr" placeholder="https://menu.lumiere.com/"
                                   value="${esc(cfg.baseUrl || '')}">
                            <span class="panel__sub" style="display:block;margin-top:.4rem">${esc(t('baseUrlHint'))}</span>
                        </label>
                    </div>
                </div>
            </div>

            <div class="qr-grid">${cards}</div>`;
    }

    /* ---------------------------------------------------------------------
       Pane 4 — services the guest can call for
       ------------------------------------------------------------------ */
    function renderServices() {
        const cfg = OPS.config();
        const base = window.__OPS_SERVICES || SERVICE_REASONS;

        const rows = base.map((r) => `
            <button class="srow" type="button" data-act="service" data-id="${r.id}">
                <span class="srow__ic">${icon(r.icon)}</span>
                <span class="srow__body">
                    <span class="srow__name">${esc(L(r))}</span>
                    <span class="srow__sub">${esc(r.en)}</span>
                </span>
                <span class="switch ${cfg.services[r.id] === false ? '' : 'on'}"></span>
            </button>`).join('');

        const extra = (cfg.extraServices || []).map((r) => `
            <div class="srow">
                <span class="srow__ic">${icon(r.icon || 'bell')}</span>
                <span class="srow__body">
                    <span class="srow__name">${esc(L(r))}</span>
                    <span class="srow__sub">${esc(r.en || '')}</span>
                </span>
                <button class="icon-mini icon-mini--danger" type="button" data-act="service-del" data-id="${r.id}">
                    ${icon('trash')}
                </button>
            </div>`).join('');

        const pays = [
            { id: 'cash', ic: 'cash', label: 'paymentCash' },
            { id: 'card', ic: 'card', label: 'paymentCard' },
            { id: 'split', ic: 'split', label: 'paymentSplit' }
        ].map((p) => `
            <button class="srow" type="button" data-act="pay" data-id="${p.id}">
                <span class="srow__ic">${icon(p.ic)}</span>
                <span class="srow__body"><span class="srow__name">${esc(t(p.label))}</span></span>
                <span class="switch ${cfg.payments[p.id] === false ? '' : 'on'}"></span>
            </button>`).join('');

        return `
            <div class="c-head">
                <div>
                    <h1 class="c-title">${esc(t('navServices'))}</h1>
                    <p class="c-sub">${esc(t('servicesHint'))}</p>
                </div>
                <div class="c-head__actions">
                    <button class="c-btn" type="button" data-act="service-add">${icon('plus')}<span>${esc(t('addService'))}</span></button>
                </div>
            </div>

            <div class="panel"><div class="panel__body panel__body--flush">${rows}${extra}</div></div>

            <div class="panel">
                <div class="panel__head">
                    <h2 class="panel__title">${esc(t('bill'))}</h2>
                    <span class="panel__sub">${esc(t('paymentsHint'))}</span>
                </div>
                <div class="panel__body panel__body--flush">${pays}</div>
            </div>`;
    }

    /* Extra services get the same editor as everything else — a browser
       prompt() is blocked in enough contexts to not be worth the risk. */
    const SERVICE_ICONS = ['bell', 'wine', 'utensils', 'info', 'note', 'receipt', 'users', 'clock'];
    let newService = null;

    function openServiceEditor() {
        newService = { id: 'x-' + Math.random().toString(36).slice(2, 6), icon: 'bell', ar: '', en: '' };

        const body = `
            <div class="form-grid">
                <label class="field">
                    <span class="field__label">${esc(t('serviceName'))} (AR)</span>
                    <input class="field__input" data-s="ar" dir="rtl">
                </label>
                <label class="field">
                    <span class="field__label">${esc(t('serviceName'))} (EN)</span>
                    <input class="field__input" data-s="en" dir="ltr">
                </label>
            </div>
            <div class="field" style="margin-top:1rem">
                <span class="field__label">${esc(t('tagsLabel'))}</span>
                <div class="tagpick" id="serviceIcons">
                    ${SERVICE_ICONS.map((name, i) => `
                        <button class="${i === 0 ? 'on' : ''}" type="button" data-act="service-icon" data-icon="${name}">
                            ${icon(name)}
                        </button>`).join('')}
                </div>
            </div>`;

        CUI.openModal('modal', t('addService'), body,
            `<button class="btn btn--ghost" type="button" data-act="close-modal">${esc(t('cancel'))}</button>
             <button class="btn btn--gold" type="button" data-act="service-save">${icon('check')}<span>${esc(t('save'))}</span></button>`);

        $$('[data-s]', $('#modal')).forEach((input) => {
            input.addEventListener('input', () => { newService[input.dataset.s] = input.value; });
        });
    }

    function saveService() {
        if (!newService.ar && !newService.en) return;
        if (!newService.en) newService.en = newService.ar;
        if (!newService.ar) newService.ar = newService.en;

        const list = (OPS.config().extraServices || []).slice();
        list.push(newService);
        OPS.setConfig({ extraServices: list });
        CUI.closeModal('modal');
        CUI.toast(t('saved'), 'check');
    }

    /* ---------------------------------------------------------------------
       Pane 5 — order settings
       ------------------------------------------------------------------ */
    function renderOrderSettings() {
        const cfg = OPS.config();
        const flows = [
            { id: 'direct', ic: 'bolt', name: 'flowDirect', sub: 'flowDirectSub' },
            { id: 'approval', ic: 'shield', name: 'flowApproval', sub: 'flowApprovalSub' }
        ];

        return `
            <div class="c-head">
                <div>
                    <h1 class="c-title">${esc(t('navOrders'))}</h1>
                    <p class="c-sub">${esc(t('flowTitle'))}</p>
                </div>
            </div>

            <div>
                ${flows.map((f) => `
                    <button class="choice ${cfg.flow === f.id ? 'on' : ''}" type="button" data-act="flow" data-id="${f.id}">
                        <span class="choice__mark">${cfg.flow === f.id ? icon('check', 'ic--fill') : ''}</span>
                        <span class="srow__ic">${icon(f.ic)}</span>
                        <span>
                            <span class="choice__name">${esc(t(f.name))}</span>
                            <span class="choice__sub" style="display:block">${esc(t(f.sub))}</span>
                        </span>
                    </button>`).join('')}
            </div>

            <div class="panel" style="margin-top:1.2rem">
                <div class="panel__body">
                    <div class="form-grid">
                        <label class="field">
                            <span class="field__label">${esc(t('serviceCharge'))} (%)</span>
                            <input class="field__input" type="number" min="0" max="30" step="1"
                                   data-cfg="servicePct" value="${Math.round(cfg.brand.servicePct * 100)}">
                        </label>
                    </div>
                </div>
            </div>`;
    }

    /* ---------------------------------------------------------------------
       Pane 6 — restaurant details
       ------------------------------------------------------------------ */
    function renderRestaurant() {
        const b = OPS.config().brand;
        const heroes = ['assets/venue.png'].concat(b.hero && b.hero !== 'assets/venue.png' ? [b.hero] : []);

        return `
            <div class="c-head">
                <div>
                    <h1 class="c-title">${esc(t('navRestaurant'))}</h1>
                    <p class="c-sub">${esc(t('restName'))}</p>
                </div>
            </div>

            <div class="panel">
                <div class="panel__body">
                    <div class="field" style="margin-top:0">
                        <span class="field__label">${icon('image')}<span>${esc(t('image'))}</span></span>
                        <div class="pics">
                            ${heroes.map((src) => `
                                <button class="pic ${(b.hero || 'assets/venue.png') === src ? 'on' : ''}" type="button"
                                        data-act="hero" data-src="${esc(src)}"><img src="${esc(src)}" alt=""></button>`).join('')}
                            <label class="pic pic--upload" title="${esc(t('uploadImage'))}">
                                ${icon('upload')}
                                <input type="file" accept="image/*" id="heroFile" hidden>
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel">
                <div class="panel__body">
                    <div class="form-grid">
                        <label class="field">
                            <span class="field__label">${esc(t('restName'))}</span>
                            <input class="field__input" data-cfg="brand.name" value="${esc(b.name)}">
                        </label>
                        <label class="field">
                            <span class="field__label">${esc(t('phone'))}</span>
                            <input class="field__input" data-cfg="brand.phone" dir="ltr" value="${esc(b.phone)}">
                        </label>
                        <label class="field">
                            <span class="field__label">${esc(t('tagline'))} (AR)</span>
                            <input class="field__input" data-cfg="brand.tagline.ar" dir="rtl" value="${esc(b.tagline.ar || '')}">
                        </label>
                        <label class="field">
                            <span class="field__label">${esc(t('tagline'))} (EN)</span>
                            <input class="field__input" data-cfg="brand.tagline.en" dir="ltr" value="${esc(b.tagline.en || '')}">
                        </label>
                        <label class="field">
                            <span class="field__label">${esc(t('address'))} (AR)</span>
                            <input class="field__input" data-cfg="brand.address.ar" dir="rtl" value="${esc(b.address.ar || '')}">
                        </label>
                        <label class="field">
                            <span class="field__label">${esc(t('address'))} (EN)</span>
                            <input class="field__input" data-cfg="brand.address.en" dir="ltr" value="${esc(b.address.en || '')}">
                        </label>
                        <label class="field">
                            <span class="field__label">${esc(t('wifiPass'))}</span>
                            <input class="field__input" data-cfg="brand.wifi" dir="ltr" value="${esc(b.wifi)}">
                        </label>
                        <label class="field">
                            <span class="field__label">${esc(t('currency'))}</span>
                            <input class="field__input" data-cfg="brand.currency" dir="ltr" value="${esc(b.currency)}">
                        </label>
                        <label class="field">
                            <span class="field__label">${esc(t('openHour'))}</span>
                            <input class="field__input" type="number" min="0" max="23" data-cfg="brand.openHour" value="${b.openHour}">
                        </label>
                        <label class="field">
                            <span class="field__label">${esc(t('closeHour'))}</span>
                            <input class="field__input" type="number" min="0" max="23" data-cfg="brand.closeHour" value="${b.closeHour}">
                        </label>
                    </div>
                </div>
            </div>

            <div class="panel">
                <div class="panel__head"><h2 class="panel__title">${esc(t('dangerZone'))}</h2></div>
                <div class="panel__body">
                    <button class="btn btn--ghost btn--block" type="button" data-act="reset-activity">
                        ${icon('reset')}<span>${esc(t('resetActivity'))}</span>
                    </button>
                    <button class="btn btn--plain btn--block" type="button" data-act="reset-all">
                        ${esc(t('resetAll'))}
                    </button>
                </div>
            </div>`;
    }

    /* ---------------------------------------------------------------------
       Settings inputs — one delegated handler for every data-cfg field
       ------------------------------------------------------------------ */
    function bindConfigFields() {
        const heroFile = $('#heroFile');
        if (heroFile) heroFile.addEventListener('change', () => {
            const chosen = heroFile.files && heroFile.files[0];
            if (!chosen) return;
            shrink(chosen, (dataUrl) => {
                OPS.setConfig({ brand: Object.assign({}, OPS.config().brand, { hero: dataUrl }) });
                CUI.toast(t('saved'), 'check');
                render();
            });
        });

        $$('[data-cfg]', $('#pane')).forEach((input) => {
            input.addEventListener('change', () => {
                const path = input.dataset.cfg;
                const raw = input.type === 'number' ? Number(input.value) : input.value;

                if (path === 'tables') {
                    OPS.setConfig({ tables: Math.max(1, Math.min(120, raw)) });
                    render();
                    return;
                }
                if (path === 'baseUrl') { OPS.setConfig({ baseUrl: raw }); render(); return; }
                if (path === 'servicePct') {
                    OPS.setConfig({ brand: Object.assign({}, OPS.config().brand, { servicePct: raw / 100 }) });
                    return;
                }

                const parts = path.split('.');           // brand.x  |  brand.x.lang
                const brand = Object.assign({}, OPS.config().brand);
                if (parts.length === 2) brand[parts[1]] = raw;
                else brand[parts[1]] = Object.assign({}, brand[parts[1]], { [parts[2]]: raw });

                OPS.setConfig({ brand: brand });
                CUI.toast(t('saved'), 'check');
                if (parts[1] === 'name') $('#brandName').textContent = brand.name;
            });
        });
    }

    /* ---------------------------------------------------------------------
       Render + events
       ------------------------------------------------------------------ */
    function render() {
        renderNav();
        const host = $('#pane');
        if (pane === 'overview') host.innerHTML = renderOverview();
        else if (pane === 'menu') host.innerHTML = renderMenu();
        else if (pane === 'tables') host.innerHTML = renderTables();
        else if (pane === 'services') host.innerHTML = renderServices();
        else if (pane === 'orders') host.innerHTML = renderOrderSettings();
        else host.innerHTML = renderRestaurant();
        bindConfigFields();
    }

    document.addEventListener('click', (e) => {
        const navBtn = e.target.closest('[data-pane]');
        if (navBtn) {
            pane = navBtn.dataset.pane;
            render();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }

        if (e.target.closest('.modal-close') || e.target.classList.contains('cmodal')) {
            CUI.closeModal('modal');
            return;
        }

        const act = e.target.closest('[data-act]');
        if (!act) return;
        const id = act.dataset.id;

        switch (act.dataset.act) {
            /* --- menu --- */
            case 'dish-add': openDishEditor(null); break;
            case 'dish-edit': openDishEditor(id); break;
            case 'dish-stock': {
                const dish = allDishes().find((d) => d.id === id);
                const next = dish.available === false;
                OPS.patchItem(id, { available: next });
                CUI.toast(next ? t('backInStock') : t('soldOut'), next ? 'check' : 'info');
                render();
                break;
            }
            case 'dish-hide': {
                const dish = allDishes().find((d) => d.id === id);
                OPS.patchItem(id, { hidden: !dish.hidden });
                render();
                break;
            }
            case 'dish-del':
                if (confirm(t('deleteDish'))) { OPS.removeItem(id); render(); }
                break;
            case 'dish-move':
                move(allDishes(), id, Number(act.dataset.d), OPS.setItemOrder);
                render();
                break;
            case 'dish-save': saveDish(); render(); break;

            case 'pic': editing.img = act.dataset.src; paintDishEditor(); break;
            case 'hero':
                OPS.setConfig({ brand: Object.assign({}, OPS.config().brand, { hero: act.dataset.src }) });
                render();
                break;
            case 'tag': {
                const at = editing.tags.indexOf(act.dataset.tag);
                if (at === -1) editing.tags.push(act.dataset.tag); else editing.tags.splice(at, 1);
                paintDishEditor();
                break;
            }
            case 'edit-stock': editing.available = editing.available === false; paintDishEditor(); break;
            case 'edit-hidden': editing.hidden = !editing.hidden; paintDishEditor(); break;

            /* --- categories --- */
            case 'cat-add': openCatEditor(null); break;
            case 'cat-edit': openCatEditor(id); break;
            case 'cat-save': saveCat(); render(); break;
            case 'cat-hide': {
                const cat = allCats().find((c) => c.id === id);
                OPS.patchCat(id, { hidden: !cat.hidden });
                render();
                break;
            }
            case 'cat-del':
                if (confirm(t('deleteCat'))) { OPS.removeCat(id); render(); }
                break;
            case 'cat-move':
                move(allCats(), id, Number(act.dataset.d), OPS.setCatOrder);
                render();
                break;

            /* --- tables --- */
            case 'copy':
                navigator.clipboard && navigator.clipboard.writeText(act.dataset.url);
                CUI.toast(t('copied'), 'copy');
                break;
            case 'print': window.print(); break;

            /* --- services --- */
            case 'service': {
                const services = Object.assign({}, OPS.config().services);
                services[id] = services[id] === false;
                OPS.setConfig({ services: services });
                render();
                break;
            }
            case 'service-add': openServiceEditor(); break;
            case 'service-icon':
                newService.icon = act.dataset.icon;
                $$('#serviceIcons button').forEach((b) => b.classList.toggle('on', b.dataset.icon === newService.icon));
                break;
            case 'service-save': saveService(); render(); break;
            case 'service-del':
                OPS.setConfig({ extraServices: (OPS.config().extraServices || []).filter((r) => r.id !== id) });
                render();
                break;
            case 'pay': {
                const payments = Object.assign({}, OPS.config().payments);
                payments[id] = payments[id] === false;
                OPS.setConfig({ payments: payments });
                render();
                break;
            }

            /* --- order flow --- */
            case 'flow': OPS.setConfig({ flow: id }); render(); break;

            /* --- danger zone --- */
            case 'reset-activity':
                if (confirm(t('confirmQ'))) { OPS.clearActivity(); CUI.toast(t('saved'), 'reset'); render(); }
                break;
            case 'reset-all':
                if (confirm(t('resetConfirm'))) { OPS.resetAll(); location.reload(); }
                break;

            case 'close-modal': CUI.closeModal('modal'); break;
        }
    });

    /* ---------------------------------------------------------------------
       Boot
       ------------------------------------------------------------------ */
    document.addEventListener('DOMContentLoaded', () => {
        hydrateIcons();
        CUI.bindChrome(render);
        $('#brandName').textContent = OPS.config().brand.name;
        render();

        // Another device changed something — repaint, unless a modal is open.
        OPS.subscribe(() => {
            if (!$('#modal').classList.contains('show')) render();
        });
    });

})();
