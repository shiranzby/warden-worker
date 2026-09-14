/**
 * J15 的运行期验证: 窄屏下下拉面板躲开软键盘。
 *
 * 用法: node .deploycheck/verify-j15.mjs     默认 https://localhost:8099
 *
 * ## 判据怎么来的
 *
 * 无头浏览器**没有软键盘**, 但"键盘把面板盖住"的可测量形式是
 * `window.visualViewport.height` 缩小 —— 所以这里注入一个**伪造的 visualViewport**:
 * 它是个真实 `EventTarget`(原生 addEventListener/removeEventListener/dispatchEvent 都在),
 * 只是 height/offsetTop 可写; `__kb(h)` 改值后派发 resize+scroll, 等价于"键盘弹起"。
 *
 * 断言的是**几何**: 面板矩形必须整体落在可见区内, 且方向选对了 ——
 *   · 字段下方空间不够 ⇒ 面板必须翻到字段**上方**;
 *   · 下方够 ⇒ 留在下方, 且底边不越过键盘线。
 * 只断言"position === fixed"是不够的: 面板仍可能被放到键盘后面。
 *
 * 另外单独验一条**负向**: 桌面(1280)不得接管 —— 那里没有软键盘, 一旦接管就改变了原生定位。
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import path from "node:path";
import { BASE, CHROME, SHOTS, sleep, ensureLoggedIn, goRoute } from "./b8-lib.mjs";

const APPEARANCE = "#/settings/appearance";

const results = [];
const ck = (name, ok, extra) => {
  results.push({ name, ok: !!ok });
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name}${extra !== undefined ? "  " + JSON.stringify(extra) : ""}`,
  );
};

/** 注入伪造的 visualViewport(必须在应用启动前)。 */
const FAKE_VV = () => {
  const vv = new EventTarget();
  const st = { width: 375, height: window.innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1 };
  for (const k of Object.keys(st)) {
    Object.defineProperty(vv, k, { get: () => st[k], configurable: true });
  }
  Object.defineProperty(window, "visualViewport", { get: () => vv, configurable: true });
  /** 模拟软键盘: 把可见区压到 h(可选下移 top), 并派发两组事件(真机两者都会发)。 */
  window.__kb = (h, top = 0) => {
    st.height = h;
    st.offsetTop = top;
    vv.dispatchEvent(new Event("resize"));
    vv.dispatchEvent(new Event("scroll"));
  };
};

const SELECTOR = 'bit-select#theme ng-select';

/** 打开下拉并读回面板的几何 + 行内样式。 */
async function openAndMeasure(page) {
  await page.evaluate((sel) => {
    document.querySelector(sel).scrollIntoView({ block: "center" });
  }, SELECTOR);
  await sleep(400);

  await page.click(SELECTOR);
  await sleep(600);

  return page.evaluate((sel) => {
    const host = document.querySelector(sel);
    const panel = document.querySelector(".ng-dropdown-panel");
    if (!host || !panel) {
      return { err: !host ? "找不到 ng-select" : "面板没打开" };
    }
    const f = host.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const cs = getComputedStyle(panel);
    const items = panel.querySelector(".ng-dropdown-panel-items");
    return {
      field: { top: +f.top.toFixed(1), bottom: +f.bottom.toFixed(1), left: +f.left.toFixed(1), width: +f.width.toFixed(1) },
      panel: { top: +p.top.toFixed(1), bottom: +p.bottom.toFixed(1), left: +p.left.toFixed(1), width: +p.width.toFixed(1), height: +p.height.toFixed(1) },
      pos: cs.position,
      inline: {
        pos: panel.style.position,
        top: panel.style.top,
        left: panel.style.left,
        width: panel.style.width,
        bottom: panel.style.bottom,
        maxHeight: panel.style.maxHeight,
      },
      itemsMaxHeight: items ? items.style.maxHeight : null,
      vvHeight: window.visualViewport.height,
      vvOffsetTop: window.visualViewport.offsetTop,
      innerHeight: window.innerHeight,
      matchDesktop: window.matchMedia("(min-width: 769px)").matches,
    };
  }, SELECTOR);
}

const closePanel = async (page) => {
  await page.keyboard.press("Escape");
  await sleep(400);
};

/* ============================ 启动 ============================ */
console.log(`\n===== J15 验证(下拉面板躲软键盘) 目标: ${BASE} =====`);

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 375, height: 812 },
  locale: "zh-CN",
});
await ctx.addInitScript(FAKE_VV);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("   [pageerror]", String(e).slice(0, 200)));

console.log("\n[登录]");
console.log("   " + (await ensureLoggedIn(page, ctx)));

console.log("\n① 窄屏 375 —— 接管后仍紧贴字段且不出格");
/*
 * ⚠️ 这里**不**断言"无键盘时保持 ng-select 原生定位" —— 那是错的。
 * 本实现(与 L4 §8.5 同口径)在窄屏下**一律接管**, 判定只看断点(768px), 不看键盘弹没弹:
 *   ① 键盘弹起时 visualViewport 的缩小量在各家浏览器上不一致(有的缩 layout, 有的只缩 visual),
 *      把"是否接管"挂在它上面会在部分 Android 上静默失效 —— 那正是最需要它的场景;
 *   ② 窄屏下由我们自己算上下两侧可用空间, 是 ng-select 原生行为的**超集**
 *      (原生按 layout 视口算, iOS 上 URL 栏那一截会被算成可用空间)。
 * 真正该守的不变量是几何: 面板必须紧贴字段 + 完整落在可见区内。桌面不接管由 ④ 单独守。
 */
await goRoute(page, APPEARANCE, SELECTOR);
const base = await openAndMeasure(page);
if (base.err) {
  console.log(`  ❌ ${base.err}`);
  await browser.close();
  process.exit(2);
}
ck(
  "窄屏接管后: 面板紧贴字段且完整落在可见区内",
  base.pos === "fixed" &&
    base.panel.top >= -0.5 &&
    base.panel.bottom <= base.vvHeight + 0.5 &&
    (Math.abs(base.panel.top - base.field.bottom) <= 10 ||
      Math.abs(base.panel.bottom - base.field.top) <= 10),
  { 面板: [base.panel.top, base.panel.bottom], 字段: [base.field.top, base.field.bottom], 可见区高: base.vvHeight },
);
ck("伪造可见区初始等于布局视口", base.vvHeight === base.innerHeight, {
  vv: base.vvHeight,
  inner: base.innerHeight,
});

console.log("\n② 键盘弹起 —— 下方空间不够, 必须翻到字段上方");
/* 把可见区压到"字段底边之下 20px": 下方可用 = 20-6-8 = 6 ⇒ 必须向上展开。 */
await page.evaluate((h) => window.__kb(h), base.field.bottom + 20);
await sleep(600);
const up = await openAndMeasure(page);
ck(
  "面板改为 fixed 且完全落在可见区内",
  up.pos === "fixed" &&
    up.panel.top >= -0.5 &&
    up.panel.bottom <= up.vvHeight + 0.5,
  { pos: up.pos, 面板: [up.panel.top, up.panel.bottom], 可见区高: up.vvHeight },
);
ck(
  "空间不够时翻到字段**上方**(面板底 <= 字段顶)",
  up.panel.bottom <= up.field.top + 0.5,
  { 面板底: up.panel.bottom, 字段顶: up.field.top },
);
ck(
  "行内只写 top、bottom 归 auto (fixed 的 bottom 参照布局视口, 会正好落到键盘后)",
  up.inline.top !== "" && up.inline.bottom === "auto",
  { top: up.inline.top, bottom: up.inline.bottom },
);
ck(
  "宽度与左沿对齐字段",
  Math.abs(up.panel.width - up.field.width) <= 1 && Math.abs(up.panel.left - up.field.left) <= 1,
  { 面板: [up.panel.left, up.panel.width], 字段: [up.field.left, up.field.width] },
);
ck(
  "列表容器也按可用高度收窄(否则内容溢出面板)",
  up.itemsMaxHeight != null && parseFloat(up.itemsMaxHeight) > 0,
  { itemsMaxHeight: up.itemsMaxHeight, 面板maxHeight: up.inline.maxHeight },
);

console.log("\n③ 键盘较低、下方够 —— 留在下方且不越过键盘线");
await closePanel(page);
/* 可见区留 700px 高: 字段在页面中段, 下方足够 ⇒ 应当向下展开。 */
await page.evaluate(() => window.__kb(700));
await sleep(300);
const down = await openAndMeasure(page);
ck(
  "下方够时留在字段下方",
  down.pos === "fixed" && down.panel.top >= down.field.bottom - 0.5,
  { 面板顶: down.panel.top, 字段底: down.field.bottom },
);
ck(
  "面板底边不越过键盘线",
  down.panel.bottom <= down.vvHeight + 0.5,
  { 面板底: down.panel.bottom, 键盘线: down.vvHeight },
);

console.log("\n④ 负向: 桌面 1280 不得接管");
await closePanel(page);
await page.setViewportSize({ width: 1280, height: 900 });
await sleep(1200);
await page.evaluate(() => window.__kb(900));
await sleep(300);
const desk = await openAndMeasure(page);
ck(
  "桌面端(>=769px)保持原生定位, 一行都不碰",
  desk.pos === "absolute" && desk.inline.pos !== "fixed" && desk.matchDesktop === true,
  { pos: desk.pos, 行内: desk.inline.pos, 桌面查询: desk.matchDesktop },
);

await page.setViewportSize({ width: 375, height: 812 });
await sleep(400);
await page.screenshot({ path: path.join(SHOTS, "j15-mobile.png") });

/* 收尾: 面板关掉后监听应被摘除(再改可见区不应报错、页面也不应有残留) */
await closePanel(page);
await page.evaluate(() => window.__kb(400));
await sleep(400);
const after = await page.evaluate(() => ({
  panels: document.querySelectorAll(".ng-dropdown-panel").length,
  inlineFixed: document.querySelectorAll('.ng-dropdown-panel[style*="fixed"]').length,
}));
ck("关闭后没有残留的面板/行内 fixed 样式", after.panels === 0 || after.inlineFixed === 0, after);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n===== 结果: ${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length) {
  console.log("失败项:");
  for (const f of failed) console.log(`  ✗ ${f.name}`);
  process.exit(1);
}
