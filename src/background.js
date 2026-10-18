'use strict';

// 兼容层：Chrome 提供 chrome.*，Firefox 提供 browser.*（两者在 MV3 下都支持 Promise）。
const ext = globalThis.browser ?? globalThis.chrome;

const ENDPOINTS = {
  search: 'https://api.deepseek.com/v1/tools/search',
  fetch: 'https://api.deepseek.com/v1/tools/fetch',
};

const MIN_INTERVAL_MS = 260; // 约 3.8 QPS：官方上限 5 QPS（按账号），留余量避免 429
const REQUEST_TIMEOUT_MS = 20000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;

class ApiError extends Error {
  constructor(kind, message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ *
 * 串行节流队列：所有出站请求排队，保证相邻两次调用间隔 >= MIN_INTERVAL_MS
 * ------------------------------------------------------------------ */
let lastCallAt = 0;
let queueTail = Promise.resolve();

function enqueue(task) {
  const run = queueTail.then(async () => {
    const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    return task();
  });
  queueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */
function httpError(status, payload) {
  const detail = payload && payload.error && payload.error.message ? String(payload.error.message) : '';
  switch (status) {
    case 400:
      return new ApiError('badrequest', detail || '请求参数不合法。', status);
    case 401:
      return new ApiError('auth', 'API Key 无效或已失效，请到设置里重新保存。', status);
    case 402:
      return new ApiError('balance', '账号余额不足，请先充值后再试。', status);
    case 403:
      return new ApiError('blocked', '该网页被目标站点或安全策略拒绝，无法抓取。', status);
    case 404:
      return new ApiError('empty', '没有拿到可用的网页正文（页面不可用或被拦截）。', status);
    case 408:
      return new ApiError('timeout', '服务器读取请求超时，请稍后重试。', status);
    case 413:
      return new ApiError('toolarge', '请求体超过大小限制。', status);
    case 429:
      return new ApiError('rate', '触发限速（每账号 5 QPS），请稍等几秒再试。', status);
    default:
      if (status >= 500) {
        return new ApiError('server', `服务端错误（HTTP ${status}），请稍后重试。`, status);
      }
      return new ApiError('badrequest', detail || `请求失败（HTTP ${status}）。`, status);
  }
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function callApi(url, body, { retries = 1 } = {}) {
  const stored = await ext.storage.local.get('apiKey');
  const apiKey = String(stored.apiKey || '').trim();
  if (!apiKey) {
    throw new ApiError('nokey', '还没有填写 API Key，请先到设置里保存。', 0);
  }

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new ApiError('timeout', '请求超时（20 秒），请稍后重试。', 0);
      }
      throw new ApiError(
        'network',
        '网络请求失败：可能断网、被代理/防火墙拦截，或扩展没有 api.deepseek.com 的访问权限。',
        0,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      const data = await readJsonSafe(response);
      if (data === null) throw new ApiError('parse', '接口返回的不是合法 JSON。', response.status);
      return data;
    }

    const payload = await readJsonSafe(response);
    if (response.status === 429 && attempt < retries) {
      await sleep(1200);
      continue;
    }
    throw httpError(response.status, payload);
  }
}

/* ------------------------------------------------------------------ *
 * 缓存（放在 storage.local，service worker 被回收也不丢）
 * ------------------------------------------------------------------ */
function hashKey(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

async function readCache(key) {
  const bag = await ext.storage.local.get(key);
  const hit = bag[key];
  if (!hit || typeof hit.t !== 'number') return null;
  if (Date.now() - hit.t > CACHE_TTL_MS) {
    await ext.storage.local.remove(key);
    return null;
  }
  return hit.v;
}

async function writeCache(key, value) {
  await ext.storage.local.set({ [key]: { t: Date.now(), v: value } });

  const all = await ext.storage.local.get(null);
  const entries = Object.entries(all)
    .filter(([k, v]) => k.startsWith('cache:') && v && typeof v.t === 'number')
    .sort((a, b) => b[1].t - a[1].t);
  if (entries.length > CACHE_MAX) {
    const stale = entries.slice(CACHE_MAX).map(([k]) => k);
    if (stale.length) await ext.storage.local.remove(stale);
  }
}

async function countCache() {
  const all = await ext.storage.local.get(null);
  return Object.keys(all).filter((k) => k.startsWith('cache:')).length;
}

/**
 * 缓存写入必须“尽力而为”：storage.local 有配额（Chrome 约 10MB），
 * 带正文的结果可能很大。写不进去只是少一层缓存，绝不能让搜索因此失败。
 */
async function safeWriteCache(key, value) {
  try {
    if (JSON.stringify(value).length > 256 * 1024) return;
    await writeCache(key, value);
  } catch {
    /* 忽略：配额不足或存储不可用 */
  }
}

/* ------------------------------------------------------------------ *
 * 数据清洗：搜索结果来自公网，全部当不可信数据处理
 * ------------------------------------------------------------------ */
function safeUrl(value) {
  try {
    const parsed = new URL(String(value));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function normalizeResults(list) {
  if (!Array.isArray(list)) return [];
  return list.map((raw) => {
    const item = raw && typeof raw === 'object' ? raw : {};
    const authority = Number(item.authority);
    const score = Number(item.rerank_score);
    return {
      title: String(item.title ?? '').trim() || '（无标题）',
      url: safeUrl(item.url),
      snippet: String(item.snippet ?? ''),
      summary: String(item.summary ?? ''),
      content: String(item.content ?? ''),
      siteName: item.site_name == null ? '' : String(item.site_name),
      siteIcon: safeUrl(item.site_icon),
      date: typeof item.date === 'string' ? item.date : '',
      authority: Number.isFinite(authority) ? authority : -1,
      score: Number.isFinite(score) ? score : 0,
      homepage: false,
    };
  });
}

/* ------------------------------------------------------------------ *
 * 导航型查询：把站点首页顶到第一位
 *
 * 「搜 bilibili 却返回一篇讲 bilibili 的文章」是典型的导航意图没被满足。
 * 这里不改写 query、不额外发请求（省钱），只用结果里的域名做证据：
 *   1. 查询足够短（≤2 个词、≤18 字符）才认为是导航型；
 *   2. 找域名/站点名与查询匹配的结果，按命中数量取最可信的站点；
 *   3. 生成（或复用）该站首页条目，放到第一位并打 homepage 标记。
 * 只有结果里真的出现过这个站点才会生效，不猜域名，避免把首条变成错的。
 * ------------------------------------------------------------------ */
const MULTI_LABEL_SUFFIXES = new Set([
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'com.hk', 'com.tw', 'co.uk', 'co.jp', 'co.kr', 'com.au',
]);

const OPERATOR_RE = /\b(?:site|lang|after|before):\S+/gi;

function hostOfUrl(value) {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
}

function registrableDomain(host) {
  const parts = String(host || '')
    .replace(/^www\./, '')
    .split('.')
    .filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

function squashText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\-_·.、,，]+/g, '');
}

function looksNavigational(query) {
  const cleaned = String(query || '').replace(OPERATOR_RE, ' ').trim();
  if (!cleaned) return false;
  if (cleaned.replace(/\s+/g, '').length > 18) return false;
  return cleaned.split(/\s+/).filter(Boolean).length <= 2;
}

function latinTokens(query) {
  return String(query || '')
    .replace(OPERATOR_RE, ' ')
    .toLowerCase()
    .split(/[\s,，、]+/)
    .filter((token) => token.length >= 2 && /^[a-z0-9-]+$/.test(token));
}

function matchesSite(item, tokens, querySquashed) {
  const domain = registrableDomain(hostOfUrl(item.url));
  if (!domain) return false;
  const label = domain.split('.')[0];
  if (tokens.some((token) => label === token || label === token.replace(/-/g, ''))) return true;

  const site = squashText(item.siteName);
  if (!site || !querySquashed) return false;
  return site === querySquashed || site.includes(querySquashed);
}

function isSiteRoot(url, domain) {
  try {
    const parsed = new URL(url);
    if (registrableDomain(parsed.host) !== domain) return false;
    return parsed.pathname.replace(/\/+$/, '') === '';
  } catch {
    return false;
  }
}

function pinHomepage(query, results) {
  if (!results.length || !looksNavigational(query)) return results;

  const tokens = latinTokens(query);
  const querySquashed = squashText(String(query || '').replace(OPERATOR_RE, ' '));
  if (!tokens.length && !querySquashed) return results;

  const groups = new Map();
  for (const item of results) {
    if (!item.url) continue;
    if (!matchesSite(item, tokens, querySquashed)) continue;

    const domain = registrableDomain(hostOfUrl(item.url));
    const group = groups.get(domain) || { domain, count: 0, score: -Infinity, siteName: '' };
    group.count += 1;
    if (item.score > group.score) {
      group.score = item.score;
      group.siteName = item.siteName || group.siteName;
    }
    groups.set(domain, group);
  }

  if (!groups.size) return results;

  // 两字母的域名标签（ai.com、vr.com 之类）容易误伤，至少要两条结果佐证
  const candidates = [...groups.values()].filter((group) => {
    const label = group.domain.split('.')[0];
    return label.length >= 3 || group.count >= 2;
  });
  if (!candidates.length) return results;

  const best = candidates.sort((a, b) => b.count - a.count || b.score - a.score)[0];

  const rootIndex = results.findIndex((item) => item.url && isSiteRoot(item.url, best.domain));

  let entry;
  if (rootIndex >= 0) {
    entry = { ...results[rootIndex], homepage: true };
  } else {
    entry = {
      title: best.siteName || best.domain.split('.')[0],
      url: `https://${best.domain}/`,
      snippet: '',
      summary: `${best.domain} · 官方网站首页`,
      content: '',
      siteName: best.siteName || best.domain,
      siteIcon: '',
      date: '',
      authority: 4,
      score: best.score,
      homepage: true,
    };
  }

  const rest = results.filter(
    (item, index) => index !== rootIndex && !isSiteRoot(item.url, best.domain),
  );

  return [entry, ...rest];
}

/* ------------------------------------------------------------------ *
 * 业务
 * ------------------------------------------------------------------ */
async function handleSearch(message) {
  const query = String(message.query || '').trim();
  if (!query) throw new ApiError('badrequest', '搜索词不能为空。', 0);
  if (query.length > 128) throw new ApiError('badrequest', '搜索词最多 128 个字符。', 0);

  const requested = Number(message.count);
  const count = Math.min(50, Math.max(1, Number.isFinite(requested) ? Math.trunc(requested) : 10));

  const body = {
    query,
    count,
    need_content: Boolean(message.needContent),
  };
  if (message.oriQuestion) body.ori_question = String(message.oriQuestion).slice(0, 128);
  if (message.localization) body.localization = String(message.localization);

  const cacheKey = `cache:${hashKey(JSON.stringify(body))}`;
  const cached = await readCache(cacheKey);
  if (cached) return { ok: true, cached: true, ...cached };

  const startedAt = Date.now();
  const data = await enqueue(() => callApi(ENDPOINTS.search, body));
  const payload = {
    query,
    results: pinHomepage(query, normalizeResults(data.results)),
    tookMs: Date.now() - startedAt,
  };
  await safeWriteCache(cacheKey, payload);
  return { ok: true, cached: false, ...payload };
}

async function handleFetch(message) {
  const target = safeUrl(message.url);
  if (!target) throw new ApiError('badrequest', '需要一个合法的 http/https 网址。', 0);

  const cacheKey = `cache:fetch:${hashKey(target)}`;
  const cached = await readCache(cacheKey);
  if (cached) return { ok: true, cached: true, ...cached };

  const startedAt = Date.now();
  const data = await enqueue(() => callApi(ENDPOINTS.fetch, { url: target }));
  const content = String(data.content || '');
  if (!content.trim()) throw new ApiError('empty', '该页面没有可提取的正文。', 0);

  const payload = {
    title: String(data.title || ''),
    url: target,
    content,
    tookMs: Date.now() - startedAt,
  };
  await safeWriteCache(cacheKey, payload);
  return { ok: true, cached: false, ...payload };
}

async function handleState() {
  const stored = await ext.storage.local.get('apiKey');
  return {
    ok: true,
    hasKey: Boolean(String(stored.apiKey || '').trim()),
    cacheEntries: await countCache(),
  };
}

async function clearCache() {
  const all = await ext.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith('cache:'));
  if (keys.length) await ext.storage.local.remove(keys);
  return keys.length;
}

async function dispatch(message) {
  const type = message && message.type;
  switch (type) {
    case 'search':
      return handleSearch(message);
    case 'fetch':
      return handleFetch(message);
    case 'state':
      return handleState();
    case 'clearCache':
      return { ok: true, removed: await clearCache() };
    default:
      return { ok: false, error: { kind: 'badrequest', message: `未知消息类型：${String(type)}` } };
  }
}

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  dispatch(message).then(
    (result) => sendResponse(result),
    (err) => {
      sendResponse({
        ok: false,
        error: {
          kind: err && err.kind ? err.kind : 'internal',
          message: err && err.message ? err.message : String(err),
        },
      });
    },
  );
  return true; // 异步响应
});

/* ------------------------------------------------------------------ *
 * 地址栏关键词：输入 ds 空格 关键词，回车打开搜索页
 * ------------------------------------------------------------------ */
const OMNIBOX_XML = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' };
const escapeXml = (text) => String(text).replace(/[<>&"']/g, (ch) => OMNIBOX_XML[ch]);

/** 打开起始页；query 有值时直接开搜，setup 为真时展开设置并把焦点放到 Key 上。 */
function openStartPage({ query = '', setup = false } = {}) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (setup) params.set('setup', '1');
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return ext.tabs.create({ url: `${ext.runtime.getURL('start.html')}${suffix}` });
}

if (ext.omnibox) {
  ext.omnibox.onInputChanged.addListener((text, suggest) => {
    const query = String(text || '').trim();
    if (!query) {
      suggest([]);
      return;
    }
    suggest([
      {
        content: query,
        description: `用蓝鲸搜索：<match>${escapeXml(query)}</match>`,
      },
    ]);
  });

  ext.omnibox.onInputEntered.addListener((text) => {
    const query = String(text || '').trim();
    if (!query) return;
    openStartPage({ query }).catch(() => {
      /* 忽略 */
    });
  });
}

if (ext.action && ext.action.onClicked) {
  ext.action.onClicked.addListener(() => {
    openStartPage().catch(() => {
      /* 忽略 */
    });
  });
}

ext.runtime.onInstalled.addListener((details) => {
  if (details && details.reason === 'install') {
    openStartPage({ setup: true }).catch(() => {
      /* 忽略 */
    });
  }
});
