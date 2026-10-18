/**
 * 自检脚本：在 Node 里用假的 chrome.* 与 fetch 加载真实的 background.js，
 * 验证请求体、鉴权头、缓存、错误映射、429 重试与节流间隔。
 *
 *   node tools/selftest.mjs
 */
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import assert from 'node:assert/strict';

const store = new Map();
let messageHandler = null;
let actionHandler = null;
let omniboxEntered = null;
let installedHandler = null;
const opened = [];
const calls = [];

const chromeStub = {
  runtime: {
    onMessage: { addListener: (fn) => { messageHandler = fn; } },
    onInstalled: { addListener: (fn) => { installedHandler = fn; } },
    openOptionsPage: async () => {},
    getURL: (path) => `chrome-extension://selftest/${path}`,
  },
  action: {
    onClicked: { addListener: (fn) => { actionHandler = fn; } },
  },
  omnibox: {
    onInputChanged: { addListener: () => {} },
    onInputEntered: { addListener: (fn) => { omniboxEntered = fn; } },
  },
  storage: {
    local: {
      async get(keys) {
        if (keys === null || keys === undefined) return Object.fromEntries(store);
        if (typeof keys === 'string') return store.has(keys) ? { [keys]: store.get(keys) } : {};
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.filter((key) => store.has(key)).map((key) => [key, store.get(key)]));
        }
        return {};
      },
      async set(items) {
        for (const [key, value] of Object.entries(items)) store.set(key, value);
      },
      async remove(keys) {
        for (const key of [].concat(keys)) store.delete(key);
      },
    },
  },
  tabs: {
    create: async ({ url }) => {
      opened.push(url);
      return { id: opened.length };
    },
  },
};

globalThis.chrome = chromeStub;

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

let scripted = [];
let defaultPayload = { results: [] };

globalThis.fetch = async (url, options) => {
  calls.push({
    url,
    at: Date.now(),
    headers: options.headers,
    body: JSON.parse(options.body),
  });
  if (scripted.length) {
    const next = scripted.shift();
    return next(url, options);
  }
  return jsonResponse(200, defaultPayload);
};

const source = readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
runInThisContext(source, { filename: 'background.js' });

assert.ok(typeof messageHandler === 'function', 'background.js 应注册 onMessage 监听器');

function send(message) {
  return new Promise((resolve, reject) => {
    const kept = messageHandler(message, {}, resolve);
    if (kept !== true) reject(new Error('onMessage 必须返回 true 以支持异步响应'));
  });
}

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      results.push(['PASS', name]);
    })
    .catch((err) => {
      results.push(['FAIL', `${name} — ${err.message}`]);
    });
}

const samplePayload = {
  results: [
    {
      rerank_score: 2.4,
      title: '示例结果一',
      url: 'https://example.com/a',
      snippet: '短摘要',
      summary: '长摘要',
      content: '',
      site_name: 'Example',
      site_icon: 'https://example.com/favicon.ico',
      date: '2026-06-01T00:00:00+00:00',
      authority: 3,
    },
    {
      title: '危险链接',
      url: 'javascript:alert(1)',
      authority: 'x',
    },
  ],
};

/* ---------------------------------------------------------------- */
await check('未配置 Key 时返回 nokey', async () => {
  const response = await send({ type: 'search', query: '测试' });
  assert.equal(response.ok, false);
  assert.equal(response.error.kind, 'nokey');
});

await check('搜索请求体、鉴权头与空值处理', async () => {
  await chromeStub.storage.local.set({ apiKey: '  sk-test-123  ' });
  calls.length = 0;
  defaultPayload = samplePayload;

  const response = await send({ type: 'search', query: '  deepseek 搜索  ', count: 99, needContent: true });
  assert.equal(response.ok, true, JSON.stringify(response.error ?? ''));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/tools/search');
  assert.equal(calls[0].headers.Authorization, 'Bearer sk-test-123');
  assert.equal(calls[0].body.query, 'deepseek 搜索');
  assert.equal(calls[0].body.count, 50, 'count 应被夹到 50');
  assert.equal(calls[0].body.need_content, true);
  assert.equal(response.results.length, 2);
  assert.equal(response.results[0].authority, 3);
  assert.equal(response.results[1].url, '', 'javascript: 链接应被丢弃');
  assert.equal(response.results[1].authority, -1, '非法 authority 应回落为 -1');
});

await check('相同请求命中缓存，不再发起网络调用', async () => {
  calls.length = 0;
  const response = await send({ type: 'search', query: 'deepseek 搜索', count: 99, needContent: true });
  assert.equal(response.ok, true);
  assert.equal(response.cached, true);
  assert.equal(calls.length, 0);
});

await check('401 映射为 auth', async () => {
  scripted = [() => jsonResponse(401, { error: { message: 'Authentication Fails' } })];
  const response = await send({ type: 'search', query: '一个不会命中缓存的词' });
  assert.equal(response.ok, false);
  assert.equal(response.error.kind, 'auth');
});

await check('402 映射为 balance', async () => {
  scripted = [() => jsonResponse(402, { error: { message: 'Insufficient Balance' } })];
  const response = await send({ type: 'search', query: '余额不足测试' });
  assert.equal(response.ok, false);
  assert.equal(response.error.kind, 'balance');
});

await check('429 自动退避重试一次后成功', async () => {
  calls.length = 0;
  scripted = [
    () => jsonResponse(429, { error: { message: 'rate limited' } }),
    () => jsonResponse(200, { results: [] }),
  ];
  const response = await send({ type: 'search', query: '限速重试测试' });
  assert.equal(response.ok, true);
  assert.equal(calls.length, 2);
});

await check('连续 429 最终报 rate', async () => {
  scripted = [
    () => jsonResponse(429, {}),
    () => jsonResponse(429, {}),
  ];
  const response = await send({ type: 'search', query: '持续限速测试' });
  assert.equal(response.ok, false);
  assert.equal(response.error.kind, 'rate');
});

await check('Fetch 接口走 /v1/tools/fetch 并返回正文', async () => {
  calls.length = 0;
  scripted = [() => jsonResponse(200, { title: 'T', content: '# 正文' })];
  const response = await send({ type: 'fetch', url: 'https://example.com/a' });
  assert.equal(response.ok, true);
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/tools/fetch');
  assert.deepEqual(calls[0].body, { url: 'https://example.com/a' });
  assert.equal(response.content, '# 正文');
});

await check('Fetch 空正文报 empty', async () => {
  scripted = [() => jsonResponse(200, { title: 'T', content: '   ' })];
  const response = await send({ type: 'fetch', url: 'https://example.com/empty' });
  assert.equal(response.ok, false);
  assert.equal(response.error.kind, 'empty');
});

await check('Fetch 拒绝非 http(s) 地址', async () => {
  const response = await send({ type: 'fetch', url: 'file:///etc/passwd' });
  assert.equal(response.ok, false);
  assert.equal(response.error.kind, 'badrequest');
});

await check('串行节流：相邻请求间隔 >= 250ms', async () => {
  calls.length = 0;
  defaultPayload = { results: [] };
  const queries = ['节流测试 A', '节流测试 B'];
  await Promise.all(
    queries.map((query, index) =>
      send({ type: 'search', query, count: 3 + index }),
    ),
  );
  assert.equal(calls.length, 2);
  const gap = calls[1].at - calls[0].at;
  assert.ok(gap >= 250, `间隔 ${gap}ms 太小，可能撞 5 QPS`);
});

await check('导航型查询：把站点首页顶到第一位', async () => {
  defaultPayload = {
    results: [
      {
        title: '关于 bilibili 的一篇文章',
        url: 'https://news.example.com/about-bilibili',
        summary: '讲的是 bilibili 这家公司。',
        site_name: 'Example News',
        rerank_score: 2.6,
        authority: 3,
      },
      {
        title: '哔哩哔哩某个视频',
        url: 'https://www.bilibili.com/video/BV1xx411c7mD',
        site_name: '哔哩哔哩',
        rerank_score: 1.4,
        authority: 4,
      },
      {
        title: 'bilibili 是什么',
        url: 'https://www.bilibili.com/read/cv123',
        site_name: '哔哩哔哩',
        rerank_score: 1.1,
        authority: 4,
      },
    ],
  };

  const response = await send({ type: 'search', query: 'bilibili', count: 50 });
  assert.equal(response.ok, true);
  assert.equal(response.results[0].homepage, true);
  assert.equal(response.results[0].url, 'https://bilibili.com/');
  assert.equal(response.results[0].siteName, '哔哩哔哩');
});

await check('首页本来就在结果里：复用它的地址，不重复', async () => {
  defaultPayload = {
    results: [
      {
        title: '知乎 - 有问题，就会有答案',
        url: 'https://www.zhihu.com/',
        site_name: '知乎',
        rerank_score: 2.2,
        authority: 4,
      },
      {
        title: '某个回答',
        url: 'https://www.zhihu.com/question/123',
        site_name: '知乎',
        rerank_score: 1.8,
        authority: 4,
      },
    ],
  };

  const response = await send({ type: 'search', query: 'zhihu', count: 50 });
  assert.equal(response.results[0].homepage, true);
  assert.equal(response.results[0].url, 'https://www.zhihu.com/');
  assert.equal(
    response.results.filter((item) => item.url === 'https://www.zhihu.com/').length,
    1,
  );
});

await check('中文站点名也能匹配到首页', async () => {
  defaultPayload = {
    results: [
      {
        title: '知乎上的一个回答',
        url: 'https://www.zhihu.com/question/456',
        site_name: '知乎',
        rerank_score: 2.0,
        authority: 4,
      },
    ],
  };

  const response = await send({ type: 'search', query: '知乎', count: 50 });
  assert.equal(response.results[0].homepage, true);
  assert.equal(response.results[0].url, 'https://zhihu.com/');
});

await check('长尾查询不抢首位', async () => {
  defaultPayload = {
    results: [
      {
        title: 'B站视频下载方法汇总',
        url: 'https://www.bilibili.com/video/BV2yy',
        site_name: '哔哩哔哩',
        rerank_score: 2.5,
        authority: 4,
      },
      {
        title: '另一个结果',
        url: 'https://example.org/x',
        site_name: 'Example',
        rerank_score: 1.5,
        authority: 2,
      },
    ],
  };

  const response = await send({ type: 'search', query: 'bilibili 视频怎么下载 2026', count: 50 });
  assert.equal(response.results[0].homepage, false);
  assert.equal(response.results[0].url, 'https://www.bilibili.com/video/BV2yy');
});

await check('结果里没有该站点时不硬猜首页', async () => {
  defaultPayload = {
    results: [
      {
        title: '无关结果',
        url: 'https://example.org/a',
        site_name: 'Example',
        rerank_score: 2.0,
        authority: 2,
      },
    ],
  };

  const response = await send({ type: 'search', query: 'nosuchbrandxyz', count: 50 });
  assert.equal(response.results[0].homepage, false);
  assert.equal(response.results[0].url, 'https://example.org/a');
});

await check('两字母域名只有一个结果时不硬钉', async () => {
  defaultPayload = {
    results: [
      {
        title: 'AI 相关的一篇报道',
        url: 'https://ai.com/news/story',
        site_name: 'AI',
        rerank_score: 2.1,
        authority: 2,
      },
    ],
  };

  const response = await send({ type: 'search', query: 'ai', count: 50 });
  assert.equal(response.results[0].homepage, false);
  assert.equal(response.results[0].url, 'https://ai.com/news/story');
});

await check('工具栏按钮打开起始页', async () => {
  opened.length = 0;
  actionHandler();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(opened.length, 1);
  assert.ok(opened[0].endsWith('/start.html'), opened[0]);
});

await check('omnibox 关键词带上 q 参数', async () => {
  opened.length = 0;
  omniboxEntered('  deepseek 搜索  ');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(opened.length, 1);
  const url = new URL(opened[0]);
  assert.equal(url.searchParams.get('q'), 'deepseek 搜索');
});

await check('首次安装打开带 setup 的起始页', async () => {
  opened.length = 0;
  installedHandler({ reason: 'install' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(opened[0].includes('setup=1'), opened[0]);
});

const failed = results.filter(([state]) => state === 'FAIL');
for (const [state, text] of results) {
  console.log(`${state === 'PASS' ? '✓' : '✗'} ${text}`);
}
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) process.exitCode = 1;
