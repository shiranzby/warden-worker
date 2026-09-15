/**
 * Z 段(设计系统底座) 冒烟: 确认设计系统真的挂上了、且没有把移动端改坏。
 *   node .deploycheck/probe-z22-smoke.mjs
 *   RECON_W=390 RECON_H=844 node .deploycheck/probe-z22-smoke.mjs
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep, SHOTS } from "./b8-lib.mjs";

const PROXY = process.env.WARDEN_TEST_PROXY || "";
const W = Number(process.env.RECON_W || 1280);
const H = Number(process.env.RECON_H || 860);
const OUT = path.join(SHOTS, `z22-${W}x${H}`);
fs.mkdirSync(OUT, { recursive: true });

let pass = 0,
  fail = 0;
const check = (n, ok, d = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? "  " + d : ""}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch({
  headless: true, executablePath: CHROME, ...(PROXY ? { proxy: { server: PROXY } } : {}),
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true, viewport: { width: W, height: H }, locale: "zh-CN",
  ...(W <= 768 ? { isMobile: true, hasTouch: true } : {}),
});
const page = await ctx.newPage();
await ensureLoggedIn(page, ctx, { verbose: false });
console.log(`BASE=${BASE} ${W}x${H}`);
const shot = (n) => page.screenshot({ path: path.join(OUT, n) });

await goRoute(page, "/vault", "app-vault", 25000).catch(() => {});
await sleep(3000);

const probe = await page.evaluate(() => {
  const g = (v, el = document.documentElement) => getComputedStyle(el).getPropertyValue(v).trim();
  const sheetOk = [...document.styleSheets].some((s) => (s.href || "").includes("warden-design.css"));
  const body = document.body;
  return {
    wdOnBody: body.classList.contains("wd"),
    designSheetLoaded: sheetOk,
    tokenBg: g("--bg"),
    tokenAccent: g("--accent"),
    bodyBg: getComputedStyle(body).backgroundColor,
    bodyFont: getComputedStyle(body).fontFamily.slice(0, 40),
    brand: g("--color-primary-600"),
    textMain: g("--color-text-main"),
    // 设计系统的组件类是否可命中(用一个临时节点试)
    cardPad: (() => {
      const d = document.createElement("div");
      d.className = "card";
      d.style.position = "absolute";
      d.style.left = "-9999px";
      document.body.appendChild(d);
      const cs = getComputedStyle(d);
      const r = { pad: cs.paddingTop + "/" + cs.paddingLeft, radius: cs.borderTopLeftRadius };
      d.remove();
      return r;
    })(),
  };
});
console.log("  " + JSON.stringify(probe, null, 1));
await shot("01-vault-light.png");

check("设计系统已加载(css/warden-design.css)", probe.designSheetLoaded);
check("body 带上了作用域类 wd", probe.wdOnBody);
check("设计系统 token 生效(--bg 有值)", /^#|rgb/.test(probe.tokenBg), probe.tokenBg);
check("应用变量已跟随设计 token(--color-primary-600 不再是 Bitwarden 蓝 18 82 163)",
  probe.brand !== "18 82 163", `brand=${probe.brand}`);
check("卡片规范已接管(body.wd .card 内边距 = 20px/r18)",
  probe.cardPad.pad === "20px/20px" && probe.cardPad.radius === "18px",
  JSON.stringify(probe.cardPad));

// 深色
await page.evaluate(() => {
  document.documentElement.classList.remove("theme_light");
  document.documentElement.classList.add("theme_dark");
});
await sleep(800);
const dark = await page.evaluate(() => ({
  bg: getComputedStyle(document.body).backgroundColor,
  tokenBg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
  accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
}));
console.log("  深色: " + JSON.stringify(dark));
await shot("02-vault-dark.png");
check("深色模式 token 已桥接(--bg 变黑)", dark.tokenBg === "#000000", dark.tokenBg);
check("深色模式 accent 变 #2997ff", dark.accent === "#2997ff", dark.accent);

await page.evaluate(() => {
  document.documentElement.classList.remove("theme_dark");
  document.documentElement.classList.add("theme_light");
});
await goRoute(page, "/settings/account", undefined, 25000).catch(() => {});
await sleep(2500);
await shot("03-settings.png");

console.log(`\n================ ${pass} 通过 / ${fail} 失败 ================`);
console.log(`截图目录: ${OUT}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
