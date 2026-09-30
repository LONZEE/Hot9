/* ==========================================================
   HOT 9 GOLF — Tournament core (shared by Tourny.html and
   tourny-admin.html). Uses localStorage (one device / kiosk)
   until FIREBASE_CONFIG is filled in, then switches to
   Firestore so every phone sees the leaderboard update live.
========================================================== */

// Firebase console > Project settings > Your apps (Web).
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCh5H1ahGIuZQM1NYovg2lXJcDgqEOW9to",
    authDomain: "hot9-golf.firebaseapp.com",
    projectId: "hot9-golf",
    appId: "1:636214575868:web:4b974250447194c36e0d79",
};
const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/10.12.2";

const LS_TOURNEYS = "h9_tournaments";
const LS_CURRENT = "h9_tourny_current";
const FEED_LIMIT = 50;

/* ---------------- helpers ---------------- */

const $ = id => document.getElementById(id);

function readJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function toPar(n) {
    return n === 0 ? "E" : n > 0 ? `+${n}` : String(n);
}

function toParClass(n) {
    return n < 0 ? "under" : n > 0 ? "over" : "even";
}

// Only touch the DOM when markup actually changes, so open selects and typed values survive live updates.
function setHTML(el, html) {
    if (el._html !== html) {
        el.innerHTML = html;
        el._html = html;
    }
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(s);
    });
}

/* ---------------- data layer ---------------- */

const LocalStore = {
    live: false,
    _listeners: new Set(),
    _all() { return readJSON(LS_TOURNEYS, {}); },
    _emit() {
        const list = Object.values(this._all());
        this._listeners.forEach(fn => fn(list));
    },
    async init() {
        // Keeps other tabs on this device (e.g. a kiosk leaderboard) in sync.
        window.addEventListener("storage", e => { if (e.key === LS_TOURNEYS) this._emit(); });
    },
    subscribeAll(cb) {
        this._listeners.add(cb);
        cb(Object.values(this._all()));
        return () => this._listeners.delete(cb);
    },
    async save(t) {
        const all = this._all();
        all[t.id] = t;
        writeJSON(LS_TOURNEYS, all);
        this._emit();
    },
    async remove(id) {
        const all = this._all();
        delete all[id];
        writeJSON(LS_TOURNEYS, all);
        this._emit();
    },
    async mutate(id, fn) {
        const all = this._all();
        if (!all[id]) throw new Error("Tournament not found.");
        fn(all[id]);
        writeJSON(LS_TOURNEYS, all);
        this._emit();
    },
};

const FirestoreStore = {
    live: true,
    db: null,
    async init() {
        if (this.db) return;
        await loadScript(`${FIREBASE_SDK}/firebase-app-compat.js`);
        await loadScript(`${FIREBASE_SDK}/firebase-firestore-compat.js`);
        firebase.initializeApp(FIREBASE_CONFIG);
        this.db = firebase.firestore();
    },
    col() { return this.db.collection("tournaments"); },
    subscribeAll(cb) {
        return this.col().onSnapshot(
            snap => cb(snap.docs.map(d => d.data())),
            err => console.error("Tournament sync failed:", err)
        );
    },
    async save(t) { await this.col().doc(t.id).set(t); },
    async remove(id) { await this.col().doc(id).delete(); },
    async mutate(id, fn) {
        const ref = this.col().doc(id);
        // Transaction so two players saving at once don't overwrite each other.
        await this.db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists) throw new Error("Tournament not found.");
            const t = snap.data();
            fn(t);
            tx.set(ref, t);
        });
    },
};

const firebaseConfigured = !FIREBASE_CONFIG.apiKey.startsWith("YOUR_");
let Store = firebaseConfigured ? FirestoreStore : LocalStore;

async function startSync(onChange) {
    try {
        await Store.init();
    } catch (err) {
        console.error("Live sync unavailable, falling back to this device:", err);
        Store = LocalStore;
        await Store.init();
    }
    Store.subscribeAll(list => {
        state.tournaments = list;
        onChange();
    });
}

/* ---------------- scoring / handicap ---------------- */

function playingHandicap(t, p) {
    return Math.round((Number(p.handicap) || 0) * (t.allowance ?? 100) / 100);
}

// Strokes given on a hole based on stroke index; plus-handicaps give strokes back on the easiest holes.
function strokesOnHole(ph, si, holes) {
    if (ph >= 0) return Math.floor(ph / holes) + (si <= ph % holes ? 1 : 0);
    const a = -ph;
    return -(Math.floor(a / holes) + (si > holes - (a % holes) ? 1 : 0));
}

function sortedFlights(t) {
    return [...t.flights].sort((a, b) => a.max - b.max);
}

function flightFor(t, p) {
    if (p.flightId) {
        const f = t.flights.find(x => x.id === p.flightId);
        if (f) return f;
    }
    const h = Number(p.handicap) || 0;
    const flights = sortedFlights(t);
    return flights.find(f => h <= f.max) || flights[flights.length - 1] || null;
}

function flightRange(t, f) {
    const flights = sortedFlights(t);
    const i = flights.findIndex(x => x.id === f.id);
    if (i === 0) return `up to ${f.max}`;
    const lo = (flights[i - 1].max + 0.1).toFixed(1);
    return i === flights.length - 1 ? `${lo}+` : `${lo} – ${f.max}`;
}

function playerLine(t, p) {
    const ph = playingHandicap(t, p);
    const card = t.scores?.[p.id] || [];
    let gross = 0, par = 0, pops = 0, thru = 0;
    for (let i = 0; i < t.holes; i++) {
        const s = card[i];
        if (!s) continue;
        thru++;
        gross += s;
        par += t.par[i];
        pops += strokesOnHole(ph, t.si[i], t.holes);
    }
    const net = gross - pops;
    return {
        player: p,
        team: t.teams.find(x => x.id === p.teamId) || null,
        flight: flightFor(t, p),
        ph, thru, gross, pops, net,
        grossToPar: gross - par,
        netToPar: net - par,
    };
}

function teamLines(t) {
    const lines = t.players.map(p => playerLine(t, p));
    return t.teams.map(team => {
        const members = lines.filter(l => l.player.teamId === team.id);
        const played = members.filter(l => l.thru > 0);
        return {
            team,
            members,
            thru: played.reduce((s, l) => s + l.thru, 0),
            gross: played.reduce((s, l) => s + l.gross, 0),
            netToPar: played.reduce((s, l) => s + l.netToPar, 0),
        };
    });
}

function rankLines(lines) {
    const sorted = [...lines].sort((a, b) =>
        (a.thru === 0) - (b.thru === 0) || a.netToPar - b.netToPar || b.thru - a.thru || a.gross - b.gross
    );
    const counts = {};
    sorted.forEach(l => { if (l.thru) counts[l.netToPar] = (counts[l.netToPar] || 0) + 1; });
    let pos = 0;
    sorted.forEach((l, i) => {
        if (!l.thru) { l.pos = "–"; return; }
        if (i === 0 || sorted[i - 1].netToPar !== l.netToPar) pos = i + 1;
        l.pos = (counts[l.netToPar] > 1 ? "T" : "") + pos;
    });
    return sorted;
}

async function saveHole(tid, pid, hole, raw, by) {
    const n = parseInt(raw, 10);
    const strokes = Number.isFinite(n) ? Math.max(1, Math.min(20, n)) : null;
    // Let focus move to the next hole first so the re-render can restore it there.
    await new Promise(r => setTimeout(r, 0));
    await Store.mutate(tid, t => {
        t.scores = t.scores || {};
        const card = (t.scores[pid] || []).slice();
        while (card.length < t.holes) card.push(null);
        card[hole] = strokes;
        t.scores[pid] = card;
        if (strokes != null) {
            t.feed = [...(t.feed || []), { playerId: pid, hole, strokes, at: Date.now(), by }].slice(-FEED_LIMIT);
        }
        t.updatedAt = Date.now();
    });
}

/* ---------------- shared state / render ---------------- */

const state = {
    tournaments: [],
    currentId: localStorage.getItem(LS_CURRENT),
};

function current() {
    return state.tournaments.find(t => t.id === state.currentId) || null;
}

function setCurrent(id) {
    state.currentId = id;
    if (id) localStorage.setItem(LS_CURRENT, id);
    else localStorage.removeItem(LS_CURRENT);
}

// Newest first; defaults the selection to a live tournament when nothing valid is selected.
function ensureCurrent() {
    const sorted = [...state.tournaments].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    if (!current() && sorted.length) {
        setCurrent((sorted.find(t => t.status === "live") || sorted[0]).id);
    }
    return sorted;
}

function renderPicker(sorted, t) {
    const picker = $("tPicker");
    $("pickerWrap").hidden = sorted.length < 2;
    setHTML(picker, sorted.map(x =>
        `<option value="${esc(x.id)}">${esc(x.name || "Untitled")} — ${esc(formatDate(x.date))}</option>`
    ).join(""));
    if (t) picker.value = t.id;
}

// Keeps the scorecard input someone is typing in focused across live re-renders.
function preserveFocus(render) {
    const active = document.activeElement;
    const focus = active?.matches?.("input[data-hole]")
        ? { box: active.closest("[data-card-box]")?.id, hole: active.dataset.hole, value: active.value }
        : null;
    render();
    if (!focus?.box) return;
    const inp = document.querySelector(`#${focus.box} input[data-hole="${focus.hole}"]`);
    if (inp && document.activeElement !== inp) {
        inp.value = focus.value;
        inp.focus();
    }
}

function scorecardHTML(t, p, editable) {
    const ph = playingHandicap(t, p);
    const card = t.scores?.[p.id] || [];
    const l = playerLine(t, p);
    const holes = t.par.map((par, i) => {
        const pops = strokesOnHole(ph, t.si[i], t.holes);
        const s = card[i];
        return `<div class="hole ${s ? toParClass(s - par) : ""}">
            <div class="hole-num">${i + 1}</div>
            <div class="hole-meta">Par ${par} · SI ${t.si[i]}</div>
            <div class="hole-pops" title="Handicap strokes">${pops > 0 ? "•".repeat(pops) : pops < 0 ? `+${-pops}` : "&nbsp;"}</div>
            ${editable
                ? `<input type="number" inputmode="numeric" min="1" max="20" data-hole="${i}" value="${s ?? ""}" aria-label="Hole ${i + 1} strokes">`
                : `<div class="hole-score">${s ?? "–"}</div>`}
        </div>`;
    }).join("");
    return `<div class="scorecard">${holes}</div>
        <div class="card-totals">
            <div><span>Thru</span><strong>${l.thru === t.holes ? "F" : l.thru}</strong></div>
            <div><span>Gross</span><strong>${l.gross || "–"}</strong></div>
            <div><span>HCP Strokes</span><strong>${l.pops}</strong></div>
            <div><span>Net</span><strong>${l.thru ? l.net : "–"}</strong></div>
            <div><span>Net to Par</span><strong class="topar ${l.thru ? toParClass(l.netToPar) : ""}">${l.thru ? toPar(l.netToPar) : "–"}</strong></div>
        </div>`;
}
