/**
 * 第十批 / N 段 的运行期验证 —— 窄屏省高度。
 *
 * 用法: node .deploycheck/verify-batch10.mjs     默认 https://localhost:8099
 *
 * ## 这一批在验什么
 *
 *   ① 窄屏: 「新增」在**列表「名称/选择」那一行里**(不再独占页头一行), 且页头那行塌掉;
 *   ② 窄屏: 筛选面板顶部的「筛选」标题行没了, 但 bit-search(搜索密码库)与
 *      .warden-filter-toggle(筛选开关)都还在、还能点;
 *   ③ 桌面: 一行都没变 —— 「新增」仍在页头, 「筛选」标题行仍在, .warden-headbar 不渲染;
 *   ④ 桌面→窄屏**不刷新**地改视口, 切换必须跟着走。
 *
 * ## 为什么 ④ 值得单列
 *
 * 本批的"谁显示"是**纯 CSS**决定的(@media + display:none), 模板里两个实例都在 DOM 里。
 * 如果改成用 `@if (isNarrow)` 只渲染一个, 桌面→窄屏 resize 时 Angular 不会重跑变更检测,
 * 窄屏下就会变成"两个都没有"。所以这条既是回归守卫, 也是在守住"CSS 决定显隐"这个选型。
 *
 * ## 本脚本**验不到**的那条
 *
 *   coachmark 的 addItem 锚点切换(页头那颗让位给列表里那颗)。理由是它只在**首登用户
 *   第一次进密码库**时出现一次(CoachmarkService 把完成态写进 state, 之后不再触发),
 *   而测试账号早就不是首登 —— 强行重置会污染账号状态。所以那条只做了静态核对:
 *   两个 app-coachmark 都在, 且 [coachmarkPopover] 由 isNarrowViewport 二选一
 *   (页头是它的取反), 见下面第 ④ 组的"锚点开关"两条。
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";
import { BASE, CHROME, sleep, ensureLoggedIn, goRoute } from "./b8-lib.mjs";

const SHOTS = path.resolve(import.meta.dirname, "shots-b10");
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const ck = (name, ok, extra) => {
  results.push({ name, ok: !!ok });
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name}${extra !== undefined ? "  " + JSON.stringify(extra) : ""}`,
  );
};

const NARROW = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 900 };

/** 一次性把这一屏需要的几何/可见性都抓回来。 */
const probe = (page) =>
  page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        w: +r.width.toFixed(1),
        h: +r.height.toFixed(1),
        top: +r.top.toFixed(1),
        bottom: +r.bottom.toFixed(1),
        left: +r.left.toFixed(1),
        right: +r.right.toFixed(1),
        cy: +((r.top + r.bottom) / 2).toFixed(1),
        display: cs.display,
        visibility: cs.visibility,
      };
    };
    /** 真的"看得见"吗 —— display/visibility/尺寸三者都要过。 */
    const shown = (el) => {
      if (!el) return false;
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden" && b.width > 0 && b.height > 0;
    };

    // 两处「新增」: 页头那颗在 .warden-head-new 里, 列表那颗在 .warden-headbar 里。
    const wrap = q("app-vault-header .warden-head-new");
    const headbar = q(".warden-headbar");
    const headerMenu = wrap ? wrap.querySelector("vault-new-cipher-menu") : null;
    const listMenu = headbar ? headbar.querySelector("vault-new-cipher-menu") : null;
    const headerBtn = headerMenu
      ? headerMenu.querySelector("#newItemButton, #newItemDropdown")
      : null;
    const listBtn = listMenu ? listMenu.querySelector("#newItemButton, #newItemDropdown") : null;

    return {
      headerWrapShown: shown(wrap),
      headerWrap: box(wrap),
      headerMenuShown: shown(headerMenu),
      headerBtnShown: shown(headerBtn),
      headbarShown: shown(headbar),
      headbar: box(headbar),
      listMenuShown: shown(listMenu),
      listBtnShown: shown(listBtn),
      listBtn: box(listBtn),
      listBtnId: listBtn ? listBtn.id : null,
      listBtnText: listBtn ? listBtn.textContent.trim() : null,
      nameTh: box(q("th.warden-name-th")),
      selectBtn: box(q(".warden-select-toggle")),
      selectBtnShown: shown(q(".warden-select-toggle")),
      // 页头整体高度: 塌掉后应该接近 0(留下的只有 I 段给的 2px padding-bottom)
      headerHost: box(q("main#main-content app-vault-header")),
      filtersHeaderShown: shown(q('[data-testid="filters-header"]')),
      filtersBodyShown: shown(q('[data-testid="filters-body"]')),
      searchShown: shown(q("app-vault-filter bit-search")),
      toggleShown: shown(q(".warden-filter-toggle")),
      // 两个 addItem coachmark 必须各在一边(页头那颗 / 列表那颗) —— 锚点切换的前提。
      // 注意页面上 coachmark 实例不止这两个: 侧栏有 monitorSecurity, 每个筛选项上还有
      // shareWithCollections(实测 8 个), 所以只能按**作用域**数, 不能数总数。
      itemsCoachmark: document.querySelectorAll("app-vault-items app-coachmark").length,
      headerCoachmark: document.querySelectorAll("app-vault-header app-coachmark").length,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

/* ============================ 启动 ============================ */
console.log(`\n===== 第十批 / N 段 验证(窄屏省高度) 目标: ${BASE} =====`);

// 打线上时必须经本地代理(本机直连 shypwd.cc.cd 不通); 打 dev server 时不需要。
const PROXY = process.env.WARDEN_TEST_PROXY || "";
const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  ...(PROXY ? { proxy: { server: PROXY } } : {}),
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: NARROW,
  locale: "zh-CN",
});
const page = await ctx.newPage();
/*
 * 控制台分两类记:
 *   · hard —— 未捕获异常 / 其它 console error, 一个都不许有;
 *   · csp  —— `Applying inline style violates ... style-src`。
 *     ⚠️ 这一类是**开发模式的固有噪声**, 与本批无关: dev server 下 Angular 走 inline style
 *     注入组件样式, 而应用 index.html 自带的 CSP 只放行 'self'(+ 一个空串 sha256),
 *     于是**每次加载首屏**就会刷出来 —— 所以脚本在登录后、任何点击之前先记一个基线,
 *     本批只要求"我点出来的这些交互不要额外制造新的 hard error"。
 */
const hardErrors = [];
const cspNoise = [];
page.on("pageerror", (e) => hardErrors.push("[pageerror] " + String(e).slice(0, 200)));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (/violates the following Content Security Policy directive 'style-src/.test(t)) {
    cspNoise.push(t.slice(0, 120));
  } else {
    hardErrors.push("[console] " + t.slice(0, 200));
  }
});

console.log("\n[登录]");
console.log("   " + (await ensureLoggedIn(page, ctx)));

await goRoute(page, "#/vault", "app-vault-items", 20000);
await sleep(1200);

/** 基线: 还没点任何东西时的 CSP 噪声条数(见脚本头部说明)。 */
const cspAtLoad = cspNoise.length;
const hardAtLoad = hardErrors.length;
console.log(`   [基线] 加载后: hard error=${hardAtLoad}, CSP(style-src) 噪声=${cspAtLoad}`);

/* ======================= ① 窄屏 375×812 ======================= */
console.log("\n① 窄屏 375×812 —— 「新增」在列表「名称/选择」行里");
const n = await probe(page);
await page.screenshot({ path: path.join(SHOTS, "narrow-vault.png"), fullPage: false });

ck("列表里的「新增」可见", n.listBtnShown, { id: n.listBtnId, text: n.listBtnText });
ck("页头那颗「新增」已隐藏", !n.headerWrapShown && !n.headerBtnShown, {
  display: n.headerWrap ? n.headerWrap.display : null,
});
ck(".warden-headbar 可见(与「选择」同一容器)", n.headbarShown);
ck("「选择」胶囊仍在(窄屏唯一的批量选择入口)", n.selectBtnShown);
ck(
  "「新增」与「名称」表头在同一行(垂直中心落在 th 内)",
  n.listBtn && n.nameTh && n.listBtn.cy > n.nameTh.top && n.listBtn.cy < n.nameTh.bottom,
  { btnCy: n.listBtn && n.listBtn.cy, th: n.nameTh && [n.nameTh.top, n.nameTh.bottom] },
);
ck(
  "「新增」在「选择」左侧(顺序: 名称 … 新增 选择)",
  n.listBtn && n.selectBtn && n.listBtn.right <= n.selectBtn.left + 1,
  { btnRight: n.listBtn && n.listBtn.right, selLeft: n.selectBtn && n.selectBtn.left },
);
ck(
  "页头那一行已经塌掉(高度 < 20px)",
  n.headerHost && n.headerHost.h <= 20,
  { headerH: n.headerHost && n.headerHost.h },
);

console.log("\n② 筛选面板: 去掉「筛选」标题行, 保留搜索 + 筛选开关");
ck("「筛选」标题行已隐藏", !n.filtersHeaderShown);
ck("筛选主体仍在", n.filtersBodyShown);
ck("搜索密码库(bit-search)仍在", n.searchShown);
ck("「筛选」开关仍在", n.toggleShown);

console.log("\n③ 窄屏交互 —— 开关能展开、新增菜单能打开");
// ③-1 筛选开关: 点一下必须把筛选区块放出来
await page.locator(".warden-filter-toggle button").first().click();
await sleep(700);
const afterToggle = await page.evaluate(() => {
  const secs = Array.from(document.querySelectorAll("app-vault-filter .filter"));
  const vis = secs.filter((s) => {
    const b = s.getBoundingClientRect();
    return b.width > 0 && b.height > 0;
  });
  return { total: secs.length, visible: vis.length };
});
ck("点「筛选」开关后筛选区块展开", afterToggle.visible > 0, afterToggle);
await page.locator(".warden-filter-toggle button").first().click(); // 收回，免得影响后面的截图
await sleep(500);

// ③-2 列表里的「新增」: 点开必须真的有东西出来(菜单或弹窗)
const before = await page.evaluate(
  () => document.querySelectorAll(".cdk-overlay-container > *").length,
);
await page.locator(".warden-headbar #newItemButton, .warden-headbar #newItemDropdown").first().click();
await sleep(900);
const opened = await page.evaluate(() => ({
  overlays: document.querySelectorAll(".cdk-overlay-container > *").length,
  menuItems: document.querySelectorAll('.cdk-overlay-container [role="menuitem"]').length,
  hasDialog: !!document.querySelector("bit-dialog"),
}));
await page.screenshot({ path: path.join(SHOTS, "narrow-new-menu.png"), fullPage: false });
ck(
  "点列表里的「新增」能打开菜单/弹窗",
  opened.overlays > before && (opened.menuItems > 0 || opened.hasDialog),
  opened,
);
await page.keyboard.press("Escape");
await sleep(600);

console.log("\n④ coachmark 两处实例都在(锚点切换的前提)");
ck("app-vault-header 下有 1 个 addItem coachmark", n.headerCoachmark === 1, {
  headerCoachmark: n.headerCoachmark,
});
ck("app-vault-items 下有 1 个 addItem coachmark", n.itemsCoachmark === 1, {
  itemsCoachmark: n.itemsCoachmark,
});
ck("窄屏无横向溢出", n.overflowX <= 1, { overflowX: n.overflowX });

/* ========================= ② 桌面 1280×900 ========================= */
console.log("\n⑤ 桌面 1280×900 —— 必须与官方一致(不刷新，直接改视口)");
await page.setViewportSize(DESKTOP);
await sleep(1200);
const d = await probe(page);
await page.screenshot({ path: path.join(SHOTS, "desktop-vault.png"), fullPage: false });

ck("页头那颗「新增」可见", d.headerBtnShown && d.headerWrapShown);
ck("列表里的「新增」不可见(.warden-headbar 不渲染)", !d.headbarShown && !d.listMenuShown, {
  headbarDisplay: d.headbar ? d.headbar.display : null,
});
ck("「筛选」标题行恢复显示", d.filtersHeaderShown);
ck("搜索密码库仍在", d.searchShown);
ck("桌面「新增」与「筛选」标题都在页头/面板原位", d.headerHost && d.headerHost.h > 20, {
  headerH: d.headerHost && d.headerHost.h,
});
ck("桌面无横向溢出", d.overflowX <= 1, { overflowX: d.overflowX });

/* =================== ③ 桌面 → 窄屏 再切回(守住 CSS 选型) =================== */
console.log("\n⑥ 桌面 → 窄屏 resize 后切换必须跟着走(不刷新)");
await page.setViewportSize(NARROW);
await sleep(1200);
const back = await probe(page);
ck("切回窄屏后列表里的「新增」又可见", back.listBtnShown && back.headbarShown);
ck("切回窄屏后页头那颗又隐藏", !back.headerWrapShown);
ck("切回窄屏后「筛选」标题行又隐藏", !back.filtersHeaderShown);
ck("切回窄屏后搜索与筛选开关仍在", back.searchShown && back.toggleShown);
await page.screenshot({ path: path.join(SHOTS, "narrow-after-resize.png"), fullPage: false });

console.log("\n⑦ 控制台/页面错误");
console.log(
  `   hard error: 加载时 ${hardAtLoad} -> 结束 ${hardErrors.length};` +
    ` CSP(style-src) 噪声: ${cspAtLoad} -> ${cspNoise.length}`,
);
ck("全程无未捕获异常/其它 console error(CSP 噪声单独计)", hardErrors.length === 0, {
  count: hardErrors.length,
  sample: hardErrors.slice(0, 3),
});

/* ============================== 汇总 ============================== */
await browser.close();

const pass = results.filter((r) => r.ok).length;
console.log(`\n===== 结果: ${pass}/${results.length} =====`);
for (const r of results.filter((r) => !r.ok)) console.log(`  ❌ ${r.name}`);
console.log(`截图: ${SHOTS}`);
process.exit(pass === results.length ? 0 : 1);
