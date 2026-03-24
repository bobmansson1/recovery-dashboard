/* ──────────────────────────────────────────────────────────────
   SUPABASE CONNECTION
   These two values connect the app to the cloud database.
   The anon key is safe to include here — it's designed to be
   public and only allows what the database security rules permit.
   ────────────────────────────────────────────────────────────── */

const SUPABASE_URL = 'https://zamwktaebxpkbldrbseh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphbXdrdGFlYnhwa2JsZHJic2VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjAzNDksImV4cCI6MjA4OTkzNjM0OX0.k0PXIoofcgvQCmHie_bChux6VexPsDqNt5T8_tvvDOI';

// createClient comes from the Supabase library loaded via CDN in index.html
const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);


/* ──────────────────────────────────────────────────────────────
   UTILITY HELPERS
   ────────────────────────────────────────────────────────────── */

// Converts a Date object to "YYYY-MM-DD" using LOCAL time, not UTC.
function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getToday() {
  return dateToStr(new Date());
}

// Returns an array of N date strings, ending today.
// Example for n=3: ["2025-03-22", "2025-03-23", "2025-03-24"]
function getLastNDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(dateToStr(d));
  }
  return days;
}

// Converts "2025-03-24" into a short chart label like "24 Mar"
function shortLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Shows a brief confirmation message that fades out after 2.5 seconds
function showFeedback(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

// Set Chart.js global defaults — only if the CDN loaded successfully
if (typeof Chart !== 'undefined') {
  Chart.defaults.color = '#4a5f85';
  Chart.defaults.borderColor = '#d5dff5';
  Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
}


/* ──────────────────────────────────────────────────────────────
   OFFLINE / CONNECTION CHECK

   On page load we try one lightweight query to Supabase.
   If it fails (no internet, Supabase down, etc.) we show a
   friendly banner and stop — rather than crashing or showing
   broken empty charts.
   ────────────────────────────────────────────────────────────── */

async function checkConnection() {
  try {
    const { error } = await db.from('wellbeing').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}

function showOfflineBanner() {
  const banner = document.getElementById('offlineBanner');
  if (banner) banner.style.display = 'block';
}


/* ──────────────────────────────────────────────────────────────
   SECTION 1 — EXERCISE TRACKER

   Database table: exercises
   One row per exercise per day:
     date            "2025-03-24"
     exercise_number 0 / 1 / 2 / 3
     completions     [false, true, false, ...]

   We query all rows for today, then build the familiar
   { date, data[] } shape the rest of the code uses.
   ────────────────────────────────────────────────────────────── */

const EXERCISE_NAMES       = ['Exercise 1', 'Exercise 2', 'Exercise 3', 'Exercise 4'];
const CIRCLES_PER_EXERCISE = [6, 6, 6, 3];
const MAX_TOTAL_CIRCLES    = CIRCLES_PER_EXERCISE.reduce((a, b) => a + b, 0); // 21

// Loads today's exercise state from the database.
// Returns { date, data } where data is a 2D array of booleans.
async function loadExerciseState() {
  const today = getToday();
  const { data, error } = await db
    .from('exercises')
    .select('*')
    .eq('date', today);

  if (error || !data || data.length === 0) {
    // No rows for today yet — return a fresh all-empty state
    return {
      date: today,
      data: CIRCLES_PER_EXERCISE.map(n => Array(n).fill(false))
    };
  }

  // Rebuild the 4-row array from whatever rows exist in the database.
  // Array.from ensures we always get exactly the right number of circles.
  const exerciseData = CIRCLES_PER_EXERCISE.map((n, i) => {
    const row = data.find(r => r.exercise_number === i);
    if (!row) return Array(n).fill(false);
    return Array.from({ length: n }, (_, j) => row.completions[j] || false);
  });

  return { date: today, data: exerciseData };
}

// Flips one circle on or off, saves the updated row, re-renders
async function toggleExercise(exIdx, circleIdx) {
  const state = await loadExerciseState();
  state.data[exIdx][circleIdx] = !state.data[exIdx][circleIdx];

  // upsert = insert if no row exists for (date + exercise_number),
  //          otherwise update the existing row
  await db.from('exercises').upsert({
    date:            state.date,
    exercise_number: exIdx,
    completions:     state.data[exIdx]
  }, { onConflict: 'date,exercise_number' });

  await renderExercises();
}

let exerciseChartInst = null;

async function renderExerciseChart() {
  const days = getLastNDays(14);

  // One query fetches all exercise rows for the last 14 days
  const { data } = await db
    .from('exercises')
    .select('date, completions')
    .in('date', days);

  // Sum the completed circles per day across all four exercises
  const totals = {};
  if (data) {
    data.forEach(row => {
      const count = row.completions.filter(Boolean).length;
      totals[row.date] = (totals[row.date] || 0) + count;
    });
  }

  const values = days.map(d => totals[d] !== undefined ? totals[d] : null);
  const labels = days.map(shortLabel);

  const barColors = values.map(v => {
    if (v === null) return 'rgba(180,180,180,0.2)';
    const hue = Math.round(Math.min(v / MAX_TOTAL_CIRCLES, 1) * 120);
    return `hsla(${hue}, 65%, 46%, 0.75)`;
  });
  const barBorders = values.map(v => {
    if (v === null) return 'rgba(180,180,180,0.3)';
    const hue = Math.round(Math.min(v / MAX_TOTAL_CIRCLES, 1) * 120);
    return `hsl(${hue}, 65%, 40%)`;
  });

  if (exerciseChartInst) exerciseChartInst.destroy();

  const ctx = document.getElementById('exerciseChart').getContext('2d');
  exerciseChartInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Completed',
        data: values,
        backgroundColor: barColors,
        borderColor: barBorders,
        borderWidth: 1,
        borderRadius: 5,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 11 } }, grid: { color: '#d5dff5' } },
        y: {
          min: 0, max: MAX_TOTAL_CIRCLES,
          ticks: { font: { size: 11 }, stepSize: 7 },
          grid: { color: '#d5dff5' }
        }
      }
    }
  });
}

// Builds the exercise rows in the DOM, then redraws the chart
async function renderExercises() {
  const state     = await loadExerciseState();
  const container = document.getElementById('exerciseList');
  container.innerHTML = '';

  state.data.forEach((circles, exIdx) => {
    const row = document.createElement('div');
    row.className = 'exercise-row';

    const label = document.createElement('div');
    label.className   = 'exercise-label';
    label.textContent = EXERCISE_NAMES[exIdx];
    row.appendChild(label);

    const maxCircles  = CIRCLES_PER_EXERCISE[exIdx];
    const circlesWrap = document.createElement('div');
    circlesWrap.className = 'exercise-circles';
    circles.forEach((filled, circleIdx) => {
      const btn   = document.createElement('button');
      btn.className = 'circle-btn';
      btn.title     = filled ? 'Click to unmark' : 'Click to mark done';

      const hue = maxCircles > 1 ? Math.round((circleIdx / (maxCircles - 1)) * 120) : 120;
      if (filled) {
        btn.style.background  = `hsl(${hue}, 65%, 46%)`;
        btn.style.borderColor = 'transparent';
        btn.style.boxShadow   = `0 0 10px hsla(${hue}, 65%, 46%, 0.45)`;
      }

      btn.addEventListener('click', () => toggleExercise(exIdx, circleIdx));
      circlesWrap.appendChild(btn);
    });
    row.appendChild(circlesWrap);

    const done = circles.filter(Boolean).length;
    const prog = document.createElement('div');
    prog.className   = 'exercise-progress' + (done === maxCircles ? ' complete' : '');
    prog.textContent = `${done}/${maxCircles}`;
    row.appendChild(prog);

    container.appendChild(row);
  });

  await renderExerciseChart();
}


/* ──────────────────────────────────────────────────────────────
   SECTION 2 — READING TRACKER

   Database table: reading
   One row per day:
     date       "2025-03-24"
     pages_read 45

   "Add Pages" reads today's current total, adds to it, upserts.
   ────────────────────────────────────────────────────────────── */

let readingChartInst = null;

async function addReading() {
  const input = document.getElementById('readingInput');
  const pages = parseInt(input.value, 10);
  if (!pages || pages < 1) return;

  const today = getToday();

  // Fetch today's existing total (if any) before adding to it
  // maybeSingle() returns null instead of an error when no row exists
  const { data } = await db
    .from('reading')
    .select('pages_read')
    .eq('date', today)
    .maybeSingle();

  const current = data ? data.pages_read : 0;

  await db.from('reading').upsert(
    { date: today, pages_read: current + pages },
    { onConflict: 'date' }
  );

  input.value = '';
  await renderReading();
}

async function renderReading() {
  const days = getLastNDays(14);

  // Fetch the last 14 days for the chart
  const { data: chartData } = await db
    .from('reading')
    .select('date, pages_read')
    .in('date', days);

  const log = {};
  if (chartData) chartData.forEach(r => { log[r.date] = r.pages_read; });

  const values = days.map(d => log[d] || 0);
  const labels = days.map(shortLabel);

  // All-time total needs all rows, not just the last 14 days
  const { data: allData } = await db.from('reading').select('pages_read');
  const total = allData ? allData.reduce((sum, r) => sum + r.pages_read, 0) : 0;
  document.getElementById('readingTotal').textContent = total.toLocaleString();

  if (readingChartInst) readingChartInst.destroy();

  const ctx = document.getElementById('readingChart').getContext('2d');
  readingChartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Pages Read',
        data: values,
        borderColor: '#4d84f5',
        backgroundColor: 'rgba(77,132,245,0.08)',
        borderWidth: 2.5,
        pointBackgroundColor: '#4d84f5',
        pointRadius: 4,
        pointHoverRadius: 6,
        tension: 0.35,
        fill: true
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 11 } }, grid: { color: '#d5dff5' } },
        y: { beginAtZero: true, grace: '20%', ticks: { font: { size: 11 } }, grid: { color: '#d5dff5' } }
      }
    }
  });
}


/* ──────────────────────────────────────────────────────────────
   SECTION 3 — WELLBEING TRACKER

   Database table: wellbeing
   One row per day:
     date       "2025-03-24"
     mood       7
     energy     6
     motivation 8
     pain       3
   ────────────────────────────────────────────────────────────── */

let wellbeingChartInst = null;

// If today has a saved entry, pre-fill the sliders with it
async function loadTodayWellbeing() {
  const { data } = await db
    .from('wellbeing')
    .select('*')
    .eq('date', getToday())
    .maybeSingle();

  if (!data) return;

  const set = (sliderId, valId, val) => {
    document.getElementById(sliderId).value     = val;
    document.getElementById(valId).textContent  = val;
  };
  set('moodSlider',       'moodVal',       data.mood);
  set('energySlider',     'energyVal',     data.energy);
  set('motivationSlider', 'motivationVal', data.motivation);
  set('painSlider',       'painVal',       data.pain);
}

async function saveWellbeing() {
  await db.from('wellbeing').upsert({
    date:       getToday(),
    mood:       +document.getElementById('moodSlider').value,
    energy:     +document.getElementById('energySlider').value,
    motivation: +document.getElementById('motivationSlider').value,
    pain:       +document.getElementById('painSlider').value
  }, { onConflict: 'date' });

  showFeedback('wellbeingFeedback', '✓ Ratings saved for today');
  await renderWellbeing();
}

async function renderWellbeing() {
  const days = getLastNDays(14);

  const { data } = await db
    .from('wellbeing')
    .select('*')
    .in('date', days);

  // Turn the array of rows into a lookup object keyed by date
  const log = {};
  if (data) data.forEach(r => { log[r.date] = r; });

  const labels     = days.map(shortLabel);
  const mood       = days.map(d => log[d] ? log[d].mood       : null);
  const energy     = days.map(d => log[d] ? log[d].energy     : null);
  const motivation = days.map(d => log[d] ? log[d].motivation : null);
  const pain       = days.map(d => log[d] ? log[d].pain       : null);

  if (wellbeingChartInst) wellbeingChartInst.destroy();

  const ctx = document.getElementById('wellbeingChart').getContext('2d');
  wellbeingChartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Mood',       data: mood,       borderColor: '#4d84f5', backgroundColor: 'transparent', borderWidth: 2.5, pointBackgroundColor: '#4d84f5', pointRadius: 4, pointHoverRadius: 6, tension: 0.3, spanGaps: true },
        { label: 'Energy',     data: energy,     borderColor: '#f59e0b', backgroundColor: 'transparent', borderWidth: 2.5, pointBackgroundColor: '#f59e0b', pointRadius: 4, pointHoverRadius: 6, tension: 0.3, spanGaps: true },
        { label: 'Motivation', data: motivation, borderColor: '#0fd9a8', backgroundColor: 'transparent', borderWidth: 2.5, pointBackgroundColor: '#0fd9a8', pointRadius: 4, pointHoverRadius: 6, tension: 0.3, spanGaps: true },
        { label: 'Pain',       data: pain,       borderColor: '#f87171', backgroundColor: 'transparent', borderWidth: 2.5, pointBackgroundColor: '#f87171', pointRadius: 4, pointHoverRadius: 6, tension: 0.3, spanGaps: true }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true, labels: { font: { size: 12 }, padding: 20, usePointStyle: true, pointStyle: 'circle' } } },
      scales: {
        x: { ticks: { font: { size: 11 } }, grid: { color: '#d5dff5' } },
        y: { min: 0, max: 11, ticks: { font: { size: 11 }, stepSize: 2 }, grid: { color: '#d5dff5' } }
      }
    }
  });
}


/* ──────────────────────────────────────────────────────────────
   SECTION 4 — SLEEP TRACKER

   Database table: sleep
   One row per day:
     date  "2025-03-24"
     hours 7.5
   ────────────────────────────────────────────────────────────── */

let sleepChartInst = null;

async function saveSleep() {
  const input = document.getElementById('sleepInput');
  const hours = parseFloat(input.value);
  if (isNaN(hours) || hours < 0 || hours > 24) return;

  await db.from('sleep').upsert(
    { date: getToday(), hours },
    { onConflict: 'date' }
  );

  showFeedback('sleepFeedback', '✓ Sleep logged');
  await renderSleep();
}

async function renderSleep() {
  const days = getLastNDays(14);

  const { data } = await db
    .from('sleep')
    .select('date, hours')
    .in('date', days);

  const log = {};
  if (data) data.forEach(r => { log[r.date] = parseFloat(r.hours); });

  const values = days.map(d => log[d] !== undefined ? log[d] : null);
  const labels = days.map(shortLabel);

  // Pre-fill the input if today's sleep is already saved
  const today = getToday();
  if (log[today] !== undefined) {
    document.getElementById('sleepInput').value = log[today];
  }

  if (sleepChartInst) sleepChartInst.destroy();

  const ctx = document.getElementById('sleepChart').getContext('2d');
  sleepChartInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Hours Slept',
          data: values,
          backgroundColor: 'rgba(77,132,245,0.65)',
          borderColor: '#4d84f5',
          borderWidth: 1,
          borderRadius: 5,
          borderSkipped: false
        },
        {
          type: 'line',
          label: '8hr Target',
          data: Array(14).fill(8),
          borderColor: 'rgba(15,217,168,0.75)',
          borderWidth: 2,
          borderDash: [7, 5],
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true, labels: { font: { size: 12 }, padding: 20, usePointStyle: true, pointStyle: 'circle' } } },
      scales: {
        x: { ticks: { font: { size: 11 } }, grid: { color: '#d5dff5' } },
        y: { min: 0, max: 12, ticks: { font: { size: 11 }, stepSize: 2 }, grid: { color: '#d5dff5' } }
      }
    }
  });
}


/* ──────────────────────────────────────────────────────────────
   SECTION 5 — TO-DO LIST

   Database table: todos
   One row per task:
     id         (uuid, auto-generated)
     created_at (timestamp, auto-generated)
     text       "Walk to the kitchen"
     done       false / true
   ────────────────────────────────────────────────────────────── */

async function addTodo() {
  const input = document.getElementById('todoInput');
  const text  = input.value.trim();
  if (!text) return;

  // Insert a new row — Supabase generates the id and created_at automatically
  await db.from('todos').insert({ text, done: false });
  input.value = '';
  await renderTodos();
}

async function toggleTodo(id) {
  // Fetch the current done value, flip it, save back
  const { data } = await db
    .from('todos')
    .select('done')
    .eq('id', id)
    .single();

  if (data) {
    await db.from('todos').update({ done: !data.done }).eq('id', id);
  }
  await renderTodos();
}

async function deleteTodo(id) {
  await db.from('todos').delete().eq('id', id);
  await renderTodos();
}

async function renderTodos() {
  // Fetch all tasks ordered by when they were created
  const { data: todos } = await db
    .from('todos')
    .select('*')
    .order('created_at', { ascending: true });

  const list      = document.getElementById('todoList');
  const countEl   = document.getElementById('todoCount');
  const items     = todos || [];
  const remaining = items.filter(t => !t.done).length;

  countEl.textContent = `${remaining} task${remaining !== 1 ? 's' : ''} remaining`;
  list.innerHTML = '';

  items.forEach(todo => {
    const item = document.createElement('div');
    item.className = 'todo-item' + (todo.done ? ' done' : '');
    item.addEventListener('click', () => toggleTodo(todo.id));

    const textSpan = document.createElement('span');
    textSpan.className   = 'todo-text';
    textSpan.textContent = todo.text;
    item.appendChild(textSpan);

    const del = document.createElement('button');
    del.className   = 'todo-delete';
    del.textContent = '×';
    del.title       = 'Delete task';
    del.addEventListener('click', e => {
      e.stopPropagation(); // Don't also trigger the toggle
      deleteTodo(todo.id);
    });
    item.appendChild(del);

    list.appendChild(item);
  });
}


/* ──────────────────────────────────────────────────────────────
   INITIALISATION

   The entire init is async now because every data call is async.
   Each section still has its own try/catch so a failure in one
   won't prevent the others from loading.
   ────────────────────────────────────────────────────────────── */
(async function init() {

  // Header date badge
  const now = new Date();
  document.getElementById('headerDate').textContent = now.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  // Test the database connection before loading any data
  const online = await checkConnection();
  if (!online) {
    showOfflineBanner();
    return; // Stop here — no point trying to load data if offline
  }

  try { await renderExercises();                               } catch (e) { console.error('Exercises failed:', e); }
  try { await renderReading();                                 } catch (e) { console.error('Reading failed:',   e); }
  try { await loadTodayWellbeing(); await renderWellbeing();   } catch (e) { console.error('Wellbeing failed:', e); }
  try { await renderSleep();                                   } catch (e) { console.error('Sleep failed:',     e); }
  try { await renderTodos();                                   } catch (e) { console.error('Todos failed:',     e); }

})();
