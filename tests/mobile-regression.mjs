/**
 * warden-worker 移动端回归测试 (shypwd.cc.cd)
 * ------------------------------------------------------------------
 * 用法:
 *   node tests/mobile-regression.mjs                # 线上, 全部
 *   node tests/mobile-regression.mjs --local        # 用本地 custom.js/css 注入验证(免部署)
 *   node tests/mobile-regression.mjs --only=layout  # 只跑布局巡检
 *   node tests/mobile-regression.mjs --only=guard   # 只跑历史 bug 回归点
 *   node tests/mobile-regression.mjs --only=func    # 只跑功能冒烟
 *   node tests/mobile-regression.mjs --shot         # 顺带出截图
 *
 * 三段:
 *   layout 13 个路由 x 3 视口: 横向溢出 / 越界元素 / 控制台错误
 *   guard  历史 bug 的回归点(每修一个 bug 就往这里加一条, 防止改回去)
 *   func   功能冒烟: 底栏 / 对话框 / 生成器 / 二级导航 / 三级 tabs / 报告 / Send
 *
 * 说明: 本套件只读, 唯一写操作是 guard 段会 PUT 一次头像(用于验证跨端同步), 用测试账号。
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

/* ============================ 配置 ============================ */
const REPO = path.resolve(import.meta.dirname, "..");
const CUSTOM = path.join(REPO, "custom");
const OUT = path.join(REPO, "tests", "shots");
const BASE = "https://shypwd.cc.cd";
const ACCOUNT = process.env.WARDEN_TEST_MAIL || "shypwd.verify.test@qq.com";
const PASSWORD = process.env.WARDEN_TEST_PASS || "VerifyTest12345!";
const CHROME = "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";
const PROXY = { server: "http://127.0.0.1:7890" };   // github / shypwd 直连不通, 必须走代理
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const argv = process.argv.slice(2);
const LOCAL = argv.includes("--local");
const SHOT = argv.includes("--shot");
const ONLY = (argv.find(a => a.startsWith("--only=")) || "").split("=")[1] || "";
const want = (s) => !ONLY || ONLY === s;

/* ============================ 工具 ============================ */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const failures = [];
const ck = (n, c, g) => {
  if (c) { pass++; console.log("  PASS " + n); }
  else { fail++; failures.push(n); console.log("  FAIL " + n + "  -> " + JSON.stringify(g)); }
};
const hdr = (s) => console.log("\n===== " + s + " =====");

const ROUTES = [
  ["#/vault", "vault"], ["#/sends", "sends"], ["#/tools", "tools"],
  ["#/tools/generator", "generator"], ["#/tools/import", "import"], ["#/tools/export", "export"],
  ["#/reports", "reports"], ["#/settings", "settings"], ["#/settings/account", "account"],
  ["#/settings/security", "security"], ["#/settings/appearance", "appearance"],
  ["#/settings/domain-rules", "domains"], ["#/settings/emergency-access", "emergency"],
];

const browser = await chromium.launch({ headless: true, executablePath: CHROME, proxy: PROXY });

async function newCtx(vw, vh, desktop = false) {
  const ctx = await browser.newContext({
    viewport: { width: vw, height: vh }, ignoreHTTPSErrors: true,
    userAgent: desktop ? undefined : UA,
    isMobile: !desktop, hasTouch: !desktop, deviceScaleFactor: 2,
  });
  if (LOCAL) {
    const JS = fs.readFileSync(path.join(CUSTOM, "custom.js"), "utf8");
    const CSS = fs.readFileSync(path.join(CUSTOM, "custom.css"), "utf8");
    await ctx.route("**/custom.js", r => r.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
    await ctx.route("**/custom.css", r => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
    await ctx.addInitScript({
      content: `(function(){var c=${JSON.stringify(CSS)};function put(){var h=document.head||document.documentElement;if(!h)return false;var s=document.createElement("style");s.textContent=c;h.appendChild(s);return true;}if(!put())document.addEventListener("DOMContentLoaded",put);})();`,
    });
    await ctx.addInitScript({ content: JS });
  }
  return ctx;
}

async function login(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(2500);
  const em = await page.$('input[type="email"], input#email');
  if (em) { await em.fill(ACCOUNT); await page.keyboard.press("Enter"); await sleep(1800); }
  for (let i = 0; i < 3; i++) {
    const pw = await page.$('input[type="password"]'); if (!pw) break;
    await pw.fill(PASSWORD); await page.keyboard.press("Enter"); await sleep(4000);
  }
  for (let i = 0; i < 4; i++) {
    if (await page.$("tr[appvaultcipherrow]")) break;
    const later = await page.$('button:has-text("稍后添加")'); if (later) { await later.click().catch(() => {}); await sleep(1200); }
    const go = await page.$('a[href="#/vault"]'); if (go) { await go.click().catch(() => {}); await sleep(2500); }
  }
  await sleep(2000);
  for (let i = 0; i < 3; i++) { const sk = await page.$('button:has-text("跳过")'); if (!sk) break; await sk.click().catch(() => {}); await sleep(1500); }
  await sleep(1800);
}

const go = async (page, h, ms = 3200) => { await page.evaluate((x) => { location.hash = x; }, h); await sleep(ms); };

/* ============================ ① 布局巡检 ============================ */
if (want("layout")) {
  hdr("① 布局巡检 (13 路由 x 3 视口)");
  for (const [vw, vh] of [[390, 844], [375, 667], [320, 568]]) {
    const ctx = await newCtx(vw, vh);
    const page = await ctx.newPage();
    const errs = [];
    page.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0, 120)); });
    page.on("pageerror", e => errs.push("PAGEERROR " + String(e).slice(0, 120)));
    await login(page);
    for (const [r, n] of ROUTES) {
      await go(page, r);
      const s = await page.evaluate(() => {
        const vw = window.innerWidth, out = [];
        document.querySelectorAll("main#main-content *").forEach(el => {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) return;
          if (b.right > vw + 2 || b.left < -2) out.push(el.tagName + "." + (el.className || "").toString().slice(0, 28));
        });
        const m = document.querySelector("main#main-content");
        return { ox: document.documentElement.scrollWidth - vw, n: out.length, off: out.slice(0, 5), txt: m ? (m.innerText || "").trim().length : 0 };
      });
      ck(`${vw}x${vh} ${r} 无横向溢出`, s.ox <= 0, s);
      ck(`${vw}x${vh} ${r} 无越界元素`, s.n === 0, s.off);
      ck(`${vw}x${vh} ${r} 有内容`, s.txt > 20, s.txt);
      if (SHOT) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, `${vw}-${n}.png`), fullPage: true }); }
    }
    ck(`${vw}x${vh} 无控制台错误`, errs.length === 0, errs.slice(0, 4));
    await ctx.close();
  }
}

/* ============================ ② 历史 bug 回归点 ============================ */
if (want("guard")) {
  hdr("② 回归点 G1 导入页下拉不被顶出屏幕 (v9)");
  for (const [vw, vh] of [[375, 667], [320, 568], [390, 844]]) {
    const ctx = await newCtx(vw, vh);
    const page = await ctx.newPage();
    await login(page);
    await go(page, "#/tools/import", 3500);
    await page.evaluate(() => { const e = document.querySelectorAll("main#main-content bit-select ng-select")[2]; if (e) e.scrollIntoView({ block: "center" }); });
    await sleep(700);
    const c = await page.evaluate(() => { const e = document.querySelectorAll("main#main-content bit-select ng-select")[2].getBoundingClientRect(); return { x: Math.round(e.x + e.width / 2), y: Math.round(e.y + e.height / 2) }; });
    await page.touchscreen.tap(c.x, c.y);
    await sleep(1100);
    const r = await page.evaluate(() => {
      const p = document.querySelector(".ng-dropdown-panel"); if (!p) return { opened: false };
      const pb = p.getBoundingClientRect(), opts = Array.from(p.querySelectorAll(".ng-option"));
      const first = opts[0] ? opts[0].getBoundingClientRect() : null;
      let clickable = 0;
      for (const o of opts.slice(0, 40)) {
        const ob = o.getBoundingClientRect();
        if (ob.height === 0 || ob.y < 0 || ob.bottom > window.innerHeight) continue;
        const el = document.elementFromPoint(Math.round(ob.x + ob.width / 2), Math.round(ob.y + ob.height / 2));
        if (el && (el === o || o.contains(el))) clickable++;
      }
      return { opened: true, y: Math.round(pb.y), firstOptY: first ? Math.round(first.y) : null, firstVisible: !!first && first.y >= 0, opts: opts.length, clickable, z: getComputedStyle(p).zIndex };
    });
    ck(`G1 ${vw}x${vh} 面板打开`, r.opened, r);
    ck(`G1 ${vw}x${vh} ★ 顶部没被顶出屏幕`, r.y >= 0, r);
    ck(`G1 ${vw}x${vh} ★ 第一个选项可见`, r.firstVisible === true, r);
    ck(`G1 ${vw}x${vh} 选项可点`, r.clickable >= 5, r);
    ck(`G1 ${vw}x${vh} z-index 高于原生 2050`, Number(r.z) >= 2050, r.z);
    if (SHOT) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, `guard-dropdown-${vw}.png`) }); }
    await ctx.close();
  }

  hdr("② 回归点 G2 设置页头像行不闪烁 (v9)");
  {
    const ctx = await newCtx(390, 844);
    const page = await ctx.newPage();
    await login(page);
    await go(page, "#/vault", 2500);
    const s = await page.evaluate(async () => {
      const out = []; const t0 = performance.now();
      location.hash = "#/settings/account";
      for (let i = 0; i < 90; i++) {
        const rows = Array.from(document.querySelectorAll(".warden-app-avatar-row"));
        out.push({ t: Math.round(performance.now() - t0), visible: rows.filter(r => getComputedStyle(r).display !== "none").length, card: document.querySelectorAll(".warden-acctcard").length });
        await new Promise(r => setTimeout(r, 16));
      }
      return out;
    });
    const shown = s.filter(x => x.visible > 0).length;
    ck("G2 ★ 头像行 0 帧可见", shown === 0, { 采样: s.length, 可见帧: shown, 前几帧: s.slice(0, 6) });
    ck("G2 首帧就有自定义卡片", s[0].card >= 1, s[0]);
    await ctx.close();
  }

  hdr("② 回归点 G3 桌面端账户卡片 (v9)");
  {
    const ctx = await newCtx(1280, 800, true);
    const page = await ctx.newPage();
    await login(page);
    await go(page, "#/settings/account", 3500);
    const r = await page.evaluate(() => {
      const card = document.querySelector(".warden-acctcard");
      const appRow = document.querySelector("main#main-content app-header header div:has(> app-account-menu)");
      const av = card && card.querySelector(".warden-avatar");
      const tx = card && card.querySelector(".warden-acct-name") || card;
      const ab = av && av.getBoundingClientRect(), tb = tx && tx.getBoundingClientRect();
      return {
        hasCard: !!card, cardVisible: card ? getComputedStyle(card).display !== "none" : false,
        appRowHidden: appRow ? getComputedStyle(appRow).display === "none" : null,
        appMenuVisible: (() => { const m = document.querySelector("main#main-content app-account-menu"); if (!m) return 0; const b = m.getBoundingClientRect(); return b.height > 0 && getComputedStyle(m).display !== "none" ? 1 : 0; })(),
        layout: ab && tb ? { avLeft: Math.round(ab.left), txLeft: Math.round(tb.left), sameRow: Math.abs(ab.top - tb.top) < 24 } : null,
        ox: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    ck("G3 桌面端卡片渲染", r.hasCard && r.cardVisible, r);
    ck("G3 ★ 原生头像行被隐藏", r.appRowHidden === true && r.appMenuVisible === 0, r);
    ck("G3 ★ 名称邮箱在头像右侧", r.layout && r.layout.txLeft > r.layout.avLeft && r.layout.sameRow, r.layout);
    ck("G3 桌面端无横向溢出", r.ox <= 0, r.ox);
    if (SHOT) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, "guard-desktop-card.png") }); }
    await ctx.close();
  }

  hdr("② 回归点 G4 头像跨端同步 (v9 后端端点)");
  {
    const ctx = await newCtx(390, 844);
    const page = await ctx.newPage();
    await login(page);
    const r = await page.evaluate(async () => {
      const tok = localStorage.getItem("accessToken") || JSON.parse(localStorage.getItem("__warden_token__") || "null");
      const h = { "Content-Type": "application/json", Authorization: "Bearer " + (typeof tok === "string" ? tok : "") };
      const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const put = await fetch("/api/accounts/avatar/image", { method: "PUT", headers: h, body: JSON.stringify({ image: png }) });
      const get = await (await fetch("/api/accounts/avatar", { headers: h })).json();
      const del = await fetch("/api/accounts/avatar/image", { method: "DELETE", headers: h });
      const get2 = await (await fetch("/api/accounts/avatar", { headers: h })).json();
      return { putStatus: put.status, get: get.avatarImage, delStatus: del.status, get2: get2.avatarImage };
    });
    ck("G4 PUT 头像 2xx", r.putStatus >= 200 && r.putStatus < 300, r);
    ck("G4 ★ GET 能取回刚上传的图", typeof r.get === "string" && r.get.indexOf("data:image") === 0, r.get);
    ck("G4 DELETE 2xx", r.delStatus >= 200 && r.delStatus < 300, r);
    ck("G4 ★ 删除后取回为 null", r.get2 === null || r.get2 === undefined, r.get2);
    await ctx.close();
  }

  hdr("② 回归点 G5 二级导航 chips 挂 main 内且不闪烁 (v8)");
  {
    const ctx = await newCtx(390, 844);
    const page = await ctx.newPage();
    await login(page);
    for (const [h, n] of [["#/tools", 3], ["#/settings", 5]]) {
      await go(page, h);
      const r = await page.evaluate(() => {
        const s = document.getElementById("warden-subnav");
        if (!s) return null;
        return { inMain: !!s.closest("main#main-content"), n: s.children.length, w: Array.from(s.children).map(a => Math.round(a.getBoundingClientRect().width)) };
      });
      ck(`G5 ${h} chips ${n} 项`, r && r.n === n, r);
      ck(`G5 ${h} chips 挂在 main 内`, r && r.inMain === true, r);
      ck(`G5 ${h} chips 等分`, r && Math.max(...r.w) - Math.min(...r.w) <= 1, r && r.w);
    }
    await ctx.close();
  }
}

/* ============================ ③ 功能冒烟 ============================ */
if (want("func")) {
  hdr("③ 功能冒烟");
  const ctx = await newCtx(390, 844);
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0, 120)); });
  page.on("pageerror", e => errs.push("PAGEERROR " + String(e).slice(0, 120)));
  await login(page);

  const tabs = await page.evaluate(() => { const t = document.getElementById("warden-tabbar"); return t ? Array.from(t.querySelectorAll("a,button")).map(a => (a.innerText || "").trim().split("\n")[0]) : null; });
  ck("F1 底栏 6 项", tabs && tabs.length === 6, tabs);
  for (const h of ["#/sends", "#/tools", "#/reports", "#/settings", "#/vault"]) {
    await go(page, h);
    const cur = await page.evaluate(() => location.hash);
    ck(`F1 切到 ${h}`, cur.indexOf(h) === 0, cur);
  }

  /* ⚠️ 「新增」的流程是两段: 先弹类型菜单(bit-menu-panel), 选完类型才出 bit-dialog。
     直接断言 bit-dialog 一定是 null —— v9 就在这里误报过一次。
     也**不能**用 `innerText 以"新增"开头` 找按钮: 引导清单里有个 <a>新增组织</a>, 会跳走。 */
  async function openAddFlow(page, btnSel, exactText) {
    const clicked = await page.evaluate(([sel, txt]) => {
      let b = document.querySelector(sel);
      /* 兜底: 有些「新增」按钮既没 aria-label 也没 title(Send 页就是),
         只能按**精确文本**找。绝不能用 indexOf === 0 —— 引导清单里
         有个 <a>新增组织</a> 会把你带去创建组织页。 */
      if (!b && txt) {
        const cands = Array.from(document.querySelectorAll("main#main-content button, main#main-content a"));
        b = cands.filter(x => (x.innerText || "").trim() === txt)[0];
      }
      if (!b) return false;
      b.click(); return true;
    }, [btnSel, exactText || ""]);
    if (!clicked) return { clicked: false };
    await sleep(1800);
    // 第一段: 类型菜单
    const menu = await page.evaluate(() => {
      const p = document.querySelector(".bit-menu-panel, .cdk-overlay-pane [role='menu']");
      if (!p || p.getBoundingClientRect().height === 0) return null;
      const items = Array.from(p.querySelectorAll("button, a, [role='menuitem'], .bit-menu-item")).map(x => (x.innerText || "").trim()).filter(Boolean);
      return { items };
    });
    if (menu && menu.items.length) {
      await page.evaluate(() => {
        const p = document.querySelector(".bit-menu-panel, .cdk-overlay-pane [role='menu']");
        const it = Array.from(p.querySelectorAll("button, a, [role='menuitem'], .bit-menu-item")).filter(x => (x.innerText || "").trim())[0];
        if (it) it.click();
      });
      await sleep(2200);
    }
    // 第二段: 真正的对话框
    return await page.evaluate(() => {
      const d = document.querySelector(".cdk-overlay-pane bit-dialog, bit-dialog");
      if (!d) return { clicked: true, dialog: false, menu: !!document.querySelector(".bit-menu-panel") };
      const b = d.getBoundingClientRect();
      return {
        clicked: true, dialog: true,
        w: Math.round(b.width), y: Math.round(b.y),
        inView: b.y >= -2 && b.x >= -2 && b.right <= window.innerWidth + 2,
        fields: d.querySelectorAll("input,textarea,bit-select").length,
      };
    });
  }

  const vaultDlg = await openAddFlow(page, 'main#main-content button[aria-label="新增"]', "新增");
  ck("F2 密码库新增流程能开", vaultDlg.clicked === true, vaultDlg);
  ck("F2 ★ 新增对话框能弹出", vaultDlg.dialog === true, vaultDlg);
  ck("F2 ★ 对话框在视口内", vaultDlg.inView === true, vaultDlg);
  ck("F2 对话框有字段", vaultDlg.fields >= 4, vaultDlg.fields);
  await page.keyboard.press("Escape"); await sleep(1000);
  ck("F2 对话框能关", await page.evaluate(() => { const x = document.querySelector(".cdk-overlay-pane bit-dialog"); return !x || getComputedStyle(x).display === "none"; }), null);

  /* ⚠️ 生成器的类型切换是 <bit-toggle> 自定义元素, 不是 button/a —— v9 误报过一次。 */
  await go(page, "#/tools/generator");
  for (const t of ["密码", "密码短语", "用户名"]) {
    const ok = await page.evaluate((label) => {
      const els = Array.from(document.querySelectorAll("main#main-content bit-toggle, main#main-content button, main#main-content a"));
      const hit = els.filter(x => (x.innerText || "").trim() === label)[0];
      if (!hit) return false; hit.click(); return true;
    }, t);
    await sleep(1300);
    const has = await page.evaluate(() => { const m = document.querySelector("main#main-content"); return m ? (m.innerText || "").length > 40 : false; });
    ck(`F3 生成器「${t}」可切换`, ok && has, { ok, has });
  }
  // 生成按钮在类型切换后应给出长度足够的输出(测「密码」类型)
  await page.evaluate(() => { const e = Array.from(document.querySelectorAll("main#main-content bit-toggle")).filter(x => (x.innerText || "").trim() === "密码")[0]; if (e) e.click(); });
  await sleep(1000);
  await page.evaluate(() => { const b = document.querySelector('main#main-content button[aria-label="生成密码"], main#main-content button[title="生成密码"]'); if (b) b.click(); });
  await sleep(1200);
  const genOk = await page.evaluate(() => {
    const m = document.querySelector("main#main-content");
    return m ? /[A-Za-z0-9!@#$%^&*]{12,}/.test(m.innerText || "") : false;
  });
  ck("F3 ★ 点「生成密码」有输出", genOk, genOk);

  for (const [h, n] of [["#/tools", 3], ["#/settings", 5]]) {
    await go(page, h);
    const r = await page.evaluate(() => { const s = document.getElementById("warden-subnav"); return s ? { n: s.children.length, labels: Array.from(s.children).map(a => (a.innerText || "").trim()), hrefs: Array.from(s.children).map(a => a.getAttribute("data-href")) } : null; });
    for (let i = 0; i < (r ? r.n : 0); i++) {
      const target = r.hrefs[i];
      await page.evaluate((i) => { document.getElementById("warden-subnav").children[i].click(); }, i);
      await sleep(2500);
      const now = await page.evaluate(() => location.hash);
      ck(`F4 点「${r.labels[i]}」→ ${target}`, now.indexOf(String(target)) === 0, now);
    }
  }

  await go(page, "#/settings/security", 3600);
  const l3 = await page.evaluate(() => { const hd = document.querySelector("main#main-content app-header"); return hd ? Array.from(hd.querySelectorAll("a,button")).map(b => (b.innerText || "").trim()).filter(Boolean) : []; });
  ck("F5 安全页有三级 tabs", l3.length >= 4, l3);
  for (const label of l3.slice(0, 5)) {
    const ok = await page.evaluate((l) => { const hd = document.querySelector("main#main-content app-header"); const b = Array.from(hd.querySelectorAll("a,button")).filter(x => (x.innerText || "").trim() === l); if (!b.length) return false; b[0].click(); return true; }, label);
    await sleep(2200);
    const has = await page.evaluate(() => { const m = document.querySelector("main#main-content"); return m ? (m.innerText || "").length > 80 : false; });
    ck(`F5 切到「${label}」`, ok && has, { ok, has });
  }

  await go(page, "#/reports");
  ck("F6 报告页有内容", await page.evaluate(() => { const m = document.querySelector("main#main-content"); return m ? (m.innerText || "").trim().length > 20 : false; }), null);

  await go(page, "#/sends");
  /* Send 有两个入口: 页头「新增」(y≈8) 和空状态里的「新增 Send」。都没有 aria-label,
     所以按精确文本找。同样先出类型菜单再出对话框。 */
  const sendDlg = await openAddFlow(page, 'main#main-content button[title="新增 Send"], main#main-content button[aria-label="新增 Send"]', "新增 Send");
  ck("F7 Send 新增流程能开", sendDlg.clicked === true, sendDlg);
  ck("F7 Send 新增对话框能弹出", sendDlg.dialog === true, sendDlg);
  ck("F7 ★ Send 对话框在视口内", sendDlg.inView === true, sendDlg);
  await page.keyboard.press("Escape"); await sleep(600);

  ck("F8 全程无控制台错误", errs.length === 0, errs.slice(0, 5));
  await ctx.close();
}

/* ============================ 汇总 ============================ */
console.log("\n================================================");
console.log(`模式: ${LOCAL ? "本地注入" : "线上"} | PASS ${pass} / FAIL ${fail}`);
if (fail) console.log("失败项:\n  - " + failures.join("\n  - "));
console.log("================================================");
await browser.close();
process.exit(fail ? 1 : 0);
