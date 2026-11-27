const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const zones = ["UTC", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Dubai", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"];
const sounds = ["chime", "beep", "rise", "bell"];
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const presets = [1, 5, 10, 25, 60];

const icon = path => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const tabs = [
  ["clock", "Clock", icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')],
  ["alarms", "Alarms", icon('<path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7"/><path d="M10 20h4"/>')],
  ["timers", "Timers", icon('<path d="M9 3h6"/><circle cx="12" cy="14" r="7"/><path d="M12 14l3-3"/>')],
  ["stopwatch", "Stopwatch", icon('<circle cx="12" cy="13" r="8"/><path d="M12 13V8M10 2h4"/>')],
  ["settings", "Settings", icon('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>')]
];

let store;
let view = "clock";
let ringing = null;
let audio = null;
const watch = { start: 0, acc: 0, running: false, laps: [] };

const $ = selector => document.querySelector(selector);
const pad = n => String(n).padStart(2, "0");
const zoneName = zone => zone.split("/").pop().replace(/_/g, " ");

function hourCycle() {
  const format = store.settings.time_format;
  return format === "12" ? true : format === "24" ? false : undefined;
}

function formatClock(date, zone) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: store.settings.show_seconds ? "2-digit" : undefined,
    hour12: hourCycle(),
    timeZone: zone
  }).format(date);
}

function formatAlarm(hour, minute) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: hourCycle() }).format(new Date(2000, 0, 1, hour, minute));
}

function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60].map(pad).join(":");
}

function watchElapsed() {
  return watch.acc + (watch.running ? performance.now() - watch.start : 0);
}

function formatWatch(ms) {
  const centi = Math.floor(ms / 10) % 100;
  const total = Math.floor(ms / 1000);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}.${pad(centi)}`;
}

function applyTheme() {
  const { theme, accent, font, density } = store.settings;
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.density = density;
  root.style.setProperty("--accent", accent);
  const families = {
    mono: '"Cascadia Mono", Consolas, monospace',
    serif: 'Georgia, "Times New Roman", serif'
  };
  root.style.setProperty("--font", families[font] || '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif');
}

function sound(name) {
  const bank = {
    chime: [[880, 0, 1.4, "sine"], [1318, 0.28, 1.6, "sine"]],
    beep: [[1000, 0, 0.12, "square"], [1000, 0.2, 0.12, "square"], [1000, 0.4, 0.12, "square"]],
    rise: [[523, 0, 0.5, "triangle"], [659, 0.3, 0.5, "triangle"], [784, 0.6, 0.8, "triangle"]],
    bell: [[660, 0, 2, "sine"], [1320, 0, 1.2, "sine"], [1980, 0, 0.8, "sine"]]
  };
  return bank[name] || bank.chime;
}

function startRing(payload) {
  stopRing();
  const context = new AudioContext();
  const master = context.createGain();
  master.connect(context.destination);
  const { ramp_volume, auto_silence_secs } = store.settings;
  master.gain.setValueAtTime(ramp_volume ? 0.1 : 1, context.currentTime);
  if (ramp_volume) master.gain.linearRampToValueAtTime(1, context.currentTime + 15);

  const play = () => {
    for (const [freq, offset, length, type] of sound(payload.sound)) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      const t = context.currentTime + offset;
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + length);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + length + 0.05);
    }
  };

  play();
  const loop = setInterval(play, 2200);
  const silence = auto_silence_secs > 0 ? setTimeout(stopRing, auto_silence_secs * 1000) : null;
  audio = { context, loop, silence };
  ringing = payload;
  showRing();
}

function stopRing() {
  if (audio) {
    clearInterval(audio.loop);
    clearTimeout(audio.silence);
    audio.context.close();
    audio = null;
  }
}

function showRing() {
  const el = $("#ring");
  if (!ringing) {
    el.hidden = true;
    return;
  }
  const kind = ringing.kind === "alarm" ? "Alarm" : "Timer finished";
  el.innerHTML = `<div class="panel"><div class="title">${kind}</div><div class="muted">${ringing.label || ""}</div><div class="row">${ringing.kind === "alarm" ? '<button data-act="snooze">Snooze</button>' : ""}<button class="primary" data-act="dismiss">Dismiss</button></div></div>`;
  el.hidden = false;
}

function clockView() {
  const { world_clocks } = store.settings;
  const options = zones.filter(z => !world_clocks.includes(z)).map(z => `<option value="${z}">${zoneName(z)}</option>`).join("");
  const cards = world_clocks.map(z => `<div class="card"><div class="muted">${zoneName(z)}</div><div class="mid" data-zone="${z}"></div><button class="link" data-act="removeZone" data-v="${z}">Remove</button></div>`).join("");
  return `<h1>Clock</h1><div class="hero"><div class="time" data-clock></div><div class="date" data-date></div></div><h2>World clocks</h2><div class="grid">${cards}</div><div class="row"><select id="zonePick">${options}</select><button data-act="addZone">Add clock</button></div>`;
}

function alarmsView() {
  const items = store.alarms.map(a => {
    const repeat = a.days.length === 0 ? "Once" : a.days.length === 7 ? "Every day" : a.days.map(d => weekdays[d]).join(", ");
    return `<div class="item"><div class="big">${formatAlarm(a.hour, a.minute)}</div><div class="grow"><div>${a.label || "Alarm"}</div><div class="muted">${repeat}</div></div><button class="link" data-act="deleteAlarm" data-id="${a.id}">Delete</button><label class="switch"><input type="checkbox" data-act="toggleAlarm" data-id="${a.id}" ${a.enabled ? "checked" : ""}><i></i></label></div>`;
  }).join("");
  const dayChips = weekdays.map((d, i) => `<label><input type="checkbox" name="day" value="${i}"><span>${d}</span></label>`).join("");
  const soundOptions = sounds.map(s => `<option value="${s}" ${s === store.settings.default_sound ? "selected" : ""}>${s}</option>`).join("");
  return `<h1>Alarms</h1><div class="list">${items || '<div class="empty">No alarms yet. Set a time below to create one.</div>'}</div><h2>New alarm</h2><div class="row"><input type="time" id="alarmTime" value="07:00"><input type="text" id="alarmLabel" placeholder="Label"><select id="alarmSound">${soundOptions}</select></div><div class="row"><div class="days">${dayChips}</div></div><div class="row"><button class="primary" data-act="addAlarm">Add alarm</button></div>`;
}

function timersView() {
  const items = store.timers.map(t => `<div class="item"><div class="big" data-timer="${t.id}"></div><div class="grow">${t.label}</div>${t.running ? `<button data-act="pauseTimer" data-id="${t.id}">Pause</button>` : `<button class="primary" data-act="startTimer" data-id="${t.id}">Start</button>`}<button data-act="resetTimer" data-id="${t.id}">Reset</button><button class="link" data-act="deleteTimer" data-id="${t.id}">Delete</button></div>`).join("");
  const buttons = presets.map(m => `<button data-act="preset" data-v="${m}">${m} min</button>`).join("");
  return `<h1>Timers</h1><div class="list">${items || '<div class="empty">No timers yet. Pick a preset or enter a length below.</div>'}</div><h2>New timer</h2><div class="row">${buttons}</div><div class="row"><input type="number" id="customMinutes" min="1" max="999" placeholder="Minutes"><input type="text" id="customLabel" placeholder="Label"><button class="primary" data-act="customTimer">Add timer</button></div>`;
}

function stopwatchView() {
  const laps = watch.laps.map((lap, i) => `<div class="item"><div class="muted">Lap ${watch.laps.length - i}</div><div class="grow"></div><div>${formatWatch(lap.split)}</div><div class="muted">${formatWatch(lap.total)}</div></div>`).join("");
  return `<h1>Stopwatch</h1><div class="sw-time" data-watch></div><div class="row"><button class="primary" data-act="watchToggle">${watch.running ? "Stop" : "Start"}</button><button data-act="watchLap" ${watch.running ? "" : "disabled"}>Lap</button><button data-act="watchReset">Reset</button></div><h2>Laps</h2><div class="list">${laps || '<div class="empty">Laps appear here while the stopwatch runs.</div>'}</div>`;
}

function select(key, options) {
  const current = store.settings[key];
  return `<select data-set="${key}">${options.map(([v, l]) => `<option value="${v}" ${v === current ? "selected" : ""}>${l}</option>`).join("")}</select>`;
}

function toggle(key) {
  return `<label class="switch"><input type="checkbox" data-set="${key}" ${store.settings[key] ? "checked" : ""}><i></i></label>`;
}

function setting(label, control) {
  return `<div class="setting"><div>${label}</div>${control}</div>`;
}

function settingsView() {
  const s = store.settings;
  const soundList = sounds.map(x => [x, x]);
  return `<h1>Settings</h1><h2>Appearance</h2><div class="list">
    ${setting("Theme", select("theme", [["system", "Match Windows"], ["light", "Light"], ["dark", "Dark"]]))}
    ${setting("Accent color", `<input type="color" data-set="accent" value="${s.accent}">`)}
    ${setting("Font", select("font", [["system", "Windows default"], ["mono", "Monospace"], ["serif", "Serif"]]))}
    ${setting("Density", select("density", [["compact", "Compact"], ["comfortable", "Comfortable"], ["spacious", "Spacious"]]))}
    ${setting("Time format", select("time_format", [["system", "Match Windows"], ["12", "12-hour"], ["24", "24-hour"]]))}
    ${setting("Show seconds", toggle("show_seconds"))}
  </div><h2>Alerts</h2><div class="list">
    ${setting("Windows notifications", toggle("notifications"))}
    ${setting("Default sound", select("default_sound", soundList))}
    ${setting("Raise volume gradually", toggle("ramp_volume"))}
    ${setting("Silence after (seconds)", `<input type="number" data-set="auto_silence_secs" min="0" max="600" value="${s.auto_silence_secs}">`)}
    ${setting("Snooze length (minutes)", `<input type="number" data-set="snooze_minutes" min="1" max="60" value="${s.snooze_minutes}">`)}
  </div><h2>System</h2><div class="list">
    ${setting("Keep running in the tray when closed", toggle("minimize_to_tray"))}
    ${setting("Start with Windows", `<label class="switch"><input type="checkbox" data-set="autostart"><i></i></label>`)}
  </div><div class="row"><button data-act="resetSettings">Reset to defaults</button></div>`;
}

const views = { clock: clockView, alarms: alarmsView, timers: timersView, stopwatch: stopwatchView, settings: settingsView };

function render() {
  $("#nav").innerHTML = `<div class="brand">Tempo</div>${tabs.map(([id, label, svg]) => `<button data-act="go" data-v="${id}" ${id === view ? 'aria-current="true"' : ""}>${svg}${label}</button>`).join("")}`;
  $("#main").innerHTML = views[view]();
  if (view === "settings") {
    invoke("plugin:autostart|is_enabled").then(on => {
      const box = $("[data-set=autostart]");
      if (box) box.checked = on;
    }).catch(() => {});
  }
  tick();
}

function tick() {
  const now = new Date();
  const clock = $("[data-clock]");
  if (clock) {
    clock.textContent = formatClock(now);
    $("[data-date]").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(now);
  }
  document.querySelectorAll("[data-zone]").forEach(el => { el.textContent = formatClock(now, el.dataset.zone); });
  document.querySelectorAll("[data-timer]").forEach(el => {
    const timer = store.timers.find(t => t.id === el.dataset.timer);
    if (timer) el.textContent = formatDuration(timer.running ? Date.parse(timer.ends_at) - Date.now() : timer.remaining_ms);
  });
  const display = $("[data-watch]");
  if (display) display.textContent = formatWatch(watchElapsed());
}

async function setSetting(key, value) {
  store = await invoke("update_settings", { settings: { ...store.settings, [key]: value } });
  applyTheme();
}

async function addTimer(minutes, label) {
  store = await invoke("save_timer", {
    timer: { id: crypto.randomUUID(), label: label || `${minutes} min`, duration_secs: minutes * 60, remaining_ms: 0, running: false, ends_at: null, sound: store.settings.default_sound }
  });
  render();
}

const actions = {
  go: (_, v) => { view = v; render(); },
  addZone: async () => {
    const zone = $("#zonePick")?.value;
    if (zone) await setSetting("world_clocks", [...store.settings.world_clocks, zone]);
    render();
  },
  removeZone: async (_, v) => {
    await setSetting("world_clocks", store.settings.world_clocks.filter(z => z !== v));
    render();
  },
  addAlarm: async () => {
    const [hour, minute] = $("#alarmTime").value.split(":").map(Number);
    const days = [...document.querySelectorAll("[name=day]:checked")].map(x => Number(x.value));
    store = await invoke("save_alarm", {
      alarm: { id: crypto.randomUUID(), label: $("#alarmLabel").value.trim(), hour, minute, days, enabled: true, sound: $("#alarmSound").value, snooze_minutes: store.settings.snooze_minutes }
    });
    render();
  },
  toggleAlarm: async (id, _, el) => { store = await invoke("set_alarm_enabled", { id, enabled: el.checked }); },
  deleteAlarm: async id => { store = await invoke("delete_alarm", { id }); render(); },
  preset: (_, v) => addTimer(Number(v)),
  customTimer: () => {
    const minutes = Number($("#customMinutes").value);
    if (minutes > 0) addTimer(minutes, $("#customLabel").value.trim());
  },
  startTimer: async id => { store = await invoke("start_timer", { id }); render(); },
  pauseTimer: async id => { store = await invoke("pause_timer", { id }); render(); },
  resetTimer: async id => { store = await invoke("reset_timer", { id }); render(); },
  deleteTimer: async id => { store = await invoke("delete_timer", { id }); render(); },
  watchToggle: () => {
    if (watch.running) watch.acc += performance.now() - watch.start;
    else watch.start = performance.now();
    watch.running = !watch.running;
    render();
  },
  watchLap: () => {
    const total = watchElapsed();
    const previous = watch.laps.length ? watch.laps[0].total : 0;
    watch.laps.unshift({ total, split: total - previous });
    render();
  },
  watchReset: () => { Object.assign(watch, { start: 0, acc: 0, running: false, laps: [] }); render(); },
  snooze: async () => {
    stopRing();
    if (ringing) store = await invoke("snooze_alarm", { id: ringing.id });
    ringing = null;
    showRing();
  },
  dismiss: async () => {
    stopRing();
    if (ringing?.kind === "alarm") store = await invoke("dismiss_alarm", { id: ringing.id });
    ringing = null;
    showRing();
    render();
  },
  resetSettings: async () => { store = await invoke("reset_settings"); applyTheme(); render(); }
};

document.addEventListener("click", event => {
  const el = event.target.closest("[data-act]");
  if (el) actions[el.dataset.act]?.(el.dataset.id, el.dataset.v, el);
});

document.addEventListener("change", async event => {
  const el = event.target.closest("[data-set]");
  if (!el) return;
  const key = el.dataset.set;
  const value = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
  if (key === "autostart") {
    await invoke(`plugin:autostart|${value ? "enable" : "disable"}`);
    return;
  }
  await setSetting(key, value);
});

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => store && applyTheme());

async function start() {
  store = await invoke("get_store");
  applyTheme();
  render();
  setInterval(tick, 200);
  listen("ring", event => startRing(event.payload));
  listen("store-changed", event => {
    store = event.payload;
    if (view === "alarms" || view === "timers") render();
  });
}

start();
