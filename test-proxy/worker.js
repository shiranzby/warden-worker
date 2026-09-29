/**
 * shytest.cc.cd 的**测试用** Worker —— 只做两件事，不碰生产。
 *
 *   ① 静态资源：直接发 `../vw_web_builds/apps/web/build`（`warden-design-proto` 分支构建出来的
 *      新版前端），由 wrangler 的 `[assets]` 绑定提供；
 *   ② 后端：把 `/api/*`、`/identity/*`、`/notifications/*` **反向代理**到线上
 *      `https://shypwd.cc.cd`。
 *
 * 为什么要反代而不是再部署一份后端：
 *   · 后端是 Rust→WASM，本地重建要装整套 cargo/wasm 工具链（几分钟起）；
 *   · 而且我们的测试目的只是**前端 UI**，后端逻辑一行没改；
 *   · 反代到线上同时意味着测试环境用的是**真实数据**（同一个 D1），能立刻看出问题。
 *
 * ⚠️ 这是**临时测试通道**，不是生产架构：生产是 `push-cloudflare.yaml` 按 artifact 名反查、
 *    把前端打进 `public/web-vault` 与 Worker 一起发布。这里只是为了"先看到新 UI"。
 * ⚠️ WebSocket（`/notifications/hub`）能不能透传取决于 Cloudflare 的边缘行为，
 *    最坏情况是实时同步不工作（页面仍可用），MVP 阶段可接受。
 */

const UPSTREAM = "https://shypwd.cc.cd";
const PROXY_PREFIXES = ["/api/", "/identity/", "/notifications/"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (PROXY_PREFIXES.some((p) => url.pathname.startsWith(p))) {
      const target = new URL(request.url);
      target.protocol = "https:";
      target.host = new URL(UPSTREAM).host;

      const headers = new Headers(request.headers);
      headers.set("Host", target.host);

      return fetch(
        new Request(target.toString(), {
          method: request.method,
          headers,
          body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
          redirect: "manual",
        }),
      );
    }

    return env.ASSETS.fetch(request);
  },
};
