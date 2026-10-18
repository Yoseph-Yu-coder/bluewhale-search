# 隐私政策 / Privacy Policy

**蓝鲸搜索 / Blue Whale Search**

最后更新 / Last updated: 2026-10-18

---

## 中文

蓝鲸搜索是一个浏览器扩展，把新标签页变成一个搜索框。开发者没有服务器，不收集统计、不做用户画像、不向开发者自有服务发送任何数据。

### 数据流向

1. **搜索词**：你在搜索框输入的关键词，会通过 HTTPS 发送到 `https://api.deepseek.com` 的搜索接口，用于取回搜索结果。
2. **鉴权信息**：上一步请求使用你自己填写的 DeepSeek API Key 鉴权，该 Key 作为请求头发送给同一个服务。
3. **网址**：当你点击某条结果的「查看正文」时，该结果的网址会发送到 `https://api.deepseek.com` 的抓取接口，用于取回页面正文。除这一次主动点击外，不发送任何网址。
4. **本地存储**：API Key 与搜索偏好（每页条数、是否附带正文）保存在浏览器本地存储中，只在本机，不同步、不上传。搜索结果缓存同样只保存在本地，10 分钟后失效，可在设置中随时清空。

### 第三方

DeepSeek（`api.deepseek.com`）按其自身隐私政策处理上述请求。除该服务外，本扩展不与任何第三方通信。

### 不收集

浏览历史、书签、位置、健康、财务、身份信息；不含分析代码、不含广告代码、不含远程代码。

### 删除数据

在扩展设置中点「清空缓存」可清除本地缓存；卸载扩展即删除包括 API Key 在内的全部本地数据。

### 联系方式

`2353799504@qq.com`

---

## English

Blue Whale Search is a browser extension that turns the new tab page into a search box. The developer operates no server, collects no analytics, builds no user profiles, and sends no data to any developer-owned service.

### Data flows

1. **Search terms** — the keywords you type are sent over HTTPS to `https://api.deepseek.com` to retrieve search results.
2. **Authentication information** — those requests are authenticated with the DeepSeek API key you provide, which is sent as a request header to the same service.
3. **Website URLs** — when you click "查看正文" (view page) on a result, that result's URL is sent to `https://api.deepseek.com` to retrieve the page text. No URL is sent other than from such an explicit click.
4. **Local storage** — your API key and preferences (page size, whether to include page text) are stored in the browser's local storage only, on your device. They are not synced or uploaded. Search results are cached locally for 10 minutes and can be cleared at any time.

### Third parties

DeepSeek (`api.deepseek.com`) processes these requests under its own privacy policy. Apart from that service, the extension communicates with no third party.

### Not collected

Browsing history, bookmarks, location, health, financial, or identity information. The extension contains no analytics, no advertising, and no remote code.

### Deleting your data

"Clear cache" in the settings removes local cached results; uninstalling the extension deletes all local data, including your API key.

### Contact

`2353799504@qq.com`
