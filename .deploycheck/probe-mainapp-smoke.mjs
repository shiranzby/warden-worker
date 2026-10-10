// 一次性冒烟：确认本次部署没有影响密码库主应用（新增路由/静态目录都是**增量**，
// 但仍要证明"登录页能开、/api/config 与 /api/now 正常、控制台无报错"）。
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";

const BASE = "https://shypwd.cc.cd";
let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  console.log("  " + (ok ? "✅" : "❌") + " " + n + (d ? "  " + d : ""));
  ok ? pass++ : fail++;
};

const browser = await chromium.launch({
  headless: true,
  executablePath:
    "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe",
  proxy: { server: "http://127.0.0.1:7890", bypass: "localhost,127.0.0.1" },
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, locale: "zh-CN",
  viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 160)));

const api = {};
page.on("response", (r) => {
  const u = r.url();
  for (const k of ["/api/config", "/api/now"]) {
    if (u.includes(k) && !(k in api)) api[k] = r.status();
  }
});

console.log("");
console.log("[主应用冒烟] " + BASE);
const resp = await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
check("首页 200", resp && resp.status() === 200, "http=" + (resp ? resp.status() : "?"));

const mounted = await page
  .waitForSelector("app-root, #app", { timeout: 25000 })
  .then(() => true)
  .catch(() => false);
check("Angular 根组件挂载", mounted, "");

const vp = await page.evaluate(() => {
  const m = document.querySelector('meta[name="viewport"]');
  return m ? m.getAttribute("content") : null;
});
check("viewport 是 device-width（我们的前端定制仍在）", !!vp && /device-width/.test(vp), String(vp));

const css = await page.evaluate(async () => {
  const r = await fetch("/css/vaultwarden.css", { cache: "no-store" });
  return { status: r.status, len: (await r.text()).length };
});
check("/css/vaultwarden.css 可达且非空", css.status === 200 && css.len > 1000, JSON.stringify(css));

// ⚠️ 别用"固定 sleep 之后直接断言" —— 5MB 主包经代理加载后首屏会晚几秒，
// 上一版就是这样误报"没落在登录页 / 没请求 /api/config"。改成轮询到状态出现为止。
let hash = "";
for (let i = 0; i < 60; i++) {
  hash = await page.evaluate(() => location.hash);
  if (/#\/(login|lock|start|vault)/.test(hash)) break;
  await new Promise((r) => setTimeout(r, 400));
}
const isLogin = /#\/(login|lock|start)/.test(hash) ||
  (await page.evaluate(() => !!document.querySelector("input[type=password], input#email")));
check("落在登录/锁屏页（未登录态符合预期）", isLogin, "hash=" + hash);

for (let i = 0; i < 40 && !("/api/config" in api); i++) {
  await new Promise((r) => setTimeout(r, 400));
}
check("GET /api/config 200", api["/api/config"] === 200, "http=" + api["/api/config"]);
// ⚠️ 前端**从不**调用 /api/now（本项目手册 §13.5 已记：apps/web 与 libs 里零命中），
// 所以这里必须**主动**请求，而不是等页面自己发。上一版把它当成页面的请求 = 探针写错了。
const nowResp = await page.evaluate(async () => {
  const r = await fetch("/api/now", { cache: "no-store" });
  return { status: r.status, body: (await r.text()).slice(0, 40) };
});
check("GET /api/now 200（主动请求）", nowResp.status === 200 && /^"?\d{4}-\d{2}-\d{2}T/.test(nowResp.body),
  JSON.stringify(nowResp));
check("0 个控制台错误", errs.length === 0, errs.length ? errs.slice(0, 2).join(" | ") : "0 条");

// 旧的管理入口（如果有）不该被我们的 /admin/ 抢走 —— 记录一下现状
const adminProbe = await page.evaluate(async () => {
  const r = await fetch("/admin", { redirect: "manual", cache: "no-store" });
  return { status: r.status, type: r.type, url: r.url };
});
console.log("    （参考）/admin 无斜杠 -> " + JSON.stringify(adminProbe));

await browser.close();
console.log("");
console.log("结果: " + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
