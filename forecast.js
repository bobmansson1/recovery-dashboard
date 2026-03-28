/* ──────────────────────────────────────────────────────────────
   SUPABASE CONNECTION
   ────────────────────────────────────────────────────────────── */

const SUPABASE_URL = 'https://zamwktaebxpkbldrbseh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphbXdrdGFlYnhwa2JsZHJic2VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjAzNDksImV4cCI6MjA4OTkzNjM0OX0.k0PXIoofcgvQCmHie_bChux6VexPsDqNt5T8_tvvDOI';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);


/* ──────────────────────────────────────────────────────────────
   AUTHENTICATION
   Same pattern as app.js — keeps the login button consistent
   across both pages. Forecast has no write operations so there
   is nothing to show/hide beyond the auth button itself.
   ────────────────────────────────────────────────────────────── */

async function signIn() {
  await db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
}

async function signOut() {
  await db.auth.signOut();
  updateAuthUI(null);
}

function updateAuthUI(session) {
  const isOwner  = !!session;
  document.body.classList.toggle('owner', isOwner);

  const loginBtn = document.getElementById('loginBtn');
  const userInfo = document.getElementById('userInfo');
  if (!loginBtn || !userInfo) return;

  if (isOwner) {
    loginBtn.style.display = 'none';
    userInfo.style.display = 'flex';
    const avatar    = document.getElementById('userAvatar');
    const avatarUrl = session.user.user_metadata?.avatar_url;
    if (avatar && avatarUrl) avatar.src = avatarUrl;
  } else {
    loginBtn.style.display = '';
    userInfo.style.display = 'none';
  }
}


/* ──────────────────────────────────────────────────────────────
   UTILITY HELPERS
   ────────────────────────────────────────────────────────────── */

// Converts a Date object to "YYYY-MM-DD" using LOCAL time, not UTC.
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getToday() {
  return toDateStr(new Date());
}

// Returns date strings from Monday of the current week up to today.
// e.g. if today is Wednesday: ["2025-03-24", "2025-03-25", "2025-03-26"]
function getCurrentWeekDates() {
  const today      = new Date();
  const dayOfWeek  = today.getDay(); // 0 = Sun, 1 = Mon, …
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const dates = [];
  for (let i = daysToMonday; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dates.push(toDateStr(d));
  }
  return dates;
}

// Returns a short day name like "Mon", "Tue" from a date string
function shortDayName(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('sv-SE', { weekday: 'short' });
}

// Formats a date range as "24 Mar – 30 Mar"
function formatWeekRange(dates) {
  if (!dates.length) return '';
  const fmt = s => new Date(s + 'T00:00:00').toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
  return `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`;
}

// Average of an array, ignoring null/undefined values
function avg(arr) {
  const valid = arr.filter(v => v !== null && v !== undefined);
  if (!valid.length) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

// Shows/hides the offline banner
function showOfflineBanner() {
  const banner = document.getElementById('offlineBanner');
  if (banner) banner.style.display = 'block';
}


/* ──────────────────────────────────────────────────────────────
   WMO WEATHER CODE HELPERS
   Maps numeric codes from Open-Meteo to emoji + label.
   ────────────────────────────────────────────────────────────── */

function wmoToInfo(code) {
  if (code === 0)  return { icon: '☀️',  label: 'Klar himmel' };
  if (code === 1)  return { icon: '🌤️', label: 'Mestadels klart' };
  if (code === 2)  return { icon: '⛅',  label: 'Delvis molnigt' };
  if (code === 3)  return { icon: '☁️',  label: 'Mulet' };
  if (code <= 48)  return { icon: '🌫️', label: 'Dimma' };
  if (code <= 55)  return { icon: '🌦️', label: 'Duggregn' };
  if (code <= 65)  return { icon: '🌧️', label: 'Regn' };
  if (code <= 67)  return { icon: '🌧️', label: 'Underkylt regn' };
  if (code <= 75)  return { icon: '🌨️', label: 'Snö' };
  if (code <= 77)  return { icon: '🌨️', label: 'Snökorn' };
  if (code <= 82)  return { icon: '🌦️', label: 'Regnskurar' };
  if (code <= 86)  return { icon: '🌨️', label: 'Snöskurar' };
  if (code === 95) return { icon: '⛈️',  label: 'Åska' };
  if (code >= 96)  return { icon: '⛈️',  label: 'Åska' };
  return { icon: '🌡️', label: 'Okänt' };
}


/* ──────────────────────────────────────────────────────────────
   SECTION 1 — WEEKLY RECOVERY SUMMARY

   Reads from the same Supabase tables as the dashboard:
     wellbeing  → mood, energy, motivation, pain averages
     reading    → total pages this week
     sleep      → average hours slept this week

   All three tables are queried in parallel using Promise.all
   so the page loads as fast as possible.
   ────────────────────────────────────────────────────────────── */

async function calcWeeklyStats() {
  const weekDates = getCurrentWeekDates();

  // Fire alla fyra frågor parallellt för snabbast möjliga laddning
  const [wellbeingResult, readingResult, sleepResult, exercisesResult] = await Promise.all([
    db.from('wellbeing').select('*').in('date', weekDates),
    db.from('reading').select('date, pages_read').in('date', weekDates),
    db.from('sleep').select('date, hours').in('date', weekDates),
    db.from('exercises').select('date, completions').in('date', weekDates)
  ]);

  // Turn each array of rows into a lookup object keyed by date
  const wellbeing = {};
  (wellbeingResult.data || []).forEach(r => { wellbeing[r.date] = r; });

  const readingLog = {};
  (readingResult.data || []).forEach(r => { readingLog[r.date] = r.pages_read; });

  const sleepLog = {};
  (sleepResult.data || []).forEach(r => { sleepLog[r.date] = parseFloat(r.hours); });

  // Summera ifyllda cirklar per dag (varje rad = en övning med boolean-array)
  const exerciseTotals = {};
  (exercisesResult.data || []).forEach(r => {
    const count = r.completions.filter(Boolean).length;
    exerciseTotals[r.date] = (exerciseTotals[r.date] || 0) + count;
  });

  const moods       = weekDates.map(d => wellbeing[d] ? wellbeing[d].mood       : null);
  const energies    = weekDates.map(d => wellbeing[d] ? wellbeing[d].energy     : null);
  const motivations = weekDates.map(d => wellbeing[d] ? wellbeing[d].motivation : null);
  const pains       = weekDates.map(d => wellbeing[d] ? wellbeing[d].pain       : null);

  const pages       = weekDates.reduce((sum, d) => sum + (readingLog[d] || 0), 0);
  const sleepValues = weekDates.map(d => sleepLog[d] !== undefined ? sleepLog[d] : null);

  // Snitt övningar: räkna bara dagar som har registrerad data (ignorera null-dagar)
  const exerciseValues = weekDates.map(d =>
    exerciseTotals[d] !== undefined ? exerciseTotals[d] : null
  );

  return {
    mood:       avg(moods),
    energy:     avg(energies),
    motivation: avg(motivations),
    pain:       avg(pains),
    pages,
    sleep:      avg(sleepValues),
    exercises:  avg(exerciseValues),
    weekDates
  };
}

function getMotivationalMessage(avgMood) {
  if (avgMood === null) {
    return {
      icon: '📋',
      text: 'Inga välmåendebetyg registrerade denna vecka. Gå till dashboarden och logga ditt första!'
    };
  }
  if (avgMood < 5) {
    return {
      icon: '💙',
      text: 'Återhämtning tar tid och varje litet steg framåt räknas. Ha tålamod och var snäll mot dig själv — du gör det bättre än du tror.'
    };
  }
  if (avgMood <= 7) {
    return {
      icon: '⭐',
      text: 'Du gör stadiga framsteg, Bob. Konsekvens är allt i återhämtning — fortsätt visa upp varje dag och resultaten kommer att följa.'
    };
  }
  return {
    icon: '🎉',
    text: 'Vilken vecka! Du är i strålande form Bob — siffrorna talar för sig själva. Håll den här energin vid liv!'
  };
}

// Updates a stat card element — shows "—" in muted style if no data
function setStatCard(id, value, decimals = 1) {
  const el = document.getElementById(id);
  if (value === null) {
    el.textContent = '—';
    el.classList.add('no-data');
  } else {
    el.textContent = typeof decimals === 'number' ? value.toFixed(decimals) : value;
    el.classList.remove('no-data');
  }
}

async function renderSummary() {
  const stats = await calcWeeklyStats();

  // Motivational message card
  const msg = getMotivationalMessage(stats.mood);
  document.getElementById('messageIcon').textContent = msg.icon;
  document.getElementById('messageText').textContent = msg.text;
  document.getElementById('messageWeek').textContent = `Vecka: ${formatWeekRange(stats.weekDates)}`;

  // Six stat cards
  setStatCard('statMood',       stats.mood);
  setStatCard('statEnergy',     stats.energy);
  setStatCard('statMotivation', stats.motivation);
  setStatCard('statPain',       stats.pain);

  // Pages: always show a number (0 is meaningful, unlike the other metrics)
  const pagesEl = document.getElementById('statPages');
  pagesEl.textContent = stats.pages;
  pagesEl.classList.remove('no-data');

  setStatCard('statSleep',      stats.sleep);
  setStatCard('statExercises',  stats.exercises);
}


/* ──────────────────────────────────────────────────────────────
   SECTION 2 — WEATHER FORECAST
   Uses the Open-Meteo free API (no key required).
   Kalmar and Abisko fetch independently — one failing won't
   affect the other.
   ────────────────────────────────────────────────────────────── */

async function fetchWeather() {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    '?latitude=56.6616&longitude=16.3566' +
    '&daily=temperature_2m_max,temperature_2m_min,weathercode' +
    '&current_weather=true' +
    '&timezone=Europe%2FStockholm' +
    '&forecast_days=7';

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderWeather(await response.json());
  } catch (err) {
    console.warn('Kalmar weather fetch failed:', err);
    showWeatherError();
  }
}

function renderWeather(data) {
  const current     = data.current_weather;
  const daily       = data.daily;
  const currentInfo = wmoToInfo(current.weathercode);

  document.getElementById('currentIcon').textContent      = currentInfo.icon;
  document.getElementById('currentTemp').innerHTML        = `${Math.round(current.temperature)}<sup>°C</sup>`;
  document.getElementById('currentCondition').textContent = currentInfo.label;

  const strip = document.getElementById('forecastStrip');
  strip.innerHTML = '';
  daily.time.forEach((dateStr, i) => {
    const info  = wmoToInfo(daily.weathercode[i]);
    const hi    = Math.round(daily.temperature_2m_max[i]);
    const lo    = Math.round(daily.temperature_2m_min[i]);
    const dayEl = document.createElement('div');
    dayEl.className = 'forecast-day';
    dayEl.innerHTML = `
      <div class="forecast-day-name">${shortDayName(dateStr)}</div>
      <span class="forecast-icon">${info.icon}</span>
      <div class="forecast-hi">${hi}°</div>
      <div class="forecast-lo">${lo}°</div>
    `;
    strip.appendChild(dayEl);
  });

  document.getElementById('weatherStatus').style.display  = 'none';
  document.getElementById('weatherContent').style.display = 'block';
}

function showWeatherError() {
  const status = document.getElementById('weatherStatus');
  status.classList.add('error');
  status.innerHTML = 'Väderdata är otillgänglig just nu — försök ladda om sidan.';
}

async function fetchWeatherAbisko() {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    '?latitude=68.35&longitude=18.83' +
    '&daily=temperature_2m_max,temperature_2m_min,weathercode' +
    '&current_weather=true' +
    '&timezone=Europe%2FStockholm' +
    '&forecast_days=7';

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderWeatherAbisko(await response.json());
  } catch (err) {
    console.warn('Abisko weather fetch failed:', err);
    const status = document.getElementById('abiskoStatus');
    status.classList.add('error');
    status.innerHTML = 'Väderdata är otillgänglig just nu — försök ladda om sidan.';
  }
}

function renderWeatherAbisko(data) {
  const current     = data.current_weather;
  const daily       = data.daily;
  const currentInfo = wmoToInfo(current.weathercode);

  document.getElementById('abiskoIcon').textContent      = currentInfo.icon;
  document.getElementById('abiskoTemp').innerHTML        = `${Math.round(current.temperature)}<sup>°C</sup>`;
  document.getElementById('abiskoCondition').textContent = currentInfo.label;

  const strip = document.getElementById('abiskoStrip');
  strip.innerHTML = '';
  daily.time.forEach((dateStr, i) => {
    const info  = wmoToInfo(daily.weathercode[i]);
    const hi    = Math.round(daily.temperature_2m_max[i]);
    const lo    = Math.round(daily.temperature_2m_min[i]);
    const dayEl = document.createElement('div');
    dayEl.className = 'forecast-day';
    dayEl.innerHTML = `
      <div class="forecast-day-name">${shortDayName(dateStr)}</div>
      <span class="forecast-icon">${info.icon}</span>
      <div class="forecast-hi">${hi}°</div>
      <div class="forecast-lo">${lo}°</div>
    `;
    strip.appendChild(dayEl);
  });

  document.getElementById('abiskoStatus').style.display  = 'none';
  document.getElementById('abiskoContent').style.display = 'block';
}


/* ──────────────────────────────────────────────────────────────
   INITIALISATION
   ────────────────────────────────────────────────────────────── */
(async function init() {

  // Header date badge
  const now = new Date();
  document.getElementById('headerDate').textContent = now.toLocaleDateString('sv-SE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).replace(/^./, c => c.toUpperCase());

  // onAuthStateChange is the single source of truth for auth state.
  // Handles both returning visits (INITIAL_SESSION) and fresh OAuth logins (SIGNED_IN).
  db.auth.onAuthStateChange((_event, newSession) => {
    updateAuthUI(newSession);
  });

  // Check Supabase connection before trying to load summary data
  try {
    const { error } = await db.from('wellbeing').select('id').limit(1);
    if (error) throw error;
  } catch {
    showOfflineBanner();
    try { fetchWeather();       } catch (e) { console.error('Kalmar weather failed:', e); }
    try { fetchWeatherAbisko(); } catch (e) { console.error('Abisko weather failed:', e); }
    return;
  }

  // Each section is independent — a failure in one won't break the others
  try { await renderSummary();   } catch (e) { console.error('Summary failed:', e); }
  try { fetchWeather();          } catch (e) { console.error('Kalmar weather failed:', e); }
  try { fetchWeatherAbisko();    } catch (e) { console.error('Abisko weather failed:', e); }

})();
