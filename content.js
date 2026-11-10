// Ищет на странице всё, что связано с ELO, и помечает атрибутами data-elo-*; скрывает hide.css.
// FACEIT использует обфусцированные классы и часто не пишет слово "ELO" рядом с числом,
// поэтому ищем по тексту и по характерной структуре (уровень + число, полоска до след. уровня).
//
// Производительность: текст предков читается только ограниченно (shortText обрывает обход,
// как только превышен лимит), нерелевантные узлы отсеиваются одним регэкспом, тяжёлый поиск
// полосок с замером раскладки откладывается до кадра и делается один раз на блок,
// а полный пересканирующий проход страницы не делается ни на новые значения ELO, ни на настройки.
(() => {
  const ATTR = 'data-elo-hidden';
  const LADDER_ATTR = 'data-elo-ladder';
  const DELTA_ATTR = 'data-elo-delta';    // "+25" / "−25"
  const SEASON_ATTR = 'data-elo-season';  // ELO в карточках сезонов
  const BADGE_ATTR = 'data-elo-badge';    // бейдж "значок уровня + ELO"
  const KEEP_ATTR = 'data-elo-keep';      // никогда не скрывать (фраза "до след. уровня")
  const QQ_ATTR = 'data-elo-qq';          // число заменяется на "??"
  const BAR_ATTR = 'data-elo-bar';        // полоска уровня, перекрашивается в серый
  const LEVEL_ATTR = 'data-elo-level';    // значок уровня, найденный по структуре (комната матча)

  // Карточки сезонов в профиле: "SEASON 8 · 1 504 · Максимум в сезоне 1 586"
  // Только "Максимум в сезоне": по "Season 9" ловилась и "Статистика Season 9" с числом матчей
  const SEASON_RE = /максимум\s+в\s+сезоне|season\s+(high|max|peak)|highest\s+elo/i;
  // Подписи рядом с числом, которые точно значат "не ELO": матчи, победы, поражения, проценты, убийства
  const NOT_ELO_RE = /матч|match|побед|поражен|\bwins?\b|\bloss|%|убийств|kills|k\/d|\bhs\b|сезонов|seasons/i;
  const NEXT_RE = /нужно\s+для\s+перехода|needed\s+(to|for)\s+(reach|the\s+next)|to\s+reach\s+the\s+next\s+level/i;
  const LABEL_RE = /^\s*elo\s*:?\s*$/i;                                      // отдельная подпись "ELO"
  const INLINE_RE = /\d[\d\s.,]{0,6}\s*elo\b|\belo\s*[:\-–]?\s*[+\-−]?\d/i;  // "2150 ELO", "ELO 2150"
  const DELTA_RE = /^\s*[+\-−–]\s?\d{1,3}\s*$/;                              // "+25" / "-25"
  const ELO_NUM_RE = /^\s*(\d{1,2}[\s.,]\d{3}|\d{3,4})\s*$/;                 // "1 674", "1,674", "1674"
  const NUM_ONLY_RE = /^[\d\s.,]+$/;
  const PROGRESS_RE = /(до|to|until)\s+(\d+\s*)?(уровня|level)|level\s*up/i;  // "+77 до уровня 9"
  const CONTEXT_RE = /\belo\b|до\s+уровня|to\s+level|победа|поражение|\bwin\b|\bloss\b/i;
  const LADDER_RE = /ladder|ладдер/i;                                        // "Monthly Ladder"
  const FLEX_RE = /гибк|flexible|ограничени|restrict|range|диапазон/i;       // "Гибкий ELO" в карточках режимов
  // Быстрый отсев: узлы без цифр и без этих слов нам не интересны (это большинство текста страницы)
  const RELEVANT_RE = /\d|elo|ladder|ладдер|нужно|needed|reach/i;
  // Значок уровня: svg (лобби) или <i role="img"> (комната матча)
  const LEVEL_ICON = 'svg, img, canvas, i, [role="img"], [class*="SkillIcon"], [style*="background-image"]';
  const SKIP = 'script, style, textarea, input, [contenteditable="true"]';

  const root = document.documentElement;

  // ── Утилиты ──

  // Текст элемента, но не длиннее limit: обход обрывается, как только лимит превышен (→ null).
  // Обычный textContent у большого блока строит огромную строку — это и тормозило.
  const shortText = (el, limit, sep = '') => {
    let s = '';
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      // CSS внутри <style> (он есть в svg значка уровня) — не текст страницы.
      // Из-за него блок игрока со значком казался "слишком длинным" и значок не считался твоим
      const pn = n.parentNode.nodeName;
      if (pn === 'STYLE' || pn === 'style' || pn === 'SCRIPT') continue;
      s += n.nodeValue + sep;
      if (s.length > limit) return null;
    }
    return s;
  };

  const mark = (el, attr = ATTR) => {
    if (!el || el.nodeType !== 1 || el === document.body || el === root) return;
    if (attr !== KEEP_ATTR && attr !== QQ_ATTR && el.closest(`[${KEEP_ATTR}]`)) return;
    if (!el.hasAttribute(attr)) el.setAttribute(attr, '');
    if (OWNABLE.includes(attr)) tagMine(el);
  };

  // ── Режим "скрывать только свой ELO" ──
  // Элемент считается своим, если его число — одно из известных своих значений ELO,
  // или он в строке/карточке игрока с твоим ником. Поднимаемся от элемента вверх, пока в блоке
  // одно число ELO: как только чисел больше одного — это уже блок нескольких игроков, дальше не идём.
  const MINE_ATTR = 'data-elo-mine';
  let ownNick = ''; // свой ник: указанный вручную или определённый автоматически
  const OWNABLE = [ATTR, DELTA_ATTR, SEASON_ATTR, BADGE_ATTR, LEVEL_ATTR];
  const ELO_CLASS_SEL = '[class*="__Elo"], [class*="EloPoints"], [class*="EloBadge"], [class*="EloDelta"], [class*="EloChange"]';
  // Значок уровня (кружок с цифрой) — в режиме "только свой" тоже скрывается только свой
  const LEVEL_SEL = `[class*="SkillIcon"], svg:has(> title):has(circle.background):has(path.bar-bg), [${LEVEL_ATTR}]`;
  // Элементы, которые CSS скрывает сам (по классу/структуре) — их тоже делим на свои/чужие
  const CSS_HIDDEN_SEL = ELO_CLASS_SEL + ', ' + LEVEL_SEL;
  const OWNABLE_SEL = OWNABLE.map((a) => `[${a}]`).join(', ') + ', ' + CSS_HIDDEN_SEL;
  const ELO_IN_TEXT_RE = /\d{1,2}[\s.,]\d{3}|\b\d{3,4}\b/g;
  const countElo = (t) => (t.match(ELO_IN_TEXT_RE) || [])
    .filter((s) => { const n = parseInt(s.replace(/\D/g, ''), 10); return n >= 100 && n <= 6000; }).length;

  // Блок одного игрока вокруг элемента: поднимаемся, пока в блоке не больше одного числа ELO
  const playerBlock = (el) => {
    let block = el;
    for (let cur = el.parentElement, i = 0; cur && cur !== document.body && i < 5; cur = cur.parentElement, i++) {
      const t = shortText(cur, 250, ' ');
      if (t === null || countElo(t) > 1) break;
      block = cur;
    }
    return block;
  };

  const isMine = (el) => {
    const v = parseElo(shortText(el, 16) || '');
    if (v && knownElo.has(v)) return true;
    // Рядом (в блоке того же игрока) уже есть твой ELO — значит и значок уровня твой
    if (!v && playerBlock(el).querySelector(`[${MINE_ATTR}]`)) return true;
    const nick = ownNick;
    if (!nick) return false;
    let cur = el;
    for (let i = 0; i < 8 && cur && cur !== document.body; i++, cur = cur.parentElement) {
      // Через пробел: иначе "adildo16" + "1,674" склеиваются и число не распознаётся
      const t = shortText(cur, 250, ' ');
      if (t === null) return false;
      // Сначала проверяем, не вышли ли в блок нескольких игроков, — и только потом ищем ник
      if (countElo(t) > 1) return false;
      if (t.toLowerCase().split(/\s+/).includes(nick)) {
        if (v) remember([v]); // запомнили свой ELO — пригодится на страницах без ника
        return true;
      }
    }
    return false;
  };

  function tagMine(el) {
    if (current.eloScope !== 'mine' || el.hasAttribute(MINE_ATTR)) return;
    if (!isMine(el)) return;
    el.setAttribute(MINE_ATTR, '');
    // Значок уровня мог обработаться раньше числа — помечаем значки в блоке этого игрока.
    // И все вложенные части значка (обёртка + svg): иначе CSS "показать чужой" сработал бы
    // на внутреннем svg, и он стал бы виден внутри скрытой обёртки
    const block = playerBlock(el);
    block.querySelectorAll(CSS_HIDDEN_SEL).forEach((e) => e.setAttribute(MINE_ATTR, ''));
    el.querySelectorAll(CSS_HIDDEN_SEL).forEach((e) => e.setAttribute(MINE_ATTR, ''));
  }

  // Пересчитать "свои" элементы (сменился ник или режим)
  const retagMine = () => {
    root.querySelectorAll(`[${MINE_ATTR}]`).forEach((e) => e.removeAttribute(MINE_ATTR));
    root.querySelectorAll(OWNABLE_SEL).forEach(tagMine);
  };

  // Свой профиль (/players/<ник>/...) — в режиме "только свой" там скрывается всё
  let lastPath = '';
  const updateOwnPage = () => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    const nick = ownNick;
    const own = !!nick && decodeURIComponent(location.pathname).toLowerCase().split('/').includes(nick) &&
      /\/players\//i.test(location.pathname);
    root.toggleAttribute('data-elo-own-page', own);
  };

  // ── Автоопределение своего ника (вводить вручную не нужно) ──
  // 1) Надёжно: на странице /players/<ник> есть кнопка "Ред. профиль" — она есть только на своём профиле.
  //    Срабатывает и при смене аккаунта.
  // 2) Догадка, пока ник неизвестен: ссылка на профиль с аватаркой в правом верхнем углу (шапка сайта).
  const PLAYER_PATH_RE = /\/players\/([^/?#]+)/i;
  const EDIT_PROFILE_RE = /^\s*(ред(\.|актировать)?\s*профиль|edit\s+profile)\s*$/i;
  let detectTimer = 0;

  const setAutoNick = (nick) => {
    if (!nick || nick === current.autoNickname) return;
    chrome.storage.local.set({ autoNickname: nick }); // вернётся через onChanged → apply
  };

  const detectNick = () => {
    const m = location.pathname.match(PLAYER_PATH_RE);
    if (m) {
      const nick = decodeURIComponent(m[1]).toLowerCase();
      for (const b of document.querySelectorAll('a, button')) {
        const t = shortText(b, 40);
        if (t && EDIT_PROFILE_RE.test(t)) return setAutoNick(nick);
      }
    }
    if (current.autoNickname) return;
    for (const a of document.querySelectorAll('a[href*="/players/"]')) {
      if (!a.querySelector('img')) continue;
      const r = a.getBoundingClientRect();
      if (r.width && r.top < 100 && r.right > innerWidth - 320) {
        const hm = a.getAttribute('href').match(PLAYER_PATH_RE);
        if (hm) return setAutoNick(decodeURIComponent(hm[1]).toLowerCase());
      }
    }
  };
  // Не чаще раза в полсекунды и после того, как страница успокоилась
  const scheduleDetect = () => {
    clearTimeout(detectTimer);
    detectTimer = setTimeout(detectNick, 500);
  };

  const parseElo = (text) => {
    if (!ELO_NUM_RE.test(text)) return null;
    const n = parseInt(text.replace(/\D/g, ''), 10);
    return n >= 100 && n <= 6000 ? n : null;
  };

  // Поднимаемся до самого большого предка, текст которого не длиннее limit символов.
  const climb = (el, limit, maxLevels = 6) => {
    let cur = el;
    for (let i = 0; i < maxLevels; i++) {
      const p = cur.parentElement;
      if (!p || p === document.body) break;
      const t = shortText(p, limit + 100);
      if (t === null || t.trim().length > limit) break;
      cur = p;
    }
    return cur;
  };

  // Есть ли рядом (в нескольких уровнях вверх) совпадение с re в коротком тексте.
  const nearContext = (el, levels = 4, limit = 300, re = CONTEXT_RE) => {
    let cur = el;
    for (let i = 0; i < levels && cur && cur !== document.body; i++) {
      const t = shortText(cur, limit);
      if (t === null) return false; // выше будет только длиннее
      if (re.test(t)) return true;
      cur = cur.parentElement;
    }
    return false;
  };

  // FACEIT может рисовать число по цифрам в отдельных span ("1" "," "6" "7" "4").
  // Поднимаемся до элемента, весь текст которого — одно число.
  const numberRoot = (el) => {
    let cur = el;
    for (;;) {
      const p = cur.parentElement;
      if (!p || p === document.body || p.querySelector(LEVEL_ICON)) break; // дальше — иконка уровня
      const t = shortText(p, 16);
      if (t === null) break;
      const c = t.replace(/\s/g, '');
      if (!/^[\d.,]+$/.test(c) || parseInt(c.replace(/\D/g, ''), 10) > 6000) break;
      cur = p;
    }
    return cur;
  };

  // Видимый текст без содержимого svg (в значке уровня есть <title>"Уровень скилла 8"</title>), до 9 символов
  const visibleText = (el) => {
    let s = '';
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.parentElement.closest('svg, style, script, [role="img"]')) continue;
      s += n.nodeValue.replace(/\s/g, '');
      if (s.length > 9) return null;
    }
    return s;
  };

  // Бейдж "иконка уровня + ELO": весь видимый текст — число, возможно с цифрой уровня ("8" + "1,674")
  const isLevelBadge = (el) => {
    let cur = el.parentElement;
    for (let i = 0; i < 3 && cur && cur !== document.body; i++) {
      const t = visibleText(cur);
      if (t === null) return null;
      if (/^((10|[1-9])?)\d{1,2}[.,]?\d{3}$|^((10|[1-9])?)\d{3,4}$/.test(t) &&
          cur.querySelector(LEVEL_ICON)) return cur;
      cur = cur.parentElement;
    }
    return null;
  };

  // ── Известные значения ELO (сохраняются между страницами, чтобы скрывать сразу) ──

  const knownElo = new Set();
  // Числа, похожие на ELO, которые пока не скрыты: если позже узнаем, что это ELO, — скроем точечно,
  // без пересканирования всей страницы
  const candidates = new Map(); // элемент → значение

  const remember = (values, save = true) => {
    const fresh = values.filter((v) => !knownElo.has(v));
    if (!fresh.length) return;
    fresh.forEach((v) => knownElo.add(v));
    if (save) chrome.storage.local.set({ knownElo: [...knownElo].slice(-10) });
    candidates.forEach((v, el) => {
      if (!el.isConnected) candidates.delete(el);
      else if (knownElo.has(v)) { mark(el); candidates.delete(el); }
    });
    // Новые свои значения — пометить уже скрытые элементы с ними как "свои"
    if (current.eloScope === 'mine') root.querySelectorAll(OWNABLE_SEL).forEach(tagMine);
  };

  chrome.storage.local.get({ knownElo: [] }, (s) => remember(s.knownElo, false));

  const addCandidate = (el, value) => {
    candidates.set(el, value);
    if (candidates.size > 300) candidates.forEach((_, e) => { if (!e.isConnected) candidates.delete(e); });
  };

  const learn = (box) => {
    const values = [];
    const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.parentElement || !NUM_ONLY_RE.test(n.nodeValue)) continue;
      const v = parseElo(numberRoot(n.parentElement).textContent || '');
      if (v) values.push(v);
    }
    remember(values);
  };

  // ── Ладдер ──

  // Скрываем саму вкладку/кнопку с надписью "Monthly Ladder" (небольшой блок вокруг текста).
  const processLadder = (el) => {
    let tab = el.closest('a, button, [role="tab"], li');
    if (!tab) {
      // Поднимаемся только через обёртки, у которых тот же самый текст
      const label = (el.textContent || '').trim();
      tab = el;
      while (tab.parentElement && tab.parentElement !== document.body &&
             shortText(tab.parentElement, label.length + 20)?.trim() === label) tab = tab.parentElement;
    }
    mark(tab, LADDER_ATTR);
  };

  // ── "76 Elo нужно для перехода на следующий уровень" ──

  // Текстовые узлы вида "76 Elo ...": узел → исходный текст (чтобы вернуть число при выключении)
  const replaced = new Map();
  const QQ_TEXT = (v) => v.replace(/\d[\d\s.,]*/, '?? ');
  const barsDone = new WeakSet();

  // Текст — это только фраза "[число] [Elo] нужно для перехода на следующий уровень" и ничего больше
  const SENTENCE_RE = /нужно\s+для\s+перехода\s+на\s+следующий\s+уровень|needed\s+(to|for)\s+(reach\s+)?the\s+next\s+level|to\s+reach\s+the\s+next\s+level/gi;
  const isOnlySentence = (t) => t.replace(SENTENCE_RE, '').replace(/elo|[\d\s.,?:+\-−–]/gi, '') === '';

  const processNextLevel = (el) => {
    // Сама фраза всегда видна — снимаем с неё пометки скрытия (подменяется только число)
    if (!el.hasAttribute(KEEP_ATTR)) {
      mark(el, KEEP_ATTR);
      [el, ...el.querySelectorAll(`[${ATTR}], [${DELTA_ATTR}], [${SEASON_ATTR}]`)].forEach((e) => {
        e.removeAttribute(ATTR); e.removeAttribute(DELTA_ATTR); e.removeAttribute(SEASON_ATTR);
      });
    }
    const box = climb(el, 120, 3);
    // "??" — только внутри самой фразы (раньше задевало соседние "Матчи", победы/поражения)
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const v = n.nodeValue;
      if (/^\s*\d[\d\s.,]*\s*$/.test(v)) {
        mark(n.parentElement, QQ_ATTR);                 // число в отдельном элементе — CSS покажет "??"
      } else if (/^\s*\d[\d\s.,]*\s*elo/i.test(v)) {   // число и "Elo" в одном узле — меняем текст
        replaced.set(n, v);
        if (nextHidden()) n.nodeValue = QQ_TEXT(v);
      }
    }
    // Полоски уровней ищем в следующем кадре и один раз на блок: замер раскладки во время
    // обработки изменений DOM заставлял браузер пересчитывать страницу на каждом изменении
    if (!barsDone.has(box)) {
      barsDone.add(box);
      requestAnimationFrame(() => findBars(box));
    }
  };

  // Ищем вверх блок с полосками: маленькие элементы без текста с цветным фоном
  const findBars = (box) => {
    if (!box.isConnected) return;
    for (let cur = box, i = 0; i < 5 && cur && cur !== document.body; cur = cur.parentElement, i++) {
      const all = cur.getElementsByTagName('*');
      if (all.length > 400) return; // слишком большой блок — это уже не карточка
      const bars = [];
      for (const e of all) {
        if (e.firstChild?.nodeType === 3 || e.closest('svg') || e.textContent.trim()) continue;
        const r = e.getBoundingClientRect();
        if (!r.height || r.height > 12 || r.width < 8) continue;
        const cs = getComputedStyle(e);
        if (cs.backgroundImage !== 'none' || !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) bars.push(e);
      }
      if (bars.length >= 5) {
        bars.forEach((b) => mark(b, BAR_ATTR));
        return;
      }
    }
  };

  // ── "+25" / "−25" рядом с числом ELO ("1 674 +25" в истории матчей) ──

  const nearEloNumber = (el) => {
    let cur = el.parentElement;
    for (let i = 0; i < 3 && cur && cur !== document.body; i++) {
      const t = shortText(cur, 40);
      if (t === null) return false;
      const nums = t.match(/\d{1,2}[\s.,]\d{3}|\d{3,4}/g) || [];
      if (nums.some((s) => {
        const n = parseInt(s.replace(/\D/g, ''), 10);
        return n >= 100 && n <= 6000;
      })) {
        // Само число ELO в этой ячейке — под настройку "ELO"
        const w = document.createTreeWalker(cur, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (!NUM_ONLY_RE.test(n.nodeValue)) continue;
          const r = numberRoot(n.parentElement);
          if (parseElo(r.textContent || '')) mark(r);
        }
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  };

  // ── Обработка одного текстового узла ──

  // ── Значок уровня по структуре ──
  // 1) <svg><title>Уровень скилла 8</title>…</svg> — берём svg (и обёртку <i role="img">, если есть).
  // 2) Цифра 1–10 внутри маленького квадратного элемента вместе с svg/картинкой (кольцо с цифрой).
  const SKILL_TITLE_RE = /^\s*(уровень\s+скилла|skill\s+level|level)\s*(10|[1-9])\s*$/i;
  const LEVEL_DIGIT_RE = /^\s*(10|[1-9])\s*$/;
  const ICON_INNER = 'svg, img, canvas, [role="img"], [style*="background-image"]';

  const iconWrapper = (svg) => {
    const p = svg.parentElement;
    // Обёртка без своего текста (<i role="img">, <span>) — скрываем её целиком
    if (!p || p === document.body || p.children.length > 3) return svg;
    if (p.matches('i, [role="img"]')) return p;
    const t = shortText(p, 3);
    return t !== null && !t.replace(/\s|10|[1-9]/g, '') ? p : svg;
  };

  const isSmallSquare = (e) => {
    const r = e.getBoundingClientRect();
    return r.width >= 12 && r.width <= 64 && r.height >= 12 && r.height <= 64 && Math.abs(r.width - r.height) <= 8;
  };

  const findLevelIcon = (node, el, text) => {
    if (el.tagName.toLowerCase() === 'title' && SKILL_TITLE_RE.test(text)) {
      const svg = el.closest('svg');
      return svg ? iconWrapper(svg) : null;
    }
    if (!LEVEL_DIGIT_RE.test(text)) return null;
    // Цифра нарисована внутри svg (<text>8</text>)
    const inSvg = el.closest('svg');
    if (inSvg) return inSvg.querySelector('title') || isSmallSquare(inSvg) ? iconWrapper(inSvg) : null;
    // Цифра рядом с кольцом: поднимаемся, пока весь текст — только эта цифра
    let cur = el;
    for (let i = 0; i < 3 && cur && cur !== document.body; i++, cur = cur.parentElement) {
      const t = shortText(cur, 3);
      if (t === null || !LEVEL_DIGIT_RE.test(t)) return null;
      if ((cur.matches('[role="img"]') || cur.querySelector(ICON_INNER)) && isSmallSquare(cur)) return cur;
    }
    return null;
  };

  // Узлы, которые уже окончательно обработаны с этим текстом (повторно не трогаем)
  const done = new WeakMap();

  const processText = (node) => {
    const text = node.nodeValue;
    if (!text || done.get(node) === text || !RELEVANT_RE.test(text)) return;
    const el = node.parentElement;
    if (!el || el.closest(SKIP)) return;

    // Значок уровня, которого нет под классами SkillIcon (например, в комнате матча)
    const icon = findLevelIcon(node, el, text);
    if (icon) {
      mark(icon, LEVEL_ATTR);
      return done.set(node, text);
    }

    // Цифры без букв, но и не число/дельта ("16 / 14 / 7", "5:13") — точно не ELO
    if (!/[a-zа-яё]/i.test(text) && !NUM_ONLY_RE.test(text) && !/^\s*[+\-−–]\s?[\d\s.,]+$/.test(text)) {
      return done.set(node, text);
    }

    // Свой же "??" — уже обработан
    if (replaced.has(node) && text === QQ_TEXT(replaced.get(node))) return;

    if (LADDER_RE.test(text)) processLadder(el);
    if (el.closest(`[${LADDER_ATTR}]`)) return done.set(node, text);

    // Фраза "до след. уровня": "77", "Elo" и остальной текст могут быть в разных span
    // Лимит 80 символов: только сама фраза (~50 символов + число). Иначе пока страница грузится
    // и в карточке мало текста, за "фразу" принималась вся карточка со статистикой и графиком —
    // она помечалась "не скрывать", и ELO в подсказке графика оставался виден
    for (let cur = el, i = 0; cur && cur !== document.body && i < 3; cur = cur.parentElement, i++) {
      const t = shortText(cur, 80);
      if (t === null) break;
      if (NEXT_RE.test(t)) {
        if (!isOnlySentence(t)) break; // в блоке есть посторонний текст — это не фраза, а карточка
        // Расширяемся вверх, пока родитель добавляет только число / "Elo" (они могут быть в соседних span)
        let s = cur;
        for (let j = 0; j < 3 && s.parentElement && s.parentElement !== document.body; j++) {
          const pt = shortText(s.parentElement, 80);
          if (pt === null || !isOnlySentence(pt)) break;
          s = s.parentElement;
        }
        processNextLevel(s);
        return done.set(node, node.nodeValue);
      }
    }

    // Описания настроек матча ("Гибкий ELO" и т.п.) — не значение, не скрываем
    if (FLEX_RE.test(text) || FLEX_RE.test(climb(el, 40, 3).textContent || '')) return;

    if (LABEL_RE.test(text)) {
      mark(climb(el, 40, 3));
      return done.set(node, text);
    }
    if (INLINE_RE.test(text)) {
      mark(el);
      return done.set(node, text);
    }
    // Блок прогресса "1 531 ——— +77 до уровня 9 ——— 1 750" вместе с текущим ELO над ним
    if (PROGRESS_RE.test(shortText(el, 200) || '')) {
      const box = climb(el, 120);
      learn(box);
      mark(box);
      return done.set(node, text);
    }

    if (NUM_ONLY_RE.test(text)) {
      const numEl = numberRoot(el);
      const value = parseElo(numEl.textContent || '');
      if (value !== null) {
        // Бейдж "значок уровня + ELO": прячем целиком, чтобы не оставалась пустая плашка
        const badge = isLevelBadge(numEl);
        if (badge) {
          mark(badge, BADGE_ATTR);
          mark(numEl);
          return done.set(node, text);
        }
        // "512 Матчи", "Победы 130", "51 %" — не ELO (если рядом нет самого слова ELO)
        const near = shortText(numEl.parentElement, 40);
        if (near !== null && NOT_ELO_RE.test(near) && !/\belo\b/i.test(near)) return done.set(node, text);
        const isSeason = nearContext(numEl, 5, 160, SEASON_RE);
        if (isSeason) mark(numEl, SEASON_ATTR);
        // Текущий ELO скрывается, даже если это карточка сезона
        if (knownElo.has(value) || (!isSeason && nearContext(numEl, 2, 80))) {
          mark(numEl);
          candidates.delete(numEl);
          return done.set(node, text);
        }
        addCandidate(numEl, value); // контекст может появиться позже — не помечаем done
        return;
      }
    }

    // "+25" / "−25" (знак и число могут быть в разных span)
    const deltaEl = DELTA_RE.test(text) ? el
      : (/^\s*\d{1,3}\s*$/.test(text) && DELTA_RE.test(shortText(el.parentElement, 12) || '')) ? el.parentElement
      : null;
    if (deltaEl && (nearContext(deltaEl) || nearEloNumber(deltaEl))) {
      mark(deltaEl, DELTA_ATTR);
      done.set(node, text);
    }
  };

  const scan = (node) => {
    if (node.nodeType === 3) return processText(node);
    if (node.nodeType !== 1 || node.closest?.(SKIP)) return;
    const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) processText(n);
    // Элементы, которые CSS скрывает по имени класса (styles__Elo...), тоже делим на свои/чужие
    if (current.eloScope === 'mine') {
      if (node.matches(CSS_HIDDEN_SEL)) tagMine(node);
      node.querySelectorAll(CSS_HIDDEN_SEL).forEach(tagMine);
    }
    // Подсказки (title) тоже могут содержать ELO
    const titled = node.hasAttribute?.('title') ? [node, ...node.querySelectorAll('[title]')] : node.querySelectorAll('[title]');
    titled.forEach((e) => {
      if (/\belo\b/i.test(e.getAttribute('title'))) e.setAttribute('title', '');
    });
  };

  // ── Наблюдение за DOM (FACEIT — SPA, контент постоянно подгружается) ──

  // Пакетная обработка: в микрозадаче, т.е. до отрисовки кадра — без мелькания
  let pending = new Set();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    updateOwnPage(); // SPA: переход между страницами виден по изменениям DOM
    scheduleDetect();
    const nodes = pending;
    pending = new Set();
    for (const n of nodes) {
      if (!n.isConnected) continue;
      // Узел внутри другого узла из этой же пачки будет обработан вместе с ним
      let p = n.parentNode, covered = false;
      for (let i = 0; p && i < 12; p = p.parentNode, i++) if (nodes.has(p)) { covered = true; break; }
      if (!covered) scan(n);
    }
  };
  function queue(n) {
    if (!n) return;
    pending.add(n);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  }

  // Небольшой родительский блок перепроверяем целиком: число могло появиться раньше подписи
  // ("Максимум в сезоне", "ELO") и не быть скрыто с первого раза
  const smallParent = (el) => (el && el.nodeType === 1 && el !== document.body && el !== root &&
    shortText(el, 300) !== null ? el : null);

  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'characterData') {
        if (!RELEVANT_RE.test(m.target.nodeValue || '')) continue;
        queue(m.target);
        queue(smallParent(m.target.parentElement?.parentElement));
      } else if (m.addedNodes.length) {
        const p = smallParent(m.target);
        if (p) queue(p);
        else m.addedNodes.forEach(queue);
      }
    }
  }).observe(root, { childList: true, subtree: true, characterData: true });

  queue(root);

  // ── Настройки из попапа ──
  // true = скрывать. Для выключенного пункта на <html> ставится data-show-<имя>,
  // а hide.css скрывает элементы только когда такого атрибута нет.
  const SETTINGS = {
    enabled: true,      // главный выключатель
    hideElo: true,      // ELO целиком: текущий, +/−, сезоны, "до след. уровня", полоска уровней
    hideLevel: true,    // значок уровня
    hideLadder: true,   // Monthly Ladder
    hideMission: true,  // Monthly Mission
    eloScope: 'all',    // 'all' — скрывать весь ELO, 'mine' — только свой (ELO других игроков видно)
    nickname: '',       // ник, указанный вручную (необязательно)
    autoNickname: '',   // ник, определённый автоматически
  };
  // Какие атрибуты data-show-* ставит каждая настройка, когда она выключена
  const ATTR_FOR = {
    hideElo: ['elo', 'delta', 'season', 'next', 'bars'],
    hideLevel: ['level'], hideLadder: ['ladder'], hideMission: ['mission'],
  };
  const current = { ...SETTINGS };
  function nextHidden() { return current.enabled && current.hideElo; }

  const apply = (s) => {
    const scopeChanged = 'eloScope' in s || 'nickname' in s || 'autoNickname' in s;
    Object.assign(current, s);
    // Ручной ник важнее; если его нет — определённый автоматически
    ownNick = String(current.nickname || '').trim().toLowerCase() ||
      String(current.autoNickname || '').trim().toLowerCase();
    root.toggleAttribute('data-elo-scope-mine', current.eloScope === 'mine');
    if (scopeChanged) {
      lastPath = '';
      updateOwnPage();
      retagMine();
    }
    root.toggleAttribute('data-elo-off', !current.enabled);
    for (const [key, names] of Object.entries(ATTR_FOR)) {
      names.forEach((name) => root.toggleAttribute(`data-show-${name}`, !current[key]));
    }
    // Остальное переключает CSS; здесь только текст "76 Elo" ↔ "?? Elo" — без пересканирования страницы
    const hide = nextHidden();
    replaced.forEach((orig, node) => {
      if (!node.isConnected) return replaced.delete(node);
      const want = hide ? QQ_TEXT(orig) : orig;
      if (node.nodeValue !== want) node.nodeValue = want;
    });
  };
  chrome.storage.local.get(SETTINGS, apply);
  chrome.storage.onChanged.addListener((changes) => {
    const s = {};
    for (const k of Object.keys(SETTINGS)) if (changes[k]) s[k] = changes[k].newValue;
    if (Object.keys(s).length) apply(s);
  });
})();
