/* ──────────────────────────────────────────────────────────────
   UTILITY HELPERS
   ────────────────────────────────────────────────────────────── */

// Converts a Date object to "YYYY-MM-DD" using LOCAL time, not UTC.
// toISOString() returns UTC, which in Sweden runs 1-2 hours behind local
// time and would cause dates to roll over before midnight.
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getToday() {
  return toDateStr(new Date());
}

// Load from localStorage
function load(key, defaultValue) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

// Returns an array of date strings from Monday of the current week up to today.
// e.g. if today is Wednesday: ["2025-03-24", "2025-03-25", "2025-03-26"]
function getCurrentWeekDates() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  // Calculate how many days back Monday was
  // If today is Sunday (0), Monday was 6 days ago
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
  return d.toLocaleDateString('en-GB', { weekday: 'short' });
}

// Formats a date range as "24 Mar – 30 Mar" for the message card subtitle
function formatWeekRange(dates) {
  if (!dates.length) return '';
  const fmt = s => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`;
}

// Calculates the average of an array of numbers, ignoring null/undefined
function avg(arr) {
  const valid = arr.filter(v => v !== null && v !== undefined);
  if (!valid.length) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}


/* ──────────────────────────────────────────────────────────────
   WMO WEATHER CODE HELPERS
   Maps numeric weather codes from Open-Meteo to emoji + label.
   ────────────────────────────────────────────────────────────── */

function wmoToInfo(code) {
  if (code === 0)              return { icon: '☀️',  label: 'Clear sky' };
  if (code === 1)              return { icon: '🌤️', label: 'Mainly clear' };
  if (code === 2)              return { icon: '⛅',  label: 'Partly cloudy' };
  if (code === 3)              return { icon: '☁️',  label: 'Overcast' };
  if (code <= 48)              return { icon: '🌫️', label: 'Fog' };
  if (code <= 55)              return { icon: '🌦️', label: 'Drizzle' };
  if (code <= 65)              return { icon: '🌧️', label: 'Rain' };
  if (code <= 67)              return { icon: '🌧️', label: 'Freezing rain' };
  if (code <= 75)              return { icon: '🌨️', label: 'Snow' };
  if (code <= 77)              return { icon: '🌨️', label: 'Snow grains' };
  if (code <= 82)              return { icon: '🌦️', label: 'Showers' };
  if (code <= 86)              return { icon: '🌨️', label: 'Snow showers' };
  if (code === 95)             return { icon: '⛈️',  label: 'Thunderstorm' };
  if (code >= 96)              return { icon: '⛈️',  label: 'Thunderstorm' };
  return { icon: '🌡️', label: 'Unknown' };
}


/* ──────────────────────────────────────────────────────────────
   SECTION 1 — WEEKLY RECOVERY SUMMARY

   Reads the same localStorage keys as the dashboard:
     rd_wellbeing_log  → mood, energy, motivation, pain averages
     rd_reading_log    → total pages this week
     rd_sleep_log      → average hours slept this week

   Shows "—" for any metric with no data yet.
   ────────────────────────────────────────────────────────────── */

function calcWeeklyStats() {
  const weekDates    = getCurrentWeekDates();
  const wellbeing    = load('rd_wellbeing_log', {});
  const readingLog   = load('rd_reading_log',   {});
  const sleepLog     = load('rd_sleep_log',     {});

  // Pull each wellbeing metric for each day that has data
  const moods       = weekDates.map(d => wellbeing[d] ? wellbeing[d].mood       : null);
  const energies    = weekDates.map(d => wellbeing[d] ? wellbeing[d].energy     : null);
  const motivations = weekDates.map(d => wellbeing[d] ? wellbeing[d].motivation : null);
  const pains       = weekDates.map(d => wellbeing[d] ? wellbeing[d].pain       : null);

  // Total pages: sum all days in the week that have entries
  const pages = weekDates.reduce((sum, d) => sum + (readingLog[d] || 0), 0);

  // Average sleep
  const sleepValues = weekDates.map(d => sleepLog[d] !== undefined ? sleepLog[d] : null);

  return {
    mood:       avg(moods),
    energy:     avg(energies),
    motivation: avg(motivations),
    pain:       avg(pains),
    pages:      pages,
    sleep:      avg(sleepValues),
    weekDates
  };
}

function getMotivationalMessage(avgMood) {
  if (avgMood === null) {
    return {
      icon: '📋',
      text: 'No wellbeing ratings recorded yet this week. Head to the dashboard and log your first entry!'
    };
  }
  if (avgMood < 5) {
    return {
      icon: '💙',
      text: 'Recovery takes time, and every small step forward counts. Be patient and kind to yourself — you are doing better than you think.'
    };
  }
  if (avgMood <= 7) {
    return {
      icon: '⭐',
      text: 'You are making steady progress, Bob. Consistency is everything in recovery — keep showing up each day and the results will follow.'
    };
  }
  return {
    icon: '🎉',
    text: 'What a week! You are in great form Bob — the numbers speak for themselves. Keep this energy going!'
  };
}

// Sets a stat card's value, removing the "no-data" style if there is real data
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

function renderSummary() {
  const stats = calcWeeklyStats();

  // Motivational message
  const msg = getMotivationalMessage(stats.mood);
  document.getElementById('messageIcon').textContent = msg.icon;
  document.getElementById('messageText').textContent = msg.text;
  document.getElementById('messageWeek').textContent = `Week of ${formatWeekRange(stats.weekDates)}`;

  // Stat cards
  setStatCard('statMood',       stats.mood);
  setStatCard('statEnergy',     stats.energy);
  setStatCard('statMotivation', stats.motivation);
  setStatCard('statPain',       stats.pain);

  // Pages: show 0 rather than — if there's no data (zero is a valid meaningful answer)
  const pagesEl = document.getElementById('statPages');
  pagesEl.textContent = stats.pages;
  pagesEl.classList.remove('no-data');

  setStatCard('statSleep', stats.sleep);
}


/* ──────────────────────────────────────────────────────────────
   SECTION 2 — WEATHER FORECAST

   Uses the Open-Meteo free API (no key required).
   Kalmar, Sweden: 56.6616°N, 16.3566°E

   If the fetch fails for any reason, a friendly error message
   is shown — the rest of the page is unaffected.
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
    const data = await response.json();
    renderWeather(data);
  } catch (err) {
    console.warn('Weather fetch failed:', err);
    showWeatherError();
  }
}

function renderWeather(data) {
  const current = data.current_weather;
  const daily   = data.daily;

  // Fill in current conditions
  const currentInfo = wmoToInfo(current.weathercode);
  document.getElementById('currentIcon').textContent      = currentInfo.icon;
  document.getElementById('currentTemp').innerHTML        = `${Math.round(current.temperature)}<sup>°C</sup>`;
  document.getElementById('currentCondition').textContent = currentInfo.label;

  // Build the 7-day forecast strip
  const strip = document.getElementById('forecastStrip');
  strip.innerHTML = '';
  daily.time.forEach((dateStr, i) => {
    const info = wmoToInfo(daily.weathercode[i]);
    const hi   = Math.round(daily.temperature_2m_max[i]);
    const lo   = Math.round(daily.temperature_2m_min[i]);
    const name = shortDayName(dateStr);

    const dayEl = document.createElement('div');
    dayEl.className = 'forecast-day';
    dayEl.innerHTML = `
      <div class="forecast-day-name">${name}</div>
      <span class="forecast-icon">${info.icon}</span>
      <div class="forecast-hi">${hi}°</div>
      <div class="forecast-lo">${lo}°</div>
    `;
    strip.appendChild(dayEl);
  });

  // Hide loading indicator and show the real content
  document.getElementById('weatherStatus').style.display  = 'none';
  document.getElementById('weatherContent').style.display = 'block';
}

function showWeatherError() {
  const status = document.getElementById('weatherStatus');
  status.classList.add('error');
  status.innerHTML = 'Weather data is unavailable right now — try refreshing the page.';
}

/* ── ABISKO WEATHER — loads independently from Kalmar ── */

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
    const data = await response.json();
    renderWeatherAbisko(data);
  } catch (err) {
    console.warn('Abisko weather fetch failed:', err);
    const status = document.getElementById('abiskoStatus');
    status.classList.add('error');
    status.innerHTML = 'Weather data is unavailable right now — try refreshing the page.';
  }
}

function renderWeatherAbisko(data) {
  const current = data.current_weather;
  const daily   = data.daily;

  const currentInfo = wmoToInfo(current.weathercode);
  document.getElementById('abiskoIcon').textContent      = currentInfo.icon;
  document.getElementById('abiskoTemp').innerHTML        = `${Math.round(current.temperature)}<sup>°C</sup>`;
  document.getElementById('abiskoCondition').textContent = currentInfo.label;

  const strip = document.getElementById('abiskoStrip');
  strip.innerHTML = '';
  daily.time.forEach((dateStr, i) => {
    const info = wmoToInfo(daily.weathercode[i]);
    const hi   = Math.round(daily.temperature_2m_max[i]);
    const lo   = Math.round(daily.temperature_2m_min[i]);
    const name = shortDayName(dateStr);

    const dayEl = document.createElement('div');
    dayEl.className = 'forecast-day';
    dayEl.innerHTML = `
      <div class="forecast-day-name">${name}</div>
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
(function init() {

  // Header date badge
  const now = new Date();
  document.getElementById('headerDate').textContent = now.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  // Each section is independent — a failure in one won't break the other
  try { renderSummary();       } catch (e) { console.error('Summary failed:', e); }
  try { fetchWeather();        } catch (e) { console.error('Kalmar weather failed:', e); }
  try { fetchWeatherAbisko();  } catch (e) { console.error('Abisko weather failed:', e); }

})();
