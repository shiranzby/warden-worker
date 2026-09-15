/**
 * 第二十一批(Y 段) 验收: 下拉"打开之后必须能关掉" —— 四条路径逐条断。
 *
 * 用法(默认跑桌面; 换 RECON_W 跑窄屏):
 *   node .deploycheck/probe-y21-verify.mjs
 *   RECON_W=390 RECON_H=844 node .deploycheck/probe-y21-verify.mjs
 *   WARDEN_TEST_BASE=https://shypwd.cc.cd WARDEN_TEST_PROXY=http://127.0.0.1:7890 \
 *     node .deploycheck/probe-y21-verify.mjs
 *
 * 背景: 用户验收第二十批(把"点不开"修好)之后回来说"点开了但关不掉"。
 * 实测四条关闭路径里**只有一条**真的坏:
 *   · 点箭头      → 原生 `handleArrowClick()` 开↔关, **一直是好的**
 *   · 点页面空白  → document 上 `outsideClickEvent="mousedown"` 的捕获监听, **一直是好的**
 *   · 点对话框遮罩→ 同上, **一直是好的**
 *   · 再点一次控件本体 → 🔴 **坏的**: ng-select 的 `handleMousedown()` 是
 *     `if (searchable()) { open() } else { toggle() }`, 而宽屏我们把 searchable 留成 true
 *     (长列表要输入过滤) ⇒ 只会 `open()`, 对已开的面板是 no-op。
 * 修法见 `select.component.ts` 的 Y 段说明(宽屏补上"关"的那一半, 且只在"按下时已开着"时关)。
 *
 * ⚠️ 窄屏必须用 `touchscreen.tap`(真实触摸) —— 我们的 pointerdown 定制只在触摸路径生效,
 *    用 `mouse.click` 测不出真机行为。
 * ⚠️ 每次点击都要**重新取坐标**: 面板开合会让对话框滚动, 早先取的点会落到别的控件上,
 *    表现为"重开失败"这种**探针自己造成的假故障**(本批踩过)。
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep } from "./b8-lib.mjs";

const PROXY = process.env.WARDEN_TEST_PROXY || "";
const W = Number(process.env.RECON_W || 1280);
const H = Number(process.env.RECON_H || 860);
const touch = W <= 768;

let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  ...(PROXY ? { proxy: { server: PROXY } } : {}),
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: W, height: H },
  locale: "zh-CN",
  ...(touch ? { isMobile: true, hasTouch: true } : {}),
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 150)));
await ensureLoggedIn(page, ctx, { verbose: false });
console.log(`BASE=${BASE} ${W}x${H} touch=${touch}`);

/** 取"当前还开着"的那个 select 的实时几何(每次都重新取, 不用旧坐标)。 */
const geom = (idx = 0) =>
  page.evaluate((i) => {
    const root = document.querySelector("bit-dialog") || document;
    const s = root.querySelectorAll("bit-select")[i];
    if (!s) return null;
    const b = s.getBoundingClientRect();
    const a = s.querySelector(".ng-arrow-wrapper");
    const ab = a ? a.getBoundingClientRect() : null;
    return {
      field: { x: Math.round(b.x + 30), y: Math.round(b.y + b.height / 2) },
      arrow: ab ? { x: Math.round(ab.x + ab.width / 2), y: Math.round(ab.y + ab.height / 2) } : null,
      rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
      text: (s.innerText || "").trim().slice(0, 16),
    };
  }, idx);

const isOpen = () =>
  page.evaluate(() => {
    const o = [...document.querySelectorAll("ng-select.ng-select-opened")];
    const vis = [...document.querySelectorAll("ng-dropdown-panel, .ng-dropdown-panel")].filter(
      (p) => getComputedStyle(p).display !== "none" && p.getBoundingClientRect().height > 0,
    );
    return { open: o.length > 0, panels: vis.length };
  });

const doTap = async (pt) => {
  if (touch) await page.touchscreen.tap(pt.x, pt.y);
  else await page.mouse.click(pt.x, pt.y);
  await sleep(750);
};

/** 用**实时坐标**点控件本体, 返回点完之后是否开着。 */
async function tapField(idx = 0) {
  const g = await geom(idx);
  if (!g) return null;
  await doTap(g.field);
  return (await isOpen()).open;
}
async function tapArrow(idx = 0) {
  const g = await geom(idx);
  if (!g || !g.arrow) return null;
  await doTap(g.arrow);
  return (await isOpen()).open;
}
async function ensureOpen(idx = 0) {
  for (let i = 0; i < 3; i++) {
    if ((await isOpen()).open) return true;
    await tapField(idx);
  }
  return (await isOpen()).open;
}

/* ============ 场景 A: 设置页(无浮层) ============ */
console.log("\n########## A. 设置 · 外观(页面内下拉) ##########");
await goRoute(page, "/settings/appearance", undefined, 25000).catch(() => {});
await sleep(3000);

if (!(await ensureOpen(0))) {
  check("A 能打开(前置)", false, "点了几次都没打开");
} else {
  check("A 能打开(前置)", true);
  check("A ① 开着时【再点控件本体】能关掉", (await tapField(0)) === false);
  await ensureOpen(0);
  check("A ② 开着时点【箭头】能关掉", (await tapArrow(0)) === false);
  await ensureOpen(0);
  const g = await geom(0);
  if (touch) await doTap({ x: 6, y: H - 6 });
  else await doTap({ x: W - 40, y: H - 30 });
  check("A ③ 开着时点【页面空白处】能关掉", (await isOpen()).open === false, `字段位置=${g && g.rect}`);
}

/* ============ 场景 B: 发送对话框(浮层) ============ */
console.log("\n########## B. 新增文本 Send 对话框(两个下拉) ##########");
await goRoute(page, "/sends", "tools-send-list", 25000);
await sleep(2500);
const create = touch
  ? page.locator('main#main-content tools-send-list button:has-text("新增 Send")').first()
  : page.locator('main#main-content button:has-text("新增")').first();
await create.click();
await sleep(900);
await page.locator('.cdk-overlay-container button:has-text("文本 Send")').first().click();
await sleep(2800);

for (const idx of [0, 1]) {
  const g = await geom(idx);
  const label = g ? g.text : `#${idx}`;
  console.log(`  --- 下拉 #${idx} <${label}> ---`);
  if (!(await ensureOpen(idx))) {
    check(`B#${idx} 能打开(前置)`, false);
    continue;
  }
  check(`B#${idx} 能打开(前置)`, true);
  check(`B#${idx} ① 再点控件本体能关掉`, (await tapField(idx)) === false);
  await ensureOpen(idx);
  check(`B#${idx} ② 点箭头能关掉`, (await tapArrow(idx)) === false);
  await ensureOpen(idx);
  await doTap(touch ? { x: 6, y: H - 6 } : { x: W - 40, y: H - 30 });
  check(`B#${idx} ③ 点对话框外遮罩能关掉`, (await isOpen()).open === false);
}

console.log("\npageerrors:", errs.length ? errs : "无");
check("⓪ 无运行期页面错误", errs.length === 0, errs.join(" | "));
console.log(`\n================ ${pass} 通过 / ${fail} 失败 ================`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
