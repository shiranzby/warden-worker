/**
 * 第十八批(V 段) 窄屏验收 —— 五个问题逐条断, 全部在 dev server(8099) 上跑。
 *   node .deploycheck/probe-v18-verify.mjs
 *
 * 探针顺序按 MEMORY ⑮ 安排: 所有"量浮层之外的页面"的断言都排在打开对话框**之前** ——
 * cdk overlay 不随路由卸载, 开着会把 main#main-content 压成 20px 宽, 之后量的东西
 * 全是退化盒, 与"功能没生效"长得一模一样。
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep, SHOTS } from "./b8-lib.mjs";

const OUT = path.join(SHOTS, "v18");
fs.mkdirSync(OUT, { recursive: true });
let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
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
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));
await ensureLoggedIn(page, ctx, { verbose: false });
console.log(`BASE = ${BASE}`);
const shot = (n) => page.screenshot({ path: path.join(OUT, n) });

/** 关掉任何还开着的 bit-dialog(cdk 抽屉不随路由卸载)。 */
async function closeAllDialogs() {
  for (let i = 0; i < 6; i++) {
    if ((await page.evaluate(() => document.querySelectorAll("bit-dialog").length)) === 0) return true;
    const ok = await page.evaluate(() => {
      const ds = [...document.querySelectorAll("bit-dialog")];
      const d = ds[ds.length - 1];
      const b =
        d.querySelector("footer button[bitdialogclose]") ||
        d.querySelector("footer button:last-child") ||
        d.querySelector("button[biticonbutton='bwi-close']");
      if (b) {
        b.click();
        return true;
      }
      return false;
    });
    if (!ok) return false;
    await sleep(1500);
  }
  return (await page.evaluate(() => document.querySelectorAll("bit-dialog").length)) === 0;
}

const R = (b) => (b ? `[${Math.round(b.y)}..${Math.round(b.bottom)}]` : "null");

console.log("\n########## ⓪ 清场 ##########");
await goRoute(page, "/sends", "tools-send-list", 25000);
await sleep(2000);
check("⓪ 无遗留对话框", await closeAllDialogs());

/* =====================================================================
 * 问题 3 + 4: 发送列表页(无浮层) —— 先量
 * ===================================================================== */
console.log("\n########## ③④ 发送列表(全部 Send, 有内容) ##########");
await page.evaluate(() => {
  location.hash = "#/sends";
});
await sleep(3000);

const list = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const r = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), right: +b.right.toFixed(1), bottom: +b.bottom.toFixed(1), cy: +(b.y + b.height / 2).toFixed(1) };
  };
  const filt = q('main#main-content tools-send-list > .warden-send-filters');
  const group = q("main#main-content tools-send-list > .warden-send-filters > bit-toggle-group");
  const newBtn = q("main#main-content tools-send-list > .warden-send-filters > .warden-send-filters-new");
  const newInner = newBtn ? newBtn.querySelector("button") : null;
  const search = q("main#main-content tools-send-search");
  const toggles = [...document.querySelectorAll("main#main-content tools-send-list > .warden-send-filters > bit-toggle-group bit-toggle")];
  const th = q("main#main-content tools-send-table thead th:last-child");
  const td = q("main#main-content tools-send-table tbody tr:first-child td:last-child");
  const dot = td ? td.querySelector("button") : null;
  let thText = null;
  if (th) {
    const rg = document.createRange();
    rg.selectNodeContents(th);
    const cr = rg.getClientRects()[0];
    if (cr) thText = { x: +cr.x.toFixed(1), right: +cr.right.toFixed(1), w: +cr.width.toFixed(1) };
  }
  return {
    filters: r(filt),
    filtersCls: filt ? filt.className : null,
    group: r(group),
    groupDisplay: group ? getComputedStyle(group).display : null,
    newBtn: r(newBtn),
    newInner: r(newInner),
    newInnerTag: newInner ? newInner.tagName.toLowerCase() : null,
    toggleCount: toggles.length,
    toggleWidths: toggles.map((e) => +e.getBoundingClientRect().width.toFixed(1)),
    toggleVisible: toggles.map((e) => getComputedStyle(e).display !== "none"),
    hasDropdownFallback: !!q("main#main-content tools-send-list bit-toggle-dropdown"),
    search: r(search),
    gapSearchFilters: search && filt ? +(filt.getBoundingClientRect().top - search.getBoundingClientRect().bottom).toFixed(1) : null,
    th: r(th),
    thText,
    td: r(td),
    dot: r(dot),
    rowCount: document.querySelectorAll("main#main-content tools-send-table tbody tr").length,
    tableRight: (() => { const t = q("main#main-content tools-send-table table"); return t ? +t.getBoundingClientRect().right.toFixed(1) : null; })(),
  };
});
console.log("  " + JSON.stringify(list, null, 1).split("\n").join("\n  "));
await shot("03-list-full.png");

check("④a 搜索栏与切换行之间有空隙(6px)", list.gapSearchFilters === 6, `gap=${list.gapSearchFilters}`);
check("④b 有内容时搜索栏存在", !!list.search);
check("③b 切换条没有降级成下拉框", !list.hasDropdownFallback && list.toggleCount === 3, `count=${list.toggleCount} dropdown=${list.hasDropdownFallback}`);
const q4 = list.newBtn ? list.newBtn.w : 0;
const g3 = list.group ? list.group.w : 0;
// 「四等均分」= 新增按钮与**单个 toggle** 等宽(切换组自带 18px 壳, 已用 flex-basis 抵掉)
const perToggle = (g3 - 18) / 3;
check(
  "③b 新增按钮与单个切换等宽(四等均分)",
  Math.abs(q4 - perToggle) <= 1.5 && q4 > 40,
  `new=${q4} toggle=${perToggle.toFixed(1)} group=${g3}`,
);
check("③b 新增按钮高度与切换条一致(32px)", list.newInner && Math.abs(list.newInner.h - 32) <= 1, `h=${list.newInner && list.newInner.h}`);
check(
  "③b 新增按钮与切换条间距很小(4px)",
  list.filters && list.group && list.newBtn
    ? Math.abs(list.group.right + 4 - list.newBtn.x) <= 1.5
    : false,
  `group.right=${list.group && list.group.right} new.x=${list.newBtn && list.newBtn.x}`,
);
check("③a 选项列宽 = 56px(有内容)", list.th && Math.abs(list.th.w - 56) <= 1, `w=${list.th && list.th.w}`);
check(
  "③a 表头「选项」右沿与 ⋯ 按钮右沿对齐(有内容)",
  list.thText && list.dot ? Math.abs(list.thText.right - list.dot.right) <= 1.5 : false,
  `thText.right=${list.thText && list.thText.right} dot.right=${list.dot && list.dot.right}`,
);

/* ---------- 无内容状态(切「文件 Send」) ---------- */
console.log("\n########## ③④ 发送列表(文件 Send, 无内容) ##########");
const tg2 = page.locator("main#main-content tools-send-list > .warden-send-filters > bit-toggle-group bit-toggle");
console.log("  切换项 =", JSON.stringify(await tg2.allInnerTexts()));
await tg2.nth(2).click();
await sleep(2500);
const empty = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const r = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { x: +b.x.toFixed(1), w: +b.width.toFixed(1), right: +b.right.toFixed(1), h: +b.height.toFixed(1) };
  };
  const th = q("main#main-content tools-send-table thead th:last-child");
  let thText = null;
  if (th) {
    const rg = document.createRange();
    rg.selectNodeContents(th);
    const cr = rg.getClientRects()[0];
    if (cr) thText = { x: +cr.x.toFixed(1), right: +cr.right.toFixed(1), w: +cr.width.toFixed(1) };
  }
  const search = q("main#main-content tools-send-search");
  const filt = q('main#main-content tools-send-list > .warden-send-filters');
  return {
    hash: location.hash,
    searchBarPresent: !!search,
    searchInputPresent: !!q("main#main-content tools-send-search input"),
    rowCount: document.querySelectorAll("main#main-content tools-send-table tbody tr").length,
    noItems: !!q("main#main-content bit-no-items"),
    th: r(th),
    thText,
    tableRight: (() => { const t = q("main#main-content tools-send-table table"); return t ? +t.getBoundingClientRect().right.toFixed(1) : null; })(),
    gapSearchFilters: search && filt ? +(filt.getBoundingClientRect().top - search.getBoundingClientRect().bottom).toFixed(1) : null,
  };
});
console.log("  " + JSON.stringify(empty, null, 1).split("\n").join("\n  "));
await shot("04-list-empty.png");
check("④b 切到「文件 Send」(无结果)搜索栏**仍在**", empty.searchBarPresent && empty.searchInputPresent, `hash=${empty.hash}`);
check("③a 选项列宽 = 56px(无内容)", empty.th && Math.abs(empty.th.w - 56) <= 1, `w=${empty.th && empty.th.w}`);
check(
  "③a 无内容时表头右沿仍贴列右沿(与 ⋯ 同列)",
  empty.thText && empty.tableRight ? Math.abs(empty.thText.right - (empty.tableRight - 12)) <= 1.5 : false,
  `thText.right=${empty.thText && empty.thText.right} 期望=${empty.tableRight - 12}`,
);
check("④a 无内容时也有同一空隙", empty.gapSearchFilters === 6, `gap=${empty.gapSearchFilters}`);

/* =====================================================================
 * 问题 5: 深色主题(仍在无浮层状态)
 * ===================================================================== */
console.log("\n########## ⑤ 深色主题适配 ##########");
const colorOf = (sel, prop) =>
  page.evaluate(
    ([s, p]) => {
      const el = document.querySelector(s);
      return el ? getComputedStyle(el)[p] : null;
    },
    [sel, prop],
  );

// 先取浅色基线(必须与改动前一致)
await page.evaluate(() => {
  document.documentElement.classList.remove("theme_dark");
  document.documentElement.classList.add("theme_light");
});
await sleep(600);
const lightBase = {
  tabbar: await colorOf(".warden-tabbar", "backgroundColor"),
  chip: await colorOf(".warden-totp-chip", "backgroundColor"),
  digits: await colorOf(".warden-totp-digits", "color"),
};
console.log("  浅色基线:", JSON.stringify(lightBase));
check("⑤ 浅色底栏仍是白底(未回归)", lightBase.tabbar === "rgb(255, 255, 255)", lightBase.tabbar);

// 挂深色
await page.evaluate(() => {
  document.documentElement.classList.remove("theme_light");
  document.documentElement.classList.add("theme_dark");
});
await sleep(800);
const darkTabbar = {
  bg: await colorOf(".warden-tabbar", "backgroundColor"),
  a: await colorOf(".warden-tabbar a", "color"),
};
console.log("  深色底栏:", JSON.stringify(darkTabbar));
check("⑤1 底栏跟随应用内深色", darkTabbar.bg === "rgb(31, 35, 41)", `bg=${darkTabbar.bg}`);

// 验证码页
await page.evaluate(() => {
  location.hash = "#/totp";
});
await sleep(3000);
const darkTotp = await page.evaluate(() => {
  const g = (sel, props) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = cs[p];
    return o;
  };
  return {
    search: g(".warden-auth-search", ["backgroundColor", "color"]),
    card: g(".warden-auth-card", ["backgroundColor"]),
    row: g(".warden-auth-row", ["borderBottomColor"]),
    name: g(".warden-auth-name", ["color"]),
    user: g(".warden-auth-user", ["color"]),
    chip: g(".warden-totp-chip", ["backgroundColor"]),
    ring: g(".warden-totp-ring", ["boxShadow"]),
    digits: g(".warden-totp-digits", ["color"]),
    next: g(".warden-totp-next", ["color"]),
    fillA: g(".warden-totp-fill-a", ["backgroundColor"]),
    rowCount: document.querySelectorAll(".warden-auth-row").length,
  };
});
console.log("  深色验证码页:", JSON.stringify(darkTotp, null, 1));
await shot("05-totp-dark.png");
check("⑤3 验证码页搜索框已变深", darkTotp.search && darkTotp.search.backgroundColor === "rgb(38, 43, 51)", JSON.stringify(darkTotp.search));
check("⑤3 验证码页卡片已变深", darkTotp.card && darkTotp.card.backgroundColor === "rgb(38, 43, 51)", JSON.stringify(darkTotp.card));
check("⑤3 验证码页每行的分隔线已变深", darkTotp.row && /255, 255, 255/.test(darkTotp.row.borderBottomColor), JSON.stringify(darkTotp.row));
check("⑤2 徽章底色不再是淡蓝", darkTotp.chip && darkTotp.chip.backgroundColor !== "rgb(238, 243, 255)", JSON.stringify(darkTotp.chip));
check("⑤2 徽章码色已反相(不再是深蓝 #175ddc)", darkTotp.digits && darkTotp.digits.color !== "rgb(23, 93, 220)", JSON.stringify(darkTotp.digits));
check("⑤2 徽章外框已适配", darkTotp.ring && darkTotp.ring.boxShadow !== "rgb(185, 205, 243) 0px 0px 0px 1px inset", JSON.stringify(darkTotp.ring));

// 账户页
await page.evaluate(() => {
  location.hash = "#/settings/account";
});
await sleep(3000);
const darkAcct = await page.evaluate(() => {
  const g = (sel, props) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = cs[p];
    return o;
  };
  return {
    card: g(".warden-acctcard", ["backgroundColor", "borderTopColor"]),
    name: g(".warden-acct-name", ["color"]),
    mail: g(".warden-acct-mail", ["color"]),
    lock: g(".warden-acct-acts button", ["color"]),
    present: !!document.querySelector(".warden-acctcard"),
  };
});
console.log("  深色账户页:", JSON.stringify(darkAcct));
await shot("05-account-dark.png");
check("⑤4 账户卡片背景已变深", darkAcct.card && darkAcct.card.backgroundColor === "rgb(38, 43, 51)", JSON.stringify(darkAcct.card));
check("⑤4 昵称/邮箱已适配", darkAcct.name && darkAcct.name.color === "rgb(243, 244, 246)", JSON.stringify(darkAcct.name));
check("⑤4 锁定/注销已适配", darkAcct.lock && darkAcct.lock.color === "rgb(122, 167, 255)", JSON.stringify(darkAcct.lock));

// 还原浅色, 免得污染后面的对话框量测
await page.evaluate(() => {
  document.documentElement.classList.remove("theme_dark");
  document.documentElement.classList.add("theme_light");
});
await sleep(600);
const backLight = { tabbar: await colorOf(".warden-tabbar", "backgroundColor") };
check("⑤ 还原浅色后底栏回到白底", backLight.tabbar === "rgb(255, 255, 255)", backLight.tabbar);

/* =====================================================================
 * 问题 1 + 2: 打开「新增文本 Send」对话框(最后做)
 * ===================================================================== */
console.log("\n########## ①② 新增文本 Send 对话框 ##########");
await goRoute(page, "/sends", "tools-send-list", 25000);
await sleep(2500);
await closeAllDialogs();
const tg3 = page.locator("main#main-content tools-send-list > .warden-send-filters > .warden-send-filters-new button");
console.log("  新增入口数量 =", await tg3.count());
await tg3.first().click();
await sleep(900);
await page.locator('.cdk-overlay-container button:has-text("文本 Send")').first().click();
await sleep(3000);
const dlg = await page.evaluate(() => {
  const d = document.querySelector("bit-dialog");
  if (!d) return { ok: false };
  const box = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      sel: el.tagName.toLowerCase(),
      x: +b.x.toFixed(1),
      y: +b.y.toFixed(1),
      w: +b.width.toFixed(1),
      h: +b.height.toFixed(1),
      cy: +(b.y + b.height / 2).toFixed(1),
      bottom: +b.bottom.toFixed(1),
      disp: cs.display,
      ovf: cs.overflowY,
      padT: cs.paddingTop,
      padB: cs.paddingBottom,
    };
  };
  const sec = d.querySelector(":scope > section");
  const hdr = d.querySelector(":scope > section > header");
  const ftr = d.querySelector(":scope > section > footer");
  const outer = d.querySelector(":scope > section > div.tw-relative");
  const scroller = d.querySelector(":scope > section > div.tw-relative > div[cdkscrollable]");
  const fieldRow = (ctl) => {
    // 输入框 → 上溯到 bit-form-field, 找那个 flex 行
    let e = ctl && ctl.parentElement;
    let flexRow = null;
    let hops = 0;
    while (e && hops++ < 4) {
      if (getComputedStyle(e).display === "flex") {
        flexRow = e;
        break;
      }
      e = e.parentElement;
    }
    return flexRow;
  };
  const ctl = (sel) => d.querySelector(sel);
  const pairs = {
    name: ctl('input[formcontrolname="name"]'),
    text: ctl('textarea[formcontrolname="text"]'),
    notes: ctl('textarea[formcontrolname="notes"]'),
    maxAccess: ctl('input[formcontrolname="maxAccessCount"]'),
  };
  const out = {};
  for (const [k, el] of Object.entries(pairs)) {
    const row = fieldRow(el);
    out[k] = { ctl: box(el), row: box(row), dCy: el && row ? +(box(el).cy - box(row).cy).toFixed(1) : null };
  }
  const suffix = [...d.querySelectorAll("[bitsuffix] button")].map(box);
  return {
    ok: true,
    section: box(sec),
    sectionScrollH: sec.scrollHeight,
    sectionClientH: sec.clientHeight,
    header: hdr ? { disp: getComputedStyle(hdr).display, h: box(hdr).h } : null,
    footer: box(ftr),
    outer: box(outer),
    scroller: box(scroller),
    viewportH: window.innerHeight,
    tabbar: (() => {
      const t = document.getElementById("warden-tabbar");
      if (!t) return null;
      const b = t.getBoundingClientRect();
      return { disp: getComputedStyle(t).display, y: +b.y.toFixed(1), h: +b.height.toFixed(1) };
    })(),
    footerBtns: ftr
      ? [...ftr.querySelectorAll(":scope > button")].map((b) => ({
          txt: (b.innerText || "").trim(),
          ...box(b),
        }))
      : [],
    fields: out,
    suffix,
    selectBox: box(ctl("bit-select")),
    optionsSummary: {
      disclosureHidden: (() => {
        const dd = d.querySelector(".warden-send-options bit-disclosure");
        return dd ? dd.className.includes("tw-hidden") : null;
      })(),
      cardVisible: (() => {
        const c = d.querySelector(".warden-send-options bit-card");
        if (!c) return null;
        const b = c.getBoundingClientRect();
        return b.height > 0 && getComputedStyle(c).display !== "none";
      })(),
      caretVisible: (() => {
        const c = d.querySelector(".warden-send-options-caret");
        return c ? getComputedStyle(c).display !== "none" : null;
      })(),
      toggleVisible: (() => {
        const t = d.querySelector(".warden-send-options-toggle");
        return t ? t.getBoundingClientRect().height > 0 : null;
      })(),
    },
    mainW: document.querySelector("main#main-content").getBoundingClientRect().width,
  };
});
console.log("  " + JSON.stringify(dlg, null, 1).split("\n").join("\n  "));
await shot("01-dialog-collapsed.png");

check("②a 对话框页头已隐藏", dlg.header && dlg.header.disp === "none", JSON.stringify(dlg.header));
check("②d 底栏保留(不再被藏掉)", dlg.tabbar && dlg.tabbar.disp !== "none", JSON.stringify(dlg.tabbar));
check("②d 页脚没被底栏盖住", dlg.footer && dlg.tabbar && dlg.footer.bottom <= dlg.tabbar.y + 1, `footer.bottom=${dlg.footer && dlg.footer.bottom} tabbar.y=${dlg.tabbar && dlg.tabbar.y}`);

const hs = ["name", "text"].map((k) => dlg.fields[k] && dlg.fields[k].ctl && dlg.fields[k].ctl.h);
console.log("  >> 折叠态可见控件高度 =", JSON.stringify(hs), " 下拉框 =", dlg.selectBox && dlg.selectBox.h);
check("① 可见的单行控件高度统一 = 38px", hs.every((h) => h !== null && Math.abs(h - 38) <= 1), JSON.stringify(hs));
check("① 下拉框同口径(38px)", dlg.selectBox && Math.abs(dlg.selectBox.h - 38) <= 1, `h=${dlg.selectBox && dlg.selectBox.h}`);
check("① text 与 name 同高", hs.length === 2 && Math.abs(hs[0] - hs[1]) <= 0.5, JSON.stringify(hs));
for (const k of ["name", "text"]) {
  const f = dlg.fields[k];
  check(`① ${k} 内容垂直居中(控件 cy ≈ 行 cy)`, f && Math.abs(f.dCy) <= 1, `dCy=${f && f.dCy} ctl=${f && f.ctl && f.ctl.cy} row=${f && f.row && f.row.cy}`);
}
check("②b 附加选项默认收起", dlg.optionsSummary.disclosureHidden === true && dlg.optionsSummary.cardVisible === false, JSON.stringify(dlg.optionsSummary));
check("②b 附加选项标题可点(箭头显示)", dlg.optionsSummary.caretVisible === true && dlg.optionsSummary.toggleVisible === true, JSON.stringify(dlg.optionsSummary));
check(
  "②c 保存/取消均分同一行",
  dlg.footerBtns.length === 2 && Math.abs(dlg.footerBtns[0].w - dlg.footerBtns[1].w) <= 2,
  JSON.stringify(dlg.footerBtns.map((b) => ({ t: b.txt, w: b.w, h: b.h }))),
);

/* ---------- 展开附加选项 ---------- */
console.log("\n  --- 点开「附加选项」---");
await page.locator(".warden-send-options-toggle").first().click();
await sleep(1200);
const afterExpand = await page.evaluate(() => {
  const d = document.querySelector("bit-dialog");
  const sec = d.querySelector(":scope > section");
  const c = d.querySelector(".warden-send-options bit-card");
  const ftr = d.querySelector(":scope > section > footer");
  const t = document.getElementById("warden-tabbar");
  const b = (e) => (e ? e.getBoundingClientRect() : null);
  const cR = b(c),
    fR = b(ftr),
    tR = b(t);
  return {
    cardH: cR ? +cR.height.toFixed(1) : null,
    footnoteAfterCard: cR && fR ? +(fR.top - cR.bottom).toFixed(1) : null,
    footerBottom: fR ? +fR.bottom.toFixed(1) : null,
    tabbarY: tR ? +tR.y.toFixed(1) : null,
    scrollH: sec.scrollHeight,
    clientH: sec.clientHeight,
    scrolled: sec.scrollTop,
  };
});
// 滚到底, 确认页脚能露出来
await page.evaluate(() => {
  const sec = document.querySelector("bit-dialog > section");
  sec.scrollTop = sec.scrollHeight;
});
await sleep(800);
const afterScroll = await page.evaluate(() => {
  const d = document.querySelector("bit-dialog");
  const ftr = d.querySelector(":scope > section > footer");
  const t = document.getElementById("warden-tabbar");
  const card = d.querySelector(".warden-send-options bit-card");
  const b = (e) => (e ? e.getBoundingClientRect() : null);
  const fR = b(ftr),
    tR = b(t),
    cR = b(card);
  return {
    footerTop: fR ? +fR.top.toFixed(1) : null,
    footerBottom: fR ? +fR.bottom.toFixed(1) : null,
    tabbarY: tR ? +tR.y.toFixed(1) : null,
    cardBottom: cR ? +cR.bottom.toFixed(1) : null,
    footerVisibleAboveTabbar: fR && tR ? fR.bottom <= tR.y + 1 : null,
    footerAfterCard: cR && fR ? fR.top >= cR.bottom - 1 : null,
  };
});
console.log("  展开后:", JSON.stringify(afterExpand));
console.log("  滚到底:", JSON.stringify(afterScroll));
await shot("02-dialog-expanded-bottom.png");
check("②b 点标题后附加选项展开", afterExpand.cardH !== null && afterExpand.cardH > 50, `cardH=${afterExpand.cardH}`);

/* ---------- 展开后复量「附加选项」里的两个控件(V1 的另一半) ---------- */
const expandedFields = await page.evaluate(() => {
  const d = document.querySelector("bit-dialog");
  const box = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { h: +b.height.toFixed(1), cy: +(b.y + b.height / 2).toFixed(1) };
  };
  const rowOf = (el) => {
    let e = el && el.parentElement;
    for (let i = 0; i < 4 && e; i++) {
      if (getComputedStyle(e).display === "flex") return e;
      e = e.parentElement;
    }
    return null;
  };
  const out = {};
  for (const [k, sel] of Object.entries({
    notes: 'textarea[formcontrolname="notes"]',
    maxAccess: 'input[formcontrolname="maxAccessCount"]',
  })) {
    const el = d.querySelector(sel);
    const row = rowOf(el);
    out[k] = { ctl: box(el), row: box(row), dCy: el && row ? +(box(el).cy - box(row).cy).toFixed(1) : null };
  }
  out.suffix = [...d.querySelectorAll("[bitsuffix] button")].map(box);
  out.placeholder = (() => {
    const i = d.querySelector('input[formcontrolname="maxAccessCount"]');
    return i ? i.placeholder : null;
  })();
  return out;
});
console.log("  展开后控件:", JSON.stringify(expandedFields));
check("① 私密备注高度 = 38px(与 Send 名称一致)", expandedFields.notes.ctl && Math.abs(expandedFields.notes.ctl.h - 38) <= 1, JSON.stringify(expandedFields.notes));
check("① 私密备注内容垂直居中", Math.abs(expandedFields.notes.dCy) <= 1, `dCy=${expandedFields.notes.dCy}`);
check("① 最大访问次数输入框高度 = 38px", expandedFields.maxAccess.ctl && Math.abs(expandedFields.maxAccess.ctl.h - 38) <= 1, JSON.stringify(expandedFields.maxAccess));
check("① 最大访问次数(含「不限制」placeholder)垂直居中", Math.abs(expandedFields.maxAccess.dCy) <= 1, `dCy=${expandedFields.maxAccess.dCy}`);
check("① placeholder 仍为「不限制」(U 段未回归)", expandedFields.placeholder === "不限制", `placeholder=${expandedFields.placeholder}`);
check(
  "① ⊖⊕ 步进按钮与输入框同中线",
  expandedFields.suffix.length === 2 && Math.abs(expandedFields.suffix[0].cy - expandedFields.maxAccess.ctl.cy) <= 1,
  `suffixCy=${expandedFields.suffix[0] && expandedFields.suffix[0].cy} ctlCy=${expandedFields.maxAccess.ctl.cy}`,
);
check("②c 展开后页脚仍紧跟附加选项之后", afterExpand.footnoteAfterCard !== null && afterExpand.footnoteAfterCard >= -1, `gap=${afterExpand.footnoteAfterCard}`);
check("②c 展开后滚到底, 页脚完整露在底栏之上", afterScroll.footerVisibleAboveTabbar === true, JSON.stringify(afterScroll));
check("②c 展开后页脚仍在附加选项下方", afterScroll.footerAfterCard === true, JSON.stringify(afterScroll));

console.log("\npageerrors:", errs.length ? errs : "无");
check("⓪ 无运行期页面错误", errs.length === 0, errs.join(" | "));

console.log(`\n================ ${pass} 通过 / ${fail} 失败 ================`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
