/**
 * 第十六批 TOTP「逐帧看」 —— 问题1 只有把动画**放慢**再截图才看得出用户到底看到了什么。
 *
 * 做法(只影响这次观测, 不改产品行为):
 *   ① 页面里把 `setTimeout` 的 300ms(= 组件的 ROLL_MS) 拉长到 3000ms;
 *   ② 同时把 CSS 里两个 keyframes 的 animation-duration 也拉成 3s(否则动画早跑完了);
 *   ③ 于是"升格"那一幕变成 3 秒, 可以每 250ms 截一张徽章图, 看清每一帧。
 *
 * 用法: node .deploycheck/probe-b16-totp-frames.mjs
 * 产物: .deploycheck/shots/f0..f11-totp.png
 */
import { mkdirSync } from "node:fs";
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep } from "./b8-lib.mjs";

const DIR = "F:/WorkSpace/Workbuddy/Github项目分析部署/warden-worker/.deploycheck/shots";
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 390, height: 844 },
  locale: "zh-CN",
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
});
const page = await ctx.newPage();
console.log("BASE = " + BASE);
await ensureLoggedIn(page, ctx, { verbose: false });
await goRoute(page, "#/vault", "main#main-content", 20000);
await sleep(1500);

/* 放慢: JS 侧 ROLL_MS(300) → 3000 */
await page.evaluate(() => {
  const orig = window.setTimeout;
  window.setTimeout = function (fn, ms, ...rest) {
    return orig.call(window, fn, ms === 300 ? 3000 : ms, ...rest);
  };
});
/* CSS 侧把两个 keyframes 也拉成 3s。
   ⚠️ 不能用 page.addStyleTag —— 应用的 CSP `style-src` 没有 unsafe-inline, 内联样式会被拦:
   `page.addStyleTag: Applying inline style violates ... Content Security Policy directive 'style-src'`。
   而**CSSOM 写元素内联样式不受 CSP 限制**(组件自己的 applyGeometry 就靠这个), 所以直接改元素 style。 */
await page.evaluate(() => {
  for (const r of document.querySelectorAll(".warden-totp-row")) {
    r.style.animationDuration = "3s";
  }
  for (const f of document.querySelectorAll(".warden-totp-fill-a, .warden-totp-fill-b")) {
    f.style.transitionDuration = "3s";
  }
});

const badge = page.locator(".warden-totp-code").first();
await badge.scrollIntoViewIfNeeded().catch(() => {});
await sleep(200);

const facts = () =>
  page.evaluate(() => {
    const b = document.querySelector(".warden-totp-code");
    if (!b) return null;
    return {
      cls: b.className.replace("warden-totp-code", "").trim(),
      sec: (document.querySelector(".warden-totp-sec") || {}).textContent?.trim(),
      rows: [...b.querySelectorAll(".warden-totp-row")].map((r) => {
        const cs = getComputedStyle(r);
        const bb = r.getBoundingClientRect();
        return `${r.className.replace("warden-totp-row", "").trim()} y=${Math.round(bb.top)} h=${Math.round(bb.height)} op=${(+cs.opacity).toFixed(2)} col=${cs.color} "${(r.textContent || "").trim()}"`;
      }),
    };
  });

// 等"升格"开始(轮询页面里的 class, 别等 sec, 因为 sec 的跳变和 class 不同步)
console.log("等待升格…");
await page.waitForFunction(
  () => document.querySelector(".warden-totp-code")?.classList.contains("warden-totp-rolling"),
  null,
  { timeout: 40000, polling: 20 },
);
console.log("升格开始, 开始逐帧截图(3 秒窗口, 每 250ms 一张)");
for (let i = 0; i < 11; i++) {
  const f = await facts();
  console.log(` f${i} ${f ? JSON.stringify(f) : "(无徽章)"}`);
  await badge.screenshot({ path: `${DIR}/f${i}-totp.png` }).catch((e) => console.log("  截图失败 " + e.message));
  await sleep(250);
}
await browser.close();
