/**
 * AA 段探针的**侦察**脚本: 只做一件事 —— 把"能不能走到备注框"这条路上的 DOM 全打印出来。
 *
 * 起因: `probe-aa22-notes.mjs` 第一版在测试通道上登录成功(#/vault), 但
 *   ① 找不到 `tr[appvaultcipherrow] td:last-child button[aria-label="选项"]`;
 *   ② 点了「新增」→「登录」之后也没有 `textarea[formcontrolname="notes"]`。
 * 与其猜, 不如把每一步的按钮/浮层/textarea 清单打出来。
 *
 * ⚠️ 一个脚本只登录一次(服务端对短时间重复登录限流)。
 * ⚠️ 本机直连 Cloudflare 边缘被 TLS reset ⇒ 浏览器挂 7890 代理(见 probe-aa22-notes.mjs)。
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import { BASE, CHROME, UA, ensureLoggedIn, goRoute, sleep, SHOTS } from "./b8-lib.mjs";

const PROXY = /localhost|127\.0\.0\.1/.test(BASE) ? "" : "http://127.0.0.1:7890";
const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  proxy: PROXY ? { server: PROXY, bypass: "localhost,127.0.0.1" } : undefined,
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  userAgent: UA,
  locale: "zh-CN",
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();
console.log("BASE = " + BASE);

const dump = async (label) => {
  const d = await page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 0 && e.getClientRects().length > 0;
    const label_ = (e) =>
      (
        (e.getAttribute("aria-label") || "") +
        "|" +
        (e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 26)
      ).slice(0, 46);
    return {
      hash: location.hash,
      hiddenBody: document.body.className.includes("tw-overflow-hidden"),
      overlays: document.querySelectorAll(".cdk-overlay-container > *").length,
      backdrops: document.querySelectorAll(".cdk-overlay-backdrop").length,
      dialogs: document.querySelectorAll("bit-dialog").length,
      tables: document.querySelectorAll("main#main-content table").length,
      theadTh: document.querySelectorAll("main#main-content table thead th").length,
      cipherRows: document.querySelectorAll("tr[appvaultcipherrow]").length,
      anyRows: document.querySelectorAll("main#main-content tbody tr").length,
      textareas: [...document.querySelectorAll("textarea")].map((t) => ({
        fc: t.getAttribute("formcontrolname"),
        rows: t.getAttribute("rows"),
        vis: vis(t),
        h: Math.round(t.getBoundingClientRect().height),
        inDialog: !!t.closest("bit-dialog"),
      })),
      rowButtons: (() => {
        const r = document.querySelector("tr[appvaultcipherrow]");
        if (!r) return null;
        return [...r.querySelectorAll("button, a")].map(label_);
      })(),
      visibleButtons: [...document.querySelectorAll("button, a, [role='menuitem']")]
        .filter(vis)
        .map(label_)
        .slice(0, 60),
    };
  });
  console.log(`\n---------- ${label} ----------`);
  console.log(JSON.stringify(d, null, 1));
  await page.screenshot({ path: `${SHOTS}/aa22-diag-${label.replace(/[^\w-]/g, "_")}.png` });
};

await ensureLoggedIn(page, ctx, { verbose: true });
await dump("00-after-login");

await goRoute(page, "#/vault", "main#main-content", 20000);
await sleep(2500);
await dump("01-vault-1440");

console.log("\n>>> 点「新增」");
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button, a")].find(
    (e) => /^新增$/.test((e.textContent || "").trim()) && e.getBoundingClientRect().width > 0,
  );
  if (b) b.click();
});
await sleep(1500);
await dump("02-after-new-click");

console.log("\n>>> 点「登录」");
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button, a, [role='menuitem']")].find(
    (e) => /^\s*登录\s*$/.test((e.textContent || "").trim()) && e.getBoundingClientRect().width > 0,
  );
  if (b) b.click();
  return !!b;
});
await sleep(3000);
await dump("03-after-login-click");

console.log("\n>>> 再等 3s(排查是否只是慢)");
await sleep(3000);
await dump("04-later");

await browser.close();
