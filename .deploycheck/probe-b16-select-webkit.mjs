/**
 * 第十六批(T 段)下拉修复的 **WebKit**(≈ iOS Safari 的引擎)验收。
 *
 * 为什么要单独跑一遍: 用户报的是**真机**"所有可选项都展不开, 只闪一层浅灰色"。
 * Chromium(桌面内核)在改前改后都**复现不出来** ⇒ 单靠 Chromium 的结论不足以收工。
 * WebKit 与 Chromium 在"触摸事件 → 兼容 mouse 事件"的合成规则、以及
 * `preventDefault()` 对后续事件的抑制上都有差异, 所以补一个引擎级的第二数据点。
 *
 * 判据(窄屏 390, hasTouch, 用**真实触摸** `touchscreen.tap`):
 *   ① 轻点控件 → 面板展开 **且选项真渲染**(≥1 个 .ng-option 可见 + 首项高 ≥20px);
 *   ② 再轻点 → 收起;
 *   ③ 展开后 0~600ms 每 40ms 采样,**不允许出现"已关闭"帧**(这才是"闪一下"的量化形式);
 *   ④ 连点两次的净效果必须是"关"(= 每次按下只 toggle 一次, 没有被合成事件二次触发);
 *   ⑤ 0 个 pageerror。
 *
 * 用法: node .deploycheck/probe-b16-select-webkit.mjs
 */
import { webkit } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import { BASE, ensureLoggedIn, goRoute, sleep } from "./b8-lib.mjs";

const browser = await webkit.launch({ headless: true });
console.log("BASE = " + BASE + "   engine = webkit");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
  ok ? pass++ : fail++;
};

const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 390, height: 844 },
  locale: "zh-CN",
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));

await ensureLoggedIn(page, ctx, { verbose: false });
await goRoute(page, "/settings/appearance");
await sleep(500);

const panel = () =>
  page.evaluate(() => {
    const ps = [...document.querySelectorAll("ng-dropdown-panel")];
    const vis = ps.filter((p) => {
      const cs = getComputedStyle(p);
      return (
        cs.display !== "none" &&
        cs.visibility !== "hidden" &&
        Number(cs.opacity) > 0.01 &&
        p.getClientRects().length > 0
      );
    });
    const p = vis[0];
    if (!p) return { open: false, n: 0, firstH: 0, text: null };
    const opts = [...p.querySelectorAll(".ng-option")].filter((o) => o.getClientRects().length > 0);
    return {
      open: true,
      n: opts.length,
      firstH: opts[0] ? Math.round(opts[0].getBoundingClientRect().height) : 0,
      text: opts[0] ? (opts[0].textContent || "").replace(/\s+/g, " ").trim().slice(0, 12) : null,
    };
  });

const box = async () => {
  const b = await page.locator("bit-select").first().locator(".ng-select-container").first().boundingBox();
  if (!b) throw new Error("量不到 bit-select");
  return b;
};
const reset = async () => {
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(250);
};

/* ---- 控件是否存在 ---- */
const n = await page.locator("bit-select").count();
check("页面上有 bit-select", n >= 1, `count=${n}`);
if (!n) {
  await browser.close();
  process.exit(1);
}
check("窄屏 narrow() 生效(输入框只读, 不弹键盘)", await page.evaluate(() => {
  const i = document.querySelector("bit-select input");
  return !i || i.readOnly === true || getComputedStyle(i).pointerEvents === "none";
}));

/* ---- ① 轻点 → 开 + 选项真渲染 ---- */
await reset();
let b = await box();
const y = b.y + b.height / 2;
await page.touchscreen.tap(b.x + b.width / 2, y);
await sleep(400);
let f = await panel();
check("① 轻点 → 面板展开", f.open, `选项=${f.n} 首个="${f.text}"`);
check("① 选项真的渲染出来了", f.n >= 1 && f.firstH >= 20, `选项=${f.n} 首项高=${f.firstH}px`);

/* ---- ② 再轻点 → 收起 ---- */
await page.touchscreen.tap(b.x + b.width / 2, y);
await sleep(400);
f = await panel();
check("② 再轻点 → 收起", !f.open);

/* ---- ③ 无"关闭帧" ---- */
await reset();
b = await box();
await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
const frames = [];
for (let i = 0; i < 15; i++) {
  await sleep(40);
  frames.push((await panel()).open ? "O" : ".");
}
const trace = frames.join("");
check("③ 展开后 0~600ms 无「关闭帧」", !trace.includes("."), `采样=${trace} O=开 .=关`);

/* ---- ④ 连点两次净效果 = 关 ---- */
await reset();
b = await box();
await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
await sleep(300);
await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
await sleep(400);
f = await panel();
check("④ 连点两次净效果 = 关(未被合成事件二次触发)", !f.open);

/* ---- ⑤ pageerror ---- */
check("⑤ 0 个 pageerror", errs.length === 0, errs.length ? errs[0] : "");

console.log(`\n===== WebKit 合计: ${pass} 通过 / ${fail} 失败 =====`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
