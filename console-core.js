/* =========================================================================
   Operix Restaurant System — console shared layer
   Chrome that staff.html and admin.html both need: language, theme, clock,
   toasts, the alert chime, and the small formatting helpers. Nothing here
   knows about orders or dishes; that is each console's own script.
   ========================================================================= */
(function (global) {
    'use strict';

    const KEY = { theme: 'lum.theme', lang: 'lum.lang' };

    const store = {
        get(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                return raw === null ? fallback : JSON.parse(raw);
            } catch (e) { return fallback; }
        },
        set(key, value) {
            try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* no storage */ }
        }
    };

    /* The guest menu opens in English by default; the back of house is used
       by the restaurant's own team, so it opens in Arabic. Once anyone picks
       a language both sides follow it — it is one product. */
    const state = {
        lang: store.get(KEY.lang, 'ar'),
        theme: store.get(KEY.theme, 'dark')
    };

    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

    const esc = (str) => String(str == null ? '' : str).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

    /** Console strings first, then the guest dictionary, then the key itself. */
    function t(key) {
        const ops = global.I18N_OPS || {};
        const guest = (typeof I18N !== 'undefined' ? I18N : {});   // data.js uses const — not on window
        return (ops[state.lang] && ops[state.lang][key]) ||
               (guest[state.lang] && guest[state.lang][key]) ||
               (ops.en && ops.en[key]) ||
               (guest.en && guest.en[key]) || key;
    }

    const L = (obj) => (obj ? (obj[state.lang] || obj.en || obj.ar || '') : '');

    const money = (n) => {
        const cur = (global.OPS ? OPS.config().brand.currency : '$');
        return cur + (Math.round(n * 100) / 100);
    };

    const clockText = (ts) => new Date(ts).toLocaleTimeString(
        state.lang === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' }
    );

    /** Short, glanceable age: "12ث" / "4د" / "1س 20د". */
    function timeAgo(ts) {
        const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
        const unit = state.lang === 'ar'
            ? { s: 'ث', m: 'د', h: 'س' }
            : { s: 's', m: 'm', h: 'h' };
        if (secs < 60) return secs + unit.s;
        const mins = Math.floor(secs / 60);
        if (mins < 60) return mins + unit.m;
        return Math.floor(mins / 60) + unit.h + ' ' + (mins % 60) + unit.m;
    }

    const minutesSince = (ts) => (Date.now() - ts) / 60000;

    /* ---------------------------------------------------------------------
       Theme + language
       ------------------------------------------------------------------ */
    function applyTheme() {
        document.documentElement.dataset.theme = state.theme;
        const btn = $('#themeBtn');
        if (btn) btn.innerHTML = icon(state.theme === 'dark' ? 'moon' : 'sun');
    }

    function applyLang() {
        const rtl = state.lang === 'ar';
        document.documentElement.lang = state.lang;
        document.documentElement.dir = rtl ? 'rtl' : 'ltr';

        const btn = $('#langBtn');
        if (btn) btn.textContent = rtl ? 'EN' : 'ع';

        $$('[data-ops]').forEach((n) => { n.textContent = t(n.dataset.ops); });
        $$('[data-ops-label]').forEach((n) => { n.setAttribute('aria-label', t(n.dataset.opsLabel)); });
    }

    /* ---------------------------------------------------------------------
       Toasts (same component as the guest side)
       ------------------------------------------------------------------ */
    function toast(message, iconName) {
        const host = $('#toasts');
        if (!host) return;
        const node = document.createElement('div');
        node.className = 'toast';
        node.setAttribute('role', 'status');
        node.innerHTML = icon(iconName || 'check') + '<span>' + esc(message) + '</span>';
        host.appendChild(node);
        setTimeout(() => {
            node.classList.add('out');
            node.addEventListener('animationend', () => node.remove(), { once: true });
        }, 2800);
    }

    /* ---------------------------------------------------------------------
       Alert chime — two soft notes, no audio file to ship
       ------------------------------------------------------------------ */
    let audio = null;

    function chime(urgent) {
        if (!global.OPS || !OPS.config().sound) return;
        try {
            if (!audio) audio = new (global.AudioContext || global.webkitAudioContext)();
            if (audio.state === 'suspended') audio.resume();
            const now = audio.currentTime;
            [0, 0.16].forEach((delay, i) => {
                const osc = audio.createOscillator();
                const gain = audio.createGain();
                osc.type = 'sine';
                osc.frequency.value = urgent ? (i ? 784 : 587) : (i ? 659 : 523);
                gain.gain.setValueAtTime(0.0001, now + delay);
                gain.gain.exponentialRampToValueAtTime(0.16, now + delay + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.32);
                osc.connect(gain).connect(audio.destination);
                osc.start(now + delay);
                osc.stop(now + delay + 0.34);
            });
        } catch (e) { /* audio blocked — the toast still lands */ }
    }

    /* ---------------------------------------------------------------------
       Modal helper — one generic dialog per console
       ------------------------------------------------------------------ */
    function openModal(id, title, bodyHtml, footHtml) {
        const modal = $('#' + id);
        if (!modal) return;
        $('.cmodal__title', modal).textContent = title;
        $('.cmodal__body', modal).innerHTML = bodyHtml;
        $('.cmodal__foot', modal).innerHTML = footHtml || '';
        modal.classList.add('show');
        return modal;
    }

    function closeModal(id) {
        const modal = $('#' + id);
        if (modal) modal.classList.remove('show');
    }

    /* ---------------------------------------------------------------------
       Shared chrome wiring
       ------------------------------------------------------------------ */
    function bindChrome(onRerender) {
        applyTheme();
        applyLang();

        const themeBtn = $('#themeBtn');
        if (themeBtn) themeBtn.addEventListener('click', () => {
            state.theme = state.theme === 'dark' ? 'light' : 'dark';
            store.set(KEY.theme, state.theme);
            applyTheme();
        });

        const langBtn = $('#langBtn');
        if (langBtn) langBtn.addEventListener('click', () => {
            state.lang = state.lang === 'ar' ? 'en' : 'ar';
            store.set(KEY.lang, state.lang);
            applyLang();
            if (onRerender) onRerender();
        });

        const soundBtn = $('#soundBtn');
        if (soundBtn) {
            const paint = () => {
                const on = OPS.config().sound;
                soundBtn.innerHTML = icon(on ? 'volume' : 'volumeOff');
                soundBtn.classList.toggle('on', !!on);
                soundBtn.setAttribute('aria-label', t('sound'));
            };
            paint();
            soundBtn.addEventListener('click', () => {
                OPS.setConfig({ sound: !OPS.config().sound });
                paint();
                if (OPS.config().sound) chime(false);
            });
        }

        // Only a real account can be signed out of, so the button appears
        // with the database and stays hidden on a local install.
        const outBtn = $('#signOutBtn');
        if (outBtn && global.CLOUD && CLOUD.enabled && CLOUD.isStaff()) {
            outBtn.hidden = false;
            outBtn.innerHTML = icon('logout');
            outBtn.title = (CLOUD.staff && CLOUD.staff.full_name) || t('signOut');
            outBtn.addEventListener('click', async () => {
                await CLOUD.signOut();
                location.reload();
            });
        }

        const clockEl = $('#clock');
        if (clockEl) {
            const paint = () => { clockEl.textContent = clockText(Date.now()); };
            paint();
            setInterval(paint, 15000);
        }
    }

    /* ---------------------------------------------------------------------
       Staff gate
       In local mode there is nobody to check against, so the consoles open
       straight away. With a database, the floor and the dashboard are behind
       a real sign-in: an account is not enough, it has to have a row in
       public.staff, which is what every RLS policy actually asks about.
       ------------------------------------------------------------------ */
    function paintGate(then, needsManager) {
        const host = document.createElement('div');
        host.className = 'gate';
        host.innerHTML = `
            <form class="gate__card" id="gateForm" autocomplete="on">
                <div class="gate__mark">${icon('shield')}</div>
                <h1 class="gate__title">${esc(OPS.config().brand.name)}</h1>
                <p class="gate__sub">${esc(needsManager ? t('signInManager') : t('signInSub'))}</p>

                <label class="field">
                    <span class="field__label">${esc(t('email'))}</span>
                    <input class="field__input" id="gateEmail" type="email" dir="ltr"
                           autocomplete="username" required>
                </label>
                <label class="field">
                    <span class="field__label">${esc(t('password'))}</span>
                    <input class="field__input" id="gatePass" type="password" dir="ltr"
                           autocomplete="current-password" required>
                </label>

                <p class="gate__error" id="gateError" hidden></p>

                <button class="btn btn--gold btn--block" type="submit" id="gateGo">
                    ${icon('logout')}<span>${esc(t('signIn'))}</span>
                </button>
            </form>`;

        document.body.appendChild(host);
        setTimeout(() => host.classList.add('show'), 20);
        $('#gateEmail').focus();

        $('#gateForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const button = $('#gateGo');
            const error = $('#gateError');

            button.disabled = true;
            error.hidden = true;

            const res = await CLOUD.signIn($('#gateEmail').value.trim(), $('#gatePass').value);

            if (res.error) {
                error.hidden = false;
                error.textContent = res.error === 'not-staff' ? t('notStaff') : t('signInFailed');
                button.disabled = false;
                $('#gatePass').value = '';
                return;
            }

            // Working here is not the same as running the place.
            if (needsManager && (!CLOUD.staff || CLOUD.staff.role !== 'manager')) {
                await CLOUD.signOut();
                error.hidden = false;
                error.textContent = t('notManager');
                button.disabled = false;
                $('#gatePass').value = '';
                return;
            }

            await OPS.reloadCloud();
            host.classList.remove('show');
            setTimeout(() => host.remove(), 300);
            then();
        });
    }

    /** requireStaff(then) — any staff. requireStaff({manager:true}, then) —
        the dashboard, which is the owner's screen, not the floor's. */
    async function requireStaff(opts, then) {
        if (typeof opts === 'function') { then = opts; opts = {}; }
        const needsManager = !!opts.manager;

        if (!global.CLOUD || !CLOUD.enabled) { then(); return; }

        await OPS.ready();                         // let the first snapshot land

        const allowed = CLOUD.isStaff() &&
            (!needsManager || (CLOUD.staff && CLOUD.staff.role === 'manager'));

        if (allowed) { then(); return; }

        // Signed in, but on the wrong screen: start the gate from scratch.
        if (CLOUD.isStaff()) await CLOUD.signOut();
        paintGate(then, needsManager);
    }

    global.CUI = {
        requireStaff: requireStaff,
        state: state, store: store, KEY: KEY,
        $: $, $$: $$, esc: esc, t: t, L: L, money: money,
        clockText: clockText, timeAgo: timeAgo, minutesSince: minutesSince,
        applyTheme: applyTheme, applyLang: applyLang,
        toast: toast, chime: chime,
        openModal: openModal, closeModal: closeModal,
        bindChrome: bindChrome
    };

})(window);
