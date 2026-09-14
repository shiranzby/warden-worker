/**
 * 第十八批(V 段)**线上**验收 —— 五个问题各在真站(shypwd.cc.cd)上断一次。
 *
 * 为什么必须有这一层: 本地 dev server 是开发产物 + 本机网络, 与"用户手机打开 shypwd.cc.cd"
 * 不是同一件事。产物级 grep(`vw-version.json` / `main.js` / `vaultwarden.css`)只能证明
 * "文件换了", 证明不了"行为对了"。
 *
 * 🔴 本机**直连 shypwd.cc.cd 是不通的**(http=000), 所以浏览器必须显式挂代理
 *    (`chromium.launch({ proxy: { server } })`)—— 这点与 curl 的 `-x` 一致。
 *
 * 用法:
 *   WARDEN_TEST_BASE=https://shypwd.cc.cd WARDEN_TEST_PROXY=http://127.0.0.1:7890 \
 *     node .deploycheck/probe-v18-live.mjs
 *
 * ⚠️ 深色主题这一段**只动 <html> 上的类**(`theme_dark`/`theme_light`), 不写 localStorage、
 *    不点设置页的开关 —— 探针跑完不留痕(改的只是当前这个标签页的 DOM)。
 *    它验的正是 V5 的实质: "线上那份 vaultwarden.css 里的 `html.theme_dark` 规则是否真的生效"。
 *
 * 探针顺序按 MEMORY ⑮: 所有"量浮层之外页面"的断言都排在打开对话框**之前** ——
 * cdk overlay 不随路由卸载, 开着会把 main#main-content 压成 20px 宽。
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep, SHOTS } from "./b8-lib.mjs";

const PROXY = process.env.WARDEN_TEST_PROXY || "http://127.0.0.1:7890";
const OUT = path.join(SHOTS, "v18-live");
fs.mkdirSync(OUT, { recursive: true });

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  proxy: { server: PROXY },
});
console.log(`BASE = ${BASE}   proxy = ${PROXY}`);

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
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 180)));
await ensureLoggedIn(page, ctx, { verbose: false });
const shot = (n) => page.screenshot({ path: path.join(OUT, n), fullPage: false });

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

/** 线上版本号(顺带取证 "跑的就是 v2026.8.8")。 */
const version = await page.evaluate(async () => {
  try {
    return await (await fetch("vw-version.json", { cache: "no-store" })).json();
  } catch (e) {
    return { error: String(e) };
  }
});
console.log(`线上 vw-version.json = ${JSON.stringify(version)}`);
check("⓪ 线上产物就是 v2026.8.8", version && version.version === "2026.8.8", JSON.stringify(version));

/* =====================================================================
 * ⓪ 清场 —— 打开对话框之前先把列表页量完
 * ===================================================================== */
console.log("\n########## ⓪ 清场 ##########");
await goRoute(page, "/sends", "tools-send-list", 25000);
await sleep(2500);
check("⓪ 无遗留对话框", await closeAllDialogs());

/* =====================================================================
 * 问题 3 + 4: 发送列表(有内容)
 * ===================================================================== */
console.log("\n########## ③④ 发送列表(全部 Send) ##########");
await goRoute(page, "/sends", "tools-send-list", 25000);
await sleep(2500);

const list = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const r = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), right: +b.right.toFixed(1), bottom: +b.bottom.toFixed(1) };
  };
  const filt = q("main#main-content tools-send-list > .warden-send-filters");
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
    if (cr) thText = { right: +cr.right.toFixed(1) };
  }
  return {
    filters: r(filt),
    group: r(group),
    newBtn: r(newBtn),
    newInner: r(newInner),
    toggleCount: toggles.length,
    hasDropdownFallback: !!q("main#main-content tools-send-list bit-toggle-dropdown"),
    search: r(search),
    gapSearchFilters: search && filt ? +(filt.getBoundingClientRect().top - search.getBoundingClientRect().bottom).toFixed(1) : null,
    th: r(th),
    thText,
    dot: r(dot),
    rowCount: document.querySelectorAll("main#main-content tools-send-table tbody tr").length,
    tableRight: (() => { const t = q("main#main-content tools-send-table table"); return t ? +t.getBoundingClientRect().right.toFixed(1) : null; })(),
  };
});
console.log("  " + JSON.stringify(list));
await shot("03-list-full.png");

check("④a 搜索栏与切换行之间留了小空隙(6px)", list.gapSearchFilters === 6, `gap=${list.gapSearchFilters}`);
check("④b 有内容时搜索栏存在", !!list.search);
check("③b 切换条没降级成下拉框", !list.hasDropdownFallback && list.toggleCount === 3, `count=${list.toggleCount}`);
const perToggle = list.group ? (list.group.w - 18) / 3 : 0;
check(
  "③b 新增 Send 与单个切换等宽(四等均分)",
  list.newBtn && Math.abs(list.newBtn.w - perToggle) <= 1.5 && list.newBtn.w > 40,
  `new=${list.newBtn && list.newBtn.w} toggle=${perToggle.toFixed(1)} group=${list.group && list.group.w}`,
);
check("③b 新增 Send 高度与切换条一致(32px)", list.newInner && Math.abs(list.newInner.h - 32) <= 1, `h=${list.newInner && list.newInner.h}`);
check(
  "③b 两个控件之间留了 4px 以区分",
  list.group && list.newBtn ? Math.abs(list.group.right + 4 - list.newBtn.x) <= 1.5 : false,
  `group.right=${list.group && list.group.right} new.x=${list.newBtn && list.newBtn.x}`,
);
check("③a 选项列宽 = 56px(有内容)", list.th && Math.abs(list.th.w - 56) <= 1, `w=${list.th && list.th.w}`);
check(
  "③a 表头「选项」与 ⋯ 按钮右对齐(有内容)",
  list.thText && list.dot ? Math.abs(list.thText.right - list.dot.right) <= 1.5 : false,
  `thText.right=${list.thText && list.thText.right} dot.right=${list.dot && list.dot.right}`,
);

/* ---------- 切「文件 Send」(V4 的核心: 搜索栏不再消失) ---------- */
console.log("\n########## ④ 切到「文件 Send」 ##########");
const tgs = page.locator("main#main-content tools-send-list > .warden-send-filters > bit-toggle-group bit-toggle");
console.log("  切换项 =", JSON.stringify(await tgs.allInnerTexts()));
await tgs.nth(2).click();
await sleep(2500);
const empty = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const th = q("main#main-content tools-send-table thead th:last-child");
  let thText = null;
  if (th) {
    const rg = document.createRange();
    rg.selectNodeContents(th);
    const cr = rg.getClientRects()[0];
    if (cr) thText = { right: +cr.right.toFixed(1) };
  }
  const search = q("main#main-content tools-send-search");
  const filt = q("main#main-content tools-send-list > .warden-send-filters");
  const t = q("main#main-content tools-send-table table");
  return {
    hash: location.hash,
    searchBarPresent: !!search,
    searchInputPresent: !!q("main#main-content tools-send-search input"),
    rowCount: document.querySelectorAll("main#main-content tools-send-table tbody tr").length,
    th: th ? +th.getBoundingClientRect().width.toFixed(1) : null,
    thText,
    tableRight: t ? +t.getBoundingClientRect().right.toFixed(1) : null,
    gapSearchFilters: search && filt ? +(filt.getBoundingClientRect().top - search.getBoundingClientRect().bottom).toFixed(1) : null,
  };
});
console.log("  " + JSON.stringify(empty));
await shot("04-list-empty.png");
check("④b 切到「文件 Send」后搜索栏**仍在**(V4 核心修复)", empty.searchBarPresent && empty.searchInputPresent, `hash=${empty.hash} rows=${empty.rowCount}`);
check("③a 选项列宽 = 56px(无内容)", empty.th !== null && Math.abs(empty.th - 56) <= 1, `w=${empty.th}`);
check(
  "③a 无内容时表头仍与 ⋯ 同列(不再向左偏移)",
  empty.thText && empty.tableRight ? Math.abs(empty.thText.right - (empty.tableRight - 12)) <= 1.5 : false,
  `thText.right=${empty.thText && empty.thText.right} 期望=${empty.tableRight - 12}`,
);
check("④a 无内容时也留同一空隙", empty.gapSearchFilters === 6, `gap=${empty.gapSearchFilters}`);

/* =====================================================================
 * 问题 5: 深色主题(仍在无浮层状态)
 * ===================================================================== */
console.log("\n########## ⑤ 应用内深色主题 ##########");
const colorOf = (sel, prop) =>
  page.evaluate(
    ([s, p]) => {
      const el = document.querySelector(s);
      return el ? getComputedStyle(el)[p] : null;
    },
    [sel, prop],
  );
const setTheme = (cls) =>
  page.evaluate((c) => {
    document.documentElement.classList.remove("theme_dark", "theme_light");
    document.documentElement.classList.add(c);
  }, cls);

await setTheme("theme_light");
await sleep(600);
const lightBase = { tabbar: await colorOf(".warden-tabbar", "backgroundColor") };
console.log("  浅色基线:", JSON.stringify(lightBase));
check("⑤ 浅色底栏仍是白底(未回归)", lightBase.tabbar === "rgb(255, 255, 255)", lightBase.tabbar);

await setTheme("theme_dark");
await sleep(900);
const darkTabbar = { bg: await colorOf(".warden-tabbar", "backgroundColor") };
console.log("  深色底栏:", JSON.stringify(darkTabbar));
check("⑤1 底栏跟随应用内深色", darkTabbar.bg === "rgb(31, 35, 41)", `bg=${darkTabbar.bg}`);

await goRoute(page, "/totp", undefined, 25000);
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
    search: g(".warden-auth-search", ["backgroundColor"]),
    card: g(".warden-auth-card", ["backgroundColor"]),
    row: g(".warden-auth-row", ["borderBottomColor"]),
    chip: g(".warden-totp-chip", ["backgroundColor"]),
    ring: g(".warden-totp-ring", ["boxShadow"]),
    digits: g(".warden-totp-digits", ["color"]),
    rowCount: document.querySelectorAll(".warden-auth-row").length,
  };
});
console.log("  深色验证码页:", JSON.stringify(darkTotp));
await shot("05-totp-dark.png");
check("⑤3 验证码页搜索条目输入框已变深", darkTotp.search && darkTotp.search.backgroundColor === "rgb(38, 43, 51)", JSON.stringify(darkTotp.search));
check("⑤3 验证码页卡片已变深", darkTotp.card && darkTotp.card.backgroundColor === "rgb(38, 43, 51)", JSON.stringify(darkTotp.card));
check("⑤2 TOTP 徽章底色不再是淡蓝", darkTotp.chip && darkTotp.chip.backgroundColor !== "rgb(238, 243, 255)", JSON.stringify(darkTotp.chip));
check("⑤2 TOTP 倒计时数字已反色", darkTotp.digits && darkTotp.digits.color !== "rgb(23, 93, 220)", JSON.stringify(darkTotp.digits));
check("⑤2 TOTP 徽章外框已适配", darkTotp.ring && !/185, 205, 243/.test(darkTotp.ring.boxShadow), JSON.stringify(darkTotp.ring));

await goRoute(page, "/settings/account", undefined, 25000);
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
    card: g(".warden-acctcard", ["backgroundColor"]),
    name: g(".warden-acct-name", ["color"]),
    lock: g(".warden-acct-acts button", ["color"]),
  };
});
console.log("  深色账户页:", JSON.stringify(darkAcct));
await shot("05-account-dark.png");
check("⑤4 账户卡片(头像/昵称/锁定注销)背景已变深", darkAcct.card && darkAcct.card.backgroundColor === "rgb(38, 43, 51)", JSON.stringify(darkAcct.card));
check("⑤4 昵称已适配", darkAcct.name && darkAcct.name.color === "rgb(243, 244, 246)", JSON.stringify(darkAcct.name));

await setTheme("theme_light");
await sleep(600);
check("⑤ 还原浅色后底栏回到白底", (await colorOf(".warden-tabbar", "backgroundColor")) === "rgb(255, 255, 255)");

/* =====================================================================
 * 问题 1 + 2: 打开「新增文本 Send」对话框(最后做)
 * ===================================================================== */
console.log("\n########## ①② 新增文本 Send 对话框 ##########");
await goRoute(page, "/sends", "tools-send-list", 25000);
await sleep(2500);
await closeAllDialogs();
const entry = page.locator("main#main-content tools-send-list > .warden-send-filters > .warden-send-filters-new button");
console.log("  新增入口数量 =", await entry.count());
await entry.first().click();
await sleep(1000);
await page.locator('.cdk-overlay-container button:has-text("文本 Send")').first().click();
await sleep(3000);

const dlg = await page.evaluate(() => {
  const d = document.querySelector("bit-dialog");
  if (!d) return { ok: false };
  const b = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), y: +r.y.toFixed(1), x: +r.x.toFixed(1), bottom: +r.bottom.toFixed(1), cy: +(r.y + r.height / 2).toFixed(1) };
  };
  const rowOf = (el) => {
    let e = el && el.parentElement;
    for (let i = 0; i < 4 && e; i++) {
      if (getComputedStyle(e).display === "flex") return e;
      e = e.parentElement;
    }
    return null;
  };
  const sec = d.querySelector(":scope > section");
  const hdr = d.querySelector(":scope > section > header");
  const ftr = d.querySelector(":scope > section > footer");
  const fields = {};
  for (const [k, sel] of Object.entries({
    name: 'input[formcontrolname="name"]',
    text: 'textarea[formcontrolname="text"]',
  })) {
    const el = d.querySelector(sel);
    const row = rowOf(el);
    fields[k] = { ctl: b(el), row: b(row), dCy: el && row ? +(b(el).cy - b(row).cy).toFixed(1) : null };
  }
  const t = document.getElementById("warden-tabbar");
  return {
    ok: true,
    header: hdr ? { disp: getComputedStyle(hdr).display } : null,
    footer: b(ftr),
    tabbar: t ? { disp: getComputedStyle(t).display, y: +t.getBoundingClientRect().y.toFixed(1) } : null,
    selectBox: b(d.querySelector("bit-select")),
    footerBtns: ftr ? [...ftr.querySelectorAll(":scope > button")].map((x) => ({ txt: (x.innerText || "").trim(), w: +x.getBoundingClientRect().width.toFixed(1), h: +x.getBoundingClientRect().height.toFixed(1) })) : [],
    fields,
    options: {
      disclosureHidden: (() => {
        const dd = d.querySelector(".warden-send-options bit-disclosure");
        return dd ? dd.className.includes("tw-hidden") : null;
      })(),
      cardVisible: (() => {
        const c = d.querySelector(".warden-send-options bit-card");
        if (!c) return null;
        return c.getBoundingClientRect().height > 0 && getComputedStyle(c).display !== "none";
      })(),
      toggleVisible: (() => {
        const x = d.querySelector(".warden-send-options-toggle");
        return x ? x.getBoundingClientRect().height > 0 : null;
      })(),
    },
  };
});
if (!dlg.ok) {
  console.log("  ❌ 对话框没打开");
  fail++;
} else {
  console.log("  " + JSON.stringify(dlg));
  await shot("01-dialog-collapsed.png");
  check("②a 顶部「新增文本 Send」整条已隐藏", dlg.header && dlg.header.disp === "none", JSON.stringify(dlg.header));
  check("②d 底部导航栏保留(U3 不再对发送对话框生效)", dlg.tabbar && dlg.tabbar.disp !== "none", JSON.stringify(dlg.tabbar));
  check("②d 页脚没被底栏盖住", dlg.footer && dlg.tabbar ? dlg.footer.bottom <= dlg.tabbar.y + 1 : false, `footer.bottom=${dlg.footer && dlg.footer.bottom} tabbar.y=${dlg.tabbar && dlg.tabbar.y}`);
  const hs = ["name", "text"].map((k) => dlg.fields[k].ctl && dlg.fields[k].ctl.h);
  check("① 名称/文本输入框高度统一 = 38px", hs.every((h) => h !== null && Math.abs(h - 38) <= 1), JSON.stringify(hs));
  check("① 下拉框同口径(38px)", dlg.selectBox && Math.abs(dlg.selectBox.h - 38) <= 1, `h=${dlg.selectBox && dlg.selectBox.h}`);
  for (const k of ["name", "text"]) {
    check(`① ${k} 内容垂直居中(dCy≈0)`, Math.abs(dlg.fields[k].dCy) <= 1, `dCy=${dlg.fields[k].dCy}`);
  }
  check("②b 附加选项默认收起", dlg.options.disclosureHidden === true && dlg.options.cardVisible === false, JSON.stringify(dlg.options));
  check("②b 附加选项标题可点(箭头在)", dlg.options.toggleVisible === true, JSON.stringify(dlg.options));
  check(
    "②c 保存/取消均分同一行",
    dlg.footerBtns.length === 2 && Math.abs(dlg.footerBtns[0].w - dlg.footerBtns[1].w) <= 2,
    JSON.stringify(dlg.footerBtns),
  );

  console.log("\n  --- 点开「附加选项」---");
  await page.locator(".warden-send-options-toggle").first().click();
  await sleep(1200);
  await page.evaluate(() => {
    const sec = document.querySelector("bit-dialog > section");
    sec.scrollTop = sec.scrollHeight;
  });
  await sleep(800);
  const expanded = await page.evaluate(() => {
    const d = document.querySelector("bit-dialog");
    const card = d.querySelector(".warden-send-options bit-card");
    const ftr = d.querySelector(":scope > section > footer");
    const t = document.getElementById("warden-tabbar");
    const R = (e) => (e ? e.getBoundingClientRect() : null);
    const cR = R(card), fR = R(ftr), tR = R(t);
    const notes = d.querySelector('textarea[formcontrolname="notes"]');
    const maxa = d.querySelector('input[formcontrolname="maxAccessCount"]');
    const rowOf = (el) => {
      let e = el && el.parentElement;
      for (let i = 0; i < 4 && e; i++) {
        if (getComputedStyle(e).display === "flex") return e;
        e = e.parentElement;
      }
      return null;
    };
    const cyOf = (el) => (el ? +(el.getBoundingClientRect().y + el.getBoundingClientRect().height / 2).toFixed(1) : null);
    return {
      cardH: cR ? +cR.height.toFixed(1) : null,
      footerVisibleAboveTabbar: fR && tR ? fR.bottom <= tR.y + 1 : null,
      footerAfterCard: cR && fR ? fR.top >= cR.bottom - 1 : null,
      notesH: notes ? +notes.getBoundingClientRect().height.toFixed(1) : null,
      notesDCy: notes ? +(cyOf(notes) - cyOf(rowOf(notes))).toFixed(1) : null,
      maxAccessH: maxa ? +maxa.getBoundingClientRect().height.toFixed(1) : null,
      maxAccessDCy: maxa ? +(cyOf(maxa) - cyOf(rowOf(maxa))).toFixed(1) : null,
      maxAccessPlaceholder: maxa ? maxa.placeholder : null,
      suffixCy: [...d.querySelectorAll("[bitsuffix] button")].map(cyOf),
    };
  });
  console.log("  展开后:", JSON.stringify(expanded));
  await shot("02-dialog-expanded-bottom.png");
  check("②b 点标题后附加选项展开", expanded.cardH !== null && expanded.cardH > 50, `cardH=${expanded.cardH}`);
  check("②c 展开后滚到底, 页脚仍完整露在底栏之上", expanded.footerVisibleAboveTabbar === true, JSON.stringify(expanded));
  check("②c 展开后页脚仍在附加选项下方", expanded.footerAfterCard === true, JSON.stringify(expanded));
  check("① 私密备注高度 = 38px", expanded.notesH !== null && Math.abs(expanded.notesH - 38) <= 1, `h=${expanded.notesH}`);
  check("① 私密备注垂直居中", Math.abs(expanded.notesDCy) <= 1, `dCy=${expanded.notesDCy}`);
  check("① 最大访问次数高度 = 38px", expanded.maxAccessH !== null && Math.abs(expanded.maxAccessH - 38) <= 1, `h=${expanded.maxAccessH}`);
  check("① 最大访问次数(含「不限制」)垂直居中", Math.abs(expanded.maxAccessDCy) <= 1, `dCy=${expanded.maxAccessDCy}`);
  check("① placeholder 仍是「不限制」", expanded.maxAccessPlaceholder === "不限制", `placeholder=${expanded.maxAccessPlaceholder}`);
}

console.log("\npageerrors:", errs.length ? errs : "无");
check("⓪ 无运行期页面错误", errs.length === 0, errs.join(" | "));

console.log(`\n================ ${pass} 通过 / ${fail} 失败 ================`);
console.log(`截图目录: ${OUT}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
