/**
 * 第十一批 / O 段 的运行期验证 —— 窄屏一批体验修复(用户反馈 7 条)。
 *
 * 用法: node .deploycheck/verify-batch11.mjs          默认 https://localhost:8099
 *       WARDEN_TEST_PROXY=http://127.0.0.1:7890 node .deploycheck/verify-batch11.mjs  打线上
 *
 * ## 这一批在验什么
 *
 *   O1 密码库顶部: 搜索 + 筛选 合成一行(筛选缩成搜索框右侧的按钮), 外层矩形框去掉 —— 再省一行;
 *   O2 表头行: 「新增」搬到最右格(原 ⋮ 的位置); 进选择模式「新增」让位给 ⋮, 且「名称」表头
 *      不再被按钮压住(这条正是用户报的那个 bug);
 *   O3 TOTP 倒计时: 两根线的 transition 必须"左段先、右段后"(右段 delay 0.45s),
 *      且 delay+duration ≤ 1s(超过 1s 会被每秒的宽度更新反复打断 → 近乎卡住);
 *   O4 设置-我的账户: 「保存」在窄屏挪到「名称」右侧(官方那颗藏起来);
 *   O5 设置-我的账户: 「更改电子邮箱」窄屏默认收起, 由邮件行右侧「更改」展开;
 *      展开后「继续/取消」在字段**上面**, 且「取消」未验证时也可见;
 *   O6 底部固定标签栏: 滚动区底部留白必须 ≥ 底栏实高(62px + iOS 安全区) + 12px 间隙。
 *
 * ## 为什么每条都要在**桌面**再验一次
 *
 * 这一批除 O3 外全部是"窄屏才生效"的 CSS。桌面端必须**零变化** —— 所以每条都配一条
 * 反向断言(桌面上该出现的出现、该消失的消失)。resize 那一节则守住"用 CSS 而非 @if
 * 决定显隐"这个选型: @if 在切回宽屏时不会把 DOM 变回来。
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";
import { BASE, CHROME, sleep, ensureLoggedIn, goRoute } from "./b8-lib.mjs";

const SHOTS = path.resolve(import.meta.dirname, "shots-b11");
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

/** 通用取几何的小工具(在页面里跑)。 */
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
      display: cs.display, visibility: cs.visibility,
      borderTopWidth: cs.borderTopWidth,
      paddingBottom: cs.paddingBottom,
      transitionDelay: cs.transitionDelay, transitionDuration: cs.transitionDuration,
    };
  };
  const shown = (el) => {
    if (!el) return false;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && b.width > 0 && b.height > 0;
  };
  /** th 里那串直接文本("名称")的矩形 —— 用 Range 取, 才能量出"有没有被按钮压住"。 */
  const thTextBox = (th) => {
    if (!th) return null;
    const tn = Array.from(th.childNodes).find((n) => n.nodeType === 3 && n.textContent.trim());
    if (!tn) return null;
    const rg = document.createRange();
    rg.selectNodeContents(tn);
    const r = rg.getBoundingClientRect();
    return { left: +r.left.toFixed(1), right: +r.right.toFixed(1), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1) };
  };
  const overlapsX = (a, b) => !!a && !!b && !(a.left >= b.right || a.right <= b.left);
`;

/* ============================ 保险库页 ============================ */
const probeVault = (page) =>
  page.evaluate(
    new Function(
      `
    ${HELPERS}
    // 两处「新增」: 页头那颗在 .warden-head-new 里, 列表那颗现在在 .warden-head-newbar 里
    const wrap = q("app-vault-header .warden-head-new");
    const newbar = q(".warden-head-newbar");
    const headbar = q(".warden-headbar");
    const listMenu = newbar ? newbar.querySelector("vault-new-cipher-menu") : null;
    const listBtn = listMenu ? listMenu.querySelector("#newItemButton, #newItemDropdown") : null;
    const headerMenu = wrap ? wrap.querySelector("vault-new-cipher-menu") : null;
    const headerBtn = headerMenu ? headerMenu.querySelector("#newItemButton, #newItemDropdown") : null;

    const nameTh = q("th.warden-name-th");
    const lastTh = q(".warden-selectable thead tr > th:last-child");
    // 表头最右格里的 ⋮ (J14 在窄屏默认隐着)
    const dots = lastTh ? lastTh.querySelector("button[biticonbutton]") : null;

    // O1
    const filters = q('[data-testid="filters"]');
    const search = q('app-vault-filter [data-testid="filters-body"] > div:first-child');
    const toggle = q(".warden-filter-toggle");
    const toggleBtn = toggle ? toggle.querySelector("button") : null;

    // O3
    const fillA = q(".warden-totp-fill-a");
    const fillB = q(".warden-totp-fill-b");

    // O6
    const tabbar = q(".warden-tabbar");
    const mainEl = q("main#main-content");

    return {
      headerBtnShown: shown(headerBtn),
      headbarShown: shown(headbar),
      newbarShown: shown(newbar),
      newbar: box(newbar),
      listBtnShown: shown(listBtn),
      listBtn: box(listBtn),
      listBtnText: listBtn ? listBtn.textContent.trim() : null,
      dotsShown: shown(dots),
      dots: box(dots),
      nameTh: box(nameTh),
      nameText: thTextBox(nameTh),
      lastTh: box(lastTh),
      selectBtn: box(q(".warden-select-toggle")),

      filtersBorderTopWidth: filters ? getComputedStyle(filters).borderTopWidth : null,
      filtersBodyShown: shown(q('[data-testid="filters-body"]')),
      searchShown: shown(search),
      search: box(search),
      toggleShown: shown(toggle),
      toggle: box(toggle),
      toggleBtn: box(toggleBtn),

      fillADelay: fillA ? getComputedStyle(fillA).transitionDelay : null,
      fillADur: fillA ? getComputedStyle(fillA).transitionDuration : null,
      fillBDelay: fillB ? getComputedStyle(fillB).transitionDelay : null,
      fillBDur: fillB ? getComputedStyle(fillB).transitionDuration : null,

      mainPadBottom: mainEl ? getComputedStyle(mainEl).paddingBottom : null,
      tabbar: box(tabbar),
      // 滚动区能不能滚(有溢出余量)
      mainScrollable: mainEl ? mainEl.scrollHeight - mainEl.clientHeight : null,
    };
  `,
    ),
  );

/* ============================ 设置-我的账户 ============================ */
const probeSettings = (page) =>
  page.evaluate(
    new Function(
      `
    ${HELPERS}
    const saveInline = q(".warden-save-inline");
    const saveBlock = q(".warden-save-block");
    const nameInput = q(".warden-name-field input");
    const emailInput = q(".warden-email-field input");
    const openBtn = q(".warden-change-email-open");
    const section = q(".warden-change-email");
    const actions = q("app-change-email .warden-cf-actions");
    const cancelBtn = q("app-change-email .warden-cf-cancel");
    const masterField = q("app-change-email bit-form-field");
    return {
      saveInlineShown: shown(saveInline),
      saveInline: box(saveInline),
      saveBlockShown: shown(saveBlock),
      nameInput: box(nameInput),
      nameField: box(q(".warden-name-field")),
      emailInput: box(emailInput),
      openBtnShown: shown(openBtn),
      openBtn: box(openBtn),
      openBtnText: openBtn ? openBtn.textContent.trim() : null,
      sectionShown: shown(section),
      section: box(section),
      actionsShown: shown(actions),
      actions: box(actions),
      cancelShown: shown(cancelBtn),
      masterField: box(masterField),
      mainPadBottom: q("main#main-content") ? getComputedStyle(q("main#main-content")).paddingBottom : null,
      tabbar: box(q(".warden-tabbar")),
    };
  `,
    ),
  );

/* ============================== 启动 ============================== */
console.log(`\n===== 第十一批 / O 段 验证(窄屏体验修复) 目标: ${BASE} =====`);

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

/* ------------------------- ① 窄屏: 保险库页 ------------------------- */
console.log("\n① 窄屏 375×812 —— 保险库页: O1 搜索/筛选合行 + O2 新增在最右格");
await goRoute(page, "/vault", "app-vault-items");
await sleep(1200);
let v = await probeVault(page);
await page.screenshot({ path: path.join(SHOTS, "narrow-vault.png") });

// O1: 搜索与筛选开关在同一行, 且开关在搜索右侧
ck(
  "O1 搜索与「筛选」开关在同一行(垂直中心差 < 8px)",
  v.search && v.toggle && Math.abs(v.search.cy - v.toggle.cy) < 8,
  { searchCy: v.search?.cy, toggleCy: v.toggle?.cy },
);
ck("O1 「筛选」开关在搜索框右侧", v.toggle && v.search && v.toggle.left >= v.search.right - 2, {
  searchRight: v.search?.right,
  toggleLeft: v.toggle?.left,
});
ck("O1 外层矩形框的边框已去掉", v.filtersBorderTopWidth === "0px", {
  borderTopWidth: v.filtersBorderTopWidth,
});
ck("O1 搜索框仍在、可见", v.searchShown);
ck("O1 筛选开关仍是原来的那颗按钮(可展开)", v.toggleShown && !!v.toggleBtn);

// O2: 新增在最右格
ck("O2 列表里的「新增」可见", v.listBtnShown, { text: v.listBtnText });
ck("O2 页头那颗「新增」已隐藏", !v.headerBtnShown);
ck(
  "O2 「新增」落在表头最右格里(左边缘不越过该格左边缘)",
  v.listBtn && v.lastTh && v.listBtn.left >= v.lastTh.left - 1,
  { btnLeft: v.listBtn?.left, lastThLeft: v.lastTh?.left },
);
ck(
  "O2 「新增」与「名称」表头不重叠",
  v.listBtn && v.nameText && !(v.listBtn.left < v.nameText.right && v.listBtn.right > v.nameText.left),
  { btn: v.listBtn ? [v.listBtn.left, v.listBtn.right] : null, name: v.nameText ? [v.nameText.left, v.nameText.right] : null },
);
ck("O2 默认态 ⋮(选项)是隐藏的", !v.dotsShown);

// O6
{
  const reserve = parseFloat(v.mainPadBottom);
  const barH = v.tabbar ? v.tabbar.h : 0;
  ck("O6 底部留白 ≥ 底栏实高 + 12px", reserve >= barH + 12 - 0.5, {
    mainPadBottom: v.mainPadBottom,
    tabbarH: barH,
  });
}

// O3(与视口无关, 但既然在这儿就一并量)
{
  const aDur = parseFloat(v.fillADur);
  const aDelay = parseFloat(v.fillADelay);
  const bDur = parseFloat(v.fillBDur);
  const bDelay = parseFloat(v.fillBDelay);
  ck("O3 左段无延迟、0.45s", v.fillADelay === "0s" && aDur === 0.45, {
    delay: v.fillADelay,
    dur: v.fillADur,
  });
  ck("O3 右段延迟 0.45s、0.45s(左先右后)", v.fillBDelay === "0.45s" && bDur === 0.45, {
    delay: v.fillBDelay,
    dur: v.fillBDur,
  });
  // 约束是"**每段**的 delay+duration ≤ 1s"(宽度每秒更新一次, 超了会在 delay 阶段被
  // 每帧打断 → 近乎卡住)。不是三段时长相加。
  ck("O3 每段 delay+duration ≤ 1s", aDelay + aDur <= 1.0001 && bDelay + bDur <= 1.0001, {
    left: aDelay + aDur,
    right: bDelay + bDur,
  });
  ck("O3 整条扫过的总时长 = 右段 delay+duration ≤ 1s", bDelay + bDur <= 1.0001, {
    sweep: bDelay + bDur,
  });
}

/* ------------------- ② 窄屏: 选择模式(用户报的那个 bug) ------------------- */
console.log("\n② 窄屏 —— 点「选择」: 「名称」不能被按钮压住");
await page.evaluate(() => {
  const b = document.querySelector(".warden-select-toggle");
  if (b) b.click();
});
await sleep(900);
v = await probeVault(page);
await page.screenshot({ path: path.join(SHOTS, "narrow-selecting.png") });

ck("O2 选择模式: 「新增」让位(已隐藏)", !v.newbarShown);
ck("O2 选择模式: ⋮(选项)露出来", v.dotsShown);
ck(
  "O2 选择模式: 「名称」表头没被「选择」胶囊压住",
  v.nameText && v.selectBtn && !(v.selectBtn.left < v.nameText.right && v.selectBtn.right > v.nameText.left),
  {
    name: v.nameText ? [v.nameText.left, v.nameText.right] : null,
    select: v.selectBtn ? [v.selectBtn.left, v.selectBtn.right] : null,
  },
);
ck("O2 选择模式: 「名称」表头文字仍可见", !!v.nameText && v.nameText.right > v.nameText.left);
// 退回默认态
await page.evaluate(() => {
  const b = document.querySelector(".warden-select-toggle");
  if (b) b.click();
});
await sleep(700);

/* ------------------------- ③ 窄屏: 设置-我的账户 ------------------------- */
console.log("\n③ 窄屏 —— 设置-我的账户: O4 保存右移 + O5 更改电子邮箱折叠");
await goRoute(page, "/settings/account", "app-profile");
await sleep(1500);
let s = await probeSettings(page);
await page.screenshot({ path: path.join(SHOTS, "narrow-settings.png") });

ck("O4 窄屏: 行内「保存」可见", s.saveInlineShown);
ck("O4 窄屏: 官方原位那颗「保存」已隐藏", !s.saveBlockShown);
ck(
  "O4 「保存」在「名称」输入框右侧",
  s.saveInline && s.nameInput && s.saveInline.left >= s.nameInput.right - 2,
  { inputRight: s.nameInput?.right, btnLeft: s.saveInline?.left },
);
ck(
  "O4 「保存」与输入框底边基本对齐(差 ≤ 6px)",
  s.saveInline && s.nameInput && Math.abs(s.saveInline.bottom - s.nameInput.bottom) <= 6,
  { inputBottom: s.nameInput?.bottom, btnBottom: s.saveInline?.bottom },
);

ck("O5 窄屏: 「更改电子邮箱」整块默认隐藏", !s.sectionShown);
ck("O5 窄屏: 邮件行右侧的入口可见", s.openBtnShown, { text: s.openBtnText });

// 点开
await page.evaluate(() => {
  const b = document.querySelector(".warden-change-email-open");
  if (b) b.click();
});
await sleep(900);
s = await probeSettings(page);
await page.screenshot({ path: path.join(SHOTS, "narrow-settings-open.png") });

ck("O5 点「更改」后整块展开", s.sectionShown);
ck("O5 展开后「继续/取消」可见", s.actionsShown && s.cancelShown);
ck(
  "O5 「继续/取消」在表单字段**上面**",
  s.actions && s.masterField && s.actions.top < s.masterField.top,
  { actionsTop: s.actions?.top, fieldTop: s.masterField?.top },
);
ck("O5 展开后入口按钮让位(已隐藏)", !s.openBtnShown);

// 点取消 → 收起
await page.evaluate(() => {
  const b = document.querySelector("app-change-email .warden-cf-cancel");
  if (b) b.click();
});
await sleep(900);
s = await probeSettings(page);
ck("O5 点「取消」后整块收起", !s.sectionShown);
ck("O5 收起后入口按钮又回来", s.openBtnShown);

/* --------------------------- ④ 桌面 1280×900 --------------------------- */
console.log("\n④ 桌面 1280×900 —— 必须与官方一致(不刷新, 直接改视口)");
await page.setViewportSize(DESKTOP);
await sleep(1200);

// 桌面: 设置页
s = await probeSettings(page);
await page.screenshot({ path: path.join(SHOTS, "desktop-settings.png") });
ck("桌面 O4: 行内「保存」不显示", !s.saveInlineShown);
ck("桌面 O4: 官方原位那颗「保存」在", s.saveBlockShown);
ck("桌面 O5: 「更改电子邮箱」整块常显", s.sectionShown);
ck("桌面 O5: 邮件行那颗入口不显示", !s.openBtnShown);
ck("桌面 O5: 未验证时「取消」不显示(与官方一致)", !s.cancelShown);

// 桌面: 保险库页
await goRoute(page, "/vault", "app-vault-items");
await sleep(1200);
v = await probeVault(page);
await page.screenshot({ path: path.join(SHOTS, "desktop-vault.png") });
ck("桌面 O1: 外层矩形框的边框仍在", v.filtersBorderTopWidth !== "0px", {
  borderTopWidth: v.filtersBorderTopWidth,
});
// 桌面端 J9 的开关本来就不渲染(官方行为), 所以这里验的是"开关不在" + "筛选区块仍常显",
// 而不是"开关在搜索下面" —— 我第一版写成了后者, 断言本身就是错的。
ck("桌面 O1: 「筛选」开关不渲染(官方桌面无此开关)", !v.toggleShown);
ck("桌面 O1: 筛选区块仍在页面里", v.filtersBodyShown);
{
  const bodyDisplay = await page.evaluate(() =>
    getComputedStyle(document.querySelector('[data-testid="filters-body"]')).display,
  );
  ck("桌面 O1: filters-body 仍是官方的块级流", bodyDisplay === "block", { display: bodyDisplay });
}
ck("桌面 O2: 「新增」在页头, 可见", v.headerBtnShown);
ck("桌面 O2: 最右格那颗「新增」不渲染", !v.newbarShown);
ck("桌面 O2: 列表工具条 .warden-headbar 不渲染", !v.headbarShown);
{
  const reserve = parseFloat(v.mainPadBottom);
  ck("桌面 O6: 滚动区仍是官方的 32px 留白", reserve === 32, { mainPadBottom: v.mainPadBottom });
}

/* --------------------- ⑤ 桌面 → 窄屏(不刷新) --------------------- */
console.log("\n⑤ 桌面 → 窄屏 resize(不刷新): 切换必须跟着走");
await page.setViewportSize(NARROW);
await sleep(1200);
v = await probeVault(page);
ck("resize 后 O2 最右格的「新增」又可见", v.newbarShown);
ck("resize 后 O2 页头那颗又隐藏", !v.headerBtnShown);
await goRoute(page, "/settings/account", "app-profile");
await sleep(1400);
s = await probeSettings(page);
ck("resize 后 O4 行内「保存」又可见", s.saveInlineShown);
ck("resize 后 O5 整块又收起", !s.sectionShown);
ck("resize 后 O5 入口按钮又可见", s.openBtnShown);
ck(
  "resize 后 O6 底部留白又是「实高 + 12px」",
  parseFloat(s.mainPadBottom) >= (s.tabbar ? s.tabbar.h : 0) + 12 - 0.5,
  { mainPadBottom: s.mainPadBottom, tabbarH: s.tabbar?.h },
);

/* ---------------- ⑤b 窄屏 + 模拟 iOS 安全区(变量注入) ----------------
 * 无刘海设备上 env(safe-area-inset-bottom) 恒为 0, 浏览器里根本量不到"刘海机型"那一档。
 * 所以把安全区抽成了 --warden-safe-bottom(见 vaultwarden.css 的 :root);
 * 这里直接把它改成 34px, 就能把底栏/留白在刘海机型上的表现复现出来 —— 这是"共源"这个
 * 设计的意义所在: 如果哪天有人把底栏高度或留白写成字面量, 这四条会立刻炸。
 */
console.log("\n⑤b 窄屏 + 模拟 34px 安全区: 底栏与底部留白必须一起长高(同一个源头)");
await goRoute(page, "/vault", "app-vault-items");
await sleep(1200);
v = await probeVault(page);
{
  const baseBar = v.tabbar ? v.tabbar.h : 0;
  ck("安全区=0 时底栏实高 63px(62 + 1px 上边框)", Math.abs(baseBar - 63) <= 1, {
    tabbarH: baseBar,
  });
}
await page.evaluate(() =>
  document.documentElement.style.setProperty("--warden-safe-bottom", "34px"),
);
await sleep(400);
v = await probeVault(page);
{
  const safeBar = v.tabbar ? v.tabbar.h : 0;
  const safeReserve = parseFloat(v.mainPadBottom);
  ck("安全区=34px 时底栏实高 97px(62 + 1 + 34)", Math.abs(safeBar - 97) <= 1, {
    tabbarH: safeBar,
  });
  ck("安全区=34px 时底部留白 109px(随底栏一起长高)", Math.abs(safeReserve - 109) <= 1, {
    mainPadBottom: v.mainPadBottom,
  });
  ck("安全区=34px 时留白仍 ≥ 实高 + 12px(最后一条没被压住)", safeReserve >= safeBar + 12 - 0.5, {
    reserve: safeReserve,
    barH: safeBar,
  });
}
// 撤掉模拟 —— 证明留白是"从变量推导"出来的, 不是抄死的字面量
await page.evaluate(() => document.documentElement.style.removeProperty("--warden-safe-bottom"));
await sleep(400);
v = await probeVault(page);
ck(
  "撤掉模拟后底栏/留白回到 63px / 75px",
  Math.abs((v.tabbar ? v.tabbar.h : 0) - 63) <= 1 &&
    Math.abs(parseFloat(v.mainPadBottom) - 75) <= 1,
  { tabbarH: v.tabbar?.h, mainPadBottom: v.mainPadBottom },
);

/* --------------------------- ⑥ 控制台错误 --------------------------- */
console.log("\n⑥ 控制台/页面错误");
console.log(
  `   hard error: ${hardErrors.length} 条; CSP(style-src) 噪声: ${cspNoise.length} 条`,
);
if (hardErrors.length) console.log("   " + hardErrors.slice(0, 5).join("\n   "));
// CSP 噪声单独打两条样本 —— 它不计失败, 但要能一眼看出是不是自己这轮新引入的
if (cspNoise.length) console.log("   CSP 样本: " + cspNoise.slice(0, 2).join(" | "));
ck("全程无未捕获异常/其它 console error(CSP 噪声单独计)", hardErrors.length === 0, {
  count: hardErrors.length,
  sample: hardErrors.slice(0, 3),
});

/* ------------------------------ 汇总 ------------------------------ */
const pass = results.filter((r) => r.ok).length;
console.log(`\n===== 结果: ${pass}/${results.length} =====`);
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log("失败项:");
  failed.forEach((f) => console.log("  - " + f.name));
}
console.log(`截图: ${SHOTS}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
