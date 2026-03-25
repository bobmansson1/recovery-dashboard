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

/* ──────────────────────────────────────────────────────────────
   D3 CHART SHARED HELPERS

   These three small utilities are used by all four charts below
   so we only have to write the setup code once.
   ────────────────────────────────────────────────────────────── */

// Fixed margins and inner height for every chart.
// "margin" is the gap around the drawing area so axis labels
// have room and aren't clipped at the edges.
const CM = { top: 30, right: 52, bottom: 36, left: 40 };
const CH = 200; // inner drawing height in pixels

// Clears a container div and returns a ready-to-draw SVG group.
// Think of the returned `g` as a blank canvas shifted inward by
// the margins — everything you draw on it is positioned correctly.
function makeChart(id) {
  const W = (document.getElementById(id)?.clientWidth || 600) - CM.left - CM.right;
  d3.select('#' + id).selectAll('*').remove();
  const svg = d3.select('#' + id).append('svg')
    .attr('width',  W + CM.left + CM.right)
    .attr('height', CH + CM.top  + CM.bottom);
  const g = svg.append('g').attr('transform', `translate(${CM.left},${CM.top})`);
  return { g, W };
}

// Shows the shared floating tooltip div near the cursor.
// `html` is the HTML string to show inside it.
function showTip(html, event) {
  const t = document.getElementById('chartTooltip');
  t.innerHTML = html;
  t.style.opacity = '1';
  t.style.left = (event.clientX + 16) + 'px';
  t.style.top  = (event.clientY - 32) + 'px';
}
function hideTip() {
  document.getElementById('chartTooltip').style.opacity = '0';
}

// Adds subtle dashed horizontal grid lines to a chart group.
// These replace the solid grid lines Chart.js drew automatically.
function addGrid(g, yScale, W) {
  g.append('g')
    .call(d3.axisLeft(yScale).ticks(5).tickSize(-W).tickFormat(''))
    .call(a => {
      a.select('.domain').remove();
      a.selectAll('line').attr('stroke', '#d5dff5').attr('stroke-dasharray', '3,3');
    });
}


/* ──────────────────────────────────────────────────────────────
   AUTHENTICATION

   signIn()       — redirects to Google, comes back to this page
   signOut()      — clears the session immediately
   updateAuthUI() — called on every auth state change; toggles the
                    "owner" class on <body> which CSS uses to
                    show/hide all input sections at once
   ────────────────────────────────────────────────────────────── */

async function signIn() {
  await db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href }
  });
}

async function signOut() {
  await db.auth.signOut();
  updateAuthUI(null);
}

function updateAuthUI(session) {
  const isOwner  = !!session;
  // Adding/removing "owner" on <body> drives all the CSS show/hide rules
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
    loginBtn.style.display = ''; // revert to visible
    userInfo.style.display = 'none';
  }

  // Re-render exercises so circle buttons gain/lose click handlers
  renderExercises().catch(() => {});
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

  const values = days.map(d => totals[d] !== undefined ? totals[d] : 0);
  const labels = days.map(shortLabel);

  const { g, W } = makeChart('exerciseChart');
  const x = d3.scaleBand().domain(labels).range([0, W]).padding(0.3);
  const y = d3.scaleLinear().domain([0, MAX_TOTAL_CIRCLES]).range([CH, 0]);

  addGrid(g, y, W);

  // X axis — every other label to avoid crowding
  g.append('g').attr('transform', `translate(0,${CH})`)
    .call(d3.axisBottom(x).tickValues(labels.filter((_, i) => i % 2 === 0)).tickSize(0))
    .call(a => a.select('.domain').remove())
    .selectAll('text').attr('fill', '#8a9bc0').attr('font-size', '11px').attr('dy', '1.4em');

  // Y axis
  g.append('g').call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(8))
    .call(a => a.select('.domain').remove())
    .selectAll('text').attr('fill', '#8a9bc0').attr('font-size', '11px');

  // Bar colour: grey = nothing done, amber = partial, blue = most done, teal = all done
  const pct    = v => MAX_TOTAL_CIRCLES > 0 ? v / MAX_TOTAL_CIRCLES : 0;
  const barCol = v => pct(v) === 0 ? 'rgba(180,180,180,0.35)' : pct(v) < 0.5 ? '#f59e0b' : pct(v) < 1 ? '#4d84f5' : '#0ab890';

  // Bars grow upward from the bottom on first draw
  g.selectAll('rect.bar').data(values).join('rect').attr('class', 'bar')
    .attr('x', (_, i) => x(labels[i])).attr('width', x.bandwidth())
    .attr('fill', d => barCol(d)).attr('rx', 4)
    .attr('y', y(0)).attr('height', 0)
    .transition().duration(700).ease(d3.easeCubicOut)
    .attr('y', d => y(d)).attr('height', d => y(0) - y(d));

  // Invisible overlay rectangle for tooltip hover detection
  g.append('rect').attr('width', W).attr('height', CH).attr('fill', 'transparent')
    .on('mousemove', function(event) {
      const [mx] = d3.pointer(event);
      const idx  = Math.max(0, Math.min(labels.length - 1, Math.floor(mx / x.step())));
      showTip(`<strong>${labels[idx]}</strong><br>Exercises: ${values[idx]} / ${MAX_TOTAL_CIRCLES}`, event);
    })
    .on('mouseleave', hideTip);
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

      // Only make circles clickable when the owner is logged in
      if (document.body.classList.contains('owner')) {
        btn.addEventListener('click', () => toggleExercise(exIdx, circleIdx));
      } else {
        btn.style.cursor  = 'default';
        btn.style.opacity = '0.55';
      }
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

  // Fetch ALL reading history so we can compute a running cumulative total.
  // The chart shows a line that only ever goes up — days with no reading
  // stay flat at the previous day's total rather than dropping to zero.
  const { data: allData } = await db.from('reading').select('date, pages_read');

  const allLog = {};
  if (allData) allData.forEach(r => { allLog[r.date] = r.pages_read; });

  // Sum everything before the 14-day window as the starting baseline
  const windowStart = days[0];
  const baseline = Object.entries(allLog)
    .filter(([d]) => d < windowStart)
    .reduce((sum, [, n]) => sum + n, 0);

  // Walk through each visible day, carrying the running total forward
  let running = baseline;
  const values = days.map(d => {
    running += allLog[d] || 0;
    return running;
  });

  const labels = days.map(shortLabel);

  // All-time total is the final running value
  const total = Object.values(allLog).reduce((sum, n) => sum + n, 0);
  document.getElementById('readingTotal').textContent = total.toLocaleString();

  const { g, W } = makeChart('readingChart');
  const x = d3.scalePoint().domain(labels).range([0, W]);
  const y = d3.scaleLinear().domain([0, d3.max(values) * 1.2 || 10]).nice().range([CH, 0]);

  addGrid(g, y, W);

  g.append('g').attr('transform', `translate(0,${CH})`)
    .call(d3.axisBottom(x).tickValues(labels.filter((_, i) => i % 2 === 0)).tickSize(0))
    .call(a => a.select('.domain').remove())
    .selectAll('text').attr('fill', '#8a9bc0').attr('font-size', '11px').attr('dy', '1.4em');

  g.append('g').call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(8))
    .call(a => a.select('.domain').remove())
    .selectAll('text').attr('fill', '#8a9bc0').attr('font-size', '11px');

  // Gradient definition — fills the area below the line with a blue fade-to-transparent
  const defs = g.append('defs');
  const grad = defs.append('linearGradient').attr('id', 'readingGrad')
    .attr('x1', '0%').attr('y1', '0%').attr('x2', '0%').attr('y2', '100%');
  grad.append('stop').attr('offset', '0%').attr('stop-color', '#4d84f5').attr('stop-opacity', 0.22);
  grad.append('stop').attr('offset', '100%').attr('stop-color', '#4d84f5').attr('stop-opacity', 0);

  const curve = d3.curveCatmullRom.alpha(0.5);

  // Area fill drawn first so the line sits on top of it
  g.append('path').datum(values)
    .attr('fill', 'url(#readingGrad)')
    .attr('d', d3.area().x((_, i) => x(labels[i])).y0(y(0)).y1(d => y(d)).curve(curve));

  // Line animates drawing itself left-to-right using stroke-dashoffset
  const path = g.append('path').datum(values)
    .attr('fill', 'none').attr('stroke', '#4d84f5').attr('stroke-width', 2.5)
    .attr('d', d3.line().x((_, i) => x(labels[i])).y(d => y(d)).curve(curve));
  const len = path.node().getTotalLength();
  path.attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
    .transition().duration(900).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0);

  // Small label on the highest reading day
  const peakIdx = values.indexOf(d3.max(values));
  if (values[peakIdx] > 0) {
    g.append('text')
      .attr('x', x(labels[peakIdx])).attr('y', y(values[peakIdx]) - 10)
      .attr('fill', '#4d84f5').attr('font-size', '11px').attr('text-anchor', 'middle')
      .text(values[peakIdx].toLocaleString() + ' pages');
  }

  g.append('rect').attr('width', W).attr('height', CH).attr('fill', 'transparent')
    .on('mousemove', function(event) {
      const [mx] = d3.pointer(event);
      const step = W / (labels.length - 1);
      const idx  = Math.max(0, Math.min(labels.length - 1, Math.round(mx / step)));
      showTip(`<strong>${labels[idx]}</strong><br>Total: ${values[idx].toLocaleString()} pages`, event);
    })
    .on('mouseleave', hideTip);
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

  const { g, W } = makeChart('wellbeingChart');
  const x = d3.scalePoint().domain(labels).range([0, W]);
  const y = d3.scaleLinear().domain([0, 12]).range([CH, 0]);

  addGrid(g, y, W);

  g.append('g').attr('transform', `translate(0,${CH})`)
    .call(d3.axisBottom(x).tickValues(labels.filter((_, i) => i % 2 === 0)).tickSize(0))
    .call(a => a.select('.domain').remove())
    .selectAll('text').attr('fill', '#8a9bc0').attr('font-size', '11px').attr('dy', '1.4em');

  g.append('g').call(d3.axisLeft(y).ticks(6).tickSize(0).tickPadding(8))
    .call(a => a.select('.domain').remove())
    .selectAll('text').attr('fill', '#8a9bc0').attr('font-size', '11px');

  const series = [
    { name: 'Mood',       color: '#4d84f5', vals: mood       },
    { name: 'Energy',     color: '#f59e0b', vals: energy     },
    { name: 'Motivation', color: '#0fd9a8', vals: motivation },
    { name: 'Pain',       color: '#f87171', vals: pain       },
  ];

  series.forEach((s, si) => {
    // .defined(d => d !== null) means: don't draw through days with no entry.
    // Without this, D3 would try to draw a line to "undefined" and break the chart.
    const lineFn = d3.line()
      .x((_, i) => x(labels[i])).y(d => y(d))
      .defined(d => d !== null)
      .curve(d3.curveCatmullRom.alpha(0.5));

    // Each line draws itself in with a small stagger so they appear one after another
    const path = g.append('path').datum(s.vals)
      .attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 2.5)
      .attr('d', lineFn);
    const len = path.node().getTotalLength();
    path.attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
      .transition().delay(si * 120).duration(900).ease(d3.easeCubicOut)
      .attr('stroke-dashoffset', 0);

    // Dots on each non-null data point
    g.selectAll(null)
      .data(s.vals.map((v, i) => ({ v, i })).filter(d => d.v !== null))
      .join('circle')
      .attr('cx', d => x(labels[d.i])).attr('cy', d => y(d.v))
      .attr('r', 3.5).attr('fill', s.color).attr('stroke', '#fff').attr('stroke-width', 1.5);

    // Legend item — positioned in the top margin above the chart area
    const lx = (W / series.length) * si + (W / series.length) / 2 - 22;
    g.append('circle').attr('cx', lx).attr('cy', -15).attr('r', 5).attr('fill', s.color);
    g.append('text').attr('x', lx + 9).attr('y', -11)
      .attr('fill', '#4a5f85').attr('font-size', '11px').text(s.name);
  });

  g.append('rect').attr('width', W).attr('height', CH).attr('fill', 'transparent')
    .on('mousemove', function(event) {
      const [mx] = d3.pointer(event);
      const step = W / (labels.length - 1);
      const idx  = Math.max(0, Math.min(labels.length - 1, Math.round(mx / step)));
      showTip(
        `<strong>${labels[idx]}</strong><br>` +
        `Mood: ${mood[idx] ?? '—'} &nbsp; Energy: ${energy[idx] ?? '—'}<br>` +
        `Motivation: ${motivation[idx] ?? '—'} &nbsp; Pain: ${pain[idx] ?? '—'}`,
        event
      );
    })
    .on('mouseleave', hideTip);
}


/* ──────────────────────────────────────────────────────────────
   SECTION 4 — SLEEP TRACKER

   Database table: sleep
   One row per day:
     date  "2025-03-24"
     hours 7.5
   ────────────────────────────────────────────────────────────── */

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

  const { g, W } = makeChart('sleepChart');
  const x = d3.scaleBand().domain(labels).range([0, W]).padding(0.3);
  const y = d3.scaleLinear().domain([0, 12]).range([CH, 0]);

  addGrid(g, y, W);

  g.append('g').attr('transform', `translate(0,${CH})`)
    .call(d3.axisBottom(x).tickValues(labels.filter((_, i) => i % 2 === 0)).tickSize(0))
    .call(a => a.select('.domain').remove())
    .selectAll('text').attr('fill', '#8a9bc0').attr('font-size', '11px').attr('dy', '1.4em');

  g.append('g').call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(8))
    .call(a => a.select('.domain').remove())
    .selectAll('text').attr('fill', '#8a9bc0').attr('font-size', '11px');

  // Colour each bar based on hours: red = too little, amber = ok, teal = great
  const barColor = h => h == null ? 'rgba(180,180,180,0.25)' : h < 6 ? '#f87171' : h <= 8 ? '#f59e0b' : '#0ab890';

  // Bars start at height 0 and animate upward — the "grow from bottom" effect.
  // In SVG, y=0 is at the TOP of the screen, so we start bars at y(0) (bottom)
  // and transition their top edge upward to y(d).
  g.selectAll('rect.bar').data(values).join('rect').attr('class', 'bar')
    .attr('x', (_, i) => x(labels[i])).attr('width', x.bandwidth())
    .attr('fill', d => barColor(d)).attr('rx', 4)
    .attr('y', y(0)).attr('height', 0)
    .transition().duration(700).ease(d3.easeCubicOut)
    .attr('y', d => d == null ? y(0) : y(d))
    .attr('height', d => d == null ? 0 : y(0) - y(d));

  // Dashed 8-hour target line
  g.append('line')
    .attr('x1', 0).attr('x2', W).attr('y1', y(8)).attr('y2', y(8))
    .attr('stroke', 'rgba(10,184,144,0.75)').attr('stroke-width', 2).attr('stroke-dasharray', '7,5');
  // "Target" label to the right of the chart (in the right margin)
  g.append('text')
    .attr('x', W + 6).attr('y', y(8) + 4)
    .attr('fill', '#0ab890').attr('font-size', '11px').text('Target');

  g.append('rect').attr('width', W).attr('height', CH).attr('fill', 'transparent')
    .on('mousemove', function(event) {
      const [mx] = d3.pointer(event);
      const idx  = Math.max(0, Math.min(labels.length - 1, Math.floor(mx / x.step())));
      showTip(
        `<strong>${labels[idx]}</strong><br>Sleep: ${values[idx] != null ? values[idx] + 'h' : '—'}`,
        event
      );
    })
    .on('mouseleave', hideTip);
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

  // Check whether Bob is already logged in from a previous visit.
  // Supabase stores the session in localStorage automatically.
  const { data: { session } } = await db.auth.getSession();
  updateAuthUI(session);

  // Keep the UI in sync if auth state changes while the page is open
  // (e.g. after the Google redirect comes back, or after sign-out)
  db.auth.onAuthStateChange((_event, newSession) => {
    updateAuthUI(newSession);
  });

  try { await renderExercises();                               } catch (e) { console.error('Exercises failed:', e); }
  try { await renderReading();                                 } catch (e) { console.error('Reading failed:',   e); }
  try { await loadTodayWellbeing(); await renderWellbeing();   } catch (e) { console.error('Wellbeing failed:', e); }
  try { await renderSleep();                                   } catch (e) { console.error('Sleep failed:',     e); }
  try { await renderTodos();                                   } catch (e) { console.error('Todos failed:',     e); }

  // Redraw charts if the browser window is resized significantly.
  // The 40px threshold stops a redraw firing on every single pixel of dragging.
  let _lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (Math.abs(window.innerWidth - _lastW) > 40) {
      _lastW = window.innerWidth;
      renderExercises().catch(() => {});
      renderReading().catch(() => {});
      renderWellbeing().catch(() => {});
      renderSleep().catch(() => {});
    }
  });

})();
