/* ──────────────────────────────────────────────────────────────
   UTILITY HELPERS
   ────────────────────────────────────────────────────────────── */

// Converts a Date object to "YYYY-MM-DD" using LOCAL time, not UTC.
// Using toISOString() would return UTC, which is 1-2 hours behind Swedish
// time — causing dates to roll over at 10pm or 11pm instead of midnight.
function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Returns today's date as "YYYY-MM-DD" in local time.
function getToday() {
  return dateToStr(new Date());
}

// Returns an array of N date strings in local time, starting N-1 days ago.
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
  // Adding T00:00:00 forces the browser to treat it as local midnight,
  // preventing an off-by-one-day bug in some time zones.
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Saves any JavaScript value into localStorage as JSON text.
// All our data keys start with "rd_" (short for Recovery Dashboard).
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('Could not save to localStorage:', e);
  }
}

// Loads a value from localStorage. If nothing is found, returns defaultValue.
function load(key, defaultValue) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

// Shows a short confirmation message (like "✓ Saved") in a named element,
// then fades it out after 2.5 seconds.
function showFeedback(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

// Set Chart.js global defaults — only if Chart.js actually loaded.
// If the CDN was unreachable, Chart will be undefined and skipping this
// prevents a crash that would otherwise kill all JavaScript on the page.
if (typeof Chart !== 'undefined') {
  Chart.defaults.color = '#4a5f85';
  Chart.defaults.borderColor = '#d5dff5';
  Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
}


/* ──────────────────────────────────────────────────────────────
   SECTION 1 — EXERCISE TRACKER

   How the data is stored:
     localStorage key: "rd_exercises"
     Value: { date: "2025-03-24", data: [ [bool×6], [bool×6], [bool×6], [bool×6] ] }

   On each new day, the date won't match and we start with all false.
   Clicking a circle toggles its value (false ↔ true) and saves immediately.
   ────────────────────────────────────────────────────────────── */

const EXERCISE_NAMES    = ['Exercise 1', 'Exercise 2', 'Exercise 3', 'Exercise 4'];
const CIRCLES_PER_EXERCISE = [6, 6, 6, 3]; // Exercise 4 limited to 3 per day
const MAX_TOTAL_CIRCLES = CIRCLES_PER_EXERCISE.reduce((a, b) => a + b, 0); // 21

// Loads today's exercise state, or creates a fresh one if it's a new day
function loadExerciseState() {
  const today   = getToday();
  const stored  = load('rd_exercises', null);

  if (!stored || stored.date !== today) {
    // New day (or first ever visit) — start with all circles empty
    return {
      date: today,
      data: CIRCLES_PER_EXERCISE.map(n => Array(n).fill(false))
    };
  }

  // Enforce the correct circle count per exercise in case it changed.
  // Trims any extra circles and keeps any already-ticked ones within the limit.
  stored.data = CIRCLES_PER_EXERCISE.map((n, i) => {
    const row = stored.data[i] || [];
    return Array.from({ length: n }, (_, j) => row[j] || false);
  });
  return stored;
}

// Toggles one circle, saves, then re-renders the whole section
function toggleExercise(exIdx, circleIdx) {
  const state = loadExerciseState();
  state.data[exIdx][circleIdx] = !state.data[exIdx][circleIdx];
  save('rd_exercises', state);

  // Also record today's total in the history log so the chart can use it
  const total = state.data.flat().filter(Boolean).length;
  const log   = load('rd_exercise_log', {});
  log[state.date] = total;
  save('rd_exercise_log', log);

  renderExercises();
}

let exerciseChartInst = null;

function renderExerciseChart() {
  const log    = load('rd_exercise_log', {});
  const days   = getLastNDays(14);
  const values = days.map(d => log[d] !== undefined ? log[d] : null);
  const labels = days.map(shortLabel);

  // Colour each bar: interpolate red→green based on value; ≥19 is solidly green
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
          min: 0,
          max: MAX_TOTAL_CIRCLES, // 21
          ticks: { font: { size: 11 }, stepSize: 7 },
          grid: { color: '#d5dff5' }
        }
      }
    }
  });
}

// Builds the HTML for all 4 exercise rows from scratch
function renderExercises() {
  const state     = loadExerciseState();
  const container = document.getElementById('exerciseList');
  container.innerHTML = '';

  state.data.forEach((circles, exIdx) => {
    const row = document.createElement('div');
    row.className = 'exercise-row';

    // "Exercise 1" label
    const label = document.createElement('div');
    label.className = 'exercise-label';
    label.textContent = EXERCISE_NAMES[exIdx];
    row.appendChild(label);

    // Circle buttons — colour scales from red (first) to green (last)
    const maxCircles  = CIRCLES_PER_EXERCISE[exIdx];
    const circlesWrap = document.createElement('div');
    circlesWrap.className = 'exercise-circles';
    circles.forEach((filled, circleIdx) => {
      const btn = document.createElement('button');
      btn.className = 'circle-btn';
      btn.title     = filled ? 'Click to unmark' : 'Click to mark done';

      // Compute the hue for this circle: 0 = red, 120 = green
      const hue = maxCircles > 1 ? Math.round((circleIdx / (maxCircles - 1)) * 120) : 120;
      if (filled) {
        btn.style.background    = `hsl(${hue}, 65%, 46%)`;
        btn.style.borderColor   = 'transparent';
        btn.style.boxShadow     = `0 0 10px hsla(${hue}, 65%, 46%, 0.45)`;
      }

      btn.addEventListener('click', () => toggleExercise(exIdx, circleIdx));
      circlesWrap.appendChild(btn);
    });
    row.appendChild(circlesWrap);

    // Progress counter e.g. "4/6"
    const done = circles.filter(Boolean).length;
    const prog = document.createElement('div');
    prog.className  = 'exercise-progress' + (done === maxCircles ? ' complete' : '');
    prog.textContent = `${done}/${maxCircles}`;
    row.appendChild(prog);

    container.appendChild(row);
  });

  // Update the chart to reflect any changes made to today's circles
  renderExerciseChart();
}


/* ──────────────────────────────────────────────────────────────
   SECTION 2 — READING TRACKER

   How the data is stored:
     localStorage key: "rd_reading_log"
     Value: { "2025-03-24": 45, "2025-03-23": 30, ... }
     (object where each key is a date, each value is total pages that day)

   Clicking "Add Pages" adds the entered number to today's running total.
   So if you read 20 pages in the morning and then 30 in the evening,
   today shows 50. The chart shows the last 14 days.
   ────────────────────────────────────────────────────────────── */

let readingChartInst = null; // We keep a reference so we can destroy it before recreating

function addReading() {
  const input = document.getElementById('readingInput');
  const pages = parseInt(input.value, 10);
  if (!pages || pages < 1) return;

  const today = getToday();
  const log   = load('rd_reading_log', {});
  log[today]  = (log[today] || 0) + pages; // Add to whatever was already there today
  save('rd_reading_log', log);

  input.value = ''; // Clear the input field ready for next entry
  renderReading();
}

function renderReading() {
  const log    = load('rd_reading_log', {});
  const days   = getLastNDays(14);
  const values = days.map(d => log[d] || 0);
  const labels = days.map(shortLabel);

  // Sum all pages ever recorded (not just last 14 days)
  const total = Object.values(log).reduce((sum, n) => sum + n, 0);
  document.getElementById('readingTotal').textContent = total.toLocaleString();

  // Destroy the old chart before making a new one.
  // Chart.js requires this — otherwise it throws "canvas already in use".
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
        tension: 0.35, // slight curve on the line
        fill: true     // fills the area under the line
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

   How the data is stored:
     localStorage key: "rd_wellbeing_log"
     Value: { "2025-03-24": { mood:7, energy:6, motivation:8, pain:3 }, ... }

   User moves the sliders and presses "Save Today's Ratings".
   If they save again on the same day, it replaces that day's entry.
   On page load, if today's data already exists, the sliders are set to it.
   ────────────────────────────────────────────────────────────── */

let wellbeingChartInst = null;

// If today has saved wellbeing data, populate the sliders with it
function loadTodayWellbeing() {
  const today = getToday();
  const log   = load('rd_wellbeing_log', {});
  if (!log[today]) return; // Nothing saved yet — leave sliders at default 5

  const e = log[today];
  const set = (sliderId, valId, val) => {
    document.getElementById(sliderId).value = val;
    document.getElementById(valId).textContent  = val;
  };
  set('moodSlider',       'moodVal',       e.mood);
  set('energySlider',     'energyVal',     e.energy);
  set('motivationSlider', 'motivationVal', e.motivation);
  set('painSlider',       'painVal',       e.pain);
}

function saveWellbeing() {
  const today = getToday();
  const log   = load('rd_wellbeing_log', {});
  // The + before getElementById(...).value converts the string to a number
  log[today] = {
    mood:       +document.getElementById('moodSlider').value,
    energy:     +document.getElementById('energySlider').value,
    motivation: +document.getElementById('motivationSlider').value,
    pain:       +document.getElementById('painSlider').value
  };
  save('rd_wellbeing_log', log);
  showFeedback('wellbeingFeedback', '✓ Ratings saved for today');
  renderWellbeing();
}

function renderWellbeing() {
  const log    = load('rd_wellbeing_log', {});
  const days   = getLastNDays(14);
  const labels = days.map(shortLabel);

  // For each metric, build an array of 14 values (null = no data that day).
  // null values create gaps in the line; spanGaps:true bridges those gaps.
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
        {
          label: 'Mood',
          data: mood,
          borderColor: '#4d84f5',
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointBackgroundColor: '#4d84f5',
          pointRadius: 4, pointHoverRadius: 6,
          tension: 0.3, spanGaps: true
        },
        {
          label: 'Energy',
          data: energy,
          borderColor: '#f59e0b',
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointBackgroundColor: '#f59e0b',
          pointRadius: 4, pointHoverRadius: 6,
          tension: 0.3, spanGaps: true
        },
        {
          label: 'Motivation',
          data: motivation,
          borderColor: '#0fd9a8',
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointBackgroundColor: '#0fd9a8',
          pointRadius: 4, pointHoverRadius: 6,
          tension: 0.3, spanGaps: true
        },
        {
          label: 'Pain',
          data: pain,
          borderColor: '#f87171',
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointBackgroundColor: '#f87171',
          pointRadius: 4, pointHoverRadius: 6,
          tension: 0.3, spanGaps: true
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: true,
          labels: {
            font: { size: 12 }, padding: 20,
            usePointStyle: true, pointStyle: 'circle'
          }
        }
      },
      scales: {
        x: { ticks: { font: { size: 11 } }, grid: { color: '#d5dff5' } },
        y: {
          min: 0, max: 11,
          ticks: { font: { size: 11 }, stepSize: 2 },
          grid: { color: '#d5dff5' }
        }
      }
    }
  });
}


/* ──────────────────────────────────────────────────────────────
   SECTION 4 — SLEEP TRACKER

   How the data is stored:
     localStorage key: "rd_sleep_log"
     Value: { "2025-03-24": 7.5, "2025-03-23": 8, ... }

   One entry per day. Saving again on the same day replaces it.
   The chart is a bar chart. We add a second "line" dataset that
   is a flat line at 8 — this draws the recommended-hours target
   without needing any extra Chart.js plugin.
   ────────────────────────────────────────────────────────────── */

let sleepChartInst = null;

function saveSleep() {
  const input = document.getElementById('sleepInput');
  const hours = parseFloat(input.value);
  if (isNaN(hours) || hours < 0 || hours > 24) return;

  const today = getToday();
  const log   = load('rd_sleep_log', {});
  log[today]  = hours;
  save('rd_sleep_log', log);

  showFeedback('sleepFeedback', '✓ Sleep logged');
  renderSleep();
}

function renderSleep() {
  const log    = load('rd_sleep_log', {});
  const days   = getLastNDays(14);
  const values = days.map(d => (log[d] !== undefined ? log[d] : null));
  const labels = days.map(shortLabel);

  // If today's sleep is already saved, pre-fill the input with it
  const today = getToday();
  if (log[today] !== undefined) {
    document.getElementById('sleepInput').value = log[today];
  }

  if (sleepChartInst) sleepChartInst.destroy();

  const ctx = document.getElementById('sleepChart').getContext('2d');
  sleepChartInst = new Chart(ctx, {
    type: 'bar', // default chart type; individual datasets can override
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
          // A line dataset with a constant value of 8 on every day.
          // This draws the "8 hour target" reference line.
          type: 'line',
          label: '8hr Target',
          data: Array(14).fill(8),
          borderColor: 'rgba(15,217,168,0.75)',
          borderWidth: 2,
          borderDash: [7, 5], // dashed pattern: 7px dash, 5px gap
          pointRadius: 0,     // no data point dots on the line
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: true,
          labels: {
            font: { size: 12 }, padding: 20,
            usePointStyle: true, pointStyle: 'circle'
          }
        }
      },
      scales: {
        x: { ticks: { font: { size: 11 } }, grid: { color: '#d5dff5' } },
        y: {
          min: 0, max: 12,
          ticks: { font: { size: 11 }, stepSize: 2 },
          grid: { color: '#d5dff5' }
        }
      }
    }
  });
}


/* ──────────────────────────────────────────────────────────────
   SECTION 5 — TO-DO LIST

   How the data is stored:
     localStorage key: "rd_todos"
     Value: [ { id: 1711234567890, text: "Walk to kitchen", done: false }, ... ]

   The id is a timestamp (Date.now()), which gives a unique number
   for each task — useful because we need to find and remove specific tasks.

   addTodo()    — pushes a new item
   toggleTodo() — flips the done flag
   deleteTodo() — removes the item with that id
   renderTodos()— rebuilds the entire list display from scratch
   ────────────────────────────────────────────────────────────── */

function getTodos()          { return load('rd_todos', []); }
function saveTodoData(todos) { save('rd_todos', todos);     }

function addTodo() {
  const input = document.getElementById('todoInput');
  const text  = input.value.trim();
  if (!text) return;

  const todos = getTodos();
  todos.push({ id: Date.now(), text, done: false });
  saveTodoData(todos);
  input.value = '';
  renderTodos();
}

function toggleTodo(id) {
  const todos = getTodos();
  const item  = todos.find(t => t.id === id);
  if (item) item.done = !item.done;
  saveTodoData(todos);
  renderTodos();
}

function deleteTodo(id) {
  saveTodoData(getTodos().filter(t => t.id !== id));
  renderTodos();
}

function renderTodos() {
  const todos     = getTodos();
  const list      = document.getElementById('todoList');
  const countEl   = document.getElementById('todoCount');
  const remaining = todos.filter(t => !t.done).length;

  countEl.textContent = `${remaining} task${remaining !== 1 ? 's' : ''} remaining`;
  list.innerHTML = '';

  todos.forEach(todo => {
    const item = document.createElement('div');
    item.className = 'todo-item' + (todo.done ? ' done' : '');

    // Clicking anywhere on the row (except the delete button) toggles done
    item.addEventListener('click', () => toggleTodo(todo.id));

    const textSpan = document.createElement('span');
    textSpan.className   = 'todo-text';
    textSpan.textContent = todo.text;
    item.appendChild(textSpan);

    // × delete button
    const del = document.createElement('button');
    del.className   = 'todo-delete';
    del.textContent = '×';
    del.title       = 'Delete task';
    del.addEventListener('click', e => {
      e.stopPropagation(); // Prevent the click from also triggering the toggle
      deleteTodo(todo.id);
    });
    item.appendChild(del);

    list.appendChild(item);
  });
}


/* ──────────────────────────────────────────────────────────────
   INITIALISATION

   This function runs immediately when the page loads (it's an IIFE —
   Immediately Invoked Function Expression — the (function(){ ... })()
   pattern calls the function right away).

   Each section has its own try/catch block.
   "try" means: attempt this code.
   "catch" means: if anything goes wrong, log the error and carry on.
   That way a bug in one section won't stop the other sections from loading.
   ────────────────────────────────────────────────────────────── */
(function init() {

  // Display today's date in the header badge
  const now = new Date();
  document.getElementById('headerDate').textContent = now.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  try { renderExercises(); renderExerciseChart();    } catch (e) { console.error('Exercises failed:', e); }
  try { renderReading();                            } catch (e) { console.error('Reading failed:',   e); }
  try { loadTodayWellbeing(); renderWellbeing();    } catch (e) { console.error('Wellbeing failed:', e); }
  try { renderSleep();                              } catch (e) { console.error('Sleep failed:',     e); }
  try { renderTodos();                              } catch (e) { console.error('Todos failed:',     e); }

})();
