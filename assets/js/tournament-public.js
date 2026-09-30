/* ==========================================================
   HOT 9 GOLF — Tournament public page (leaderboard, my card,
   teams & flights). Depends on tournament-core.js.
========================================================== */

const LS_SESSION = "h9_session";
const LS_MY_PLAYERS = "h9_tourny_players";
const NOT_ME = "__none__";

Object.assign(state, {
    view: "board",
    boardFlight: "all",
    boardMode: "players",
});

function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(ts).toLocaleDateString();
}

function scoreName(strokes, par) {
    if (strokes === 1) return "a Hole-in-One";
    const diff = strokes - par;
    const names = { "-3": "an Albatross", "-2": "an Eagle", "-1": "a Birdie", "0": "Par", "1": "a Bogey", "2": "a Double Bogey", "3": "a Triple Bogey" };
    return names[diff] || `${toPar(diff)}`;
}

function myPlayer(t) {
    const chosen = readJSON(LS_MY_PLAYERS, {})[t.id];
    let p = t.players.find(x => x.id === chosen);
    // NOT_ME stops the account-email auto-match after someone taps "Not you?".
    if (!p && chosen !== NOT_ME) {
        const session = readJSON(LS_SESSION, null);
        if (session?.email) {
            p = t.players.find(x => x.email && x.email.toLowerCase() === session.email.toLowerCase());
        }
    }
    return p || null;
}

function setMyPlayer(tid, pid) {
    const map = readJSON(LS_MY_PLAYERS, {});
    map[tid] = pid;
    writeJSON(LS_MY_PLAYERS, map);
}

/* ---------------- render ---------------- */

function renderAll() {
    preserveFocus(() => {
        const sorted = ensureCurrent();
        const t = current();

        renderHeader(t);
        renderPicker(sorted, t);
        document.querySelectorAll(".t-tab").forEach(b => b.classList.toggle("active", b.dataset.view === state.view));
        document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === `view-${state.view}`));
        $("emptyState").hidden = !!t;
        $("viewsWrap").hidden = !t;
        if (!t) return;

        renderBoard(t);
        renderFeed(t);
        renderMe(t);
        renderTeams(t);
    });
}

function renderHeader(t) {
    $("tName").textContent = t ? t.name : "Tournaments";
    $("tSub").textContent = t
        ? `${formatDate(t.date)} · ${t.holes} holes · Net scoring (${t.allowance}% handicap)`
        : "";
    const pill = $("statusPill");
    pill.hidden = !t;
    if (t) {
        pill.textContent = t.status === "live" ? "LIVE" : t.status === "final" ? "FINAL" : "UPCOMING";
        pill.className = `status-pill ${t.status}`;
    }
}

function renderBoard(t) {
    const me = myPlayer(t);
    const chips = [{ id: "all", name: "All" }, ...sortedFlights(t)];
    setHTML($("flightChips"), state.boardMode === "players"
        ? chips.map(f => `<button type="button" class="bay-tab${state.boardFlight === f.id ? " active" : ""}" data-flight="${esc(f.id)}">${esc(f.name)}</button>`).join("")
        : "");
    document.querySelectorAll("#boardMode button").forEach(b => b.classList.toggle("active", b.dataset.mode === state.boardMode));

    let html;
    if (state.boardMode === "teams") {
        const rows = rankLines(teamLines(t));
        html = rows.length ? `
            <table class="lb">
                <thead><tr><th>Pos</th><th class="left">Team</th><th>Players</th><th>Holes</th><th>Net</th></tr></thead>
                <tbody>${rows.map(r => `
                    <tr class="${me && me.teamId === r.team.id ? "me" : ""}">
                        <td>${r.pos}</td>
                        <td class="left"><strong>${esc(r.team.name)}</strong></td>
                        <td>${r.members.length}</td>
                        <td>${r.thru || "–"}</td>
                        <td class="topar ${r.thru ? toParClass(r.netToPar) : ""}">${r.thru ? toPar(r.netToPar) : "–"}</td>
                    </tr>`).join("")}
                </tbody>
            </table>
            <p class="lb-note">Team score = combined net to par of every player on the team.</p>`
            : `<div class="empty-state">No teams set up for this tournament.</div>`;
    } else {
        const lines = t.players.map(p => playerLine(t, p))
            .filter(l => state.boardFlight === "all" || l.flight?.id === state.boardFlight);
        const rows = rankLines(lines);
        html = rows.length ? `
            <table class="lb">
                <thead><tr><th>Pos</th><th class="left">Player</th><th class="hide-sm">Flight</th><th>HCP</th><th>Thru</th><th class="hide-sm">Gross</th><th>Net</th></tr></thead>
                <tbody>${rows.map(l => `
                    <tr class="${me && me.id === l.player.id ? "me" : ""}">
                        <td>${l.pos}</td>
                        <td class="left"><strong>${esc(l.player.name)}</strong>${l.team ? `<div class="lb-sub">${esc(l.team.name)}</div>` : ""}</td>
                        <td class="hide-sm">${esc(l.flight?.name || "–")}</td>
                        <td>${l.ph}</td>
                        <td>${l.thru === t.holes ? "F" : l.thru || "–"}</td>
                        <td class="hide-sm">${l.thru ? l.gross : "–"}</td>
                        <td class="topar ${l.thru ? toParClass(l.netToPar) : ""}">${l.thru ? toPar(l.netToPar) : "–"}</td>
                    </tr>`).join("")}
                </tbody>
            </table>`
            : `<div class="empty-state">No players in this flight yet.</div>`;
    }
    setHTML($("boardTable"), html);
}

function renderFeed(t) {
    const items = [...(t.feed || [])].reverse().slice(0, 15);
    setHTML($("feedList"), items.length
        ? items.map(f => {
            const p = t.players.find(x => x.id === f.playerId);
            if (!p) return "";
            const par = t.par[f.hole];
            return `<li class="feed-item ${toParClass(f.strokes - par)}">
                <span class="feed-dot"></span>
                <span class="feed-text"><strong>${esc(p.name)}</strong> made ${esc(scoreName(f.strokes, par))} on #${f.hole + 1} (${f.strokes})${f.by === "admin" ? ' <span class="muted">· updated by admin</span>' : ""}</span>
                <span class="feed-time">${timeAgo(f.at)}</span>
            </li>`;
        }).join("")
        : `<li class="empty-state">Scores will show up here as they come in.</li>`);
}

function renderMe(t) {
    const wrap = $("meWrap");
    const p = myPlayer(t);
    if (!p) {
        setHTML(wrap, `
            <div class="card join-card">
                <h3>Find your scorecard</h3>
                <p class="muted">Enter the 4-digit player code you got from the tournament desk.</p>
                <form id="joinForm" class="join-form" data-tid="${esc(t.id)}">
                    <div class="field">
                        <label for="joinCode">Player code</label>
                        <input id="joinCode" inputmode="numeric" maxlength="6" required autocomplete="off" />
                    </div>
                    <div class="form-msg" id="joinMsg"></div>
                    <button type="submit" class="btn btn-primary btn-block">View My Card</button>
                </form>
            </div>`);
        return;
    }

    const lines = t.players.map(x => playerLine(t, x));
    const mine = lines.find(l => l.player.id === p.id);
    const flightRanked = rankLines(lines.filter(l => l.flight?.id === mine.flight?.id));
    const myRank = flightRanked.find(l => l.player.id === p.id);
    const mates = mine.team ? lines.filter(l => l.player.teamId === mine.team.id) : [];
    const editable = t.status !== "final";

    setHTML(wrap, `
        <div class="card me-card">
            <div class="me-head">
                <div class="user-avatar">${esc(p.name.trim().charAt(0).toUpperCase() || "?")}</div>
                <div class="me-id">
                    <div class="me-name">${esc(p.name)}</div>
                    <div class="muted">Handicap ${esc(p.handicap)} · Playing ${mine.ph}</div>
                </div>
                <button type="button" class="btn btn-ghost btn-sm" id="notMeBtn">Not you?</button>
            </div>
            <div class="me-stats">
                <div class="stat"><span>Flight</span><strong>${esc(mine.flight?.name || "–")}</strong>${mine.flight ? `<small>HCP ${esc(flightRange(t, mine.flight))}</small>` : ""}</div>
                <div class="stat"><span>Flight Position</span><strong>${myRank?.pos || "–"}</strong><small>of ${flightRanked.length}</small></div>
                <div class="stat"><span>Team</span><strong>${esc(mine.team?.name || "–")}</strong></div>
                <div class="stat"><span>Net to Par</span><strong class="topar ${mine.thru ? toParClass(mine.netToPar) : ""}">${mine.thru ? toPar(mine.netToPar) : "–"}</strong></div>
            </div>
            ${mates.length ? `
                <h4 class="section-h">${esc(mine.team.name)}</h4>
                <ul class="mates">${mates.map(m => `
                    <li class="${m.player.id === p.id ? "me" : ""}">
                        <span>${esc(m.player.name)}</span>
                        <span class="muted">${esc(m.flight?.name || "")} · HCP ${m.ph}</span>
                        <span class="muted">Thru ${m.thru === t.holes ? "F" : m.thru}</span>
                        <strong class="topar ${m.thru ? toParClass(m.netToPar) : ""}">${m.thru ? toPar(m.netToPar) : "–"}</strong>
                    </li>`).join("")}
                </ul>` : ""}
        </div>
        <div class="card">
            <div class="card-head">
                <h3>My Scorecard</h3>
                <span class="muted small">• = handicap stroke on that hole</span>
            </div>
            ${editable ? "" : `<p class="muted small">This tournament is final — scores are locked.</p>`}
            <div id="myCard" data-card-box>${scorecardHTML(t, p, editable)}</div>
        </div>`);
}

function renderTeams(t) {
    const lines = t.players.map(p => playerLine(t, p));
    const unassigned = lines.filter(l => !l.team);
    const teamCard = (name, members) => `
        <div class="team-card">
            <div class="team-name">${esc(name)}</div>
            ${members.length ? `<ul>${members.map(m => `
                <li><span>${esc(m.player.name)}</span><span class="flight-badge">${esc(m.flight?.name || "–")}</span><span class="muted">HCP ${esc(m.player.handicap)}</span></li>`).join("")}</ul>`
                : `<div class="muted small">No players yet.</div>`}
        </div>`;

    setHTML($("teamsWrap"), `
        <div class="card">
            <h3 class="section-h">Teams</h3>
            <div class="team-grid">
                ${t.teams.map(team => teamCard(team.name, lines.filter(l => l.player.teamId === team.id))).join("")}
                ${unassigned.length ? teamCard("Unassigned", unassigned) : ""}
            </div>
            ${!t.teams.length && !unassigned.length ? `<div class="empty-state">No teams yet.</div>` : ""}
        </div>
        <div class="card">
            <h3 class="section-h">Flights</h3>
            <p class="muted small">Flights are set by handicap index.</p>
            <div class="team-grid">
                ${sortedFlights(t).map(f => {
                    const members = lines.filter(l => l.flight?.id === f.id);
                    return `<div class="team-card">
                        <div class="team-name">${esc(f.name)} <span class="muted small">HCP ${esc(flightRange(t, f))}</span></div>
                        ${members.length ? `<ul>${members.map(m => `<li><span>${esc(m.player.name)}</span><span class="muted">${esc(m.team?.name || "")}</span><span class="muted">HCP ${esc(m.player.handicap)}</span></li>`).join("")}</ul>` : `<div class="muted small">No players yet.</div>`}
                    </div>`;
                }).join("")}
            </div>
        </div>`);
}

/* ---------------- events ---------------- */

function bindEvents() {
    document.querySelectorAll(".t-tab").forEach(b => b.addEventListener("click", () => {
        state.view = b.dataset.view;
        renderAll();
    }));

    $("tPicker").addEventListener("change", e => {
        setCurrent(e.target.value);
        state.boardFlight = "all";
        renderAll();
    });

    $("flightChips").addEventListener("click", e => {
        const b = e.target.closest("[data-flight]");
        if (!b) return;
        state.boardFlight = b.dataset.flight;
        renderAll();
    });

    $("boardMode").addEventListener("click", e => {
        const b = e.target.closest("[data-mode]");
        if (!b) return;
        state.boardMode = b.dataset.mode;
        renderAll();
    });

    $("meWrap").addEventListener("submit", e => {
        if (e.target.id !== "joinForm") return;
        e.preventDefault();
        const t = current();
        const code = $("joinCode").value.trim();
        const p = t?.players.find(x => x.code === code);
        if (!p) {
            $("joinMsg").textContent = "That code doesn't match a player in this tournament.";
            $("joinMsg").className = "form-msg error";
            return;
        }
        setMyPlayer(t.id, p.id);
        renderAll();
    });

    $("meWrap").addEventListener("click", e => {
        if (e.target.id !== "notMeBtn") return;
        setMyPlayer(current().id, NOT_ME);
        renderAll();
    });

    $("meWrap").addEventListener("change", e => {
        const inp = e.target.closest("input[data-hole]");
        const t = current();
        const p = t && myPlayer(t);
        if (!inp || !p || t.status === "final") return;
        saveHole(t.id, p.id, Number(inp.dataset.hole), inp.value, "player").catch(err => alert(err.message));
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    await startSync(renderAll);
    // Refresh "x minutes ago" labels.
    setInterval(() => { if (current()) renderFeed(current()); }, 30000);
});
