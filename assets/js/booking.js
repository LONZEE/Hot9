/* ==========================================================
   HOT 9 GOLF — Booking App logic
   Data layer is isolated behind `BookingStore` so it can be
   swapped from localStorage to a real API (Node/Express +
   MongoDB via Mongoose) later without touching the UI code.
   Just re-implement each method below to call `fetch('/api/...')`.
========================================================== */

const BAYS = [
    { id: "master", name: "Master Bay", desc: "Full Swing Pro 2.0", color: "#00ff7f" },
    { id: "standard-1", name: "Standard Bay 1", desc: "Full Swing simulator", color: "#4d9dff" },
    { id: "standard-2", name: "Standard Bay 2", desc: "Full Swing simulator", color: "#ff6bcb" },
];

const DOW_LABEL = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTH_LABEL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const BOOKING_WINDOW_DAYS = 14;

// Business hours by day-of-week, matching the schema on home.html
// 0 = Sunday ... 6 = Saturday
const HOURS = {
    0: { open: 7, close: 22 }, // Sun
    1: { open: 7, close: 22 }, // Mon
    2: { open: 7, close: 22 }, // Tue
    3: { open: 7, close: 22 }, // Wed
    4: { open: 7, close: 22 }, // Thu
    5: { open: 7, close: 24 }, // Fri
    6: { open: 7, close: 24 }, // Sat
};

/* ---------------- email notifications (EmailJS) ----------------
   1. Create a free account at https://www.emailjs.com
   2. Add an Email Service (e.g. Gmail) -> copy the Service ID
   3. Create an Email Template with variables: to_email, to_name,
      bay_name, booking_date, booking_time -> copy the Template ID
   4. Copy your Public Key from Account > API Keys
   5. Paste all three below. Until then, emails are skipped silently.
------------------------------------------------------------------- */
const EMAILJS_CONFIG = {
    publicKey: "YOUR_EMAILJS_PUBLIC_KEY",
    serviceId: "YOUR_EMAILJS_SERVICE_ID",
    templateId: "YOUR_EMAILJS_TEMPLATE_ID",
};
const SHOP_EMAIL = "hot9golf@gmail.com";

function emailIsConfigured() {
    return (
        window.emailjs &&
        !EMAILJS_CONFIG.publicKey.startsWith("YOUR_") &&
        !EMAILJS_CONFIG.serviceId.startsWith("YOUR_") &&
        !EMAILJS_CONFIG.templateId.startsWith("YOUR_")
    );
}

async function sendBookingEmail(booking, user) {
    if (!emailIsConfigured()) {
        console.info("EmailJS isn't configured yet — skipping booking email. See EMAILJS_CONFIG in booking.js.");
        return;
    }
    const bay = BAYS.find(b => b.id === booking.bayId);
    try {
        await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
            to_email: user.email,
            to_name: user.name,
            bay_name: bay ? bay.name : booking.bayId,
            booking_date: booking.date,
            booking_time: `${formatHour(booking.hour)} - ${formatHour(booking.hour + 1)}`,
            shop_email: SHOP_EMAIL,
        });
    } catch (err) {
        console.error("Booking email failed to send:", err);
    }
}

const LS_USERS = "h9_users";
const LS_SESSION = "h9_session";
const LS_BOOKINGS = "h9_bookings";

/* ---------------- helpers ---------------- */

async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

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

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function pad2(n) {
    return String(n).padStart(2, "0");
}

function formatHour(hour) {
    const h = hour % 24;
    const period = h >= 12 ? "PM" : "AM";
    const display = h % 12 === 0 ? 12 : h % 12;
    return `${display}:00 ${period}`;
}

function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/* ---------------- data layer ---------------- */

const BookingStore = {
    // --- auth ---
    async register({ name, email, password }) {
        const users = readJSON(LS_USERS, []);
        if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
            throw new Error("An account with that email already exists.");
        }
        const passHash = await sha256(password);
        const user = { id: uid(), name, email, passHash };
        users.push(user);
        writeJSON(LS_USERS, users);
        return { id: user.id, name: user.name, email: user.email };
    },

    async login({ email, password }) {
        const users = readJSON(LS_USERS, []);
        const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
        if (!user) throw new Error("No account found with that email.");
        const passHash = await sha256(password);
        if (passHash !== user.passHash) throw new Error("Incorrect password.");
        return { id: user.id, name: user.name, email: user.email };
    },

    getSession() {
        return readJSON(LS_SESSION, null);
    },
    setSession(user) {
        writeJSON(LS_SESSION, user);
    },
    clearSession() {
        localStorage.removeItem(LS_SESSION);
    },

    // --- bookings ---
    getBookings() {
        return readJSON(LS_BOOKINGS, []);
    },

    getBookingsFor(date, bayId) {
        return this.getBookings().filter(b => b.date === date && b.bayId === bayId);
    },

    getMyBookings(userId) {
        return this.getBookings()
            .filter(b => b.userId === userId)
            .sort((a, b) => (a.date + a.hour).localeCompare(b.date + b.hour));
    },

    async createBooking({ userId, userName, date, bayId, hour }) {
        const bookings = this.getBookings();
        const clash = bookings.some(b => b.date === date && b.bayId === bayId && b.hour === hour);
        if (clash) throw new Error("That slot was just booked by someone else. Pick another time.");
        const booking = { id: uid(), userId, userName, date, bayId, hour, createdAt: Date.now() };
        bookings.push(booking);
        writeJSON(LS_BOOKINGS, bookings);
        return booking;
    },

    cancelBooking(bookingId, userId) {
        const bookings = this.getBookings();
        const next = bookings.filter(b => !(b.id === bookingId && b.userId === userId));
        writeJSON(LS_BOOKINGS, next);
    },
};

/* ---------------- UI ---------------- */

const els = {};

function $(id) { return document.getElementById(id); }

function initEls() {
    els.authWrap = $("authWrap");
    els.appShell = $("appShell");
    els.tabLogin = $("tabLogin");
    els.tabRegister = $("tabRegister");
    els.formLogin = $("formLogin");
    els.formRegister = $("formRegister");
    els.loginMsg = $("loginMsg");
    els.registerMsg = $("registerMsg");

    els.userChipName = $("userChipName");
    els.userAvatar = $("userAvatar");
    els.logoutBtn = $("logoutBtn");

    els.navBook = $("navBook");
    els.navAppts = $("navAppts");
    els.viewBook = $("viewBook");
    els.viewAppts = $("viewAppts");

    els.monthLabel = $("monthLabel");
    els.weekPrev = $("weekPrev");
    els.weekNext = $("weekNext");
    els.dayStrip = $("dayStrip");
    els.bayTabs = $("bayTabs");
    els.slotGrid = $("slotGrid");
    els.summaryText = $("summaryText");
    els.confirmBtn = $("confirmBtn");
    els.bookingMsg = $("bookingMsg");

    els.apptCount = $("apptCount");
    els.apptList = $("apptList");
}

let state = {
    user: null,
    selectedBay: BAYS[0].id,
    selectedDate: todayISO(),
    selectedHour: null,
    weekOffset: 0, // 0 or 7, start index into the booking window
};

function addDays(iso, days) {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function switchAuthTab(tab) {
    const isLogin = tab === "login";
    els.tabLogin.classList.toggle("active", isLogin);
    els.tabRegister.classList.toggle("active", !isLogin);
    els.formLogin.classList.toggle("active", isLogin);
    els.formRegister.classList.toggle("active", !isLogin);
}

function showApp(user) {
    state.user = user;
    els.authWrap.style.display = "none";
    els.appShell.classList.add("active");
    els.logoutBtn.style.display = "";
    els.userChipName.textContent = user.name;
    els.userAvatar.textContent = user.name.trim().charAt(0).toUpperCase() || "?";
    renderDayStrip();
    renderBayTabs();
    renderSlots();
    renderAppointments();
}

function showAuth() {
    state.user = null;
    els.appShell.classList.remove("active");
    els.authWrap.style.display = "block";
    els.logoutBtn.style.display = "none";
}

function renderBayTabs() {
    els.bayTabs.innerHTML = "";
    BAYS.forEach(bay => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bay-tab" + (bay.id === state.selectedBay ? " active" : "");
        btn.textContent = bay.name;
        btn.addEventListener("click", () => {
            state.selectedBay = bay.id;
            state.selectedHour = null;
            renderBayTabs();
            renderSlots();
        });
        els.bayTabs.appendChild(btn);
    });
}

function renderDayStrip() {
    const today = todayISO();
    const start = addDays(today, state.weekOffset);
    const startDate = new Date(start + "T00:00:00");
    els.monthLabel.textContent = `${MONTH_LABEL[startDate.getMonth()]} ${startDate.getFullYear()}`;

    els.weekPrev.disabled = state.weekOffset <= 0;
    els.weekNext.disabled = state.weekOffset + 7 >= BOOKING_WINDOW_DAYS;

    els.dayStrip.innerHTML = "";
    for (let i = 0; i < 7; i++) {
        const offset = state.weekOffset + i;
        if (offset >= BOOKING_WINDOW_DAYS) break;
        const iso = addDays(today, offset);
        const d = new Date(iso + "T00:00:00");

        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "day-chip" + (iso === state.selectedDate ? " active" : "");
        chip.innerHTML = `<span class="dow">${DOW_LABEL[d.getDay()]}</span><span class="dom">${d.getDate()}</span>`;
        chip.addEventListener("click", () => {
            state.selectedDate = iso;
            state.selectedHour = null;
            renderDayStrip();
            renderSlots();
        });
        els.dayStrip.appendChild(chip);
    }
}

function renderSlots() {
    els.slotGrid.innerHTML = "";
    els.bookingMsg.textContent = "";

    const bay = BAYS.find(b => b.id === state.selectedBay);
    const date = new Date(state.selectedDate + "T00:00:00");
    const dow = date.getDay();
    const hours = HOURS[dow];
    const existing = BookingStore.getBookingsFor(state.selectedDate, state.selectedBay);
    const bookedHours = new Set(existing.map(b => b.hour));

    const now = new Date();
    const isToday = state.selectedDate === todayISO();

    for (let h = hours.open; h < hours.close; h++) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "slot-row";
        row.style.setProperty("--bay-color", bay.color);

        const isPast = isToday && h <= now.getHours();
        const isBooked = bookedHours.has(h);
        const isSelected = state.selectedHour === h && !isBooked && !isPast;
        const isAvailable = !isBooked && !isPast && !isSelected;

        let pillLabel = "";
        if (isBooked) pillLabel = "Booked";
        else if (isSelected) pillLabel = "Selected";

        row.innerHTML = `
            <div>
                <div class="slot-time">${isAvailable ? '<span class="status-dot"></span>' : ""}${formatHour(h)} &ndash; ${formatHour(h + 1)}</div>
                <div class="slot-sub">${bay.name} &middot; 1 hour session</div>
            </div>
            ${pillLabel ? `<span class="slot-pill">${pillLabel}</span>` : ""}
        `;

        if (isBooked || isPast) row.disabled = true;
        if (isBooked) row.classList.add("booked");
        if (isSelected) row.classList.add("selected");
        if (isAvailable) row.classList.add("available");

        row.addEventListener("click", () => {
            state.selectedHour = h;
            renderSlots();
        });
        els.slotGrid.appendChild(row);
    }

    updateSummary();
}

function updateSummary() {
    const bay = BAYS.find(b => b.id === state.selectedBay);
    if (state.selectedHour === null) {
        els.summaryText.innerHTML = "Select a time slot to continue.";
        els.confirmBtn.disabled = true;
        return;
    }
    els.summaryText.innerHTML =
        `<strong>${bay.name}</strong> on <strong>${state.selectedDate}</strong> at <strong>${formatHour(state.selectedHour)}</strong> &middot; 1 hour session`;
    els.confirmBtn.disabled = false;
}

async function renderAppointments() {
    const mine = BookingStore.getMyBookings(state.user.id);
    els.apptCount.textContent = mine.length;
    els.apptList.innerHTML = "";
    if (!mine.length) {
        els.apptList.innerHTML = `<div class="empty-state">You have no upcoming sessions yet. Book a bay to get started.</div>`;
        return;
    }
    mine.forEach(b => {
        const bay = BAYS.find(x => x.id === b.bayId);
        const item = document.createElement("div");
        item.className = "appt-item";
        item.style.setProperty("--bay-color", bay ? bay.color : "#00ff7f");
        item.innerHTML = `
            <div>
                <div class="appt-time">${b.date} &middot; ${formatHour(b.hour)} - ${formatHour(b.hour + 1)}</div>
                <div class="appt-bay-name">${bay ? bay.name : b.bayId}</div>
            </div>
            <div class="appt-right">
                <span class="appt-duration">&#9201; 1 hr</span>
            </div>
        `;
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "btn btn-ghost btn-sm";
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", () => {
            BookingStore.cancelBooking(b.id, state.user.id);
            renderAppointments();
            renderSlots();
        });
        item.querySelector(".appt-right").appendChild(cancelBtn);
        els.apptList.appendChild(item);
    });
}

function switchView(view) {
    const isBook = view === "book";
    els.navBook.classList.toggle("btn-outline", isBook);
    els.navBook.classList.toggle("btn-ghost", !isBook);
    els.navAppts.classList.toggle("btn-outline", !isBook);
    els.navAppts.classList.toggle("btn-ghost", isBook);
    els.viewBook.classList.toggle("active", isBook);
    els.viewAppts.classList.toggle("active", !isBook);
    if (!isBook) renderAppointments();
}

function bindEvents() {
    els.tabLogin.addEventListener("click", () => switchAuthTab("login"));
    els.tabRegister.addEventListener("click", () => switchAuthTab("register"));

    els.formLogin.addEventListener("submit", async (e) => {
        e.preventDefault();
        els.loginMsg.textContent = "";
        els.loginMsg.className = "form-msg";
        const email = $("loginEmail").value.trim();
        const password = $("loginPassword").value;
        try {
            const user = await BookingStore.login({ email, password });
            BookingStore.setSession(user);
            showApp(user);
        } catch (err) {
            els.loginMsg.textContent = err.message;
            els.loginMsg.className = "form-msg error";
        }
    });

    els.formRegister.addEventListener("submit", async (e) => {
        e.preventDefault();
        els.registerMsg.textContent = "";
        els.registerMsg.className = "form-msg";
        const name = $("registerName").value.trim();
        const email = $("registerEmail").value.trim();
        const password = $("registerPassword").value;
        const confirm = $("registerConfirm").value;

        if (password.length < 6) {
            els.registerMsg.textContent = "Password must be at least 6 characters.";
            els.registerMsg.className = "form-msg error";
            return;
        }
        if (password !== confirm) {
            els.registerMsg.textContent = "Passwords do not match.";
            els.registerMsg.className = "form-msg error";
            return;
        }
        try {
            const user = await BookingStore.register({ name, email, password });
            BookingStore.setSession(user);
            showApp(user);
        } catch (err) {
            els.registerMsg.textContent = err.message;
            els.registerMsg.className = "form-msg error";
        }
    });

    els.logoutBtn.addEventListener("click", () => {
        BookingStore.clearSession();
        showAuth();
        switchAuthTab("login");
    });

    els.weekPrev.addEventListener("click", () => {
        state.weekOffset = Math.max(0, state.weekOffset - 7);
        renderDayStrip();
    });
    els.weekNext.addEventListener("click", () => {
        state.weekOffset = Math.min(BOOKING_WINDOW_DAYS - 7, state.weekOffset + 7);
        renderDayStrip();
    });

    els.confirmBtn.addEventListener("click", async () => {
        els.bookingMsg.textContent = "";
        els.bookingMsg.className = "form-msg";
        try {
            const booking = await BookingStore.createBooking({
                userId: state.user.id,
                userName: state.user.name,
                date: state.selectedDate,
                bayId: state.selectedBay,
                hour: state.selectedHour,
            });
            state.selectedHour = null;
            renderSlots();
            renderAppointments();
            els.bookingMsg.textContent = "Bay booked! Check your email for confirmation.";
            els.bookingMsg.className = "form-msg success";
            sendBookingEmail(booking, state.user);
        } catch (err) {
            els.bookingMsg.textContent = err.message;
            els.bookingMsg.className = "form-msg error";
            renderSlots();
        }
    });

    els.navBook.addEventListener("click", () => switchView("book"));
    els.navAppts.addEventListener("click", () => switchView("appts"));
}

function init() {
    initEls();
    bindEvents();

    if (emailIsConfigured()) {
        emailjs.init({ publicKey: EMAILJS_CONFIG.publicKey });
    }

    state.selectedDate = todayISO();

    const session = BookingStore.getSession();
    if (session) {
        showApp(session);
    } else {
        showAuth();
    }
}

document.addEventListener("DOMContentLoaded", init);
