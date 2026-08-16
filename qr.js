/* =========================================================================
   Operix Restaurant System — QR encoder
   -------------------------------------------------------------------------
   The table QR codes are the front door of the whole product, so they are
   drawn here rather than fetched from a web service: the dashboard has to
   print a working sheet on a restaurant's flaky wi-fi, or with no internet
   at all.

   Byte mode, error correction level M (~15% recovery — enough to survive a
   laminated card on a table), versions 1–10, which covers any sane menu URL.
   Reed–Solomon and the mask penalty follow the reference formulation.
   ========================================================================= */
(function (global) {
    'use strict';

    /* --- GF(256), primitive polynomial 0x11D ---------------------------- */
    const EXP = new Uint8Array(256);
    const LOG = new Uint8Array(256);
    (function () {
        let x = 1;
        for (let i = 0; i < 255; i++) {
            EXP[i] = x;
            LOG[x] = i;
            x <<= 1;
            if (x & 0x100) x ^= 0x11D;
        }
    })();

    const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[(LOG[a] + LOG[b]) % 255]);

    /* --- Reed–Solomon ---------------------------------------------------- */
    function rsDivisor(degree) {
        const result = [];
        for (let i = 0; i < degree - 1; i++) result.push(0);
        result.push(1);

        let root = 1;
        for (let i = 0; i < degree; i++) {
            for (let j = 0; j < result.length; j++) {
                result[j] = mul(result[j], root);
                if (j + 1 < result.length) result[j] ^= result[j + 1];
            }
            root = mul(root, 0x02);
        }
        return result;
    }

    function rsRemainder(data, divisor) {
        const result = divisor.map(() => 0);
        for (let k = 0; k < data.length; k++) {
            const factor = data[k] ^ result.shift();
            result.push(0);
            for (let i = 0; i < divisor.length; i++) result[i] ^= mul(divisor[i], factor);
        }
        return result;
    }

    /* --- Level M capacity table: [ecPerBlock, blocks1, data1, blocks2, data2] */
    const SPEC = {
        1: [10, 1, 16, 0, 0],
        2: [16, 1, 28, 0, 0],
        3: [26, 1, 44, 0, 0],
        4: [18, 2, 32, 0, 0],
        5: [24, 2, 43, 0, 0],
        6: [16, 4, 27, 0, 0],
        7: [18, 4, 31, 0, 0],
        8: [22, 2, 38, 2, 39],
        9: [22, 3, 36, 2, 37],
        10: [26, 4, 43, 1, 44]
    };

    const ALIGN = {
        1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
        6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
    };

    const dataCodewords = (v) => {
        const s = SPEC[v];
        return s[1] * s[2] + s[3] * s[4];
    };

    /* --- Text → codewords ------------------------------------------------ */
    function utf8(text) {
        const out = [];
        for (let i = 0; i < text.length; i++) {
            let code = text.charCodeAt(i);
            if (code < 0x80) out.push(code);
            else if (code < 0x800) {
                out.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
            } else {
                out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
            }
        }
        return out;
    }

    function encodeData(bytes, version) {
        const countBits = version < 10 ? 8 : 16;
        const capacity = dataCodewords(version) * 8;

        const bits = [];
        const push = (value, len) => {
            for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
        };

        push(0b0100, 4);                 // byte mode
        push(bytes.length, countBits);
        bytes.forEach((b) => push(b, 8));

        for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0);   // terminator
        while (bits.length % 8 !== 0) bits.push(0);

        const words = [];
        for (let i = 0; i < bits.length; i += 8) {
            let byte = 0;
            for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
            words.push(byte);
        }

        const pad = [0xEC, 0x11];
        for (let i = 0; words.length < dataCodewords(version); i++) words.push(pad[i % 2]);
        return words;
    }

    /** Split into blocks, add EC, interleave — the order a scanner reads. */
    function interleave(words, version) {
        const spec = SPEC[version];
        const ecLen = spec[0];
        const divisor = rsDivisor(ecLen);

        const blocks = [];
        let at = 0;
        for (let i = 0; i < spec[1]; i++) { blocks.push(words.slice(at, at + spec[2])); at += spec[2]; }
        for (let i = 0; i < spec[3]; i++) { blocks.push(words.slice(at, at + spec[4])); at += spec[4]; }

        const ecBlocks = blocks.map((b) => rsRemainder(b, divisor));
        const longest = Math.max.apply(null, blocks.map((b) => b.length));

        const out = [];
        for (let i = 0; i < longest; i++) {
            blocks.forEach((b) => { if (i < b.length) out.push(b[i]); });
        }
        for (let i = 0; i < ecLen; i++) {
            ecBlocks.forEach((b) => out.push(b[i]));
        }
        return out;
    }

    /* --- Matrix ---------------------------------------------------------- */
    function build(version, codewords) {
        const size = version * 4 + 17;
        const modules = [];
        const reserved = [];
        for (let r = 0; r < size; r++) {
            modules.push(new Array(size).fill(false));
            reserved.push(new Array(size).fill(false));
        }

        const set = (col, row, dark) => {
            modules[row][col] = dark;
            reserved[row][col] = true;
        };

        /* Finder patterns + separators */
        const finder = (col, row) => {
            for (let dy = -1; dy <= 7; dy++) {
                for (let dx = -1; dx <= 7; dx++) {
                    const x = col + dx, y = row + dy;
                    if (x < 0 || y < 0 || x >= size || y >= size) continue;
                    const dist = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
                    set(x, y, dist !== 2 && dist <= 3);
                }
            }
        };
        finder(0, 0);
        finder(size - 7, 0);
        finder(0, size - 7);

        /* Timing patterns */
        for (let i = 0; i < size; i++) {
            if (!reserved[6][i]) set(i, 6, i % 2 === 0);
            if (!reserved[i][6]) set(6, i, i % 2 === 0);
        }

        /* Alignment patterns */
        const centres = ALIGN[version];
        centres.forEach((cy) => centres.forEach((cx) => {
            const corner = (cx === 6 && cy === 6) ||
                           (cx === 6 && cy === size - 7) ||
                           (cx === size - 7 && cy === 6);
            if (corner) return;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
                }
            }
        }));

        /* Reserve the format areas so data never lands on them */
        for (let i = 0; i <= 8; i++) {
            if (!reserved[i][8]) set(8, i, false);
            if (!reserved[8][i]) set(i, 8, false);
        }
        for (let i = 0; i < 8; i++) {
            if (!reserved[8][size - 1 - i]) set(size - 1 - i, 8, false);
            if (!reserved[size - 1 - i][8]) set(8, size - 1 - i, false);
        }
        set(8, size - 8, true);          // the always-dark module

        /* Version information, versions 7 and up */
        if (version >= 7) {
            let rem = version;
            for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
            const bits = (version << 12) | rem;
            for (let i = 0; i < 18; i++) {
                const bit = ((bits >>> i) & 1) === 1;
                const a = size - 11 + (i % 3);
                const b = Math.floor(i / 3);
                set(a, b, bit);
                set(b, a, bit);
            }
        }

        /* Data, zig-zagging up and down two columns at a time */
        let bitAt = 0;
        for (let right = size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;
            for (let vert = 0; vert < size; vert++) {
                for (let j = 0; j < 2; j++) {
                    const col = right - j;
                    const upward = ((right + 1) & 2) === 0;
                    const row = upward ? size - 1 - vert : vert;
                    if (reserved[row][col]) continue;
                    if (bitAt < codewords.length * 8) {
                        modules[row][col] = ((codewords[bitAt >>> 3] >>> (7 - (bitAt & 7))) & 1) === 1;
                        bitAt++;
                    }
                }
            }
        }

        return { size: size, modules: modules, reserved: reserved };
    }

    const MASKS = [
        (r, c) => (r + c) % 2 === 0,
        (r) => r % 2 === 0,
        (r, c) => c % 3 === 0,
        (r, c) => (r + c) % 3 === 0,
        (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
        (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
        (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
        (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
    ];

    function drawFormat(grid, mask) {
        const size = grid.size;
        const data = (0b00 << 3) | mask;              // level M
        let rem = data;
        for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        const bits = ((data << 10) | rem) ^ 0x5412;

        const bit = (i) => ((bits >>> i) & 1) === 1;
        const put = (col, row, dark) => { grid.modules[row][col] = dark; };

        for (let i = 0; i <= 5; i++) put(8, i, bit(i));
        put(8, 7, bit(6));
        put(8, 8, bit(7));
        put(7, 8, bit(8));
        for (let i = 9; i < 15; i++) put(14 - i, 8, bit(i));

        for (let i = 0; i < 8; i++) put(size - 1 - i, 8, bit(i));
        for (let i = 8; i < 15; i++) put(8, size - 15 + i, bit(i));
        put(8, size - 8, true);
    }

    /* Standard four penalty rules — a lower score reads more reliably. */
    function penalty(grid) {
        const size = grid.size, m = grid.modules;
        let score = 0;

        const line = (get) => {
            let run = 1, dark = 0;
            for (let i = 0; i < size; i++) {
                for (let j = 0; j < size; j++) {
                    const cell = get(i, j);
                    if (cell) dark++;
                    if (j > 0 && cell === get(i, j - 1)) {
                        run++;
                        if (run === 5) score += 3;
                        else if (run > 5) score += 1;
                    } else run = 1;
                }
                run = 1;
            }
            return dark;
        };

        const dark = line((r, c) => m[r][c]);
        line((c, r) => m[r][c]);

        for (let r = 0; r < size - 1; r++) {
            for (let c = 0; c < size - 1; c++) {
                const v = m[r][c];
                if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
            }
        }

        const PAT = [true, false, true, true, true, false, true];
        const hasPattern = (cells, at) => {
            for (let i = 0; i < 7; i++) if (cells[at + i] !== PAT[i]) return false;
            const before = cells.slice(Math.max(0, at - 4), at);
            const after = cells.slice(at + 7, at + 11);
            const quiet = (arr) => arr.length === 4 && arr.every((v) => v === false);
            return quiet(before) || quiet(after);
        };

        for (let i = 0; i < size; i++) {
            const row = m[i];
            const col = m.map((r) => r[i]);
            for (let j = 0; j + 7 <= size; j++) {
                if (hasPattern(row, j)) score += 40;
                if (hasPattern(col, j)) score += 40;
            }
        }

        const percent = (dark * 100) / (size * size);
        score += Math.floor(Math.abs(percent - 50) / 5) * 10;
        return score;
    }

    /** Encode `text` and return { size, modules[row][col] as booleans }. */
    function matrix(text) {
        const bytes = utf8(String(text));

        let version = 0;
        for (let v = 1; v <= 10; v++) {
            const countBits = v < 10 ? 8 : 16;
            if (4 + countBits + bytes.length * 8 <= dataCodewords(v) * 8) { version = v; break; }
        }
        if (!version) throw new Error('QR: text too long for version 10');

        const codewords = interleave(encodeData(bytes, version), version);

        let best = null;
        for (let mask = 0; mask < 8; mask++) {
            const grid = build(version, codewords);
            for (let r = 0; r < grid.size; r++) {
                for (let c = 0; c < grid.size; c++) {
                    if (!grid.reserved[r][c] && MASKS[mask](r, c)) grid.modules[r][c] = !grid.modules[r][c];
                }
            }
            drawFormat(grid, mask);
            const score = penalty(grid);
            if (!best || score < best.score) best = { score: score, grid: grid, mask: mask };
        }

        return { size: best.grid.size, modules: best.grid.modules, version: version, mask: best.mask };
    }

    /** Ready-to-inline SVG. `quiet` is in modules (4 is the spec minimum). */
    function svg(text, options) {
        const opts = options || {};
        const quiet = opts.quiet == null ? 3 : opts.quiet;
        const grid = matrix(text);
        const span = grid.size + quiet * 2;

        let path = '';
        for (let r = 0; r < grid.size; r++) {
            for (let c = 0; c < grid.size; c++) {
                if (grid.modules[r][c]) path += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z';
            }
        }

        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + span + ' ' + span + '" ' +
               'shape-rendering="crispEdges" role="img" aria-label="QR">' +
               '<rect width="' + span + '" height="' + span + '" fill="' + (opts.bg || '#fff') + '"/>' +
               '<path d="' + path + '" fill="' + (opts.fg || '#000') + '"/></svg>';
    }

    global.QR = { matrix: matrix, svg: svg, _rsRemainder: rsRemainder, _rsDivisor: rsDivisor };

})(typeof window !== 'undefined' ? window : globalThis);
