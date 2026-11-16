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
        key: 'hideElo', icon: 'hash', title: 'Скрыть весь ELO', sub: 'Включает и выключает все пункты ELO ниже',
        children: [
          { key: 'hideCurrentElo', icon: 'hash', title: 'Текущий ELO', sub: 'Профиль, лобби и комната матча' },
          { key: 'hideDelta', icon: 'delta', title: 'Изменения после матча', sub: 'Например, +25 или −25' },
          { key: 'hideSeason', icon: 'calendar', title: 'Карточки сезонов', sub: 'Блоки Season 7, Season 8 и другие в профиле' },
          { key: 'hideNext', icon: 'help', title: 'ELO до следующего уровня', sub: 'Число заменяется на «??»' },
          { key: 'hideBars', icon: 'bars', title: 'Шкала уровней 1–10', sub: 'Ряд уровней в статистике сезона' },
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
  { id: 'settings', name: 'Настройки', desc: 'Настрой внешний вид расширения', items: [] },
];

const THEME_COLORS = [
  { name: 'Оранжевый', value: '#ff5500' },
  { name: 'Синий', value: '#3987ff' },
  { name: 'Фиолетовый', value: '#a855f7' },
  { name: 'Зелёный', value: '#22c55e' },
  { name: 'Красный', value: '#ef4444' },
];
const ELO_KEYS = TABS.find((t) => t.id === 'elo').items[0].children.map((i) => i.key);
const KEYS = [...TABS.flatMap((t) => t.items.flatMap((i) => i.children
  ? i.children.map((child) => child.key)
  : [i.key])), 'hideTilt'];
const PRESETS = {
  all: Object.fromEntries(KEYS.map((k) => [k, true])),
  level: { ...Object.fromEntries(KEYS.map((k) => [k, k !== 'hideLevel'])), hideTilt: true },
  none: { ...Object.fromEntries(KEYS.map((k) => [k, false])), hideTilt: false },
};

const CONTEXT_MODES = [
  { value: 'default', label: 'Обычная маска' },
  { value: 'levelOnly', label: 'Только уровень' },
  { value: 'hide', label: 'Скрыть всё' },
  { value: 'show', label: 'Показать всё' },
];
const CONTEXTS = [
  { key: 'contextProfile', label: 'Профили игроков' },
  { key: 'contextLobby', label: 'Лобби и очередь' },
  { key: 'contextMatch', label: 'Матч и комната' },
];
const MAX_REVEALS = 2;
const REVEAL_DURATION_MS = 30_000;
const defaults = {
  enabled: true, popupTab: 'elo', eloScope: 'all', autoNickname: '', accentColor: '#ff5500',
  contextProfile: 'default', contextLobby: 'default', contextMatch: 'default',
  revealCount: 0, revealUntil: 0,
  ...PRESETS.all,
  hideTilt: false,
};
let state = {};

const $ = (id) => document.getElementById(id);
const svg = (name) => `<svg viewBox="0 0 24 24">${ICON[name]}</svg>`;

function renderTabs() {
  $('tabs').innerHTML = TABS.map((t) => {
    const keys = t.items.flatMap((i) => i.children ? i.children.map((child) => child.key) : [i.key]);
    const on = keys.filter((key) => state[key]).length;
    return `<button role="tab" data-tab="${t.id}" class="${t.id === state.popupTab ? 'active' : ''}">
      ${t.name}${keys.length ? `<span class="count">${on}/${keys.length}</span>` : ''}</button>`;
  }).join('');
}

function renderOption(i, child = false) {
  return `<label class="opt ${child ? 'child' : ''} ${state[i.key] ? 'on' : ''}">
    <div class="opt-icon">${svg(i.icon)}</div>
    <div class="opt-text">
      <div class="opt-title">${i.title}</div>
      <div class="opt-sub">${i.sub}</div>
    </div>
    <span class="switch">
      <input type="checkbox" data-key="${i.key}" ${state[i.key] ? 'checked' : ''}>
      <span class="track"><span class="thumb"></span></span>
    </span>
  </label>`;
}

function renderPanel() {
  const tab = TABS.find((t) => t.id === state.popupTab) || TABS[0];
  if (tab.id === 'settings') {
    $('panel').innerHTML = `<div class="tab-desc">${tab.desc}</div>${settingsBlock()}`;
    return;
  }
  $('panel').innerHTML = `<div class="tab-desc">${tab.desc}</div>` + tab.items.map((i) => i.children
    ? `<section class="elo-group">
        ${renderOption(i)}
        <div class="elo-children">${i.children.map((child) => renderOption(child, true)).join('')}</div>
      </section>`
    : renderOption(i)).join('') + (tab.id === 'elo' ? scopeBlock() : '');
  const master = $('panel').querySelector('[data-key="hideElo"]');
  if (master) master.indeterminate = ELO_KEYS.some((key) => state[key]) && !state.hideElo;
}

function themeBlock() {
  const color = isHexColor(state.accentColor) ? state.accentColor : defaults.accentColor;
  return `
    <section class="theme-card">
      <div class="theme-title">Цвет расширения</div>
      <div class="theme-desc">Выбери цвет акцентов и кнопок</div>
      <div class="theme-swatches">
        ${THEME_COLORS.map(({ name, value }) => `
          <button type="button" class="theme-swatch ${color.toLowerCase() === value ? 'active' : ''}"
            data-accent-color="${value}" style="--swatch-color:${value}"
            aria-label="${name}" title="${name}"></button>`).join('')}
      </div>
      <label class="custom-color" for="accent-color-picker">
        <span>Свой цвет</span>
        <input id="accent-color-picker" type="color" value="${color}" aria-label="Выбрать свой цвет">
      </label>
      ${state.themeError ? `<div class="theme-error" role="alert">${escapeHtml(state.themeError)}</div>` : ''}
    </section>`;
}

function settingsBlock() {
  return `${themeBlock()}
    <section class="settings-section">
      <div class="settings-heading">Анти-тильт</div>
      ${renderOption({ key: 'hideTilt', icon: 'target', title: 'Скрывать винрейт и серии', sub: 'Дополняет основную маску ELO процентом побед и сериями' })}
    </section>
    <section class="settings-section">
      <div class="settings-heading">Маска по контексту</div>
      <div class="theme-desc">«Только уровень» скрывает ELO и статистику, оставляя значок уровня. Режим страницы заменяет обычные переключатели.</div>
      ${CONTEXTS.map(({ key, label }) => `
        <label class="context-setting">
          <span>${label}</span>
          <select data-context-setting="${key}">
            ${CONTEXT_MODES.map(({ value, label: modeLabel }) => `
              <option value="${value}" ${state[key] === value ? 'selected' : ''}>${modeLabel}</option>`).join('')}
          </select>
        </label>`).join('')}
    </section>
    <section class="reveal-card">
      <div class="settings-heading">Не проверяй</div>
      <div class="theme-desc">Покажет все скрытые данные на 30 секунд. Доступно два раза за сессию браузера.</div>
      <button class="reveal-button" type="button" data-reveal>Показать всё на 30 секунд</button>
      <div class="reveal-status" id="reveal-status" role="status"></div>
      ${state.revealError ? `<div class="theme-error" role="alert">${escapeHtml(state.revealError)}</div>` : ''}
    </section>`;
}

function updateRevealStatus() {
  const status = $('reveal-status');
  const button = $('panel').querySelector('[data-reveal]');
  if (!status || !button) return;
  const remaining = Math.max(0, MAX_REVEALS - (Number(state.revealCount) || 0));
  const seconds = Math.max(0, Math.ceil((Number(state.revealUntil) - Date.now()) / 1000));
  button.disabled = seconds > 0 || remaining === 0 || !state.enabled;
  button.textContent = seconds > 0 ? `Всё показано · ${seconds} сек.` : 'Показать всё на 30 секунд';
  status.textContent = !state.enabled
    ? 'Сначала включи расширение.'
    : seconds > 0
      ? `После показа останется ${remaining} ${remaining === 1 ? 'попытка' : 'попытки'}.`
      : remaining > 0
        ? `Осталось показов: ${remaining} из ${MAX_REVEALS}.`
        : 'Лимит показов на эту сессию исчерпан.';
}

function revealAllTemporarily() {
  chrome.storage.local.get(['revealCount', 'revealUntil'], (stored) => {
    if (chrome.runtime.lastError) {
      state.revealError = `Не удалось проверить лимит: ${chrome.runtime.lastError.message}`;
      render();
      return;
    }
    const count = Number(stored.revealCount) || 0;
    const until = Number(stored.revealUntil) || 0;
    if (until > Date.now()) {
      state.revealUntil = until;
      updateRevealStatus();
      return;
    }
    if (count >= MAX_REVEALS) {
      state.revealCount = count;
      state.revealError = 'Лимит показов на эту сессию исчерпан.';
      render();
      return;
    }
    state.revealError = '';
    chrome.storage.local.set({
      revealCount: count + 1,
      revealUntil: Date.now() + REVEAL_DURATION_MS,
    }, () => {
      if (chrome.runtime.lastError) {
        state.revealError = `Не удалось показать данные: ${chrome.runtime.lastError.message}`;
        render();
        return;
      }
      state.revealCount = count + 1;
      state.revealUntil = Date.now() + REVEAL_DURATION_MS;
      render();
    });
  });
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
}

function applyAccentColor(value) {
  if (!isHexColor(value)) return;
  const red = parseInt(value.slice(1, 3), 16);
  const green = parseInt(value.slice(3, 5), 16);
  const blue = parseInt(value.slice(5, 7), 16);
  document.documentElement.style.setProperty('--accent', value);
  document.documentElement.style.setProperty('--accent-rgb', `${red}, ${green}, ${blue}`);
  document.documentElement.style.setProperty('--accent-soft', `rgba(${red}, ${green}, ${blue}, 0.14)`);
}

function setAccentColor(value) {
  if (!isHexColor(value)) return;
  state.accentColor = value.toLowerCase();
  state.themeError = '';
  applyAccentColor(state.accentColor);
  render();
  chrome.storage.local.set({ accentColor: state.accentColor }, () => {
    if (!chrome.runtime.lastError) return;
    state.themeError = `Не удалось сохранить цвет: ${chrome.runtime.lastError.message}`;
    render();
  });
}

// Чей ELO скрывать: весь или только свой (ELO противников и тиммейтов видно)
function scopeBlock() {
  const mine = state.eloScope === 'mine';
  return `
    <div class="scope ${ELO_KEYS.some((key) => state[key]) ? '' : 'off'}">
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
      <button class="account-reset" type="button" data-reset-account>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8"/><path d="M3 3v5h5"/></svg>
        Сбросить аккаунт FACEIT
      </button>
      ${state.accountResetError ? `<div class="account-reset-error" role="alert">${escapeHtml(state.accountResetError)}</div>` : ''}
      <div class="hint">Если отображается старый ник, сбрось его и открой профиль нового аккаунта на FACEIT.</div>
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
  if (Object.prototype.hasOwnProperty.call(changes, 'hideElo')) {
    const hide = changes.hideElo;
    changes = { ...changes };
    delete changes.hideElo;
    ELO_KEYS.forEach((key) => { changes[key] = hide; });
  }
  Object.assign(state, changes);
  state.hideElo = ELO_KEYS.every((key) => state[key]);
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
  const contextKey = e.target.dataset.contextSetting;
  if (contextKey && CONTEXTS.some((context) => context.key === contextKey) &&
      CONTEXT_MODES.some((mode) => mode.value === e.target.value)) {
    save({ [contextKey]: e.target.value });
  }
  if (e.target.id === 'accent-color-picker') setAccentColor(e.target.value);
});
$('panel').addEventListener('click', (e) => {
  if (e.target.closest('[data-reveal]')) revealAllTemporarily();
  const b = e.target.closest('[data-scope]');
  if (b) save({ eloScope: b.dataset.scope });
  const colorButton = e.target.closest('[data-accent-color]');
  if (colorButton) setAccentColor(colorButton.dataset.accentColor);
  if (e.target.closest('[data-reset-account]')) {
    chrome.storage.local.remove('autoNickname', () => {
      if (chrome.runtime.lastError) {
        state.accountResetError = `Не удалось сбросить аккаунт: ${chrome.runtime.lastError.message}`;
      } else {
        state.autoNickname = '';
        state.accountResetError = '';
      }
      render();
    });
  }
});
$('presets').addEventListener('click', (e) => {
  const b = e.target.closest('[data-preset]');
  if (b) save({ enabled: true, ...PRESETS[b.dataset.preset] });
});
$('panel').addEventListener('input', (e) => {
  if (e.target.id === 'accent-color-picker') applyAccentColor(e.target.value);
});

chrome.storage.local.get(null, (stored) => {
  const legacyHideElo = typeof stored.hideElo === 'boolean' ? stored.hideElo : true;
  const migrated = {};
  ELO_KEYS.forEach((key) => {
    if (typeof stored[key] !== 'boolean') migrated[key] = legacyHideElo;
  });
  state = { ...defaults, ...stored, ...migrated };
  if (!isHexColor(state.accentColor)) state.accentColor = defaults.accentColor;
  for (const { key } of CONTEXTS) {
    if (state[key] === 'antiTilt') state[key] = 'levelOnly';
    if (!CONTEXT_MODES.some((mode) => mode.value === state[key])) state[key] = 'default';
  }
  state.hideElo = ELO_KEYS.every((key) => state[key]);
  applyAccentColor(state.accentColor);
  if (Object.keys(migrated).length) chrome.storage.local.set(migrated);
  render();
});
// Ник, введённый раньше вручную, больше не нужен — работает автоопределение
chrome.storage.local.remove('nickname');
// Аккаунт мог определиться, пока попап открыт
chrome.storage.onChanged.addListener((ch) => {
  if (ch.autoNickname) state.autoNickname = ch.autoNickname.newValue || '';
  if (ch.revealCount) state.revealCount = Number(ch.revealCount.newValue) || 0;
  if (ch.revealUntil) state.revealUntil = Number(ch.revealUntil.newValue) || 0;
  if (ch.accentColor) {
    state.accentColor = isHexColor(ch.accentColor.newValue) ? ch.accentColor.newValue : defaults.accentColor;
    applyAccentColor(state.accentColor);
  }
  if (ch.autoNickname || ch.revealCount || ch.revealUntil || ch.accentColor) render();
});
setInterval(updateRevealStatus, 1000);
