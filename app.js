/* Do You Know Hasina? — host-run bachelor party game. */

const STATE_KEY = 'hasina-state-v2';
const QUESTIONS_KEY = 'hasina-questions-v2';
const SETTINGS_KEY = 'hasina-settings-v1';
const QUESTIONS_META_KEY = 'hasina-questions-meta-v1';
/* Baked in so guests need no setup at all — the URL is public anyway. */
const DEFAULT_WORKER_URL = 'https://areeb-bachelor-results.jacekrzepny2.workers.dev';
const POLL_MS = 8000;

/* Rounds played before the app existed. questionId points into questions.json;
   the text is snapshotted so editing a question never rewrites history. */
const SEED_ROUNDS = [
  { questionId: 9,  question: 'Best friend',        brideAnswer: 'Vicky',     penaltyType: 'dare',  penaltyDescription: 'Strip shirt and walk out of the restaurant', result: 'correct', timestamp: null },
  { questionId: 20, question: 'Beach or mountains?', brideAnswer: 'Mountains', penaltyType: 'drink', penaltyDescription: '4 fingers of Corona beer', result: 'correct', timestamp: null },
  { questionId: 37, question: 'Ferrari or Porsche?', brideAnswer: 'Porsche',   penaltyType: 'drink', penaltyDescription: '4 fingers of Corona beer', result: 'wrong',   timestamp: null },
  { questionId: 34, question: 'Biggest pet peeve',   brideAnswer: '',          penaltyType: 'drink', penaltyDescription: '5 fingers of Corona',      result: 'wrong',   timestamp: null }
];

let questions = [];
let fileQuestions = [];
let questionsError = null;

let state = freshState();
let settings = { workerUrl: DEFAULT_WORKER_URL, partyKey: '', shuffle: false };

let filter = 'all';
let adminFilter = 'all';
let syncStatus = { mode: 'off', at: null, message: '' };
let pollTimer = null;
let questionsUpdatedAt = new Date(0).toISOString();
/* True while this device holds a change the server has not accepted yet.
   Clocks across phones cannot be trusted, so "who is newer" is decided by
   whether WE have unsaved work — not by comparing timestamps. */
let resultsDirty = false;
let questionsDirty = false;

function freshState() {
  return {
    rounds: renumber(SEED_ROUNDS.map((r) => ({ ...r }))),
    screen: 'home',
    draft: null,
    pendingQuestionId: null,
    updatedAt: new Date(0).toISOString()
  };
}

/* Round numbers always follow array order, so deleting one never leaves a gap. */
function renumber(rounds) {
  rounds.forEach((r, i) => { r.round = i + 1; });
  return rounds;
}

/* ---------------- storage ---------------- */

function readStore(key) {
  try { return localStorage.getItem(key); } catch (err) { return null; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, value); } catch (err) { /* private mode */ }
}
function clearStore(key) {
  try { localStorage.removeItem(key); } catch (err) { /* nothing to do */ }
}

function saveState() { writeStore(STATE_KEY, JSON.stringify(state)); }
/* Local only. Sharing with everyone else happens on an explicit Submit. */
function saveQuestions() {
  writeStore(QUESTIONS_KEY, JSON.stringify(questions));
  questionsUpdatedAt = new Date().toISOString();
  questionsDirty = true;
  writeStore(QUESTIONS_META_KEY, JSON.stringify({ updatedAt: questionsUpdatedAt }));
}
function saveSettings() { writeStore(SETTINGS_KEY, JSON.stringify(settings)); }

/* Every local change stamps a time, so the newest edit wins across devices. */
function touch() {
  state.updatedAt = new Date().toISOString();
  resultsDirty = true;
  saveState();
  pushState();
}

function loadState() {
  const raw = readStore(STATE_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    if (saved && Array.isArray(saved.rounds)) {
      state = {
        rounds: renumber(saved.rounds),
        screen: saved.screen || 'home',
        draft: saved.draft || null,
        pendingQuestionId: saved.pendingQuestionId || null,
        updatedAt: saved.updatedAt || new Date(0).toISOString()
      };
    }
  } catch (err) { /* corrupt — start fresh rather than crash mid-party */ }
}

function loadQuestionsMeta() {
  const raw = readStore(QUESTIONS_META_KEY);
  if (!raw) return;
  try {
    const meta = JSON.parse(raw);
    if (meta && meta.updatedAt) questionsUpdatedAt = meta.updatedAt;
  } catch (err) { /* ignore */ }
}

function loadSettings() {
  const raw = readStore(SETTINGS_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    if (saved && typeof saved === 'object') settings = { ...settings, ...saved };
  } catch (err) { /* ignore */ }
}

/* ---------------- sync ---------------- */

function syncConfigured() { return Boolean(settings.workerUrl); }
function canWrite() { return syncConfigured(); }

function workerBase() { return settings.workerUrl.replace(/\/+$/, ''); }
function endpoint() { return workerBase() + '/results'; }
function questionsEndpoint() { return workerBase() + '/questions'; }

async function pullState(force) {
  if (!syncConfigured()) return false;
  try {
    const res = await fetch(endpoint(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const remote = await res.json();
    if (!remote || !Array.isArray(remote.rounds)) throw new Error('bad payload');

    /* Clean device: the server is the truth, always. Dirty device: push first. */
    if (resultsDirty && !force) {
      await pushState();
      return true;
    }
    /* Never let an empty server response wipe a device that holds real data. */
    if (!remote.rounds.length && state.rounds.length) {
      resultsDirty = true;
      await pushState();
      return true;
    }
    if (force || JSON.stringify(remote.rounds) !== JSON.stringify(state.rounds)) {
      state.rounds = renumber(remote.rounds);
      state.updatedAt = remote.updatedAt || new Date().toISOString();
      resultsDirty = false;
      saveState();
      refreshCurrentScreen();
    }
    setSync('live', '');
    return true;
  } catch (err) {
    setSync('error', String(err.message || err));
    return false;
  }
}

async function pushState() {
  if (!syncConfigured()) return false;
  try {
    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rounds: state.rounds })
    });
    if (!res.ok) {
      let detail = 'HTTP ' + res.status;
      try { const body = await res.json(); if (body && body.error) detail = body.error; } catch (e) {}
      throw new Error(detail);
    }
    const saved = await res.json();
    if (saved) {
      if (Array.isArray(saved.rounds)) state.rounds = renumber(saved.rounds);
      if (saved.updatedAt) state.updatedAt = saved.updatedAt;
    }
    resultsDirty = false;
    saveState();
    setSync('live', '');
    return true;
  } catch (err) {
    resultsDirty = true;   /* keep retrying on the next poll */
    setSync('error', String(err.message || err));
    return false;
  }
}

async function pullQuestions(force) {
  if (!syncConfigured()) return false;
  try {
    const res = await fetch(questionsEndpoint(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const remote = await res.json();
    if (!remote || !Array.isArray(remote.questions)) throw new Error('bad payload');

    if (questionsDirty && !force) {
      await pushQuestions();
      return true;
    }
    if (!remote.questions.length && questions.length) {
      questionsDirty = true;
      await pushQuestions();
      return true;
    }
    if (force || JSON.stringify(remote.questions) !== JSON.stringify(questions)) {
      questions = remote.questions;
      questionsUpdatedAt = remote.updatedAt || new Date().toISOString();
      writeStore(QUESTIONS_KEY, JSON.stringify(questions));
      writeStore(QUESTIONS_META_KEY, JSON.stringify({ updatedAt: questionsUpdatedAt }));
      refreshCurrentScreen();
    }
    return true;
  } catch (err) {
    setSync('error', String(err.message || err));
    return false;
  }
}

async function pushQuestions() {
  if (!syncConfigured()) return false;
  try {
    const res = await fetch(questionsEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: questions })
    });
    if (!res.ok) {
      let detail = 'HTTP ' + res.status;
      try { const body = await res.json(); if (body && body.error) detail = body.error; } catch (e) {}
      throw new Error(detail);
    }
    const saved = await res.json();
    if (saved) {
      if (Array.isArray(saved.questions)) {
        questions = saved.questions;
        writeStore(QUESTIONS_KEY, JSON.stringify(questions));
      }
      if (saved.updatedAt) {
        questionsUpdatedAt = saved.updatedAt;
        writeStore(QUESTIONS_META_KEY, JSON.stringify({ updatedAt: questionsUpdatedAt }));
      }
    }
    questionsDirty = false;
    setSync('live', '');
    if (state.screen === 'questions') renderQuestionsSummary();
    return true;
  } catch (err) {
    questionsDirty = true;
    setSync('error', String(err.message || err));
    if (state.screen === 'questions') renderQuestionsSummary();
    return false;
  }
}

function setSync(mode, message) {
  syncStatus = { mode: mode, at: new Date(), message: message };
  renderSyncLine();
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  if (!syncConfigured()) return;
  pollTimer = setInterval(() => {
    /* Never yank the board out from under a round in progress, or a field being typed in. */
    if (state.screen === 'home' || state.screen === 'scoreboard' || state.screen === 'admin') {
      pullState(false);
      pullQuestions(false);
    } else if (resultsDirty || questionsDirty) {
      /* Mid-round or mid-edit: don't pull, but keep trying to save. */
      if (resultsDirty) pushState();
      if (questionsDirty) pushQuestions();
    }
  }, POLL_MS);
}

function renderSyncLine() {
  const el = $('sync-line');
  if (!el) return;
  if (!syncConfigured()) {
    el.className = 'sync-line sync-off';
    el.textContent = 'This device only — results are not saved to GitHub.';
    return;
  }
  /* Unsaved work outranks a bare error: it tells the user their change
     has not reached anyone else yet, which is what actually matters. */
  if (resultsDirty || questionsDirty) {
    el.className = 'sync-line sync-bad';
    el.textContent = 'Not saved yet — retrying' +
      (syncStatus.mode === 'error' && syncStatus.message ? ' (' + syncStatus.message + ')' : '…');
    return;
  }
  if (syncStatus.mode === 'error') {
    el.className = 'sync-line sync-bad';
    el.textContent = 'Sync problem: ' + syncStatus.message;
    return;
  }
  el.className = 'sync-line sync-ok';
  const when = syncStatus.at ? timeAgo(syncStatus.at) : 'not yet';
  el.textContent = 'Live · everyone sees this · ' + when;
}

function timeAgo(d) {
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  return Math.round(s / 60) + 'm ago';
}

/* ---------------- helpers ---------------- */

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function playedIds() {
  return new Set(state.rounds.map((r) => r.questionId).filter((id) => id != null));
}
function unplayedQuestions() {
  const played = playedIds();
  return questions.filter((q) => !played.has(q.id));
}
function roundFor(questionId) {
  return state.rounds.find((r) => r.questionId === questionId) || null;
}
function questionById(id) {
  return questions.find((q) => q.id === id) || null;
}
function nextRoundNumber() { return state.rounds.length + 1; }
function nextQuestionId() {
  return questions.reduce((max, q) => Math.max(max, q.id), 0) + 1;
}

/* Chosen once per round and remembered — otherwise shuffle would pick a
   different question on every call. */
function chooseNextQuestion() {
  const pool = unplayedQuestions();
  if (!pool.length) return null;
  if (settings.shuffle) return pool[Math.floor(Math.random() * pool.length)];
  return pool[0];
}

function pendingQuestion() {
  if (state.pendingQuestionId == null) return null;
  const played = playedIds();
  if (played.has(state.pendingQuestionId)) return null;
  return questionById(state.pendingQuestionId);
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------------- screens ---------------- */

const SCREENS = ['home', 'setup', 'question', 'penalty', 'admin', 'questions', 'settings', 'scoreboard'];

function show(screen) {
  state.screen = screen;
  SCREENS.forEach((name) => { $('screen-' + name).hidden = name !== screen; });
  window.scrollTo(0, 0);
  saveState();
}

function refreshCurrentScreen() {
  if (state.screen === 'home') renderHome();
  else if (state.screen === 'scoreboard') renderScoreboard();
  else if (state.screen === 'admin') renderAdmin();
}

function renderHome() {
  const played = state.rounds.length;
  const left = unplayedQuestions().length;
  const box = $('home-progress');
  box.innerHTML = '';
  box.appendChild(el('div', null, `Rounds played: ${played}`));

  if (questionsError) {
    box.appendChild(el('div', 'warn', questionsError));
  } else if (!questions.length) {
    box.appendChild(el('div', 'warn', 'No questions yet — add them under Questions & Answers.'));
  } else {
    const line = el('div');
    line.appendChild(el('strong', null, String(left)));
    line.appendChild(document.createTextNode(left === 1 ? ' question left' : ' questions left'));
    box.appendChild(line);
  }

  $('btn-next-question').disabled = left === 0;
  $('btn-next-question').textContent = left === 0 ? 'No questions left' : 'Next Question';
  $('toggle-shuffle').checked = Boolean(settings.shuffle);
  renderSyncLine();
}

function renderSetup() {
  $('setup-round').textContent = 'Round ' + nextRoundNumber();
  $('choice-drink').classList.remove('is-active');
  $('choice-dare').classList.remove('is-active');
  $('penalty-input').value = '';
  $('btn-reveal').disabled = true;
}

function renderQuestion() {
  const d = state.draft;
  $('question-round').textContent = 'Round ' + nextRoundNumber();
  $('question-penalty-chip').textContent = d.penaltyType || '';
  $('question-theme').textContent = d.theme || '';
  $('question-text').textContent = d.question;
  $('bride-answer-text').textContent = d.brideAnswer || 'Not recorded — ask the room';
  $('bride-answer').hidden = true;
  $('btn-peek').hidden = false;
}

function renderPenalty() {
  const d = state.draft;
  $('penalty-kicker').textContent = d.penaltyType === 'drink' ? 'Drink up' : 'Dare';
  $('penalty-text').textContent = d.penaltyDescription;
}

function renderScoreboard() {
  const correct = state.rounds.filter((r) => r.result === 'correct').length;
  const wrong = state.rounds.filter((r) => r.result === 'wrong').length;
  $('tally-correct').textContent = correct;
  $('tally-wrong').textContent = wrong;

  const body = $('results-body');
  body.innerHTML = '';
  const rows = state.rounds.filter((r) => filter === 'all' || r.result === filter);

  if (!rows.length) {
    const tr = el('tr');
    const td = el('td', 'empty', 'Nothing to show yet.');
    td.colSpan = 5;
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  rows.forEach((r) => {
    const tr = el('tr');
    const num = el('td', 'col-n', String(r.round)); num.dataset.label = 'Round'; tr.appendChild(num);
    const q = el('td', 'col-q', r.question); q.dataset.label = 'Question'; tr.appendChild(q);

    const answer = el('td', 'col-a');
    answer.dataset.label = 'Hasina said';
    if (r.brideAnswer) { answer.textContent = r.brideAnswer; }
    else { answer.className = 'col-a muted'; answer.textContent = 'not recorded'; }
    tr.appendChild(answer);

    const penalty = el('td', 'col-p');
    penalty.dataset.label = 'Penalty';
    const pb = el('span', 'cell-body');
    if (r.penaltyType) {
      pb.appendChild(el('span', 'pill pill-type', r.penaltyType));
      pb.appendChild(document.createTextNode(r.penaltyDescription || ''));
    } else {
      pb.appendChild(el('span', 'muted', 'none'));
    }
    penalty.appendChild(pb);
    tr.appendChild(penalty);

    const res = el('td', 'col-r');
    res.dataset.label = 'Result';
    const rb = el('span', 'cell-body');
    rb.appendChild(el('span', 'pill pill-' + r.result, r.result));
    res.appendChild(rb);
    tr.appendChild(res);

    body.appendChild(tr);
  });
}

/* ---------------- backend / admin ---------------- */

function renderAdmin() {
  const list = $('admin-list');
  list.innerHTML = '';

  const shown = questions.filter((q) => {
    const r = roundFor(q.id);
    if (adminFilter === 'played') return Boolean(r);
    if (adminFilter === 'unplayed') return !r;
    return true;
  });

  if (!shown.length) {
    list.appendChild(el('p', 'empty', 'Nothing here.'));
    return;
  }

  shown.forEach((q) => {
    const r = roundFor(q.id);
    const card = el('div', 'a-card');
    if (r) card.classList.add('is-played');

    const head = el('div', 'a-head');
    head.appendChild(el('span', 'q-num', '#' + q.id));
    if (q.theme) head.appendChild(el('span', 'pill pill-type', q.theme));
    card.appendChild(head);

    card.appendChild(el('p', 'a-question', q.question || '(no question text)'));
    if (q.brideAnswer) card.appendChild(el('p', 'a-answer', q.brideAnswer));

    card.appendChild(segmented('Result', [
      { v: 'unplayed', label: 'Unplayed' },
      { v: 'correct', label: 'Correct' },
      { v: 'wrong', label: 'Wrong' }
    ], r ? r.result : 'unplayed', (v) => setResult(q, v)));

    if (r) {
      card.appendChild(segmented('Penalty', [
        { v: 'none', label: 'None' },
        { v: 'drink', label: 'Drink' },
        { v: 'dare', label: 'Dare' }
      ], r.penaltyType || 'none', (v) => setPenaltyType(q.id, v)));

      const wrap = el('label', 'field q-field');
      wrap.appendChild(el('span', 'field-label', 'Penalty description'));
      const input = document.createElement('input');
      input.type = 'text';
      input.value = r.penaltyDescription || '';
      input.placeholder = 'optional';
      input.addEventListener('input', () => {
        const live = roundFor(q.id);
        if (live) { live.penaltyDescription = input.value; touch(); }
      });
      wrap.appendChild(input);
      card.appendChild(wrap);
    }

    list.appendChild(card);
  });
}

function segmented(label, options, current, onPick) {
  const wrap = el('div', 'seg-wrap');
  wrap.appendChild(el('span', 'field-label', label));
  const row = el('div', 'seg');
  options.forEach((o) => {
    const b = el('button', 'seg-btn', o.label);
    b.type = 'button';
    if (o.v === current) b.classList.add('is-active');
    b.addEventListener('click', () => onPick(o.v));
    row.appendChild(b);
  });
  wrap.appendChild(row);
  return wrap;
}

function setResult(question, value) {
  const existing = roundFor(question.id);

  if (value === 'unplayed') {
    if (existing) state.rounds = state.rounds.filter((r) => r.questionId !== question.id);
  } else if (existing) {
    existing.result = value;
  } else {
    state.rounds.push({
      questionId: question.id,
      question: question.question,
      brideAnswer: question.brideAnswer,
      penaltyType: null,
      penaltyDescription: '',
      result: value,
      timestamp: new Date().toISOString()
    });
  }

  renumber(state.rounds);
  touch();
  renderAdmin();
}

function setPenaltyType(questionId, value) {
  const r = roundFor(questionId);
  if (!r) return;
  r.penaltyType = value === 'none' ? null : value;
  if (!r.penaltyType) r.penaltyDescription = '';
  touch();
  renderAdmin();
}

/* ---------------- questions editor ---------------- */

function renderQuestionsSummary() {
  const box = $('questions-summary');
  if (!box) return;
  const bits = [`${questions.length} questions`, `${unplayedQuestions().length} still to play`];
  box.textContent = bits.join(' · ');

  const status = $('questions-sync');
  if (!status) return;
  if (!syncConfigured()) {
    status.className = 'sync-line sync-off';
    status.textContent = 'Not connected — questions stay on this device.';
  } else if (syncStatus.mode === 'error') {
    status.className = 'sync-line sync-bad';
    status.textContent = 'Last submit failed: ' + syncStatus.message;
  } else {
    status.className = 'sync-line sync-ok';
    status.textContent = 'Shared with everyone · anyone can add a question';
  }
}

function renderQuestions() {
  renderQuestionsSummary();
  const played = playedIds();
  const list = $('questions-list');
  list.innerHTML = '';

  if (!questions.length) {
    list.appendChild(el('p', 'empty', 'No questions yet. Add the first one above.'));
    return;
  }

  questions.forEach((q) => {
    const card = el('div', 'q-card');
    if (played.has(q.id)) card.classList.add('is-played');

    const head = el('div', 'q-head');
    head.appendChild(el('span', 'q-num', '#' + q.id));
    if (played.has(q.id)) head.appendChild(el('span', 'pill pill-played', 'played'));
    const del = el('button', 'q-delete', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => deleteQuestion(q.id));
    head.appendChild(del);
    card.appendChild(head);

    const save = el('button', 'btn btn-primary q-save', 'Save changes');
    save.type = 'button';
    save.disabled = true;

    const markDirty = () => { save.disabled = false; save.textContent = 'Save changes'; };

    card.appendChild(makeField('Theme', 'input', q.theme || '', (v) => { q.theme = v; markDirty(); }));
    card.appendChild(makeField('Question', 'textarea', q.question || '', (v) => { q.question = v; markDirty(); }));
    card.appendChild(makeField("Hasina's answer", 'textarea', q.brideAnswer || '', (v) => { q.brideAnswer = v; markDirty(); }));

    save.addEventListener('click', async () => {
      save.disabled = true;
      save.textContent = 'Saving…';
      saveQuestions();
      const ok = !syncConfigured() || (await pushQuestions());
      save.textContent = ok ? 'Saved' : 'Failed — tap to retry';
      save.disabled = ok;
      renderQuestionsSummary();
    });
    card.appendChild(save);

    list.appendChild(card);
  });
}

function makeField(label, kind, value, onInput) {
  const wrap = el('label', 'field q-field');
  wrap.appendChild(el('span', 'field-label', label));
  const input = document.createElement(kind);
  if (kind === 'input') input.type = 'text';
  if (kind === 'textarea') input.rows = 2;
  input.value = value;
  input.addEventListener('input', () => { onInput(input.value); autoGrow(input); });
  wrap.appendChild(input);
  if (kind === 'textarea') requestAnimationFrame(() => autoGrow(input));
  return wrap;
}

function autoGrow(input) {
  if (input.tagName !== 'TEXTAREA') return;
  input.style.height = 'auto';
  input.style.height = input.scrollHeight + 'px';
}

async function submitNewQuestion() {
  const theme = $('new-theme').value.trim();
  const text = $('new-question').value.trim();
  const answer = $('new-answer').value.trim();
  const btn = $('btn-submit-question');
  const note = $('new-question-note');

  if (!text) {
    note.textContent = 'Write the question first.';
    note.className = 'form-note is-bad';
    $('new-question').focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Submitting…';

  const added = { id: nextQuestionId(), theme: theme, question: text, brideAnswer: answer };
  questions.push(added);
  saveQuestions();

  const ok = !syncConfigured() || (await pushQuestions());
  if (ok) {
    $('new-theme').value = '';
    $('new-question').value = '';
    $('new-answer').value = '';
    note.textContent = syncConfigured()
      ? `Added and shared with everyone — #${added.id}`
      : `Added on this device — #${added.id}`;
    note.className = 'form-note is-good';
  } else {
    note.textContent = 'Saved here but could not share it: ' + syncStatus.message;
    note.className = 'form-note is-bad';
  }

  btn.disabled = false;
  btn.textContent = 'Submit question';
  renderQuestions();
}

async function deleteQuestion(id) {
  const q = questions.find((item) => item.id === id);
  const label = q && q.question ? `"${q.question}"` : 'this question';
  if (!window.confirm(`Delete ${label} for everyone? Rounds already played keep their record.`)) return;
  questions = questions.filter((item) => item.id !== id);
  saveQuestions();
  await pushQuestions();
  renderQuestions();
}

async function revertQuestions() {
  if (!window.confirm('Reload the shared question list, discarding anything unsaved here?')) return;
  if (syncConfigured() && (await pullQuestions(true))) { renderQuestions(); return; }
  questions = fileQuestions.map((q) => ({ ...q }));
  clearStore(QUESTIONS_KEY);
  renderQuestions();
}

/* ---------------- game flow ---------------- */

function startRound() {
  const q = chooseNextQuestion();
  if (!q) return;
  state.pendingQuestionId = q.id;
  saveState();
  renderSetup();
  show('setup');
}

function pickPenaltyType(type) {
  $('choice-drink').classList.toggle('is-active', type === 'drink');
  $('choice-dare').classList.toggle('is-active', type === 'dare');
  refreshRevealButton();
}

function selectedType() {
  if ($('choice-drink').classList.contains('is-active')) return 'drink';
  if ($('choice-dare').classList.contains('is-active')) return 'dare';
  return null;
}

function refreshRevealButton() {
  const ready = Boolean(selectedType()) && $('penalty-input').value.trim().length > 0;
  $('btn-reveal').disabled = !ready;
}

function revealQuestion() {
  const type = selectedType();
  const description = $('penalty-input').value.trim();
  const q = pendingQuestion() || chooseNextQuestion();
  if (!type || !description || !q) return;

  state.pendingQuestionId = q.id;
  state.draft = {
    questionId: q.id,
    theme: q.theme,
    question: q.question,
    brideAnswer: q.brideAnswer,
    penaltyType: type,
    penaltyDescription: description
  };
  renderQuestion();
  show('question');
}

function judge(result) {
  const d = state.draft;
  state.rounds.push({
    questionId: d.questionId,
    question: d.question,
    brideAnswer: d.brideAnswer,
    penaltyType: d.penaltyType,
    penaltyDescription: d.penaltyDescription,
    result: result,
    timestamp: new Date().toISOString()
  });
  renumber(state.rounds);
  state.pendingQuestionId = null;
  touch();

  if (result === 'wrong') { renderPenalty(); show('penalty'); }
  else finishRound();
}

function finishRound() {
  state.draft = null;
  state.pendingQuestionId = null;
  saveState();
  if (!unplayedQuestions().length) {
    filter = 'all';
    setActiveFilter();
    renderScoreboard();
    show('scoreboard');
  } else {
    renderHome();
    show('home');
  }
}

function resetGame() {
  if (!window.confirm('Reset the game? Every logged round is wiped back to the four already played. Your questions are kept.')) return;
  state = freshState();
  touch();
  renderHome();
  show('home');
}

/* ---------------- export ---------------- */

function downloadResults() {
  downloadJson('hasina-results.json', {
    exportedAt: new Date().toISOString(),
    totals: {
      correct: state.rounds.filter((r) => r.result === 'correct').length,
      wrong: state.rounds.filter((r) => r.result === 'wrong').length,
      played: state.rounds.length
    },
    rounds: state.rounds
  });
}

function setActiveFilter() {
  document.querySelectorAll('[data-filter]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.filter === filter);
  });
}

/* ---------------- settings screen ---------------- */

function renderSettings() {
  $('worker-url').value = settings.workerUrl || '';
  $('party-key').value = settings.partyKey || '';
  $('settings-status').textContent = syncConfigured()
    ? 'Connected — everyone shares the same scoreboard and questions.'
    : 'Not connected — this device only.';
}

function readSettingsForm() {
  settings.workerUrl = $('worker-url').value.trim();
  settings.partyKey = $('party-key').value.trim();
  saveSettings();
}

async function testSync() {
  readSettingsForm();
  const box = $('settings-status');
  if (!settings.workerUrl) { box.textContent = 'Enter the Worker URL first.'; return; }

  box.textContent = 'Testing…';
  try {
    const res = await fetch(settings.workerUrl.replace(/\/+$/, '') + '/health', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const info = await res.json();
    if (!info.configured) {
      box.textContent = 'Worker is up but missing its GITHUB_TOKEN or PARTY_KEY secret.';
      return;
    }
    const pulled = await pullState(false);
    box.textContent = pulled
      ? 'Connected. Everything saves to GitHub.'
      : 'Worker reachable but reading results failed.';
  } catch (err) {
    box.textContent = 'Could not reach the Worker: ' + (err.message || err);
  }
  startPolling();
  renderSyncLine();
}

/* ---------------- wiring ---------------- */

/* A cached HTML/JS mismatch must degrade, not blank the whole screen. */
function on(id, event, fn) {
  const node = $(id);
  if (node) node.addEventListener(event, fn);
  else console.warn('missing element:', id);
}

function wire() {
  on('btn-next-question', 'click', startRound);
  on('btn-home-scoreboard', 'click', () => {
    filter = 'all'; setActiveFilter(); renderScoreboard(); show('scoreboard');
  });
  on('btn-home-admin', 'click', () => { renderAdmin(); show('admin'); });
  on('btn-home-questions', 'click', () => { renderQuestions(); show('questions'); });
  on('btn-home-settings', 'click', () => { renderSettings(); show('settings'); });
  on('btn-reset', 'click', resetGame);

  on('toggle-shuffle', 'change', (e) => {
    settings.shuffle = e.target.checked;
    saveSettings();
  });

  on('choice-drink', 'click', () => pickPenaltyType('drink'));
  on('choice-dare', 'click', () => pickPenaltyType('dare'));
  on('penalty-input', 'input', refreshRevealButton);
  on('penalty-input', 'keydown', (e) => {
    if (e.key === 'Enter' && !$('btn-reveal').disabled) revealQuestion();
  });
  on('btn-reveal', 'click', revealQuestion);

  on('btn-peek', 'click', () => {
    $('bride-answer').hidden = false;
    $('btn-peek').hidden = true;
  });
  on('btn-correct', 'click', () => judge('correct'));
  on('btn-wrong', 'click', () => judge('wrong'));
  on('btn-penalty-done', 'click', finishRound);

  on('btn-submit-question', 'click', submitNewQuestion);
  on('btn-download-questions', 'click', () => downloadJson('questions.json', questions));
  on('btn-revert-questions', 'click', revertQuestions);

  on('btn-test-sync', 'click', testSync);
  on('btn-pull-now', 'click', async () => {
    readSettingsForm();
    $('settings-status').textContent = (await pullState(true))
      ? 'Loaded from GitHub.' : 'Could not load: ' + syncStatus.message;
  });
  on('btn-push-now', 'click', async () => {
    readSettingsForm();
    $('settings-status').textContent = (await pushState())
      ? 'Saved to GitHub.' : 'Could not save: ' + syncStatus.message;
  });
  ['worker-url', 'party-key'].forEach((id) => {
    $(id).addEventListener('change', () => { readSettingsForm(); startPolling(); });
  });

  document.querySelectorAll('[data-goto]').forEach((b) => {
    b.addEventListener('click', () => {
      state.draft = null;
      state.pendingQuestionId = null;
      renderHome();
      show('home');
    });
  });

  document.querySelectorAll('[data-filter]').forEach((b) => {
    b.addEventListener('click', () => {
      filter = b.dataset.filter; setActiveFilter(); renderScoreboard();
    });
  });

  document.querySelectorAll('[data-adminfilter]').forEach((b) => {
    b.addEventListener('click', () => {
      adminFilter = b.dataset.adminfilter;
      document.querySelectorAll('[data-adminfilter]').forEach((x) => {
        x.classList.toggle('is-active', x.dataset.adminfilter === adminFilter);
      });
      renderAdmin();
    });
  });

  on('btn-download', 'click', downloadResults);
}

async function loadQuestions() {
  const embedded = window.EMBEDDED_QUESTIONS;
  if (Array.isArray(embedded) || (embedded && Array.isArray(embedded.questions))) {
    fileQuestions = Array.isArray(embedded) ? embedded : embedded.questions;
  } else {
    try {
      const res = await fetch('questions.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      /* Bare array is the original committed shape; the Worker writes the
         wrapped form once questions sync is on. Accept both. */
      const list = Array.isArray(data) ? data : (data && data.questions);
      if (!Array.isArray(list)) throw new Error('questions.json has an unexpected shape');
      fileQuestions = list;
      if (data && data.updatedAt && data.updatedAt > questionsUpdatedAt) {
        questionsUpdatedAt = data.updatedAt;
      }
    } catch (err) {
      questionsError = 'Could not load questions.json (' + err.message + ').';
    }
  }

  const raw = readStore(QUESTIONS_KEY);
  if (raw) {
    try {
      const saved = JSON.parse(raw);
      if (Array.isArray(saved)) { questions = saved; questionsError = null; return; }
    } catch (err) { /* fall through to the file copy */ }
  }
  questions = fileQuestions.map((q) => ({ ...q }));
}

async function init() {
  loadState();
  loadSettings();
  loadQuestionsMeta();
  wire();
  await loadQuestions();

  if (state.draft && state.screen === 'question') {
    renderQuestion();
    show('question');
  } else {
    state.draft = null;
    renderHome();
    show('home');
  }

  if (syncConfigured()) {
    await Promise.all([pullState(false), pullQuestions(false)]);
    renderHome();
    startPolling();
  }
  renderSyncLine();
}

init();
