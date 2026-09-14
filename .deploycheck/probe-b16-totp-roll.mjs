/**
 * 第十六批(T 段)TOTP「升格」验收 —— 问题1: "到点后新主码上移居中并变蓝, 但上移过程中会先变成
 * 原主码, 然后闪一下才变成新主码"。
 *
 * 根因(已在源码里修掉): 升格动画的触发判据原来是"按时钟算窗口序号 step 变了", 而 step 用了
 * `Math.round(Date.now()/1000)`, 会在窗口边界**前最多 0.5s** 就翻页 ⇒ 动画拿着**旧码**先跑,
 * 等下一秒 SDK 把新码送来时才闪一下换掉。
 *
 * 本脚本的判定口径(不看动画好不好看, 只看"屏幕上那一行到底是哪个码"):
 *   ① 先在**升格前**抓地面真值: `digits`=旧码 C, `next`=新码 N(SDK 算的下一窗口码);
 *   ② 放慢升格(JS 300→3000ms, CSS 动画 3s), 等 `.warden-totp-rolling` 出现;
 *   ③ 逐帧(每 100ms)读三行文本, 断言:
 *      · **第一帧 digits 就已经是 N**(旧版这里还会是 C —— 这就是"闪一下"的量化形式);
 *      · 升格期间**任何一帧都不允许 ghost === digits**(两个可见码同时显示同一个码 = 那一瞬
 *        屏幕上主码还是旧码, 正是用户看到的"上移时先变成原主码"); 旧版前 4 帧 ghost==digits==C。
 *   ④ 收尾: 升格结束后 digits 仍应是 N, ghost 清空。
 *
 * 用法: node .deploycheck/probe-b16-totp-roll.mjs
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep } from "./b8-lib.mjs";

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 390, height: 844 },
  locale: "zh-CN",
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
console.log("BASE = " + BASE);
await ensureLoggedIn(page, ctx, { verbose: false });
await goRoute(page, "#/vault", "main#main-content", 20000);
await sleep(1200);

const badge = page.locator(".warden-totp-code").first();
await badge.scrollIntoViewIfNeeded().catch(() => {});
await sleep(200);

/** 三行文本 + rolling 标志 + 秒数。 */
const snap = () =>
  page.evaluate(() => {
    const b = document.querySelector(".warden-totp-code");
    if (!b) return null;
    const t = (sel) => (b.querySelector(sel)?.textContent || "").trim();
    return {
      rolling: b.classList.contains("warden-totp-rolling"),
      sec: (b.querySelector(".warden-totp-sec")?.textContent || "").trim(),
      ghost: t(".warden-totp-ghost"),
      digits: t(".warden-totp-digits"),
      next: t(".warden-totp-next"),
    };
  });

/* ---------- ① 抓升格前的地面真值 ---------- */
console.log("\n--- 抓升格前地面真值(等 sec ≤ 10 让次码可见) ---");
let pre = null;
for (let i = 0; i < 400; i++) {
  const s = await snap();
  if (s && !s.rolling && Number(s.sec) <= 10 && Number(s.sec) >= 4 && s.next) {
    pre = s;
    break;
  }
  await sleep(100);
}
if (!pre) {
  console.log("❌ 拿不到升格前真值(次码一直不可见?)");
  await browser.close();
  process.exit(1);
}
console.log(`  digits(旧码 C) = "${pre.digits}"   next(新码 N) = "${pre.next}"   sec=${pre.sec}`);
const C = pre.digits;
const N = pre.next;

/* ---------- ② 放慢升格 ---------- */
await page.evaluate(() => {
  const orig = window.setTimeout;
  window.setTimeout = function (fn, ms, ...rest) {
    return orig.call(window, fn, ms === 300 ? 3000 : ms, ...rest);
  };
});
await page.evaluate(() => {
  for (const r of document.querySelectorAll(".warden-totp-row")) {
    r.style.animationDuration = "3s";
  }
});

console.log("\n--- 等升格 ---");
await page.waitForFunction(
  () => document.querySelector(".warden-totp-code")?.classList.contains("warden-totp-rolling"),
  null,
  { timeout: 40000, polling: 20 },
);

/* ---------- ③ 逐帧判定 ---------- */
const frames = [];
for (let i = 0; i < 14; i++) {
  frames.push(await snap());
  await sleep(100);
}

console.log("\n帧  sec  ghost(旧)        digits(主)       next(次)        rolling");
frames.forEach((f, i) => {
  console.log(
    `f${String(i).padStart(2)}  ${String(f.sec).padStart(2)}   ` +
      `${JSON.stringify(f.ghost).padEnd(15)} ${JSON.stringify(f.digits).padEnd(15)} ` +
      `${JSON.stringify(f.next).padEnd(15)} ${f.rolling}`,
  );
});

const settle = await page.evaluate(() => new Promise((r) => setTimeout(r, 3200))).then(snap);

/* ---------- 判定 ---------- */
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
  ok ? pass++ : fail++;
};

console.log("");
const f0 = frames[0];
check("① 升格第一帧主码就是新码 N", f0.digits === N, `f0.digits="${f0.digits}" N="${N}"`);
check("① 升格第一帧 ghost 是旧码 C", f0.ghost === C, `f0.ghost="${f0.ghost}" C="${C}"`);

const bad = frames
  .map((f, i) => ({ f, i }))
  .filter(({ f }) => f.ghost && f.digits && f.ghost === f.digits)
  .map(({ i }) => i);
check(
  "② 升格期间无「ghost === digits」帧(不再显示原主码)",
  bad.length === 0,
  bad.length ? `命中帧 f${bad.join(", f")}` : `14 帧全过`,
);

const oldOnMain = frames
  .map((f, i) => ({ f, i }))
  .filter(({ f }) => f.digits === C)
  .map(({ i }) => i);
check(
  "③ 升格期间主码行从未退回旧码 C",
  oldOnMain.length === 0,
  oldOnMain.length ? `命中帧 f${oldOnMain.join(", f")}` : "14 帧全过",
);

check("④ 升格结束后主码仍为新码 N", settle.digits === N, `settle.digits="${settle.digits}"`);
check("④ 升格结束后 ghost 已清空", settle.ghost === "", `settle.ghost="${settle.ghost}"`);

console.log(`\n===== 合计: ${pass} 通过 / ${fail} 失败 =====`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
