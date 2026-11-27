import { h, clear, icon, api, toast, modal, themeToggle, avatar, LOGO } from '../core.js';
import { state, loadMeta, bindTop, isSuper } from './shared.js';
import * as insights from './insights.js';
import * as data from './data.js';
import * as settings from './settings.js';

const app = document.getElementById('app');

const NAV = [
  ['Overview', [
    ['dashboard', 'Dashboard', 'home'],
  ]],
  ['Feedback', [
    ['reports', 'Reports', 'chart'],
    ['responses', 'Responses', 'message'],
    ['completion', 'Completion', 'target'],
  ]],
  ['Academic data', [
    ['departments', 'Departments', 'building', true],
    ['classes', 'Classes & sections', 'layers'],
    ['students', 'Students', 'graduation'],
    ['faculty', 'Faculty', 'users'],
    ['subjects', 'Subjects', 'book'],
    ['mappings', 'Faculty mapping', 'link'],
    ['import', 'Data import', 'upload'],
  ]],
  ['Configuration', [
    ['cycles', 'Feedback cycles', 'calendar'],
    ['questions', 'Questionnaire', 'clipboard'],
    ['settings', 'Settings', 'settings', true],
    ['admins', 'Admin users', 'key', true],
  ]],
];

const ROUTES = {
  dashboard: insights.dashboard,
  reports: insights.reports,
  'faculty-report': insights.facultyDetail,
  responses: insights.responses,
  completion: insights.completion,
  departments: data.departments,
  classes: data.classes,
  students: data.students,
  faculty: data.faculty,
  subjects: data.subjects,
  mappings: data.mappings,
  import: data.importer,
  cycles: settings.cycles,
  questions: settings.questions,
  settings: settings.general,
  admins: settings.admins,
};

/* ----------------------------------------------------------------- login */
function viewLogin(message) {
  const err = h('div.callout.bad.hidden', { role: 'alert' });
  const user = h('input.input#u', { autocomplete: 'username', required: true, autofocus: true });
  const pass = h('input.input#p', { type: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, 'Sign in');
  clear(app, h('div.login',
    h('section.login-art',
      h('div.brand-line', LOGO(), 'Faculty Feedback · Admin'),
      h('div',
        h('h1', 'Turn student voices into better teaching.'),
        h('p', 'Manage your academic data, follow completion in real time and explore anonymous feedback by faculty, subject, class and semester.')),
      h('div.feat',
        h('span', icon('shield'), 'Answers are never linked to students'),
        h('span', icon('upload'), 'Bulk import from Excel or CSV'),
        h('span', icon('download'), 'Filtered Excel reports in one click'))),
    h('section.login-form',
      h('form.stack', {
        style: { '--gap': '16px' },
        onsubmit: async (e) => {
          e.preventDefault();
          err.classList.add('hidden');
          btn.disabled = true;
          clear(btn, h('span.spinner'), 'Signing in…');
          try {
            await api('/api/auth/login', { method: 'POST', body: { username: user.value, password: pass.value } });
            await boot();
          } catch (ex) {
            clear(err, icon('alert'), h('span', ex.message));
            err.classList.remove('hidden');
            btn.disabled = false;
            clear(btn, 'Sign in');
            pass.select();
          }
        },
      },
      h('div', h('h2', 'Welcome back'), h('p.muted', { style: { marginTop: '6px' } }, 'Sign in to the administration portal.')),
      message ? h('div.callout', icon('info'), h('span', message)) : null,
      err,
      h('div.field', h('label', { for: 'u' }, 'Username'), user),
      h('div.field', h('label', { for: 'p' }, 'Password'), pass),
      btn,
      h('p.demo-hint', 'Demo accounts — super admin: ', h('b.mono', 'admin / admin123'), ' · department admin (CSE): ', h('b.mono', 'hod.cse / hod123'), '. Change these passwords after first sign-in.'),
      h('a.subtle', { href: '/' }, '← Back to the student portal')))));
  user.focus();
}

/* ----------------------------------------------------------------- shell */
function viewShell() {
  const title = h('h1', '');
  const crumb = h('div.crumb', '');
  const actions = h('div.row', { style: { marginLeft: 'auto', '--gap': '8px' } });
  bindTop(title, crumb, actions);

  const links = [];
  const nav = h('nav', { 'aria-label': 'Main' }, NAV.map(([group, items]) => {
    const visible = items.filter(([, , , superOnly]) => !superOnly || isSuper());
    if (!visible.length) return null;
    return [h('div.nav-group', group), visible.map(([key, label, ic]) => {
      const a = h('a.nav-link', { href: `#/${key}`, 'data-key': key }, icon(ic), label);
      links.push(a);
      return a;
    })];
  }));

  const shell = h('div.shell');
  const side = h('aside.side',
    h('div.brand-line', LOGO(), h('div', h('b', state.me.institution), h('small', 'Feedback administration'))),
    nav,
    h('div.me', avatar(state.me.name), h('div.grow', h('b', state.me.name), h('small', state.me.role === 'super_admin' ? 'Super admin' : `Department admin · ${state.me.department_code}`)),
      h('button.btn.btn-ghost.btn-icon.btn-sm', { title: 'Account', 'aria-label': 'Account', onclick: accountMenu }, icon('settings'))));
  const main = h('main.grow', { id: 'main' },
    h('header.top',
      h('button.btn.btn-ghost.btn-icon.menu-btn', { 'aria-label': 'Open menu', onclick: () => shell.classList.add('nav-open') }, icon('menu')),
      h('div', crumb, title),
      actions,
      themeToggle()),
    h('div.content#content'));
  clear(shell, side, h('div.scrim', { onclick: () => shell.classList.remove('nav-open') }), main);
  clear(app, shell);

  return {
    content: main.querySelector('#content'),
    setActive(key) {
      shell.classList.remove('nav-open');
      for (const a of links) {
        const k = a.dataset.key;
        if (k === key || (key === 'faculty-report' && k === 'reports')) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
    },
  };
}

function accountMenu() {
  const cur = h('input.input#cur', { type: 'password', autocomplete: 'current-password' });
  const nw = h('input.input#nw', { type: 'password', autocomplete: 'new-password', minlength: 8 });
  const nw2 = h('input.input#nw2', { type: 'password', autocomplete: 'new-password' });
  modal({
    title: 'Your account',
    subtitle: `${state.me.name} · @${state.me.username}`,
    body: h('div.stack',
      h('h3', 'Change password'),
      h('div.field', h('label', { for: 'cur' }, 'Current password'), cur),
      h('div.field', h('label', { for: 'nw' }, 'New password'), nw, h('span.hint', 'At least 8 characters.')),
      h('div.field', h('label', { for: 'nw2' }, 'Confirm new password'), nw2)),
    actions: [
      (close) => h('button.btn.btn-danger', { onclick: async () => { await api('/api/auth/logout', { method: 'POST' }); close(); state.me = null; viewLogin('You have been signed out.'); } }, icon('logout'), 'Sign out'),
      (close) => h('button.btn.btn-primary', {
        onclick: async () => {
          if (nw.value !== nw2.value) return toast('The new passwords do not match.', 'bad');
          try {
            await api('/api/admin/password', { method: 'POST', body: { current: cur.value, next: nw.value } });
            toast('Password updated.');
            state.me.defaultPassword = false;
            close();
            route();
          } catch (ex) { toast(ex.message, 'bad'); }
        },
      }, 'Update password'),
    ],
  });
}

/* ---------------------------------------------------------------- router */
let shellApi;
async function route() {
  if (!state.me) return;
  const [, key = 'dashboard', ...rest] = (location.hash || '#/dashboard').slice(1).split('/');
  const view = ROUTES[key];
  if (!view) { location.hash = '#/dashboard'; return; }
  shellApi.setActive(key);
  const el = shellApi.content;
  clear(el);
  try {
    await view(el, ...rest);
  } catch (ex) {
    if (ex.status === 401) { state.me = null; return viewLogin('Your session has expired. Please sign in again.'); }
    clear(el, h('div.card.empty', icon('alert'), h('h3', 'Something went wrong'), h('p', ex.message), h('button.btn.btn-primary', { onclick: route }, 'Try again')));
  }
  el.parentElement.scrollTo?.(0, 0);
}

async function boot() {
  try {
    state.me = await api('/api/auth/me');
  } catch {
    return viewLogin();
  }
  await loadMeta();
  shellApi = viewShell();
  route();
}

window.addEventListener('hashchange', route);
window.addEventListener('afs:account', accountMenu);
window.addEventListener('afs:meta', async () => { await loadMeta(); });
boot();
