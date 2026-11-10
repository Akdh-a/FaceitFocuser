// Иконки (lucide-подобные контуры)
const ICON = {
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  delta: '<path d="m7 17 5-5 5 5M7 11l5-5 5 5"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/>',
  bars: '<path d="M3 12h3M9 12h3M15 12h3M21 12h0"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.3 17a10 10 0 1 1 17.4 0"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
};

// Вкладки и настройки. key — ключ в chrome.storage (true = скрывать).
const TABS = [
  {
    id: 'elo', name: 'ELO', desc: 'Всё, по чему можно узнать твой ELO',
    items: [
      {
        key: 'hideElo', icon: 'hash', title: 'Скрыть ELO', sub: 'Лобби, профиль, комната матча, история',
        includes: [
          ['hash', 'Текущий ELO'],
          ['delta', 'Изменения +/− после матча'],
          ['calendar', 'ELO за сезоны и максимум в сезоне'],
          ['help', 'Elo до след. уровня — число станет «??»'],
          ['bars', 'Цветная полоска уровней в профиле'],
        ],
      },
    ],
  },
  {
    id: 'level', name: 'Уровень', desc: 'Значок уровня скилла (кружок с цифрой)',
    items: [
      { key: 'hideLevel', icon: 'gauge', title: 'Значок уровня', sub: 'Лобби, история матчей, окно Track' },
    ],
  },
  {
    id: 'other', name: 'Прочее', desc: 'Остальное, что отвлекает от игры',
    items: [
      { key: 'hideLadder', icon: 'trophy', title: 'Monthly Ladder', sub: 'Вкладка ежемесячного ладдера' },
      { key: 'hideMission', icon: 'target', title: 'Monthly Mission', sub: 'Блок миссии сезона' },
    ],
  },
];

const KEYS = TABS.flatMap((t) => t.items.map((i) => i.key));
const PRESETS = {
  all: Object.fromEntries(KEYS.map((k) => [k, true])),
  level: Object.fromEntries(KEYS.map((k) => [k, k !== 'hideLevel'])),
  none: Object.fromEntries(KEYS.map((k) => [k, false])),
};

const defaults = { enabled: true, popupTab: 'elo', eloScope: 'all', autoNickname: '', ...PRESETS.all };
let state = {};

const $ = (id) => document.getElementById(id);
const svg = (name) => `<svg viewBox="0 0 24 24">${ICON[name]}</svg>`;

function renderTabs() {
  $('tabs').innerHTML = TABS.map((t) => {
    const on = t.items.filter((i) => state[i.key]).length;
    return `<button role="tab" data-tab="${t.id}" class="${t.id === state.popupTab ? 'active' : ''}">
      ${t.name}<span class="count">${on}/${t.items.length}</span></button>`;
  }).join('');
}

function renderPanel() {
  const tab = TABS.find((t) => t.id === state.popupTab) || TABS[0];
  $('panel').innerHTML = `<div class="tab-desc">${tab.desc}</div>` + tab.items.map((i) => `
    <label class="opt ${state[i.key] ? 'on' : ''}">
      <div class="opt-icon">${svg(i.icon)}</div>
      <div class="opt-text">
        <div class="opt-title">${i.title}</div>
        <div class="opt-sub">${i.sub}</div>
      </div>
      <span class="switch">
        <input type="checkbox" data-key="${i.key}" ${state[i.key] ? 'checked' : ''}>
        <span class="track"><span class="thumb"></span></span>
      </span>
    </label>${i.includes ? `
    <div class="includes ${state[i.key] ? 'on' : ''}">
      <div class="includes-head">Вместе с ним скрывается</div>
      ${i.includes.map(([ic, text]) => `<div class="inc">${svg(ic)}<span>${text}</span></div>`).join('')}
    </div>` : ''}`).join('') + (tab.id === 'elo' ? scopeBlock() : '');
}

// Чей ELO скрывать: весь или только свой (ELO противников и тиммейтов видно)
function scopeBlock() {
  const mine = state.eloScope === 'mine';
  return `
    <div class="scope ${state.hideElo ? '' : 'off'}">
      <div class="includes-head">Чей ELO скрывать</div>
      <div class="seg">
        <button data-scope="all" class="${mine ? '' : 'active'}">Весь ELO</button>
        <button data-scope="mine" class="${mine ? 'active' : ''}">Только мой</button>
      </div>
      ${mine ? `
      <div class="acc">
        <div class="acc-ava">${state.autoNickname ? escapeHtml(state.autoNickname[0].toUpperCase()) : '?'}</div>
        <div>
          <div class="acc-name">${state.autoNickname ? escapeHtml(state.autoNickname) : 'Аккаунт ещё не определён'}</div>
          <div class="acc-sub">${state.autoNickname ? 'Определён автоматически' : 'Открой свой профиль на FACEIT один раз'}</div>
        </div>
      </div>
      <div class="hint">Скрывается ELO в строке с твоим ником и весь твой профиль. ELO остальных игроков видно.</div>` : `
      <div class="hint">Скрывается ELO всех игроков, включая противников и тиммейтов.</div>`}
    </div>`;
}

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function renderHeader() {
  const on = KEYS.filter((k) => state[k]).length;
  $('enabled').checked = state.enabled;
  document.body.classList.toggle('disabled', !state.enabled);
  $('status').innerHTML = state.enabled
    ? `Скрыто <b>${on}</b> из ${KEYS.length}`
    : 'Выключено — всё видно';
  // Подсветка пресета, совпадающего с текущими настройками
  document.querySelectorAll('[data-preset]').forEach((b) => {
    const p = PRESETS[b.dataset.preset];
    b.classList.toggle('active', KEYS.every((k) => p[k] === state[k]));
  });
}

function render() {
  renderHeader();
  renderTabs();
  renderPanel();
}

function save(changes) {
  Object.assign(state, changes);
  chrome.storage.local.set(changes);
  render();
}

$('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) save({ popupTab: b.dataset.tab });
});
$('panel').addEventListener('change', (e) => {
  const key = e.target.dataset.key;
  if (key) save({ [key]: e.target.checked });
});
$('panel').addEventListener('click', (e) => {
  const b = e.target.closest('[data-scope]');
  if (b) save({ eloScope: b.dataset.scope });
});
$('presets').addEventListener('click', (e) => {
  const b = e.target.closest('[data-preset]');
  if (b) save({ enabled: true, ...PRESETS[b.dataset.preset] });
});

chrome.storage.local.get(defaults, (s) => {
  state = s;
  render();
});
// Ник, введённый раньше вручную, больше не нужен — работает автоопределение
chrome.storage.local.remove('nickname');
// Аккаунт мог определиться, пока попап открыт
chrome.storage.onChanged.addListener((ch) => {
  if (ch.autoNickname) { state.autoNickname = ch.autoNickname.newValue || ''; render(); }
});
