import { h, clear, icon, api, toast, modal, themeToggle, fmt, roman, ratingWord, avatar, LOGO, fmtDate } from './core.js';
import { miniBars } from './charts.js';

const main = document.getElementById('main');
const topbar = document.getElementById('topbar');

const store = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

const S = {
  config: null,
  session: store.get('afs-student'), // { token, student, class, forms, open? }
};

function saveSession() { store.set('afs-student', S.session); }
function endSession() {
  if (S.session?.forms) for (const f of S.session.forms) store.del(`afs-draft-${f.mapping_id}`);
  S.session = null;
  store.del('afs-student');
}

/* ---------------------------------------------------------------- header */
function renderTopbar() {
  const c = S.config;
  clear(topbar,
    h('a.brand', { href: '#/' }, LOGO(), h('div.grow', h('b', c?.institution || 'Faculty Feedback'), h('small', 'Anonymous Faculty Feedback'))),
    h('div.row', { style: { '--gap': '6px' } },
      c?.cycle && h('span.chip.chip-primary', { class: 'hide-sm' }, icon('calendar'), c.cycle.academic_year + ' · ' + c.cycle.term + ' sem'),
      S.session && h('button.btn.btn-ghost.btn-sm', { onclick: signOut }, icon('logout'), 'Exit'),
      themeToggle()),
  );
}

function signOut() {
  endSession();
  location.hash = '#/';
  route();
}

/* --------------------------------------------------------------- welcome */
function viewWelcome() {
  const c = S.config;
  if (!c.cycle) return viewClosed();
  const promises = [
    ['eyeOff', '100% anonymous', 'Your ratings are saved with no name, no register number and no time of day — nothing that points back to you.'],
    ['shield', 'Sign-in only checks you belong to the class', 'Your register number and date of birth confirm eligibility and stop duplicate submissions. They are never stored with your answers.'],
    ['lock', 'No personal details on screen', 'After you sign in, this portal shows only your class — never your name or register number.'],
    ['chart', 'Faculty see class averages only', 'Results are combined across many students before anyone reviews them.'],
  ];
  const left = h('section',
    h('span.chip.chip-accent', icon('sparkles'), `${c.cycle.name}`),
    h('h1', 'Your voice shapes ', h('em', 'better teaching.')),
    h('p.lead', 'Rate each of your faculty on ten quick questions. It takes about two minutes per subject, and it is completely anonymous.'),
    h('div.promises', promises.map(([ic, t, d]) => h('div.promise', h('span.ico', icon(ic)), h('div', h('b', t), h('span', d))))),
  );
  const right = c.requireVerification ? verifyCard() : openModeCard();
  clear(main, h('div.hero', left, right));
}

function verifyCard() {
  const err = h('div.err.hidden', { role: 'alert' });
  const input = h('input.input.input-lg#reg', { name: 'register_no', autocomplete: 'off', autocapitalize: 'characters', spellcheck: false, placeholder: 'e.g. 24CSBS001', required: true, maxlength: 30 });
  const dob = h('input.input.input-lg#dob', { name: 'dob', type: 'date', required: true, max: new Date().toISOString().slice(0, 10), min: '1950-01-01', autocomplete: 'off', 'aria-describedby': 'dob-hint' });
  const btn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, 'Continue', icon('arrowRight'));
  const form = h('form.stack', {
    autocomplete: 'off',
    onsubmit: async (e) => {
      e.preventDefault();
      err.classList.add('hidden');
      if (S.config.requireDob && !dob.value) { clear(err, icon('alert'), h('span', 'Please enter your date of birth.')); err.classList.remove('hidden'); dob.focus(); return; }
      btn.disabled = true;
      clear(btn, h('span.spinner'), 'Checking…');
      try {
        const out = await api('/api/public/verify', { method: 'POST', body: { register_no: input.value.trim(), dob: dob.value } });
        S.session = { token: out.token, class: out.class, forms: out.forms };
        saveSession();
        input.value = '';
        dob.value = '';
        location.hash = '#/forms';
      } catch (ex) {
        clear(err, icon('alert'), h('span', ex.message));
        err.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        clear(btn, 'Continue', icon('arrowRight'));
      }
    },
  },
  h('div.field', h('label', { for: 'reg' }, 'Register number'), input),
  S.config.requireDob ? h('div.field', h('label', { for: 'dob' }, 'Date of birth ', h('span.subtle', '(your password)')), dob,
    h('span.hint#dob-hint', 'Both are used only to confirm you belong to the class. They are never shown on screen or saved with your answers.')) : null,
  err, btn);
  return h('section.entry', { 'aria-labelledby': 'entry-title' },
    h('h2#entry-title', 'Start your feedback'),
    h('p.muted', `Open until ${fmtDate(S.config.cycle.closes_on)}`),
    form,
    h('div.anon-note', icon('eyeOff'), h('span', h('b', 'Anonymous by design. '), 'No personal data — including your register number — is displayed or attached to your feedback.')));
}

function openModeCard() {
  let dept = null;
  const classSel = h('select.select#cls', { disabled: true }, h('option', { value: '' }, 'Select department first'));
  const err = h('div.err.hidden', { role: 'alert' });
  const go = h('button.btn.btn-primary.btn-lg.btn-block', { disabled: true, onclick: start }, 'Continue', icon('arrowRight'));
  const grid = h('div.dept-grid', { role: 'group', 'aria-label': 'Department' }, S.config.departments.map((d) =>
    h('button', { type: 'button', title: d.name, 'aria-pressed': 'false', onclick: (e) => pickDept(d, e.currentTarget) }, d.code)));

  async function pickDept(d, btn) {
    dept = d;
    for (const b of grid.children) b.setAttribute('aria-pressed', String(b === btn));
    clear(classSel, h('option', { value: '' }, 'Loading…'));
    const rows = await api(`/api/public/classes?department_id=${d.id}`);
    clear(classSel, h('option', { value: '' }, rows.length ? 'Select year, semester & section' : 'No classes set up yet'),
      rows.map((c) => h('option', { value: c.id }, `${roman(c.year)} Year · Semester ${roman(c.semester)} · Section ${c.section}`)));
    classSel.disabled = !rows.length;
    go.disabled = true;
  }
  classSel.addEventListener('change', () => (go.disabled = !classSel.value));

  async function start() {
    try {
      const out = await api(`/api/public/forms?class_id=${classSel.value}`);
      S.session = { open: true, class: out.class, forms: out.forms.map((f) => ({ ...f, completed: false })) };
      saveSession();
      location.hash = '#/forms';
    } catch (ex) {
      clear(err, icon('alert'), h('span', ex.message));
      err.classList.remove('hidden');
    }
  }
  return h('section.entry',
    h('h2', 'Start your feedback'),
    h('p.muted', `Open until ${fmtDate(S.config.cycle.closes_on)}`),
    h('div.stack', { style: { marginTop: '20px', '--gap': '16px' } },
      h('div.field', h('span.label', '1. Your department'), grid),
      h('div.field', h('label', { for: 'cls' }, '2. Your class'), classSel),
      err, go));
}

function viewClosed() {
  clear(main, h('div.card.closed-card',
    icon('calendar'),
    h('h2', { style: { margin: '14px 0 8px' } }, 'Feedback is not open right now'),
    h('p.muted', 'There is no active feedback cycle at the moment. Your department will let you know when the next one opens.')));
}

/* ------------------------------------------------------------ forms list */
async function refreshForms() {
  if (S.session.open) return;
  try {
    const out = await api('/api/public/forms', { headers: { 'X-Student-Token': S.session.token } });
    S.session.forms = out.forms;
    saveSession();
  } catch (ex) {
    if (ex.status === 401) { endSession(); toast(ex.message, 'bad'); location.hash = '#/'; }
  }
}

function viewForms() {
  const { forms, class: cls } = S.session;
  const done = forms.filter((f) => f.completed).length;
  const pct = forms.length ? Math.round((done / forms.length) * 100) : 0;

  const head = h('div.page-head',
    h('div',
      h('div.kicker', cls.label),
      h('h1', 'Who would you like to rate?'),
      h('p.muted.row', { style: { marginTop: '8px', '--gap': '8px' } }, h('span.chip.chip-good', icon('eyeOff'), 'Signed in anonymously'), 'Pick a faculty and subject, in any order.')),
    h('div.card.progress-card',
      h('div.ring', { style: { '--p': pct, '--ring-color': done === forms.length && forms.length ? 'var(--good-mark)' : 'var(--primary)' } }, h('div', h('b', `${done}/${forms.length}`), h('small', 'DONE'))),
      h('div', h('b', done === forms.length && forms.length ? 'All complete!' : `${forms.length - done} remaining`), h('div.subtle', 'Each form ≈ 2 minutes'))));

  const list = forms.length
    ? h('div.form-list', forms.map((f) => formCard(f)))
    : h('div.card.empty', icon('book'), h('h3', 'No subjects assigned yet'), h('p', 'Your class has no faculty-subject mappings for this cycle. Please contact your department office.'));

  clear(main, head,
    done === forms.length && forms.length ? h('div.all-done', h('span.big', icon('check')), h('div', h('h3', 'Thank you — you have rated every faculty!'), h('p.muted', 'Your responses have been recorded anonymously. You can close this page now.'))) : null,
    list,
    h('p.subtle', { style: { marginTop: '18px', textAlign: 'center' } }, icon('lock', 'inline'), ' Ratings are saved without your identity. Faculty only see class-level averages.'));
}

function formCard(f) {
  const draft = !f.completed && store.get(`afs-draft-${f.mapping_id}`);
  const answered = draft ? Object.keys(draft.answers || {}).length : 0;
  return h(`button.form-card${f.completed ? '.done' : ''}${draft && answered ? '.draft' : ''}`, {
    type: 'button',
    disabled: f.completed,
    'aria-label': `${f.subject_name} with ${f.faculty_name}${f.completed ? ', submitted' : ''}`,
    onclick: () => { location.hash = `#/form/${f.mapping_id}`; },
  },
  h('div.who', avatar(f.faculty_name), h('div', h('b', f.faculty_name), h('span', f.designation || 'Faculty'))),
  h('div.subject', h('small', f.subject_code), f.subject_name),
  h('div.foot',
    f.completed ? h('span.row', { style: { '--gap': '6px' } }, icon('checkCircle'), 'Submitted') : h('span', draft && answered ? `Continue · ${answered}/${S.config.questions.length} answered` : 'Give feedback'),
    f.completed ? null : icon('arrowRight')));
}

/* --------------------------------------------------------- questionnaire */
function viewQuestionnaire(mappingId) {
  const f = S.session.forms.find((x) => x.mapping_id === mappingId);
  if (!f) { location.hash = '#/forms'; return; }
  if (f.completed) { toast('You have already submitted this one.', 'info'); location.hash = '#/forms'; return; }
  const questions = S.config.questions;
  const draftKey = `afs-draft-${mappingId}`;
  const state = store.get(draftKey) || { answers: {}, comment: '' };
  const persist = () => store.set(draftKey, state);

  const cards = new Map();
  const progressBar = h('i', { style: { width: '0%' } });
  const progressText = h('span.subtle');

  // Live summary (desktop sidebar + mobile sticky bar)
  const ring = h('div.ring');
  const ringVal = h('b', '—');
  ring.append(h('div', ringVal, h('small', 'AVERAGE')));
  const sumTotal = h('dd', '—');
  const sumCount = h('dd', '0');
  const sumWord = h('span', '—');
  const bars = h('div');
  const submitBtns = [];
  const mkSubmit = (cls = '') => {
    const b = h(`button.btn.btn-primary${cls}`, { onclick: review }, 'Review & submit');
    submitBtns.push(b);
    return b;
  };
  const nextBtn = h('button.btn.btn-soft.btn-block', { onclick: jumpNext }, 'Next unanswered', icon('chevronDown'));
  const mobileAvg = h('b', '—');
  const mobileCount = h('span', '');

  function update() {
    const vals = questions.map((q) => state.answers[q.id] ?? null);
    const n = vals.filter((v) => v !== null).length;
    const total = vals.reduce((s, v) => s + (v || 0), 0);
    const avg = n ? total / n : null;
    progressBar.style.width = `${(n / questions.length) * 100}%`;
    progressText.textContent = `${n} of ${questions.length} answered`;
    ring.style.setProperty('--p', avg ? avg * 10 : 0);
    ringVal.textContent = avg ? fmt(avg, 1) : '—';
    sumTotal.textContent = n ? `${fmt(total, 1)} / ${questions.length * 10}` : '—';
    sumCount.textContent = `${n} / ${questions.length}`;
    sumWord.textContent = avg ? ratingWord(avg) : 'Not rated yet';
    clear(bars, miniBars(vals));
    mobileAvg.textContent = avg ? fmt(avg, 1) : '—';
    mobileCount.textContent = `${n}/${questions.length} answered`;
    for (const b of submitBtns) b.disabled = n < questions.length;
    nextBtn.classList.toggle('hidden', n === questions.length);
  }

  function setValue(q, v) {
    v = Math.round(Math.min(10, Math.max(1, v)) * 2) / 2;
    state.answers[q.id] = v;
    persist();
    paintCard(q);
    update();
  }

  function paintCard(q) {
    const c = cards.get(q.id);
    const v = state.answers[q.id] ?? null;
    c.el.classList.toggle('answered', v !== null);
    c.val.textContent = v === null ? '–' : fmt(v, v % 1 ? 1 : 0);
    c.word.textContent = ratingWord(v);
    c.pills.forEach((p, i) => {
      const n = i + 1;
      p.classList.toggle('on', v !== null && n <= v);
      p.classList.toggle('sel', v !== null && n === Math.floor(v));
      p.setAttribute('aria-checked', String(v !== null && n === Math.floor(v)));
    });
    c.range.value = v ?? 5.5;
    c.range.style.opacity = v === null ? 0.5 : 1;
    c.range.setAttribute('aria-valuetext', v === null ? 'Not rated' : `${v} out of 10, ${ratingWord(v)}`);
  }

  const qCards = questions.map((q, idx) => {
    const val = h('b', '–');
    const word = h('span', 'Not rated yet');
    const pills = Array.from({ length: 10 }, (_, i) =>
      h('button', { type: 'button', role: 'radio', 'aria-label': `${i + 1} out of 10`, onclick: () => setValue(q, i + 1) }, String(i + 1)));
    const range = h('input', { type: 'range', min: 1, max: 10, step: 0.5, 'aria-label': `Fine-tune rating for question ${idx + 1}`, oninput: (e) => setValue(q, Number(e.target.value)) });
    const minus = h('button.btn.btn-sm.btn-icon.step', { type: 'button', 'aria-label': 'Decrease by 0.5', onclick: () => setValue(q, (state.answers[q.id] ?? 6) - 0.5) }, '−');
    const plus = h('button.btn.btn-sm.btn-icon.step', { type: 'button', 'aria-label': 'Increase by 0.5', onclick: () => setValue(q, (state.answers[q.id] ?? 5) + 0.5) }, '+');
    const el = h('section.card.q-card', { id: `q-${q.id}`, 'aria-labelledby': `qt-${q.id}` },
      h('div.q-top',
        h('span.q-num', String(idx + 1)),
        h('div.q-text', { id: `qt-${q.id}` }, q.text),
        h('div.q-value', { 'aria-live': 'polite' }, val, word)),
      h('div.pills', { role: 'radiogroup', 'aria-labelledby': `qt-${q.id}` }, pills),
      h('div.fine', minus, range, plus),
      h('div.scale-hint', h('span', '1 · Poor'), h('span', 'Use the slider for half points'), h('span', '10 · Outstanding')));
    cards.set(q.id, { el, val, word, pills, range });
    return el;
  });

  function jumpNext() {
    const q = questions.find((x) => state.answers[x.id] === undefined);
    if (!q) return;
    const el = cards.get(q.id).el;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1200);
    cards.get(q.id).pills[0].focus({ preventScroll: true });
  }

  const comment = S.config.allowComments
    ? h('section.card.comment-card',
        h('label.label', { for: 'comment' }, 'Anything else? (optional)'),
        h('textarea.textarea#comment', {
          maxlength: 1000, placeholder: 'Share what works well or what could be better…', value: state.comment || '',
          oninput: (e) => { state.comment = e.target.value; persist(); },
        }),
        h('p.subtle', { style: { marginTop: '8px' } }, 'Please don’t include your name, register number or details that could identify you.'))
    : null;

  const sidebar = h('aside.card.summary', { 'aria-label': 'Your rating summary' },
    h('div.gauge', ring, h('div', h('div.label', 'Overall impression'), h('h3', { style: { marginTop: '4px' } }, sumWord))),
    h('dl', h('dt', 'Answered'), sumCount, h('dt', 'Total score'), sumTotal),
    h('div.label', { style: { marginBottom: '6px' } }, 'Your ratings by question'),
    bars,
    h('div.stack', { style: { marginTop: '16px', '--gap': '8px' } }, nextBtn, mkSubmit('.btn-block.btn-lg')),
    h('p.subtle', { style: { marginTop: '12px' } }, icon('lock'), ' Your progress is saved on this device until you submit.'));

  clear(main,
    h('div.row', { style: { margin: '4px 0 14px' } }, h('button.btn.btn-ghost.btn-sm', { onclick: () => (location.hash = '#/forms') }, icon('arrowLeft'), 'All faculty')),
    h('div.q-layout',
      h('div',
        h('div.card.q-context', avatar(f.faculty_name), h('div.grow', h('b', f.faculty_name), h('div.subtle', `${f.subject_name} · ${f.subject_code}`)), h('span.chip.chip-primary', icon('eyeOff'), 'Anonymous')),
        h('div.spread', h('span.label', 'Rate from 1 (poor) to 10 (outstanding)'), progressText),
        h('div.q-progress', progressBar),
        qCards,
        comment,
        h('div.mobile-bar', h('div.stat', mobileAvg, mobileCount), mkSubmit())),
      sidebar));

  for (const q of questions) paintCard(q);
  update();
  window.scrollTo({ top: 0 });

  function review() {
    const vals = questions.map((q) => state.answers[q.id]);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    modal({
      title: 'Ready to submit?',
      subtitle: `${f.faculty_name} · ${f.subject_name}`,
      body: h('div.stack',
        h('div.row', { style: { '--gap': '16px' } },
          h('div.ring', { style: { '--p': avg * 10, '--size': '84px', '--th': '9px' } }, h('div', h('b', { style: { fontSize: '1.3rem', fontWeight: 800 } }, fmt(avg, 1)), h('small.subtle', '/10'))),
          h('div', h('h3', ratingWord(avg)), h('p.muted', `Total ${fmt(vals.reduce((a, b) => a + b, 0), 1)} out of ${vals.length * 10}`))),
        h('div.table-wrap', h('table.table', h('tbody', questions.map((q, i) => h('tr', h('td.subtle', `Q${i + 1}`), h('td', q.short || q.text), h('td.right.cell-strong.num', fmt(state.answers[q.id], 1))))))),
        h('div.callout', icon('lock'), h('span', 'Once submitted, feedback cannot be edited. It is saved without your register number, so nobody — including administrators — can trace it back to you.'))),
      actions: [
        (close) => h('button.btn', { onclick: close }, 'Keep editing'),
        (close) => {
          const b = h('button.btn.btn-primary', {
            onclick: async () => {
              b.disabled = true;
              clear(b, h('span.spinner'), 'Submitting…');
              try {
                await api('/api/public/submit', {
                  method: 'POST',
                  headers: S.session.token ? { 'X-Student-Token': S.session.token } : {},
                  body: { mapping_id: mappingId, ratings: state.answers, comment: state.comment || '' },
                });
                store.del(draftKey);
                f.completed = true;
                saveSession();
                close();
                S.lastSubmitted = { f, avg };
                location.hash = '#/thanks';
              } catch (ex) {
                toast(ex.message, 'bad');
                b.disabled = false;
                clear(b, 'Submit anonymously');
                if (ex.status === 409) { store.del(draftKey); close(); await refreshForms(); location.hash = '#/forms'; }
                if (ex.status === 401) { close(); endSession(); location.hash = '#/'; }
              }
            },
          }, icon('check'), 'Submit anonymously');
          return b;
        },
      ],
    });
  }
}

/* ---------------------------------------------------------------- thanks */
function viewThanks() {
  const forms = S.session.forms;
  const done = forms.filter((f) => f.completed).length;
  const next = forms.find((f) => !f.completed);
  const last = S.lastSubmitted;
  confetti();
  clear(main, h('section.card.thanks',
    h('div.tick', icon('check')),
    h('h1', 'Thank you!'),
    h('p.muted', { style: { marginTop: '10px' } }, last ? `Your feedback for ${last.f.faculty_name} (${last.f.subject_name}) has been recorded anonymously.` : 'Your feedback has been recorded anonymously.'),
    h('p', { style: { marginTop: '16px', fontWeight: 700 } }, `${done} of ${forms.length} complete`),
    h('div.q-progress', { style: { maxWidth: '280px', margin: '8px auto 0' } }, h('i', { style: { width: `${(done / forms.length) * 100}%` } })),
    h('div.actions',
      next ? h('button.btn.btn-primary.btn-lg', { onclick: () => (location.hash = `#/form/${next.mapping_id}`) }, `Next: ${next.faculty_name.split(' ').slice(0, 2).join(' ')}`, icon('arrowRight')) : null,
      h('button.btn.btn-lg', { onclick: () => (location.hash = '#/forms') }, next ? 'See all' : 'Done'))));
  main.focus();
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#4f46e5', '#f59e0b', '#10b981', '#ec4899', '#38bdf8'];
  const box = h('div.confetti', { 'aria-hidden': 'true' });
  for (let i = 0; i < 70; i++) {
    box.append(h('i', { style: { left: `${Math.random() * 100}%`, background: colors[i % colors.length], animationDuration: `${1.6 + Math.random() * 1.8}s`, animationDelay: `${Math.random() * 0.4}s`, transform: `rotate(${Math.random() * 180}deg)` } }));
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 4000);
}

/* ---------------------------------------------------------------- router */
async function route() {
  renderTopbar();
  const hash = location.hash || '#/';
  if (!S.config.cycle) return viewClosed();
  if (hash === '#/' || !S.session) {
    if (S.session && hash === '#/') { location.hash = '#/forms'; return; }
    return viewWelcome();
  }
  if (hash === '#/forms') { viewForms(); await refreshForms(); if (location.hash === '#/forms' && S.session) viewForms(); return; }
  if (hash.startsWith('#/form/')) return viewQuestionnaire(Number(hash.split('/')[2]));
  if (hash === '#/thanks') return viewThanks();
  location.hash = '#/forms';
}

(async function init() {
  clear(main, h('div.stack', { style: { padding: '40px 0', '--gap': '16px' } }, h('div.skeleton', { style: { height: '48px', width: '60%' } }), h('div.skeleton', { style: { height: '240px' } })));
  try {
    S.config = await api('/api/public/config');
  } catch (ex) {
    clear(main, h('div.card.closed-card', icon('alert'), h('h2', { style: { margin: '14px 0 8px' } }, 'Can’t load the feedback portal'), h('p.muted', ex.message), h('button.btn.btn-primary', { style: { marginTop: '16px' }, onclick: () => location.reload() }, 'Try again')));
    return;
  }
  document.title = `Faculty Feedback · ${S.config.institution_short || S.config.institution}`;
  // A session from another mode / cycle is stale.
  if (S.session && (!!S.session.open === S.config.requireVerification)) endSession();
  window.addEventListener('hashchange', route);
  route();
})();
