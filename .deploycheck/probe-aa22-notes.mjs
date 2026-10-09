/**
 * 第二十二批(AA 段)运行期验收 —— 条目对话框的「备注」必须随内容行数**自增高**。
 *
 * 背景(用户原话: "我哪怕打很多行换行, 显示也只显示一行"):
 *   备注框 `<textarea bitInput rows="5" formControlName="notes">`
 *   (`libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.html`)
 *   被两条规则用 `!important` 钉了 height/line-height:
 *     · X2  `bit-dialog textarea[formcontrolname="notes"]`  → 38px / line-height 38px
 *     · K4  `bit-dialog bit-form-field textarea`            → 54px(仅 ≤768px)
 *   而样式表里的 `!important` 声明**战胜**非 `!important` 的行内声明 ⇒
 *   `bitInput` 的 `adjustTextareaHeight()`(写下 `style.height = scrollHeight`)被压掉,
 *   **应用自带的**自增高失效 ⇒ 只显示一行 + 右侧一条内部滚动条。
 *
 * ⚠️ 为什么不能只断"新选择器在不在": 一条 CSS 规则可能"写进去了但没生效"
 *    (权重被别人压掉 / 行内 height 盖回去)。本脚本量的是**渲染出来的几何**,
 *    并且配一条**负向对照**: 把旧规则注入回去, 高度必须回落 —— 否则判据是哑弹。
 *
 * 用法:
 *   WARDEN_TEST_BASE=https://test.shytest.cc.cd node .deploycheck/probe-aa22-notes.mjs
 *   WARDEN_TEST_BASE=https://shypwd.cc.cd      node .deploycheck/probe-aa22-notes.mjs
 * 退出码: 有 FAIL 就是 1。
 * ⚠️ 别用 `| head -N` 跑本脚本 —— 管道提前关闭会让 node 收到 SIGPIPE 而**中途死掉**
 *    (第一次就这么丢掉了一半输出)。要留档就 `> 文件`。
 */
import fs from "node:fs";
import path from "node:path";

import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import { BASE, CHROME, UA, ensureLoggedIn, goRoute, sleep, SHOTS } from "./b8-lib.mjs";

const VIEWPORTS = [
  [1920, 1080],
  [1440, 900],
  [768, 1024],
  [390, 844],
];
const LINES = 8;
const TEXT = Array.from({ length: LINES }, (_, i) => `AA22-备注第${i + 1}行`).join("\n");

/**
 * 行内 ⋯ 按钮的 aria-label 在本部署实测是 **`More options`**(英文),
 * 而 `tests/mobile-regression.mjs` 的 G6 用的是 `选项`(中文, 390 视口)。
 * 两个都收, 否则会"找不到按钮"而误判成产品问题。
 */
const ROW_DOTS = [
  'tr[appvaultcipherrow] td:last-child button[aria-label="选项"]',
  'tr[appvaultcipherrow] td:last-child button[aria-label="More options"]',
].join(", ");

/**
 * 旧写法(X2 的原始形态)。负向对照用它, 证明"改动真的决定成败"。
 *
 * ⚠️ 选择器**刻意比原版多一层** `bit-form-field`:
 *    X2 原文是 `bit-dialog textarea[formcontrolname="notes"]` = (0,1,2),
 *    而本批把 K4 改成了 `min-height: 54px !important`(窄屏 `.cdk-overlay-pane bit-form-field textarea` = (0,1,2))。
 *    若照抄原选择器, 注入后 `height:38` 与 K4 的 `min-height:54` 会**取大**变成 54px
 *    —— 于是判据"必须是 38px"会红, 但红的原因是两条规则打架, 不是对照无效。
 *    提到 (0,1,3) 后压过 K4, 才是干净的"单行复现"。
 */
const OLD_RULE = `
bit-dialog bit-form-field textarea[formcontrolname="notes"] {
  height: var(--warden-line-h, 38px) !important;
  min-height: var(--warden-line-h, 38px) !important;
  line-height: var(--warden-line-h, 38px) !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}`;

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
  ok ? pass++ : fail++;
};

fs.mkdirSync(SHOTS, { recursive: true });

/**
 * ⚠️ 本机**直连 Cloudflare 边缘会被 TLS reset**(`curl` 打 test 通道返回 000;
 *    只有 `-x http://127.0.0.1:7890` 才通)⇒ 浏览器也必须挂代理。
 *    本地 dev server(localhost)则要 bypass, 否则连自己都连不上。
 */
const PROXY =
  process.env.WARDEN_TEST_PROXY ||
  (/localhost|127\.0\.0\.1/.test(BASE) ? "" : "http://127.0.0.1:7890");
console.log(`代理: ${PROXY || "(直连)"}`);

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  proxy: PROXY ? { server: PROXY, bypass: "localhost,127.0.0.1" } : undefined,
});
// ⚠️ 只设 UA(绕开 setup-extension 守卫), **不要**设 isMobile/hasTouch ——
//    我们的断点是 `@media (max-width:768px)`, 纯视口宽度决定布局。
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  userAgent: UA,
  locale: "zh-CN",
  viewport: { width: VIEWPORTS[0][0], height: VIEWPORTS[0][1] },
});
const page = await ctx.newPage();
console.log("BASE = " + BASE);

/** 失败时要能自己解释自己: 把"有没有浮层 / 有没有 textarea"打出来。 */
const state = () =>
  page.evaluate(() => ({
    hash: location.hash,
    backdrops: document.querySelectorAll(".cdk-overlay-backdrop").length,
    overlayPanes: document.querySelectorAll(".cdk-overlay-container > *").length,
    dialogs: document.querySelectorAll("bit-dialog").length,
    rows: document.querySelectorAll("tr[appvaultcipherrow]").length,
    textareas: [...document.querySelectorAll("textarea")].map(
      (t) => `${t.getAttribute("formcontrolname")}/rows=${t.getAttribute("rows")}`,
    ),
    visibleText: [...document.querySelectorAll("button, a, [role='menuitem']")]
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => (e.textContent || "").trim())
      .filter(Boolean)
      .slice(0, 25),
  }));

/** 备注 textarea 的几何 + 影响它的那几层样式(判据只对着"用户看见的框")。 */
const readNotes = () =>
  page.evaluate(() => {
    const t = document.querySelector('textarea[formcontrolname="notes"]');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const cs = getComputedStyle(t);
    // 祖先链(判断"文字有没有呼吸空间" —— 光看 textarea 本体不够, 见 W1 的教训)
    const ancestors = [];
    let p = t.parentElement;
    for (let i = 0; i < 5 && p && p.tagName.toLowerCase() !== "body"; i++) {
      const pcs = getComputedStyle(p);
      ancestors.push({
        tag: p.tagName.toLowerCase(),
        cls: (p.className || "").toString().slice(0, 60),
        h: +p.getBoundingClientRect().height.toFixed(1),
        padT: pcs.paddingTop,
        padB: pcs.paddingBottom,
      });
      p = p.parentElement;
    }
    const fh = t.closest("bit-form-field");
    return {
      h: +r.height.toFixed(1),
      clientH: t.clientHeight,
      scrollH: t.scrollHeight,
      /** 内部滚动量 = 用户"看不见的那部分" */
      overflow: t.scrollHeight - t.clientHeight,
      inlineH: t.style.height,
      cssH: cs.height,
      lh: parseFloat(cs.lineHeight) || null,
      lhRaw: cs.lineHeight,
      pt: cs.paddingTop,
      pb: cs.paddingBottom,
      rows: t.getAttribute("rows"),
      visible: t.getClientRects().length > 0,
      lines: t.value.split("\n").length,
      boxSizing: cs.boxSizing,
      overflowY: cs.overflowY,
      fieldH: fh ? +fh.getBoundingClientRect().height.toFixed(1) : null,
      ancestors,
    };
  });

/** 让 `bitInput` 重新按 scrollHeight 写一次行内 height(它只在 ngAfterViewInit / input 时跑)。 */
const refit = async () => {
  await page.evaluate(() => {
    const t = document.querySelector('textarea[formcontrolname="notes"]');
    t && t.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(500);
};

const shot = async (name) => {
  await page.evaluate(() => {
    const t = document.querySelector('textarea[formcontrolname="notes"]');
    t && t.scrollIntoView({ block: "center" });
  });
  await sleep(400);
  const f = path.join(SHOTS, name);
  await page.screenshot({ path: f });
  return f;
};

/**
 * 点一个"可见且文案匹配"的元素(DOM click —— 浮层上 pointer click 会超时)。
 * ⚠️ 只在**没有浮层**时才能用全局查找: 密码库左栏的「筛选: 登录」文案就是「登录」,
 *    而它在 DOM 里**排在浮层前面** ⇒ 找菜单项必须用下面的 `clickInOverlay`,
 *    否则会把"新增 → 登录"点成"左栏筛选 → 登录"(第一次跑就把 hash 点成了 `?type=login`)。
 */
const clickText = (pattern, kind = "button, a, [role='menuitem']") =>
  page.evaluate(
    ({ pattern, kind }) => {
      const re = new RegExp(pattern);
      const el = [...document.querySelectorAll(kind)].find(
        (e) => re.test((e.textContent || "").trim()) && e.getBoundingClientRect().width > 0,
      );
      if (!el) return null;
      el.click();
      return (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24);
    },
    { pattern, kind },
  );

/** 只在 cdk 浮层里找并点(菜单项 / 对话框按钮都挂在这里)。 */
const clickInOverlay = (pattern) =>
  page.evaluate((pattern) => {
    const re = new RegExp(pattern);
    const root = document.querySelector(".cdk-overlay-container") || document.body;
    const el = [...root.querySelectorAll("button, a, [role='menuitem'], [role='option']")].find(
      (e) => re.test((e.textContent || "").trim()) && e.getBoundingClientRect().width > 0,
    );
    if (!el) return null;
    el.click();
    return (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24);
  }, pattern);

/** 浮层里现有哪些可点项(菜单没弹出来时用它自证)。 */
const overlayItems = () =>
  page.evaluate(() => {
    const root = document.querySelector(".cdk-overlay-container");
    if (!root) return [];
    return [...root.querySelectorAll("button, a, [role='menuitem'], [role='option']")]
      .map((e) => (e.textContent || "").trim())
      .filter(Boolean)
      .slice(0, 20);
  });

/** 摘掉残留浮层(cdk overlay 不随路由卸载, 本项目 §4.31)。 */
const clearOverlays = async () => {
  await page.evaluate(() => {
    document.querySelectorAll(".cdk-overlay-container > *").forEach((e) => e.remove());
  });
  await sleep(300);
};

/**
 * 登录后**必须**先关掉引导弹窗。
 * 实测(test 通道 1440): `#/vault` 上盖着「您已成功加入！欢迎使用 Bitwarden」对话框 +
 * `cdk-overlay-backdrop`, 它会吃掉点击 —— 第一次跑探针就是栽在这里
 * (点了「新增」什么也没发生, 于是"找不到备注框")。
 * `b8-lib` 的 `clickSkips()` 只在**没进密码库时**跑, 所以这条得自己补。
 */
const dismissOnboarding = async () => {
  for (const pat of ["^\\s*跳过\\s*$", "^\\s*忽略此清单\\s*$", "^\\s*关闭\\s*$"]) {
    const hit = await clickText(pat);
    if (hit) {
      console.log(`  关闭引导弹窗: 点了「${hit}」`);
      await sleep(900);
    }
  }
  await page.keyboard.press("Escape");
  await sleep(600);
  // 兜底: cdk overlay 不随路由卸载(本项目 §4.31), 残留遮罩只能手工摘
  const removed = await page.evaluate(() => {
    const n = document.querySelectorAll(".cdk-overlay-backdrop").length;
    document.querySelectorAll(".cdk-overlay-container > *").forEach((e) => e.remove());
    return n;
  });
  if (removed) console.log(`  兜底摘掉 ${removed} 个残留遮罩`);
  await sleep(500);
  return page.evaluate(() => document.querySelectorAll(".cdk-overlay-backdrop").length === 0);
};

await ensureLoggedIn(page, ctx, { verbose: false });
console.log("登录 OK, hash = " + (await page.evaluate(() => location.hash)));
check("P0 引导弹窗已清场(否则后面所有点击都会被遮罩吃掉)", await dismissOnboarding());

/** 关掉当前对话框(带"放弃更改"确认的兜底), 返回是否已清场。 */
const closeDialog = async () => {
  await page.keyboard.press("Escape");
  await sleep(800);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (e) =>
        /放弃|丢弃|确定|确认|是，|是的|Discard|OK/i.test(e.textContent || "") &&
        e.getBoundingClientRect().width > 0,
    );
    if (b) b.click();
  });
  await sleep(900);
  await page.evaluate(() => {
    document.querySelectorAll(".cdk-overlay-container > *").forEach((e) => e.remove());
  });
  await sleep(400);
  return page.evaluate(
    () => document.querySelectorAll('textarea[formcontrolname="notes"]').length === 0,
  );
};

/* ============================================================
 * 场景 A: 编辑**已有条目** —— 打开对话框那一刻就必须是多行(挂载路径)
 * ============================================================ */
console.log(`\n########## A. 打开「编辑」即展开(1440) ##########`);
await page.setViewportSize({ width: 1440, height: 900 });
await goRoute(page, "#/vault", "main#main-content table", 20000);
await sleep(1500);

const rowDots = await page.evaluate(
  (sel) =>
    [...document.querySelectorAll(sel)].filter((b) => b.getBoundingClientRect().width > 0).length,
  ROW_DOTS,
);
check("A0 找到行内 ⋯ 按钮", rowDots > 0, `命中 ${rowDots} 个(aria-label 兼容 选项 / More options)`);
if (rowDots > 0) {
  await page.evaluate((sel) => {
    [...document.querySelectorAll(sel)].find((b) => b.getBoundingClientRect().width > 0).click();
  }, ROW_DOTS);
  await sleep(1000);
}
const hitEdit = await clickInOverlay("^\\s*(编辑|Edit|View|查看)\\s*$");
console.log("  点「编辑」-> " + hitEdit);
if (!hitEdit) console.log("  浮层里可点项: " + JSON.stringify(await overlayItems()));
await sleep(2200);

let a = await readNotes();
if (!a) console.log("  现场: " + JSON.stringify(await state()));
console.log("  读数: " + JSON.stringify(a));
check("A1 「编辑」对话框里备注 textarea 渲染出来了", !!(a && a.visible));
if (a) {
  check(
    "A2 ★ 打开即是多行(没被压成一行)",
    a.h >= (a.lh || 20) * 1.5,
    `h=${a.h}px  lh=${a.lh}px  rows=${a.rows}`,
  );
  check(
    "A3 ★ 没有内部滚动(全可见)",
    a.overflow <= 2,
    `scrollH=${a.scrollH} clientH=${a.clientH} 差=${a.overflow}`,
  );
  check("A4 行高不是 38px(X2 的痕迹已消失)", Math.abs((a.lh || 0) - 38) > 0.5, `lh=${a.lhRaw}`);
  check("A5 行内 height 由 bitInput 写(scrollHeight 口径)", a.inlineH !== "", `inline=${a.inlineH}`);
  console.log("  截图: " + (await shot("aa22-A-open-edit-1440.png")));
}
check("A6 清场成功(对话框已关闭)", await closeDialog());

/* ============================================================
 * 场景 B: 新增条目 —— 打多行必须长高, 四个视口都过
 * ============================================================ */
console.log(`\n########## B. 输入 ${LINES} 行 → 必须长高(四视口) ##########`);
await page.setViewportSize({ width: VIEWPORTS[0][0], height: VIEWPORTS[0][1] });
await goRoute(page, "#/vault", "main#main-content table", 20000);
await sleep(1500);
await clearOverlays();
console.log("  点「新增」-> " + (await clickText("^\\s*(新增|New)\\s*$")));
await sleep(1200);
// ⚠️ 必须断言菜单真的弹出来了: 菜单没开时"在浮层里找登录"必然拿不到,
//    而此时全局找「登录」会命中左栏筛选并把 hash 改成 `?type=login`(踩过)。
const menu = await overlayItems();
console.log("  新增菜单项: " + JSON.stringify(menu));
check("B-a 「新增」菜单已弹出", menu.some((t) => /^(登录|Login)$/.test(t)), `共 ${menu.length} 项`);
console.log("  点「登录」-> " + (await clickInOverlay("^\\s*(登录|Login)\\s*$")));
await sleep(2200);

const b0 = await readNotes();
if (!b0) console.log("  现场: " + JSON.stringify(await state()));
console.log("  空框读数: " + JSON.stringify(b0));
check("B0 新增对话框里备注 textarea 渲染出来了", !!(b0 && b0.visible));
check(
  "B1 ★ 空框也是多行(rows=5 的口径, 不是 38/54 一行)",
  !!b0 && b0.h >= (b0.lh || 20) * 3,
  b0 ? `h=${b0.h}px  lh=${b0.lh}px  rows=${b0.rows}  css-h=${b0.cssH}` : "null",
);

if (b0) {
  // 打 8 行(真实键盘输入 —— Angular 的形态控件只认真实 key 事件)
  await page.evaluate(() => {
    document.querySelector('textarea[formcontrolname="notes"]').focus();
  });
  await page.keyboard.type(TEXT, { delay: 12 });
  await sleep(900);

  for (const [w, h] of VIEWPORTS) {
    console.log(`\n  ── 视口 ${w}×${h} ──`);
    await page.setViewportSize({ width: w, height: h });
    await refit();
    const m = await readNotes();
    console.log("     读数: " + JSON.stringify(m));
    if (!m) {
      check(`B2@${w} 读到备注框`, false);
      continue;
    }
    const lineH = m.lh || 20;
    // 判据口径(第一次写错过, 记下来):
    //   自增高是 `max(rows 的天生高度, 内容高度)`, **不是** "空框高度 + 每行累加"。
    //   rows=5 的空框天生 100px(=5×20); 打 8 行时 8×20=160px > 100 ⇒ 取 160。
    //   所以正确的判据是"① 比空框高 ② 至少装得下 lines 行"; 用 `空框 + (LINES-3)*行高`
    //   会要求 200px, 那是把两组数重复相加, 会在**修好的界面上**误报红。
    check(
      `B2@${w} ★ 高度随内容增长(> 空框, 且 ≥ ${LINES} 行所需)`,
      m.h >= m.lines * lineH - 2 && m.h > b0.h + 1,
      `空=${b0.h}px 现=${m.h}px 需要≥${m.lines * lineH}px 行高=${lineH} lines=${m.lines}`,
    );
    check(
      `B3@${w} ★ 没有内部滚动(每行都看得见)`,
      m.overflow <= 2,
      `scrollH=${m.scrollH} clientH=${m.clientH} 差=${m.overflow}`,
    );
    check(`B4@${w} 行高不是 38px(X2 痕迹已消失)`, Math.abs(lineH - 38) > 0.5, `lh=${m.lhRaw}`);
    console.log("     截图: " + (await shot(`aa22-B-typed-${w}.png`)));
  }

  /* ============================================================
   * 场景 C: 负向对照 —— 把旧规则注回去, 必须回落; 再拿掉, 必须恢复
   * ============================================================ */
  console.log(`\n########## C. 负向对照(390: 注回旧 X2 规则) ##########`);
  await page.setViewportSize({ width: 390, height: 844 });
  await refit();
  const before = await readNotes();
  const tag = await page.addStyleTag({ content: OLD_RULE });
  await refit();
  const clamped = await readNotes();
  console.log("  注回旧规则后: " + JSON.stringify(clamped));
  check(
    "C1 ★ 注回旧规则后回落到一行(证明 B 的判据真的对这条规则敏感)",
    Math.abs(clamped.h - 38) <= 2,
    `h=${clamped.h}px(期望≈38) lh=${clamped.lhRaw}`,
  );
  check(
    "C2 ★ 旧规则下重新出现内部滚动(复现用户报的现象)",
    clamped.overflow > 50,
    `差=${clamped.overflow}`,
  );
  /* ⚠️ 截图必须拍在**注入态**(规则还在的时候) —— 拍在 C3 之后就只会得到"恢复后"的样子,
     与 B 系列逐像素雷同, 等于没有负向对照的视觉证据(2026-10-09 首跑就踩了这个)。 */
  console.log("  截图(注入态, 应只剩一行 + 右侧滚动条): "
    + (await shot("aa22-C1-clamped-390.png")));
  await tag.evaluate((el) => el.remove());
  await refit();
  const restored = await readNotes();
  console.log("  拿掉后: " + JSON.stringify(restored));
  check(
    "C3 ★ 拿掉后恢复多行(前后成对, 不是单向假绿)",
    restored.h >= before.h - 2 && restored.overflow <= 2,
    `恢复 h=${restored.h}px(注回前 ${before.h}px)`,
  );
  console.log("  截图(恢复态): " + (await shot("aa22-C3-restored-390.png")));
}

console.log(`\n===== 合计: ${pass} 通过 / ${fail} 失败 =====`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
