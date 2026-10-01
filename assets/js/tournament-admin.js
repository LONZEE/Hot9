/* ==========================================================
   HOT 9 GOLF — Tournament admin page. Depends on tournament-core.js.
========================================================== */

// SHA-256 of the admin PIN (default "hot9admin"). To change it, run in the browser console:
// crypto.subtle.digest("SHA-256",new TextEncoder().encode("newPin")).then(b=>console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")))
const ADMIN_PIN_HASH = "dc80aeb245e9b59f7f3797863903548b350ca7c4024abcc13aa300369ade2a88";
const SS_ADMIN = "h9_tourny_admin";

// GolfCourseAPI — free key from https://golfcourseapi.com (sign up, paste it here).
const GOLF_API_KEY = "B4OYSSBCV5LMW3SDG2ITMOS2BE";
const GOLF_API_BASE = "https://api.golfcourseapi.com";

Object.assign(state, {
    draft: null,
    draftDirty: false,
    adminPlayerId: null,
    courseQuery: "",
    courseResults: [],
    courseDetail: null,
    courseSearching: false,
    courseMsg: "",
});

async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function clone(o) {
    return JSON.parse(JSON.stringify(o));
}

function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function newCode(existing) {
    let c;
    do {
        c = String((crypto.getRandomValues(new Uint32Array(1))[0] % 9000) + 1000);
    } while (existing.includes(c));
    return c;
}

function blankTournament() {
    const holes = 9;
    return {
        id: uid(),
        name: "",
        date: todayISO(),
        status: "upcoming",
        holes,
        allowance: 100,
        par: Array(holes).fill(4),
        si: Array.from({ length: holes }, (_, i) => i + 1),
        flights: [
            { id: uid(), name: "A Flight", max: 9.9 },
            { id: uid(), name: "B Flight", max: 19.9 },
            { id: uid(), name: "C Flight", max: 54 },
        ],
        teams: [],
        players: [],
        scores: {},
        feed: [],
        updatedAt: Date.now(),
    };
}

/* ---------------- render ---------------- */

function renderAll() {
    preserveFocus(() => {
        const sorted = ensureCurrent();
        const t = current();
        renderPicker(sorted, t);
        renderAdmin(t);
    });
}

function renderAdmin(t) {
    if (!state.draft || (!state.draftDirty && state.draft.id !== t?.id)) {
        state.draft = t ? clone(t) : blankTournament();
        state.draftDirty = !t;
        renderAdminForm();
    }
    $("syncNote").textContent = Store.live
        ? "Live sync is on — scores update on every device."
        : "Saving to this device only. Add your Firebase config in assets/js/tournament-core.js for live sync across phones.";

    const exists = t && state.draft.id === t.id;
    $("adminDeleteBtn").hidden = !exists;
    $("adminFormTitle").textContent = exists ? `Edit: ${t.name}` : "New Tournament";
    $("viewBoardLink").hidden = !exists;

    if (!t) {
        setHTML($("adminScores"), `<div class="empty-state">Save a tournament to start entering scores.</div>`);
        return;
    }
    const players = [...t.players].sort((a, b) => a.name.localeCompare(b.name));
    if (!players.some(p => p.id === state.adminPlayerId)) state.adminPlayerId = players[0]?.id || null;
    const p = t.players.find(x => x.id === state.adminPlayerId);
    setHTML($("adminScores"), players.length ? `
        <div class="field">
            <label for="adminPlayerPick">Player</label>
            <select id="adminPlayerPick">${players.map(x => `<option value="${esc(x.id)}"${x.id === state.adminPlayerId ? " selected" : ""}>${esc(x.name)} (code ${esc(x.code)})</option>`).join("")}</select>
        </div>
        <div id="adminCard" data-card-box>${scorecardHTML(t, p, true)}</div>`
        : `<div class="empty-state">Add players to this tournament first.</div>`);
}

function renderAdminForm() {
    const d = state.draft;
    const opt = (value, label, sel) => `<option value="${esc(value)}"${value === sel ? " selected" : ""}>${esc(label)}</option>`;
    $("adminForm").innerHTML = `
        <div class="admin-grid">
            <div class="field"><label>Tournament name</label><input data-path="name" value="${esc(d.name)}" placeholder="Fall Classic" /></div>
            <div class="field"><label>Date</label><input type="date" data-path="date" value="${esc(d.date)}" /></div>
            <div class="field"><label>Status</label><select data-path="status">${opt("upcoming", "Upcoming", d.status)}${opt("live", "Live", d.status)}${opt("final", "Final (locks scores)", d.status)}</select></div>
            <div class="field"><label>Holes</label><select data-path="holes" data-type="number" data-rerender>${opt("9", "9 holes", String(d.holes))}${opt("18", "18 holes", String(d.holes))}</select></div>
            <div class="field"><label>Handicap allowance %</label><input type="number" min="0" max="100" data-path="allowance" data-type="number" value="${d.allowance}" /></div>
        </div>

        <h4 class="section-h">Course <span class="muted small">Search by city or course name to auto-fill pars &amp; stroke indexes</span></h4>
        <div class="course-lookup">
            <div class="admin-row">
                <input id="courseQuery" placeholder="e.g. Bandon Dunes or Scottsdale" value="${esc(state.courseQuery)}" />
                <button type="button" class="btn btn-outline btn-sm" data-act="course-search">${state.courseSearching ? "Searching…" : "Search"}</button>
            </div>
            ${state.courseMsg ? `<div class="form-msg">${esc(state.courseMsg)}</div>` : ""}
            ${state.courseResults.length ? `<div class="admin-rows">${state.courseResults.map((c) => `
                <div class="admin-row">
                    <span>${esc(c.club_name || c.course_name || "Course")}${c.course_name && c.club_name && c.course_name !== c.club_name ? ` — ${esc(c.course_name)}` : ""}${c.location?.city ? ` · ${esc(c.location.city)}${c.location.state ? `, ${esc(c.location.state)}` : ""}` : ""}</span>
                    <button type="button" class="btn btn-outline btn-sm" data-act="course-load" data-id="${esc(c.id)}">Use</button>
                </div>`).join("")}</div>` : ""}
            ${state.courseDetail ? teePickerHTML(state.courseDetail) : ""}
        </div>

        <h4 class="section-h">Holes <span class="muted small">Stroke index: 1 = hardest hole, gets the first handicap stroke</span></h4>
        <div class="table-scroll">
            <table class="admin-holes">
                <tr><th>Hole</th>${d.par.map((_, i) => `<th>${i + 1}</th>`).join("")}</tr>
                <tr><th>Par</th>${d.par.map((v, i) => `<td><input type="number" min="3" max="6" data-path="par.${i}" data-type="number" value="${v}" /></td>`).join("")}</tr>
                <tr><th>SI</th>${d.si.map((v, i) => `<td><input type="number" min="1" max="${d.holes}" data-path="si.${i}" data-type="number" value="${v}" /></td>`).join("")}</tr>
            </table>
        </div>

        <h4 class="section-h">Flights <span class="muted small">Players land in the first flight whose max handicap covers them</span></h4>
        <div class="admin-rows">${d.flights.map((f, i) => `
            <div class="admin-row">
                <input data-path="flights.${i}.name" value="${esc(f.name)}" placeholder="Flight name" />
                <label class="inline">Max HCP <input type="number" step="0.1" data-path="flights.${i}.max" data-type="number" data-rerender value="${f.max}" /></label>
                <button type="button" class="btn btn-ghost btn-sm" data-act="rm-flight" data-i="${i}">Remove</button>
            </div>`).join("")}
        </div>
        <button type="button" class="btn btn-outline btn-sm" data-act="add-flight">+ Add Flight</button>

        <h4 class="section-h">Teams</h4>
        <div class="admin-rows">${d.teams.map((team, i) => `
            <div class="admin-row">
                <input data-path="teams.${i}.name" value="${esc(team.name)}" placeholder="Team name" />
                <button type="button" class="btn btn-ghost btn-sm" data-act="rm-team" data-i="${i}">Remove</button>
            </div>`).join("")}
        </div>
        <button type="button" class="btn btn-outline btn-sm" data-act="add-team">+ Add Team</button>

        <h4 class="section-h">Players <span class="muted small">Give each player their code so they can open their card</span></h4>
        <div class="table-scroll">
            <table class="admin-players">
                <thead><tr><th>Name</th><th>Email (optional)</th><th>HCP Index</th><th>Team</th><th>Flight</th><th>Code</th><th></th></tr></thead>
                <tbody>${d.players.map((p, i) => `
                    <tr>
                        <td><input data-path="players.${i}.name" value="${esc(p.name)}" placeholder="Player name" /></td>
                        <td><input type="email" data-path="players.${i}.email" value="${esc(p.email)}" placeholder="Links to their account" /></td>
                        <td><input type="number" step="0.1" class="num" data-path="players.${i}.handicap" data-type="number" data-rerender value="${esc(p.handicap)}" /></td>
                        <td><select data-path="players.${i}.teamId">${opt("", "— None —", p.teamId)}${d.teams.map(team => opt(team.id, team.name || "Untitled", p.teamId)).join("")}</select></td>
                        <td><select data-path="players.${i}.flightId">${opt("", `Auto (${flightFor(d, { ...p, flightId: "" })?.name || "–"})`, p.flightId)}${d.flights.map(f => opt(f.id, f.name || "Untitled", p.flightId)).join("")}</select></td>
                        <td class="code">${esc(p.code)}</td>
                        <td><button type="button" class="btn btn-ghost btn-sm" data-act="rm-player" data-i="${i}">Remove</button></td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
        <button type="button" class="btn btn-outline btn-sm" data-act="add-player">+ Add Player</button>

        <div class="admin-save">
            <div class="form-msg" id="adminMsg"></div>
            <button type="button" class="btn btn-primary" data-act="save">Save Tournament</button>
        </div>`;
}

/* ---------------- golf course API ---------------- */

function teePickerHTML(course) {
    const tees = ["male", "female"].flatMap(g => (course.tees?.[g] || []).map((t, i) => ({ ...t, gender: g, i })));
    if (!tees.length) return `<div class="form-msg">No tee box data for this course.</div>`;
    return `<div class="admin-rows">${tees.map(t => `
        <div class="admin-row">
            <span>${esc(t.tee_name || "Tees")} (${t.gender === "male" ? "M" : "F"}) · Par ${t.par_total ?? "–"} · ${t.number_of_holes ?? "?"} holes</span>
            <button type="button" class="btn btn-outline btn-sm" data-act="course-tee" data-g="${t.gender}" data-i="${t.i}">Load pars</button>
        </div>`).join("")}</div>`;
}

async function golfFetch(path) {
    if (!GOLF_API_KEY || GOLF_API_KEY === "PASTE_YOUR_KEY_HERE") {
        throw new Error("Paste your golfcourseapi.com API key into GOLF_API_KEY in assets/js/tournament-admin.js.");
    }
    const res = await fetch(`${GOLF_API_BASE}${path}`, { headers: { Authorization: `Bearer ${GOLF_API_KEY}` } });
    if (res.status === 401) throw new Error("Golf API key is missing or invalid.");
    if (!res.ok) throw new Error(`Golf API error ${res.status}.`);
    return res.json();
}

async function courseSearch() {
    const q = state.courseQuery.trim();
    if (!q) return;
    state.courseSearching = true;
    state.courseResults = [];
    state.courseDetail = null;
    state.courseMsg = "";
    renderAdminForm();
    try {
        const data = await golfFetch(`/v1/search?search_query=${encodeURIComponent(q)}`);
        state.courseResults = data.courses || [];
        if (!state.courseResults.length) state.courseMsg = "No courses found — try a different name or city.";
    } catch (e) {
        state.courseMsg = e.message;
    }
    state.courseSearching = false;
    renderAdminForm();
}

async function courseLoad(id) {
    if (!id) return;
    state.courseSearching = true;
    state.courseDetail = null;
    state.courseMsg = "";
    renderAdminForm();
    try {
        const data = await golfFetch(`/v1/courses/${encodeURIComponent(id)}`);
        state.courseDetail = data.course || data;
    } catch (e) {
        state.courseMsg = e.message;
    }
    state.courseSearching = false;
    renderAdminForm();
}

function applyCourseTee(gender, i) {
    const tee = state.courseDetail?.tees?.[gender]?.[i];
    if (!tee?.holes?.length) return;
    const d = state.draft;
    const n = d.holes;
    d.par = Array.from({ length: n }, (_, k) => tee.holes[k]?.par || 4);
    const si = Array.from({ length: n }, (_, k) => tee.holes[k]?.handicap);
    const valid = si.every(v => Number.isInteger(v) && v >= 1 && v <= n) && new Set(si).size === n;
    d.si = valid ? si : Array.from({ length: n }, (_, k) => k + 1);
    state.draftDirty = true;
    state.courseDetail = null;
    state.courseMsg = `${tee.tee_name || "Tees"} loaded — pars${valid ? " and stroke indexes" : ""} filled in${tee.holes.length < n ? ` (only ${tee.holes.length} holes on this tee, rest defaulted)` : ""}. Review below.`;
    renderAdminForm();
}

/* ---------------- editing ---------------- */

function setPath(obj, path, value) {
    const keys = path.split(".");
    const last = keys.pop();
    const target = keys.reduce((o, k) => o[k], obj);
    target[last] = value;
}

function readInput(el) {
    if (el.dataset.type === "number") return el.value === "" ? 0 : Number(el.value);
    return el.value;
}

function validateDraft(d) {
    if (!d.name.trim()) return "Give the tournament a name.";
    const si = [...d.si].sort((a, b) => a - b);
    if (si.some((v, i) => v !== i + 1)) return `Stroke index must use each number 1–${d.holes} exactly once.`;
    if (d.par.some(v => v < 3 || v > 6)) return "Each hole's par should be between 3 and 6.";
    if (!d.flights.length) return "Add at least one flight.";
    if (d.flights.some(f => !f.name.trim())) return "Every flight needs a name.";
    if (d.teams.some(team => !team.name.trim())) return "Every team needs a name.";
    if (d.players.some(p => !p.name.trim())) return "Every player needs a name.";
    return null;
}

async function saveDraft() {
    const d = state.draft;
    const msg = $("adminMsg");
    const err = validateDraft(d);
    if (err) {
        msg.textContent = err;
        msg.className = "form-msg error";
        return;
    }
    d.name = d.name.trim();
    const config = clone(d);
    delete config.scores;
    delete config.feed;
    const exists = state.tournaments.some(t => t.id === d.id);
    try {
        if (exists) {
            // Merge config only so scores entered while editing aren't overwritten.
            await Store.mutate(d.id, t => {
                const keep = new Set(config.players.map(p => p.id));
                Object.assign(t, config);
                t.scores = Object.fromEntries(
                    Object.entries(t.scores || {}).filter(([pid]) => keep.has(pid)).map(([pid, card]) => [pid, card.slice(0, t.holes)])
                );
                t.feed = (t.feed || []).filter(f => keep.has(f.playerId) && f.hole < t.holes);
                t.updatedAt = Date.now();
            });
        } else {
            await Store.save({ ...config, scores: {}, feed: [], updatedAt: Date.now() });
        }
        state.draftDirty = false;
        setCurrent(d.id);
        renderAll();
        msg.textContent = "Saved.";
        msg.className = "form-msg success";
    } catch (e) {
        msg.textContent = e.message;
        msg.className = "form-msg error";
    }
}

function handleAdminAction(act, i, ds = {}) {
    const d = state.draft;
    if (act === "save") return saveDraft();
    if (act === "course-search") {
        state.courseQuery = ($("courseQuery")?.value ?? state.courseQuery).trim();
        return courseSearch();
    }
    if (act === "course-load") return courseLoad(ds.id);
    if (act === "course-tee") return applyCourseTee(ds.g, Number(ds.i));
    if (act === "add-flight") {
        const top = Math.max(0, ...d.flights.map(f => f.max));
        d.flights.push({ id: uid(), name: "", max: Math.min(54, top + 10) });
    } else if (act === "rm-flight") {
        const [f] = d.flights.splice(i, 1);
        d.players.forEach(p => { if (p.flightId === f.id) p.flightId = ""; });
    } else if (act === "add-team") {
        d.teams.push({ id: uid(), name: "" });
    } else if (act === "rm-team") {
        const [team] = d.teams.splice(i, 1);
        d.players.forEach(p => { if (p.teamId === team.id) p.teamId = ""; });
    } else if (act === "add-player") {
        d.players.push({ id: uid(), name: "", email: "", handicap: 0, teamId: "", flightId: "", code: newCode(d.players.map(p => p.code)) });
    } else if (act === "rm-player") {
        if (!confirm(`Remove ${d.players[i].name || "this player"} and their scores?`)) return;
        d.players.splice(i, 1);
    }
    state.draftDirty = true;
    renderAdminForm();
}

/* ---------------- events ---------------- */

function bindEvents() {
    $("tPicker").addEventListener("change", e => {
        if (state.draftDirty && !confirm("Discard unsaved tournament changes?")) {
            e.target.value = state.currentId;
            return;
        }
        state.draft = null;
        state.draftDirty = false;
        setCurrent(e.target.value);
        renderAll();
    });

    $("adminScores").addEventListener("change", e => {
        const t = current();
        if (e.target.id === "adminPlayerPick") {
            state.adminPlayerId = e.target.value;
            renderAll();
            return;
        }
        const inp = e.target.closest("input[data-hole]");
        if (!inp || !t || !state.adminPlayerId) return;
        saveHole(t.id, state.adminPlayerId, Number(inp.dataset.hole), inp.value, "admin").catch(err => alert(err.message));
    });

    const form = $("adminForm");
    form.addEventListener("input", e => {
        const el = e.target.closest("[data-path]");
        if (!el) return;
        setPath(state.draft, el.dataset.path, readInput(el));
        state.draftDirty = true;
    });
    form.addEventListener("change", e => {
        const el = e.target.closest("[data-path]");
        if (!el) return;
        setPath(state.draft, el.dataset.path, readInput(el));
        state.draftDirty = true;
        if (el.dataset.path === "holes") {
            const d = state.draft;
            d.par = Array.from({ length: d.holes }, (_, i) => d.par[i] ?? 4);
            d.si = Array.from({ length: d.holes }, (_, i) => i + 1);
        }
        if (el.hasAttribute("data-rerender")) renderAdminForm();
    });
    form.addEventListener("click", e => {
        const b = e.target.closest("[data-act]");
        if (b) handleAdminAction(b.dataset.act, Number(b.dataset.i), b.dataset);
    });
    form.addEventListener("keydown", e => {
        if (e.key === "Enter" && e.target.id === "courseQuery") {
            e.preventDefault();
            handleAdminAction("course-search");
        }
    });

    $("adminNewBtn").addEventListener("click", () => {
        if (state.draftDirty && !confirm("Discard unsaved tournament changes?")) return;
        state.draft = blankTournament();
        state.draftDirty = true;
        renderAdminForm();
        renderAll();
    });

    $("adminDeleteBtn").addEventListener("click", async () => {
        const t = current();
        if (!t || !confirm(`Delete "${t.name}" and all of its scores? This can't be undone.`)) return;
        await Store.remove(t.id);
        setCurrent(null);
        state.draft = null;
        state.draftDirty = false;
        renderAll();
    });

    $("lockBtn").addEventListener("click", async () => {
        sessionStorage.removeItem(SS_ADMIN);
        if (firebaseConfigured) await firebase.auth().signOut();
        location.reload();
    });
}

let unlocked = false;

async function unlock() {
    if (unlocked) return;
    unlocked = true;
    $("gateWrap").hidden = true;
    $("adminApp").hidden = false;
    $("lockBtn").hidden = false;
    bindEvents();
    await startSync(renderAll);
}

function gateError(text) {
    $("pinMsg").textContent = text;
    $("pinMsg").className = "form-msg error";
    $("pinInput").select();
}

// With Firebase: real email/password sign-in, enforced by Firestore rules.
async function setupFirebaseGate() {
    await Store.init();
    await loadScript(`${FIREBASE_SDK}/firebase-auth-compat.js`);
    $("emailField").hidden = false;
    $("emailInput").required = true;
    $("pinLabel").textContent = "Password";
    $("pinInput").autocomplete = "current-password";
    firebase.auth().onAuthStateChanged(user => { if (user) unlock(); });
    $("emailInput").focus();
    $("pinForm").addEventListener("submit", async e => {
        e.preventDefault();
        try {
            await firebase.auth().signInWithEmailAndPassword($("emailInput").value.trim(), $("pinInput").value);
        } catch {
            gateError("Incorrect email or password.");
        }
    });
}

// Without Firebase (this-device-only mode) fall back to the PIN.
function setupPinGate() {
    if (sessionStorage.getItem(SS_ADMIN) === "1") {
        unlock();
        return;
    }
    $("pinInput").focus();
    $("pinForm").addEventListener("submit", async e => {
        e.preventDefault();
        if ((await sha256($("pinInput").value)) !== ADMIN_PIN_HASH) {
            gateError("Incorrect PIN.");
            return;
        }
        sessionStorage.setItem(SS_ADMIN, "1");
        unlock();
    });
}

document.addEventListener("DOMContentLoaded", () => {
    if (firebaseConfigured) {
        setupFirebaseGate().catch(err => gateError(`Couldn't reach Firebase: ${err.message}`));
    } else {
        setupPinGate();
    }
});
