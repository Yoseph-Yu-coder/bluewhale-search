'use strict';

const ext = globalThis.browser ?? globalThis.chrome;

const DEFAULTS = { count: 10, needContent: false };
const COUNT_OPTIONS = [5, 10, 20, 30, 50];
const CONTENT_LIMIT = 20000;
// 接口按请求次数计费、与条数无关，也没有分页参数 —— 一次取满 50 条最划算，
// 前端每次只露一页，剩下的交给「阅读更多」。
const FETCH_COUNT = 50;
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const $ = (id) => document.getElementById(id);

const el = {
  stage: $('stage'),
  gear: $('gear'),
  menu: $('menu'),
  menuClose: $('menu-close'),
  finder: $('finder'),
  q: $('q'),
  results: $('results'),
  hint: $('hint'),
  time: $('clock-time'),
  date: $('clock-date'),
  optCount: $('opt-count'),
  optContent: $('opt-content'),
  optKey: $('opt-key'),
  keyStatus: $('key-status'),
  saveKey: $('save-key'),
  cacheCount: $('cache-count'),
  clearCache: $('clear-cache'),
};

const state = {
  settings: { ...DEFAULTS },
  view: 'home',
  results: [],
  shown: 0,
  active: -1,
  menuOpen: false,
  hintTimer: 0,
  requestId: 0,
  lastQuery: '',
  savedKey: '',
  moreWrap: null,
  moreButton: null,
  endNote: null,
};

/* ------------------------------------------------------------------ *
 * 基础
 * ------------------------------------------------------------------ */
async function sendMessage(message) {
  try {
    const response = await ext.runtime.sendMessage(message);
    return response || { ok: false, error: { kind: 'internal', message: '后台没有响应。' } };
  } catch (err) {
    return { ok: false, error: { kind: 'internal', message: (err && err.message) || String(err) } };
  }
}

function setHint(text, tone = '') {
  window.clearTimeout(state.hintTimer);
  el.hint.textContent = text || '';
  el.hint.className = `hint${text ? ' is-visible' : ''}${tone ? ` ${tone}` : ''}`;
  if (text) {
    state.hintTimer = window.setTimeout(() => {
      el.hint.className = 'hint';
      el.hint.textContent = '';
    }, 2400);
  }
}

function replaceUrl(query) {
  try {
    const url = query ? `start.html?q=${encodeURIComponent(query)}` : 'start.html';
    history.replaceState(null, '', url);
  } catch {
    /* 忽略 */
  }
}

/* ------------------------------------------------------------------ *
 * 时钟
 * ------------------------------------------------------------------ */
let lastTime = '';
let lastDate = '';

function tickClock() {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (time !== lastTime) {
    lastTime = time;
    el.time.textContent = time;
  }
  const date = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAYS[now.getDay()]}`;
  if (date !== lastDate) {
    lastDate = date;
    el.date.textContent = date;
  }
}

/* ------------------------------------------------------------------ *
 * 视图切换：FLIP，只动 transform，可从当前屏幕位置随时改向
 * ------------------------------------------------------------------ */
function setView(next, { animate = true } = {}) {
  if (state.view === next) return;

  const finder = el.finder;
  const before = finder.getBoundingClientRect().top;
  for (const running of finder.getAnimations()) running.cancel();

  el.stage.dataset.view = next;
  state.view = next;

  if (!animate || reduceMotion.matches) return;

  const after = finder.getBoundingClientRect().top;
  const delta = before - after;
  if (Math.abs(delta) < 2) return;

  finder.animate(
    [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
    { duration: 340, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  );
}

function goHome() {
  state.requestId += 1;
  state.results = [];
  state.shown = 0;
  state.active = -1;
  state.lastQuery = '';
  state.moreWrap = null;
  state.moreButton = null;
  state.endNote = null;
  el.results.replaceChildren();
  el.q.value = '';
  setView('home');
  replaceUrl('');
  el.q.focus();
}

/* ------------------------------------------------------------------ *
 * 菜单
 * ------------------------------------------------------------------ */
function openMenu({ focusKey = false } = {}) {
  state.menuOpen = true;
  el.menu.classList.add('is-open');
  el.gear.setAttribute('aria-expanded', 'true');
  refreshCacheCount();
  if (focusKey) {
    window.setTimeout(() => {
      el.optKey.focus();
      el.optKey.select();
    }, 60);
  }
}

function closeMenu({ restoreFocus = false } = {}) {
  if (!state.menuOpen) return;
  state.menuOpen = false;
  el.menu.classList.remove('is-open');
  el.gear.setAttribute('aria-expanded', 'false');
  if (restoreFocus) el.gear.focus();
}

function toggleMenu() {
  if (state.menuOpen) closeMenu({ restoreFocus: true });
  else openMenu();
}

/* ------------------------------------------------------------------ *
 * 设置
 * ------------------------------------------------------------------ */
function setSwitch(button, on) {
  button.setAttribute('aria-checked', on ? 'true' : 'false');
}

async function loadSettings() {
  const stored = await ext.storage.local.get(['settings', 'apiKey']);
  state.settings = { ...DEFAULTS, ...(stored.settings || {}) };

  el.optCount.value = String(
    COUNT_OPTIONS.includes(Number(state.settings.count)) ? state.settings.count : 10,
  );
  setSwitch(el.optContent, Boolean(state.settings.needContent));
  el.optKey.value = String(stored.apiKey || '');
  state.savedKey = el.optKey.value;
}

async function persist({ quiet = false } = {}) {
  const key = el.optKey.value.trim();
  const settings = {
    count: Number(el.optCount.value) || 10,
    needContent: el.optContent.getAttribute('aria-checked') === 'true',
  };
  state.settings = { ...state.settings, ...settings };

  const keyChanged = key !== state.savedKey;
  state.savedKey = key;

  if (key) await ext.storage.local.set({ settings, apiKey: key });
  else {
    await ext.storage.local.remove('apiKey');
    await ext.storage.local.set({ settings });
  }

  if (!quiet) {
    el.keyStatus.textContent = key ? '已保存' : '已清空';
    el.keyStatus.className = 'note ok';
    window.setTimeout(() => {
      el.keyStatus.textContent = '仅保存在本机';
      el.keyStatus.className = 'note';
    }, 2200);
  }

  // 刚补上 Key 且正卡在失败结果页：直接把上一次搜索重跑一遍
  if (keyChanged && key && state.view === 'results' && state.lastQuery) {
    closeMenu();
    search(state.lastQuery);
  }
}

async function refreshCacheCount() {
  const response = await sendMessage({ type: 'state' });
  if (response.ok) el.cacheCount.textContent = String(response.cacheEntries || 0);
}

/* ------------------------------------------------------------------ *
 * 搜索
 * ------------------------------------------------------------------ */
function fillCountOptions() {
  for (const value of COUNT_OPTIONS) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = `${value} 条`;
    el.optCount.appendChild(option);
  }
}

async function search(rawQuery) {
  const query = String(rawQuery ?? '').trim();
  if (!query) return;

  el.q.value = query;
  state.lastQuery = query;
  state.requestId += 1;
  const requestId = state.requestId;

  setView('results');
  replaceUrl(query);
  setHint('');
  el.results.replaceChildren();
  renderSkeleton();

  const response = await sendMessage({
    type: 'search',
    query,
    count: FETCH_COUNT,
    needContent: state.settings.needContent,
  });

  if (requestId !== state.requestId) return;

  if (!response.ok) {
    renderError(response.error);
    return;
  }
  renderResults(response);
}

function renderSkeleton() {
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < 3; i += 1) {
    const row = document.createElement('div');
    row.className = 'skeleton';
    fragment.appendChild(row);
  }
  el.results.appendChild(fragment);
}

function renderError(error) {
  const kind = error && error.kind;
  el.results.replaceChildren();

  if (kind === 'nokey' || kind === 'auth') {
    renderNotice({
      title: kind === 'auth' ? 'API Key 无效' : '先填一个 API Key',
      text:
        kind === 'auth'
          ? '这把 Key 被接口拒绝了，换一把再试。'
          : '在右上角设置里粘贴 Key 即可开始。搜索按次计费，5 元 / 1000 次成功请求。',
      action: '打开设置',
      onAction: () => openMenu({ focusKey: true }),
    });
    return;
  }

  renderNotice({
    title: '没能完成搜索',
    text: (error && error.message) || '未知错误，稍后再试。',
    action: '重试',
    onAction: () => search(el.q.value),
  });
}

function renderNotice({ title, text, action, onAction }) {
  const notice = document.createElement('div');
  notice.className = 'notice';

  const heading = document.createElement('p');
  heading.className = 'notice-title';
  heading.textContent = title;
  notice.appendChild(heading);

  const paragraph = document.createElement('p');
  paragraph.className = 'notice-text';
  paragraph.textContent = text;
  notice.appendChild(paragraph);

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = action;
  button.addEventListener('click', onAction);
  notice.appendChild(button);

  el.results.appendChild(notice);
}

/* ------------------------------------------------------------------ *
 * 结果渲染（全部 DOM API，不拼 HTML）
 * ------------------------------------------------------------------ */
function renderResults(response) {
  const items = Array.isArray(response.results) ? response.results : [];
  state.results = items;
  state.shown = 0;
  state.active = -1;
  el.results.replaceChildren();

  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '没有结果。换个说法，或用 site: 收窄范围。';
    el.results.appendChild(empty);
    return;
  }

  el.results.appendChild(renderResultsHead(response, items));

  state.moreWrap = document.createElement('div');
  state.moreWrap.className = 'more-wrap';
  state.moreWrap.hidden = true;

  state.moreButton = document.createElement('button');
  state.moreButton.type = 'button';
  state.moreButton.className = 'more';
  state.moreButton.addEventListener('click', () => appendPage());
  state.moreWrap.appendChild(state.moreButton);

  state.endNote = document.createElement('p');
  state.endNote.className = 'end-note';
  state.endNote.hidden = true;
  state.moreWrap.appendChild(state.endNote);

  el.results.appendChild(state.moreWrap);
  appendPage();
}

/** 取下一页塞在「阅读更多」之前，动画错峰从头数起 */
function appendPage() {
  if (!state.moreWrap || state.shown >= state.results.length) return;

  const pageSize = Math.max(1, Math.min(50, Number(state.settings.count) || 10));
  const slice = state.results.slice(state.shown, state.shown + pageSize);

  const fragment = document.createDocumentFragment();
  slice.forEach((item, index) =>
    fragment.appendChild(renderItem(item, state.shown + index, index)),
  );
  el.results.insertBefore(fragment, state.moreWrap);
  state.shown += slice.length;

  updateMore(pageSize);
}

function updateMore(pageSize) {
  if (!state.moreWrap) return;

  const remaining = state.results.length - state.shown;

  if (remaining > 0) {
    state.moreWrap.hidden = false;
    state.moreButton.hidden = false;
    state.endNote.hidden = true;
    state.moreButton.textContent = `阅读更多 · 还有 ${remaining} 条`;
    return;
  }

  if (state.results.length > pageSize) {
    state.moreWrap.hidden = false;
    state.moreButton.hidden = true;
    state.endNote.hidden = false;
    state.endNote.textContent = `已显示全部 ${state.results.length} 条`;
    return;
  }

  state.moreWrap.hidden = true;
}

function renderResultsHead(response, items) {
  const head = document.createElement('div');
  head.className = 'results-head';

  const count = document.createElement('span');
  count.textContent = `${items.length} 条结果`;
  head.appendChild(count);

  const dot = document.createElement('span');
  dot.className = 'dot';
  head.appendChild(dot);

  const timing = document.createElement('span');
  timing.textContent = response.cached ? '来自缓存' : `${response.tookMs} ms`;
  head.appendChild(timing);

  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  head.appendChild(spacer);

  const copyAll = document.createElement('button');
  copyAll.type = 'button';
  copyAll.className = 'ghost';
  copyAll.textContent = '复制全部';
  copyAll.addEventListener('click', () => {
    const markdown = items
      .map((item) => {
        const meta = [hostOf(item.url), formatDate(item.date)].filter(Boolean).join(' · ');
        const summary = String(item.summary || item.snippet || '')
          .replace(/\s+/g, ' ')
          .trim();
        return [
          `- [${item.title}](${item.url})`,
          meta ? `  ${meta}` : '',
          summary ? `  ${summary}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n');
    copy(markdown);
  });
  head.appendChild(copyAll);

  return head;
}

function renderItem(item, index, delayIndex) {
  const article = document.createElement('article');
  article.className = 'result';
  article.style.setProperty('--i', String(Math.min(delayIndex ?? index, 6)));

  /* 元信息 + 悬停操作 */
  const meta = document.createElement('div');
  meta.className = 'result-meta';

  if (item.homepage) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = '官网';
    meta.appendChild(badge);
  }

  const site = document.createElement('span');
  site.className = 'result-site';
  site.textContent = item.siteName || hostOf(item.url) || '未命名来源';
  meta.appendChild(site);

  const dateText = formatDate(item.date);
  if (dateText) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    meta.appendChild(dot);

    const time = document.createElement('time');
    time.textContent = dateText;
    meta.appendChild(time);
  }

  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  meta.appendChild(spacer);

  const actions = document.createElement('div');
  actions.className = 'result-actions';

  if (item.url) {
    const bodyButton = document.createElement('button');
    bodyButton.type = 'button';
    bodyButton.textContent = '查看正文';
    bodyButton.setAttribute('aria-label', `查看正文：${item.title}`);
    bodyButton.addEventListener('click', () => toggleBody(article, item, bodyButton));
    actions.appendChild(bodyButton);

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = '复制引用';
    copyButton.setAttribute('aria-label', `复制引用：${item.title}`);
    copyButton.addEventListener('click', () => copy(`[${item.title}](${item.url})`));
    actions.appendChild(copyButton);
  }

  meta.appendChild(actions);
  article.appendChild(meta);

  /* 标题 */
  const title = document.createElement('a');
  title.className = 'result-title';
  title.textContent = item.title;
  if (item.url) {
    title.href = item.url;
    title.target = '_blank';
    title.rel = 'noopener noreferrer';
  }
  article.appendChild(title);

  /* 摘要 */
  const summary = document.createElement('p');
  summary.className = 'result-summary';
  summary.textContent = item.summary || item.snippet || '';
  if (!summary.textContent) summary.hidden = true;
  article.appendChild(summary);

  /* 可展开的正文 */
  const body = document.createElement('div');
  body.className = 'result-body';
  const bodyInner = document.createElement('div');
  body.appendChild(bodyInner);
  article.appendChild(body);

  return article;
}

async function toggleBody(article, item, button) {
  const body = article.querySelector('.result-body');
  const inner = body.firstElementChild;

  if (body.classList.contains('is-open')) {
    body.classList.remove('is-open');
    button.textContent = '查看正文';
    return;
  }

  if (!inner.querySelector('pre')) {
    button.disabled = true;
    button.textContent = '读取中…';

    let text = '';
    if (item.content && item.content.trim()) {
      text = item.content;
    } else {
      const response = await sendMessage({ type: 'fetch', url: item.url });
      text = response.ok
        ? response.content
        : `读取失败：${(response.error && response.error.message) || '未知错误'}`;
    }

    button.disabled = false;
    const pre = document.createElement('pre');
    pre.textContent =
      text.length > CONTENT_LIMIT
        ? `${text.slice(0, CONTENT_LIMIT)}\n\n… 已截断，全文 ${text.length} 字符`
        : text;
    inner.replaceChildren(pre);
  }

  body.classList.add('is-open');
  button.textContent = '收起';
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    setHint('已复制');
    return;
  } catch {
    /* 兜底 */
  }
  const helper = document.createElement('textarea');
  helper.value = text;
  helper.setAttribute('readonly', 'readonly');
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  document.body.appendChild(helper);
  helper.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  helper.remove();
  setHint(ok ? '已复制' : '复制失败，请手动选择', ok ? '' : 'err');
}

/* ------------------------------------------------------------------ *
 * 键盘
 * ------------------------------------------------------------------ */
function moveActive(delta) {
  const rows = [...el.results.querySelectorAll('.result')];
  if (!rows.length) return;

  if (state.active >= 0 && rows[state.active]) rows[state.active].classList.remove('is-active');
  state.active = Math.max(0, Math.min(rows.length - 1, state.active + delta));
  const row = rows[state.active];
  row.classList.add('is-active');
  row.scrollIntoView({ block: 'nearest' });
}

function openActive() {
  const rows = [...el.results.querySelectorAll('.result')];
  const row = state.active >= 0 ? rows[state.active] : null;
  const link = row && row.querySelector('.result-title');
  if (link && link.href) window.open(link.href, '_blank', 'noopener');
}

/* ------------------------------------------------------------------ *
 * 事件
 * ------------------------------------------------------------------ */
function bind() {
  el.finder.addEventListener('submit', (event) => {
    event.preventDefault();
    search(el.q.value);
  });

  el.gear.addEventListener('click', toggleMenu);
  el.menuClose.addEventListener('click', () => closeMenu({ restoreFocus: true }));

  document.addEventListener('pointerdown', (event) => {
    if (!state.menuOpen) return;
    if (el.menu.contains(event.target) || el.gear.contains(event.target)) return;
    closeMenu();
  });

  el.saveKey.addEventListener('click', () => persist());
  el.optKey.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      persist();
    }
  });

  el.optCount.addEventListener('change', () => persist({ quiet: true }));
  el.optContent.addEventListener('click', () => {
    const next = el.optContent.getAttribute('aria-checked') !== 'true';
    setSwitch(el.optContent, next);
    persist({ quiet: true });
  });

  el.clearCache.addEventListener('click', async () => {
    const response = await sendMessage({ type: 'clearCache' });
    if (response.ok) {
      el.cacheCount.textContent = '0';
      el.keyStatus.textContent = '缓存已清空';
      el.keyStatus.className = 'note ok';
      window.setTimeout(() => {
        el.keyStatus.textContent = '仅保存在本机';
        el.keyStatus.className = 'note';
      }, 2200);
    }
  });

  document.addEventListener('keydown', (event) => {
    const typing =
      document.activeElement === el.q ||
      document.activeElement === el.optKey ||
      el.menu.contains(document.activeElement);

    if (event.key === 'Escape') {
      if (state.menuOpen) {
        closeMenu({ restoreFocus: true });
        return;
      }
      if (state.view === 'results') {
        goHome();
        return;
      }
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      el.q.focus();
      el.q.select();
      return;
    }

    if (event.key === '/' && !typing) {
      event.preventDefault();
      el.q.focus();
      return;
    }

    if (state.view !== 'results') return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Enter' && state.active >= 0) {
      event.preventDefault();
      openActive();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tickClock();
  });
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */
async function init() {
  fillCountOptions();
  bind();
  tickClock();
  window.setInterval(tickClock, 1000);

  await loadSettings();

  const params = new URLSearchParams(window.location.search);

  if (params.get('setup') === '1') {
    openMenu({ focusKey: true });
    el.q.focus();
    return;
  }

  const preset = params.get('q');
  if (preset) {
    el.q.value = preset;
    search(preset);
    return;
  }

  el.q.focus();
}

init().catch((err) => setHint(`初始化失败：${(err && err.message) || err}`, 'err'));
