/**
 * 第十二批 / P 段 的运行期验证 —— 窄屏「搜索框 ↔ 筛选按钮」的高度/尺寸对齐。
 *
 * 用法: node .deploycheck/verify-batch12.mjs                                  默认 https://localhost:8099
 *       WARDEN_TEST_PROXY=http://127.0.0.1:7890 node .deploycheck/verify-batch12.mjs   打线上
 *
 * ## 用户报的现象
 *   「密码库页的筛选按钮与搜索密码库的表单高度不统一」—— 窄屏下这两个控件由 O1 并到同一行
 *   (筛选缩成搜索框右侧的按钮), 并排之后高度差一眼可见。
 *
 * ## 根因(已定位)
 *   O1 为了把按钮从 bitButton 的 block(整宽) 收回成内联尺寸, 写了:
 *       .warden-filter-toggle button { padding: 0 12px !important }
 *   本意只改**横向**内边距(px-4=16px → 12px), 但简写 `padding: 0 12px` 把**纵向**也清成了 0
 *   ⇒ 按钮高度只剩 1px 边框 + 20px 行高 + 1px 边框 = 22px, 而搜索框是 tw-min-h-10 = 40px。
 *   (bitButton 的 default 尺寸本来是 pt/pb = 0.625rem-1px = 9px, 加上边框正好 40px —— 本来是对齐的。)
 *
 * ## 本批断言
 *   P1 窄屏: 搜索框(bitFieldContainer)与筛选按钮的**外框高度相等**(|Δ| ≤ 1px);
 *   P2 窄屏: 两者垂直中心对齐;
 *   P3 窄屏: 字号/行高一致(视觉重量一致, 不只是高度);
 *   P4 窄屏: 圆角一致;
 *   P5 桌面: 筛选开关仍不渲染(官方桌面无此开关) —— 反向守卫, 防"为了修窄屏把桌面也改了"。
 *
 * 判据用**外框**(含边框/padding)而不是内容盒 —— 用户看到的是外框。
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";
import { BASE, CHROME, sleep, ensureLoggedIn, goRoute } from "./b8-lib.mjs";

const SHOTS = path.resolve(import.meta.dirname, "shots-b12");
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

/** 取外框几何 + 影响"视觉尺寸"的几条计算样式。 */
const HELPERS = `
  const q = (s) => document.querySelector(s);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1),
      left: +r.left.toFixed(1), right: +r.right.toFixed(1),
      cy: +((r.top + r.bottom) / 2).toFixed(1),
      fontSize: cs.fontSize, lineHeight: cs.lineHeight,
      padTop: cs.paddingTop, padBottom: cs.paddingBottom,
      padLeft: cs.paddingLeft, padRight: cs.paddingRight,
      borderRadius: cs.borderRadius,
      borderTopWidth: cs.borderTopWidth, boxSizing: cs.boxSizing,
      minHeight: cs.minHeight, display: cs.display,
    };
  };
  // 搜索框的"外框" = bitFieldContainer 那个 form(带边框/圆角/min-h-10)
  const searchField = q('app-vault-filter [data-testid="filters-body"] bit-search form');
  const toggle = q(".warden-filter-toggle");
  const toggleBtn = toggle ? toggle.querySelector("button") : null;
`;

const probeVault = (page) =>
  page.evaluate(
    new Function(`${HELPERS}
    return {
      searchField: box(searchField),
      toggleBtn: box(toggleBtn),
      toggleShown: !!toggle && getComputedStyle(toggle).display !== "none",
      searchFound: !!searchField,
    };
  `),
  );

/* ============================== 启动 ============================== */
console.log(`\n===== 第十二批 / P 段 验证(搜索框↔筛选按钮 尺寸对齐) 目标: ${BASE} =====`);

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

const hardErrors = [];
page.on("pageerror", (e) => hardErrors.push("[pageerror] " + String(e).slice(0, 200)));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (!/violates the following Content Security Policy directive 'style-src/.test(t)) {
    hardErrors.push("[console] " + t.slice(0, 200));
  }
});

console.log("\n[登录]");
console.log("   " + (await ensureLoggedIn(page, ctx)));

/* ------------------------- ① 窄屏: 尺寸对齐 ------------------------- */
console.log("\n① 窄屏 375×812 —— 密码库页: 搜索框 与 筛选按钮 的尺寸");
await goRoute(page, "/vault", "app-vault-items");
await sleep(1200);
let v = await probeVault(page);
await page.screenshot({ path: path.join(SHOTS, "narrow-vault.png") });

console.log("\n   [原始读数]");
console.log("   搜索框: " + JSON.stringify(v.searchField));
console.log("   筛选钮: " + JSON.stringify(v.toggleBtn));

const s = v.searchField;
const t = v.toggleBtn;

ck("P0 两个控件都找得到、都可见", !!s && !!t && v.toggleShown, {
  searchFound: v.searchFound,
  toggleShown: v.toggleShown,
});

if (s && t) {
  const dh = +Math.abs(s.h - t.h).toFixed(1);
  ck("P1 外框高度相等(|Δ| ≤ 1px)", dh <= 1, {
    搜索框: s.h,
    按钮: t.h,
    Δ: dh,
  });

  const dcy = +Math.abs(s.cy - t.cy).toFixed(1);
  ck("P2 垂直中心对齐(|Δ| ≤ 1px)", dcy <= 1, { Δ: dcy });

  ck("P3 字号 / 行高一致", s.fontSize === t.fontSize && s.lineHeight === t.lineHeight, {
    搜索框: `${s.fontSize}/${s.lineHeight}`,
    按钮: `${t.fontSize}/${t.lineHeight}`,
  });

  ck("P4 圆角一致", s.borderRadius === t.borderRadius, {
    搜索框: s.borderRadius,
    按钮: t.borderRadius,
  });

  ck(
    "P5 按钮的纵向内边距没有被清零(应 > 0)",
    parseFloat(t.padTop) > 0 && parseFloat(t.padBottom) > 0,
    { padTop: t.padTop, padBottom: t.padBottom },
  );
}

/* --------------------------- ② 桌面: 反向守卫 --------------------------- */
console.log("\n② 桌面 1280×900 —— 筛选开关必须仍不渲染");
await page.setViewportSize(DESKTOP);
await sleep(1000);
await page.screenshot({ path: path.join(SHOTS, "desktop-vault.png") });
v = await probeVault(page);
ck("P6 桌面: 筛选开关不渲染(官方桌面无此开关)", !v.toggleShown, { toggleShown: v.toggleShown });
ck("P7 桌面: 搜索框仍在", !!v.searchField);

/* ------------------------------ 汇总 ------------------------------ */
const fail = results.filter((r) => !r.ok).length;
console.log(`\n===== 结果: PASS=${results.length - fail}  FAIL=${fail} =====`);
if (hardErrors.length) {
  console.log("\n[页面报错]");
  hardErrors.slice(0, 5).forEach((e) => console.log("   " + e));
}
await browser.close();
process.exit(fail ? 1 : 0);
