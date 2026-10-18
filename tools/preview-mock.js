/**
 * 预览用 shim：不装扩展也能在普通浏览器里看到起始页。
 * 只模拟 background 的消息通道与 storage，不联网、不花钱。
 * 数据里刻意做了 14 条 + 一个「官网」置顶，方便看分页按钮和徽标。
 */
const HOMEPAGE = {
  title: '哔哩哔哩',
  url: 'https://bilibili.com/',
  snippet: '',
  summary: 'bilibili.com · 官方网站首页',
  content: '',
  siteName: '哔哩哔哩',
  siteIcon: '',
  date: '',
  authority: 4,
  homepage: true,
};

const OTHERS = [
  {
    title: '关于 B 站，你需要知道的十件事',
    url: 'https://news.example.com/about-bilibili',
    summary: '第三方媒体对这家公司的报道，不是它的官网。',
    siteName: 'Example News',
    date: '2026-10-17T00:00:00+00:00',
    authority: 3,
    homepage: false,
  },
  {
    title: 'DeepSeek 上线网页搜索与抓取 API，按次计费 5 元 / 1000 次',
    url: 'https://api-docs.deepseek.com/zh-cn/guides/search',
    summary:
      'Search 接口按 query 搜索网页，返回结构化结果并支持 site:、lang:、after: 等语法；Fetch 抓取单个页面并返回 Markdown 正文。',
    siteName: 'DeepSeek API Docs',
    date: '2026-10-17T00:00:00+00:00',
    authority: 4,
    homepage: false,
  },
  {
    title: '5 元千次：DeepSeek 的低价搜索 API 会改变什么',
    url: 'https://example.com/a',
    summary: '按请求而非 token 计费，让搜索类 Agent 的成本结构变得可预测。',
    siteName: 'Example News',
    date: '2026-10-16T00:00:00+00:00',
    authority: 2,
    homepage: false,
  },
  {
    title: '如何用 Search API 搭建 RAG 检索层',
    url: 'https://example.org/b',
    summary: '',
    snippet: '一个最小可用的检索层实现。',
    siteName: '',
    date: '',
    authority: -1,
    homepage: false,
  },
];

const RESULTS = [HOMEPAGE, ...OTHERS];
// 再补满到 14 条，用来演示「阅读更多」
for (let i = RESULTS.length; i < 14; i += 1) {
  RESULTS.push({
    title: `示例结果 #${i + 1}：占位内容，用于演示分页`,
    url: `https://example.net/p/${i + 1}`,
    summary: '这是一条占位结果，点「阅读更多」会继续追加后面的条目。',
    snippet: '',
    siteName: 'example.net',
    date: '',
    authority: 1,
    homepage: false,
  });
}

globalThis.chrome = {
  runtime: {
    async sendMessage(message) {
      if (message.type === 'search') {
        return { ok: true, cached: false, tookMs: 412, results: RESULTS };
      }
      if (message.type === 'fetch') {
        return { ok: true, content: '# 示例正文\n\n这是 Fetch 接口返回的 Markdown。' };
      }
      if (message.type === 'state') return { ok: true, hasKey: true, cacheEntries: 3 };
      return { ok: true };
    },
    getURL: (path) => path,
  },
  storage: {
    local: {
      async get() {
        return { settings: { count: 10, needContent: false }, apiKey: '' };
      },
      async set() {},
      async remove() {},
    },
  },
};
