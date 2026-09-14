/**
 * 第十六批(T 段)下拉**修复后**验收探针。
 *
 * 背景: 第十五批的验收只断"面板出现 + 有高度", 没断"选项真渲染出来", 结果空洞通过;
 * 而本轮真正改的是**事件路径**(删掉 `<ng-select>` 外面的兄弟按钮 `.warden-select-open`,
 * 改成包装 div 上的 `(pointerdown)="onFieldPointerdown($event)"`, 且**只接管窄屏**)。
 * 所以验收必须钉住这几条, 少一条都不算过:
 *
 *   窄屏(390, hasTouch):
 *     ① 轻点控件 → 面板开, 且**选项真渲染**(≥1 个 .ng-option 可见 + 首个选项高≥20px);
 *     ② 再轻点 → 面板**收起**(searchable=false 时原生就是 toggle(), 用户明确要这个);
 *     ③ "闪一下"回归守卫: 开面板后 0~600ms **每 40ms** 采一次, 不允许中途出现"已关闭"帧;
 *        —— 这正是用户报的"只在方框下面出现浅灰色一层就没了"的量化形式;
 *     ④ 点最右侧 15px(箭头带)也要开。
 *
 *   宽屏(1280, 鼠标): 桌面行为必须一字未变 ——
 *     ⑤ 点输入框 → 开, 且**输入框可聚焦**;
 *     ⑥ 在输入框里打字 → 选项被过滤(searchable 没有被我们掐掉);
 *     ⑦ 点可见三角(.ng-arrow) → 开, 且**保持开着**(不能开完立刻被 handleArrowClick 关掉);
 *     ⑧ 点面板外空白 → 正常收起。
 *
 * 用法: node .deploycheck/probe-b16-select-postfix.mjs
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep } from "./b8-lib.mjs";

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
console.log("BASE = " + BASE);

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
  ok ? pass++ : fail++;
};

/** 面板读数: 面板在不在、可见不可见、选项渲染了几个、首个多高。 */
const panel = (page) =>
  page.evaluate(() => {
    const ps = [...document.querySelectorAll("ng-dropdown-panel")];
    const visible = ps.filter((p) => {
      const cs = getComputedStyle(p);
      return (
        cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.01 && p.getClientRects().length > 0
      );
    });
    const p = visible[0];
    if (!p) return { open: false, n: 0, firstH: 0, firstText: null, top: null, h: null };
    const opts = [...p.querySelectorAll(".ng-option")].filter((o) => o.getClientRects().length > 0);
    const r = p.getBoundingClientRect();
    return {
      open: true,
      n: opts.length,
      firstH: opts[0] ? Math.round(opts[0].getBoundingClientRect().height) : 0,
      firstText: opts[0] ? (opts[0].textContent || "").replace(/\s+/g, " ").trim().slice(0, 12) : null,
      top: Math.round(r.top),
      h: Math.round(r.height),
    };
  });

const box = async (page) => {
  const el = page.locator("bit-select").first().locator(".ng-select-container").first();
  const b = await el.boundingBox();
  if (!b) throw new Error("量不到 bit-select");
  return b;
};

const reset = async (page) => {
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(250);
};

/* ===================== 窄屏 ===================== */
{
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    locale: "zh-CN",
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await ensureLoggedIn(page, ctx, { verbose: false });
  await goRoute(page, "/settings/appearance");
  await sleep(400);

  console.log("\n########## 窄屏 390  (hasTouch, narrow()=true)");
  await reset(page);
  let b = await box(page);
  const y = b.y + b.height / 2;

  // ① 轻点正中 → 开 + 选项真渲染
  await page.touchscreen.tap(b.x + b.width / 2, y);
  await sleep(350);
  let f = await panel(page);
  check("① 轻点控件 → 面板展开", f.open, `h=${f.h} 选项=${f.n} 首个="${f.firstText}"`);
  check("① 选项真的渲染出来了", f.n >= 1 && f.firstH >= 20, `选项=${f.n} 首项高=${f.firstH}px`);

  // ② 再轻点 → 收起
  await page.touchscreen.tap(b.x + b.width / 2, y);
  await sleep(350);
  f = await panel(page);
  check("② 再轻点 → 面板收起(用户要的 toggle)", !f.open);

  // ③ 闪一下回归守卫: 每 40ms 采一次, 不允许出现"关闭帧"
  await reset(page);
  b = await box(page);
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  const frames = [];
  for (let i = 0; i < 15; i++) {
    await sleep(40);
    const s = await panel(page);
    frames.push(s.open ? "O" : ".");
  }
  const trace = frames.join("");
  check("③ 展开后 0~600ms 无「关闭帧」(不再是闪一下)", !trace.includes("."), `采样=${trace} O=开 .=关`);

  // ④ 箭头带(最右 15px)
  await reset(page);
  b = await box(page);
  await page.touchscreen.tap(b.x + b.width - 15, b.y + b.height / 2);
  await sleep(350);
  f = await panel(page);
  check("④ 点最右 15px(箭头带)也能展开", f.open, `h=${f.h} 选项=${f.n}`);
  await reset(page);

  await ctx.close();
}

/* ===================== 宽屏 ===================== */
{
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
    locale: "zh-CN",
  });
  const page = await ctx.newPage();
  await ensureLoggedIn(page, ctx, { verbose: false });
  await goRoute(page, "/settings/appearance");
  await sleep(400);

  console.log("\n########## 宽屏 1280  (鼠标, narrow()=false)");
  await reset(page);
  let b = await box(page);

  // ⑤ 点输入框 → 开 + 输入框可聚焦
  await page.mouse.click(b.x + 40, b.y + b.height / 2);
  await sleep(350);
  let f = await panel(page);
  const focused = await page.evaluate(() => {
    const a = document.activeElement;
    return a ? a.tagName + (a.classList.contains("ng-input") ? "" : "") : "null";
  });
  check("⑤ 点输入框 → 展开", f.open, `h=${f.h} 选项=${f.n}`);
  const isInputFocused = await page.evaluate(() => document.activeElement?.tagName === "INPUT");
  check("⑤ 输入框仍可聚焦(没被掐掉焦点)", isInputFocused, `activeElement=${focused}`);

  // ⑥ 打字过滤 → 选项数下降
  const before = f.n;
  const input = page.locator("bit-select").first().locator("input").first();
  await input.fill("浅").catch(async () => {
    await page.keyboard.type("浅");
  });
  await sleep(400);
  f = await panel(page);
  check("⑥ 输入框打字仍能过滤(searchable 保留)", f.open && f.n >= 1 && f.n <= before, `过滤前=${before} 过滤后=${f.n}`);

  // ⑦ 点可见三角 → 开且保持开着
  await reset(page);
  const arrow = await page.evaluate(() => {
    const a = document.querySelector("bit-select .ng-arrow");
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!arrow) {
    check("⑦ 找得到 .ng-arrow", false);
  } else {
    await page.mouse.click(arrow.x, arrow.y);
    await sleep(400);
    f = await panel(page);
    check("⑦ 点三角 → 展开且不回弹", f.open, `h=${f.h} 选项=${f.n}`);
  }

  // ⑧ 点面板外 → 收起
  await page.mouse.click(20, 400);
  await sleep(400);
  f = await panel(page);
  check("⑧ 点面板外空白 → 正常收起", !f.open);

  await ctx.close();
}

console.log(`\n===== 合计: ${pass} 通过 / ${fail} 失败 =====`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
