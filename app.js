/* Do You Know Hasina? — host-run bachelor party game. */

const STATE_KEY = 'hasina-state-v2';
const QUESTIONS_KEY = 'hasina-questions-v2';

/*
 * Rounds already played before the app existed. `questionId` points at the
 * matching entry in questions.json; the question/answer text is snapshotted
 * here too, so editing or deleting a question never rewrites history.
 */
const SEED_ROUNDS = [
  {
    round: 1,
    questionId: 9,
    question: 'Best friend',
    brideAnswer: 'Vicky',
    penaltyType: 'dare',
    penaltyDescription: 'Strip shirt and walk out of the restaurant',
    result: 'correct',
    timestamp: null
  },
  {
    round: 2,
    questionId: 20,
    question: 'Beach or mountains?',
    brideAnswer: 'Mountains',
    penaltyType: 'drink',
    penaltyDescription: '4 fingers of Corona beer',
    result: 'correct',
    timestamp: null
  },
  {
    round: 3,
    questionId: 37,
    question: 'Ferrari or Porsche?',
    brideAnswer: 'Porsche',
    penaltyType: 'drink',
    penaltyDescription: '4 fingers of Corona beer',
    result: 'wrong',
    timestamp: null
  },
  {
    round: 4,
    questionId: 34,
    question: 'Biggest pet peeve',
    brideAnswer: '',
    penaltyType: 'drink',
    penaltyDescription: '5 fingers of Corona',
    result: 'wrong',
    timestamp: null
  }
];

let questions = [];
let fileQuestions = [];
let questionsError = null;

let state = freshState();
let filter = 'all';

function freshState() {
  return {
    rounds: SEED_ROUNDS.map((r) => ({ ...r })),
    screen: 'home',
    draft: null
  };
}

/* ---------------- persistence ---------------- */

function readStore(key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null; /* Private mode — the game still runs from memory. */
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    /* Storage unavailable or full; in-memory state carries the round. */
  }
}

function clearStore(key) {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    /* nothing to do */
  }
}

function saveState() {
  writeStore(STATE_KEY, JSON.stringify(state));
}

function loadState() {
  const raw = readStore(STATE_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    if (saved && Array.isArray(saved.rounds)) {
      state = {
        rounds: saved.rounds,
        screen: saved.screen || 'home',
        draft: saved.draft || null
      };
    }
  } catch (err) {
    /* Corrupt payload — start fresh rather than crash mid-party. */
  }
}

function saveQuestions() {
  writeStore(QUESTIONS_KEY, JSON.stringify(questions));
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

function nextQuestion() {
  return unplayedQuestions()[0] || null;
}

function nextRoundNumber() {
  return state.rounds.length + 1;
}

function nextQuestionId() {
  return questions.reduce((max, q) => Math.max(max, q.id), 0) + 1;
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

const SCREENS = ['home', 'setup', 'question', 'penalty', 'questions', 'scoreboard'];

function show(screen) {
  state.screen = screen;
  SCREENS.forEach((name) => {
    $('screen-' + name).hidden = name !== screen;
  });
  window.scrollTo(0, 0);
  saveState();
}

function renderHome() {
  const played = state.rounds.length;
  const left = unplayedQuestions().length;
  const box = $('home-progress');
  box.innerHTML = '';

  box.appendChild(el('div', null, `Rounds played: ${played}`));

  if (questionsError) {
    box.appendChild(el('div', 'warn', questionsError));
  } else if (questions.length === 0) {
    box.appendChild(el('div', 'warn', 'No questions yet — add them under Questions & Answers.'));
  } else {
    const line = el('div');
    line.appendChild(el('strong', null, String(left)));
    line.appendChild(document.createTextNode(left === 1 ? ' question left' : ' questions left'));
    box.appendChild(line);
  }

  const noneLeft = left === 0;
  $('btn-next-question').disabled = noneLeft;
  $('btn-next-question').textContent = noneLeft ? 'No questions left' : 'Next Question';
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
  $('question-penalty-chip').textContent = d.penaltyType;
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

  if (rows.length === 0) {
    const tr = el('tr');
    const td = el('td', 'empty', 'Nothing to show yet.');
    td.colSpan = 5;
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  rows.forEach((r) => {
    const tr = el('tr');

    const num = el('td', 'col-n', String(r.round));
    num.dataset.label = 'Round';
    tr.appendChild(num);

    const question = el('td', 'col-q', r.question);
    question.dataset.label = 'Question';
    tr.appendChild(question);

    const answer = el('td', 'col-a');
    answer.dataset.label = 'Hasina said';
    if (r.brideAnswer) {
      answer.textContent = r.brideAnswer;
    } else {
      answer.className = 'col-a muted';
      answer.textContent = 'not recorded';
    }
    tr.appendChild(answer);

    const penalty = el('td', 'col-p');
    penalty.dataset.label = 'Penalty';
    const penaltyBody = el('span', 'cell-body');
    penaltyBody.appendChild(el('span', 'pill pill-type', r.penaltyType));
    penaltyBody.appendChild(document.createTextNode(r.penaltyDescription));
    penalty.appendChild(penaltyBody);
    tr.appendChild(penalty);

    const res = el('td', 'col-r');
    res.dataset.label = 'Result';
    const resBody = el('span', 'cell-body');
    resBody.appendChild(el('span', 'pill pill-' + r.result, r.result));
    res.appendChild(resBody);
    tr.appendChild(res);

    body.appendChild(tr);
  });
}

/* ---------------- questions editor ---------------- */

function renderQuestions() {
  const played = playedIds();
  const left = unplayedQuestions().length;
  $('questions-summary').textContent =
    `${questions.length} total · ${left} still to play · edits save automatically`;

  const list = $('questions-list');
  list.innerHTML = '';

  if (questions.length === 0) {
    list.appendChild(el('p', 'empty', 'No questions yet. Tap "Add question" to write the first one.'));
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

    card.appendChild(makeField('Theme', 'input', q.theme || '', (v) => {
      q.theme = v;
      saveQuestions();
    }));

    card.appendChild(makeField('Question', 'textarea', q.question || '', (v) => {
      q.question = v;
      saveQuestions();
    }));

    card.appendChild(makeField("Hasina's answer", 'textarea', q.brideAnswer || '', (v) => {
      q.brideAnswer = v;
      saveQuestions();
    }));

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
  input.addEventListener('input', () => {
    onInput(input.value);
    autoGrow(input);
  });
  wrap.appendChild(input);

  if (kind === 'textarea') requestAnimationFrame(() => autoGrow(input));
  return wrap;
}

function autoGrow(input) {
  if (input.tagName !== 'TEXTAREA') return;
  input.style.height = 'auto';
  input.style.height = input.scrollHeight + 'px';
}

function addQuestion() {
  questions.push({ id: nextQuestionId(), theme: '', question: '', brideAnswer: '' });
  saveQuestions();
  renderQuestions();
  const cards = document.querySelectorAll('.q-card');
  const last = cards[cards.length - 1];
  if (last) {
    last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const questionBox = last.querySelectorAll('textarea')[0];
    if (questionBox) questionBox.focus();
  }
}

function deleteQuestion(id) {
  const q = questions.find((item) => item.id === id);
  const label = q && q.question ? `"${q.question}"` : 'this question';
  if (!window.confirm(`Delete ${label}? Rounds already played keep their record.`)) return;
  questions = questions.filter((item) => item.id !== id);
  saveQuestions();
  renderQuestions();
}

function revertQuestions() {
  if (!window.confirm('Discard your edits and reload questions.json from the repo?')) return;
  questions = fileQuestions.map((q) => ({ ...q }));
  clearStore(QUESTIONS_KEY);
  renderQuestions();
}

/* ---------------- game flow ---------------- */

function startRound() {
  if (!nextQuestion()) return;
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
  const q = nextQuestion();
  if (!type || !description || !q) return;

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
    round: nextRoundNumber(),
    questionId: d.questionId,
    question: d.question,
    brideAnswer: d.brideAnswer,
    penaltyType: d.penaltyType,
    penaltyDescription: d.penaltyDescription,
    result: result,
    timestamp: new Date().toISOString()
  });
  saveState();

  if (result === 'wrong') {
    renderPenalty();
    show('penalty');
  } else {
    finishRound();
  }
}

function finishRound() {
  state.draft = null;
  if (!nextQuestion()) {
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
  saveState();
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

function downloadQuestions() {
  downloadJson('questions.json', questions);
}

/* ---------------- filters ---------------- */

function setActiveFilter() {
  document.querySelectorAll('.filter').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.filter === filter);
  });
}

/* ---------------- wiring ---------------- */

function wire() {
  $('btn-next-question').addEventListener('click', startRound);
  $('btn-home-scoreboard').addEventListener('click', () => {
    renderScoreboard();
    show('scoreboard');
  });
  $('btn-home-questions').addEventListener('click', () => {
    renderQuestions();
    show('questions');
  });
  $('btn-reset').addEventListener('click', resetGame);

  $('choice-drink').addEventListener('click', () => pickPenaltyType('drink'));
  $('choice-dare').addEventListener('click', () => pickPenaltyType('dare'));
  $('penalty-input').addEventListener('input', refreshRevealButton);
  $('penalty-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !$('btn-reveal').disabled) revealQuestion();
  });
  $('btn-reveal').addEventListener('click', revealQuestion);

  $('btn-peek').addEventListener('click', () => {
    $('bride-answer').hidden = false;
    $('btn-peek').hidden = true;
  });
  $('btn-correct').addEventListener('click', () => judge('correct'));
  $('btn-wrong').addEventListener('click', () => judge('wrong'));
  $('btn-penalty-done').addEventListener('click', finishRound);

  $('btn-add-question').addEventListener('click', addQuestion);
  $('btn-download-questions').addEventListener('click', downloadQuestions);
  $('btn-revert-questions').addEventListener('click', revertQuestions);

  document.querySelectorAll('[data-goto]').forEach((b) => {
    b.addEventListener('click', () => {
      state.draft = null;
      renderHome();
      show('home');
    });
  });

  document.querySelectorAll('.filter').forEach((b) => {
    b.addEventListener('click', () => {
      filter = b.dataset.filter;
      setActiveFilter();
      renderScoreboard();
    });
  });

  $('btn-download').addEventListener('click', downloadResults);
}

async function loadQuestions() {
  /* The single-file build inlines the questions so it works offline, from file://. */
  if (Array.isArray(window.EMBEDDED_QUESTIONS)) {
    fileQuestions = window.EMBEDDED_QUESTIONS;
  } else {
    try {
      const res = await fetch('questions.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('questions.json must be an array');
      fileQuestions = data;
    } catch (err) {
      questionsError = 'Could not load questions.json (' + err.message + ').';
    }
  }

  /* Edits made in the app win over the committed file. */
  const raw = readStore(QUESTIONS_KEY);
  if (raw) {
    try {
      const saved = JSON.parse(raw);
      if (Array.isArray(saved)) {
        questions = saved;
        questionsError = null;
        return;
      }
    } catch (err) {
      /* fall through to the file copy */
    }
  }
  questions = fileQuestions.map((q) => ({ ...q }));
}

async function init() {
  loadState();
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
}

init();
