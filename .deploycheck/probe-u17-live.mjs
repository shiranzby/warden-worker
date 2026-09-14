/**
 * 第十七批(U 段)**线上**验收 —— 真站 shypwd.cc.cd 上把 U1~U5 + 问题2/4 各断一次。
 *
 * 为什么必须有这一层: 本地 dev server 是开发产物 + 本机网络, 与"用户手机打开 shypwd.cc.cd"
 * 不是同一件事。产物级 grep 只能证明"文件换了", 证明不了"行为对了"。
 *
 * 🔴 本机**直连 shypwd.cc.cd 不通** ⇒ 浏览器必须显式挂代理
 *    (`chromium.launch({ proxy: { server } })`), 这点与 curl 的 `-x` 一致。
 * 🔴 静态资产**不要另开 fetch**: 让浏览器在页面里 `fetch()` 同源 URL —— 它已经带着代理了,
 *    而且 5.4MB 的 main.js 只在页内过一遍, 只把"命中次数"这种小数据带回来。
 *
 * 用法:
 *   WARDEN_TEST_BASE=https://shypwd.cc.cd WARDEN_TEST_PROXY=http://127.0.0.1:7890 \
 *     node .deploycheck/probe-u17-live.mjs
 *
 * ⚠️ 顺序有讲究: **导出页那一段必须排在"打开新增 Send 对话框"之前**。
 *    对话框是 cdk overlay(挂 body、不随路由卸载), 开着时应用根被压成 20px 宽,
 *    导出页的 bit-select 会量成退化盒 ⇒ 假失败。详见 probe-u17-verify.mjs 顶部注释。
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep } from "./b8-lib.mjs";

const PROXY = process.env.WARDEN_TEST_PROXY || "http://127.0.0.1:7890";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, proxy: { server: PROXY } });
console.log(`BASE = ${BASE}   proxy = ${PROXY}`);

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
  ok ? pass++ : fail++;
};

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

/* ================= 静态资产 ================= */
console.log("\n########## 静态资产(vw-version.json / main.js / vaultwarden.css) ##########");
const MAIN_LITS = [
  "pressStartedOnField",
  "onFieldPointerup",
  "stepMaxAccessCount",
  "maxAccessCountPlaceholder",
  "max-access-count-increase",
  "max-access-count-decrease",
  "wardenUnlimited",
  "wardenIncrease",
  "wardenDecrease",
];
const CSS_LITS = [
  "U 段. 移动端第五轮反馈(第十七批)",
  "main#main-content app-header header:has(bit-tab-nav-bar)",
  "bit-dialog > section > header",
  "body:has(bit-dialog) #warden-tabbar",
  'bit-dialog textarea[formcontrolname="text"]',
  'main#main-content tools-send-list > [slot="filters"]',
];
const stat = await page.evaluate(
  async ([mainLits, cssLits]) => {
    const out = {};
    const get = async (u) => {
      try {
        const r = await fetch(u + (u.includes("?") ? "&" : "?") + "_=" + Date.now(), { cache: "no-store" });
        const t = await r.text();
        return { status: r.status, t, bytes: new TextEncoder().encode(t).length };
      } catch (e) {
        return { status: 0, t: "", bytes: 0, err: String(e).slice(0, 80) };
      }
    };
    const cnt = (h, l) => h.split(l).length - 1;

    const ver = await get("/vw-version.json");
    out.verStatus = ver.status;
    out.version = ver.t.trim().slice(0, 120);

    const idx = await get("/");
    out.indexStatus = idx.status;
    // ⚠️ 首页里引用主 JS 用的是**相对路径**且**没有前导斜杠**: `<script defer src="app/main.<hash>.js">`
    //    (实测)。正则里写死 `/app/main...` 会**匹配不到** ⇒ `mainStatus` 是 undefined、
    //    整块 main.js 断言静默变成 {} —— 从输出上看很像"产物没上线"。
    const m = idx.t.match(/app\/main\.[0-9a-f]+\.js/);
    out.mainPath = m ? "/" + m[0] : null;
    if (m) {
      const mj = await get(out.mainPath);
      out.mainStatus = mj.status;
      out.mainBytes = mj.bytes;
      out.mainHits = mainLits.map((l) => [l, cnt(mj.t, l)]);
    }
    const css = await get("/css/vaultwarden.css");
    out.cssStatus = css.status;
    out.cssBytes = css.bytes;
    out.cssHits = cssLits.map((l) => [l, cnt(css.t, l)]);
    return out;
  },
  [MAIN_LITS, CSS_LITS],
);
console.log("  ", JSON.stringify({ ver: stat.verStatus, version: stat.version, main: stat.mainPath, mainBytes: stat.mainBytes, cssBytes: stat.cssBytes }));

let vjson = {};
try {
  vjson = JSON.parse(stat.version);
} catch {
  /* 有的版本是裸字符串 */
}
const verStr = typeof vjson === "string" ? vjson : (vjson.version ?? stat.version);
check("线上版本 = 2026.8.7", String(verStr).includes("2026.8.7"), `version=${JSON.stringify(stat.version)}`);
check("能取到主 JS(HTTP 200)", stat.mainStatus === 200, `path=${stat.mainPath} status=${stat.mainStatus}`);
check("能取到 vaultwarden.css(HTTP 200)", stat.cssStatus === 200, `bytes=${stat.cssBytes}`);
console.log("   main.js 命中:", JSON.stringify(Object.fromEntries(stat.mainHits || [])));
console.log("   .vw.css 命中:", JSON.stringify(Object.fromEntries(stat.cssHits || [])));
for (const [lit, n] of stat.mainHits || []) {
  check(`线上 main.js 含 '${lit}'`, n >= 1, `n=${n}`);
}
for (const [lit, n] of stat.cssHits || []) {
  check(`线上 .vw.css 含 '${lit}'`, n >= 1, `n=${n}`);
}

/* ================= 导出页(必须先于对话框) ================= */
console.log("\n########## ④ 导出页: 原生 select → bit-select ##########");
await goRoute(page, "/tools/export", "main#main-content", 25000);
await sleep(1500);
const expMainW = await page.evaluate(() => Math.round(document.querySelector("main#main-content")?.getBoundingClientRect().width ?? 0));
const exp = await page.evaluate(() => {
  const main = document.querySelector("main#main-content");
  return {
    native: main.querySelectorAll('select[formcontrolname="format"]').length,
    bitSel: main.querySelectorAll("bit-select").length,
  };
});
console.log("  ", JSON.stringify(exp), `mainW=${expMainW}`);
check("线上导出页已无原生 select", exp.native === 0, `native=${exp.native}`);
check("线上导出页是 bit-select", exp.bitSel >= 1, `bitSel=${exp.bitSel}`);
const fmtBox = page.locator("main#main-content bit-select .ng-select-container").first();
if (await fmtBox.count()) {
  const key = (b) => (b ? `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}` : "null");
  let prev = null;
  for (let i = 0; i < 30; i++) {
    const b = await fmtBox.boundingBox();
    if (b && b.width > 100 && b.height >= 20 && prev && key(b) === key(prev)) {
      prev = b;
      break;
    }
    prev = b;
    await sleep(200);
  }
  const readPanel = () =>
    page.evaluate(() => {
      const vis = [...document.querySelectorAll("ng-dropdown-panel")].filter((x) => x.getBoundingClientRect().height > 0);
      if (!vis.length) return null;
      const x = vis[vis.length - 1];
      const r = x.getBoundingClientRect();
      return { top: Math.round(r.y), bottom: Math.round(r.bottom), opts: x.querySelectorAll(".ng-option").length };
    });
  let inline = null;
  let lastBox = prev;
  for (let a = 0; a < 3 && !inline; a++) {
    lastBox = await fmtBox.boundingBox();
    await page.touchscreen.tap(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2);
    await sleep(900);
    inline = await readPanel();
  }
  console.log("   面板:", JSON.stringify(inline), " box:", JSON.stringify(lastBox));
  check("线上点它弹站内面板(4 个格式选项)", !!inline && inline.opts >= 4, JSON.stringify(inline));
  check("线上面板贴在框下沿(不弹系统选择器)", !!inline && !!lastBox && Math.abs(inline.top - (lastBox.y + lastBox.height)) <= 12, `panelTop=${inline?.top} fieldBottom=${lastBox ? Math.round(lastBox.y + lastBox.height) : "?"}`);
  await page.touchscreen.tap(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2);
  await sleep(700);
  check("线上再点一次 ⇒ 面板收回", (await readPanel()) == null);
}

/* ================= ① 设置/安全页 tab 条 ================= */
console.log("\n########## ① 设置>安全页: tab 条灰底 ⇒ 白 ##########");
await goRoute(page, "/settings/security/session-timeout", "main#main-content", 25000);
await sleep(1200);
const s1 = await page.evaluate(() => {
  const h = document.querySelector("main#main-content app-header header");
  const cur = document.querySelector('main#main-content bit-tab-nav-bar [aria-current="page"]');
  const after = cur ? getComputedStyle(cur, "::after") : null;
  return {
    headerBg: h ? getComputedStyle(h).backgroundColor : null,
    activeColor: cur ? getComputedStyle(cur).color : null,
    underline: after ? { bg: after.backgroundColor, opacity: after.opacity } : null,
    activeText: cur ? (cur.textContent || "").trim() : null,
  };
});
console.log("  ", JSON.stringify(s1));
check("线上的 tab 条页头背景已透明(露出白底)", s1.headerBg === "rgba(0, 0, 0, 0)", `bg=${s1.headerBg}`);
check("选中 tab 仍是品牌蓝", s1.activeColor === "rgb(18, 82, 163)", `color=${s1.activeColor} text=${s1.activeText}`);
check("选中 tab 的下划线强调线仍在", !!s1.underline && s1.underline.opacity === "1" && s1.underline.bg === "rgb(18, 82, 163)", JSON.stringify(s1.underline));

/* ================= ⑤ 发送列表页顶部空隙 ================= */
console.log("\n########## ⑤ 发送页: 切换条上方空隙 ##########");
await goRoute(page, "/sends", "main#main-content", 25000);
await sleep(1200);
const s5 = await page.evaluate(() => {
  const flt = document.querySelector('main#main-content tools-send-list > [slot="filters"]');
  const tg = document.querySelector("main#main-content bit-toggle-group");
  return {
    mt: flt ? getComputedStyle(flt).marginTop : null,
    toggleY: tg ? Math.round(tg.getBoundingClientRect().y) : null,
  };
});
console.log("  ", JSON.stringify(s5));
check("线上 filters 容器 margin-top 已清零", s5.mt === "0px", `mt=${s5.mt}`);
check("线上切换条贴内容顶部(<=12px)", s5.toggleY != null && s5.toggleY <= 12, `toggleY=${s5.toggleY}`);

/* ================= ②③④ 新增文本 Send 对话框 ================= */
console.log("\n########## ②③④ 新增文本 Send 对话框 ##########");
await page.locator("button:visible", { hasText: "新增 Send" }).first().tap();
await sleep(600);
await page.locator("[role=menuitem], button[bitmenuitem]").filter({ hasText: "文本" }).first().tap();
await sleep(2000);

const dlg = await page.evaluate(() => {
  const header = document.querySelector("bit-dialog > section > header");
  const tabbar = document.getElementById("warden-tabbar");
  const btns = [...document.querySelectorAll("bit-dialog button")].filter((b) => b.getClientRects().length);
  const footer = btns
    .filter((b) => /保存|取消/.test(b.textContent || ""))
    .map((b) => {
      const r = b.getBoundingClientRect();
      return { t: (b.textContent || "").trim(), y: Math.round(r.y), b: Math.round(r.bottom) };
    });
  const tas = [...document.querySelectorAll("bit-dialog textarea")].map((t) => ({
    fc: t.getAttribute("formcontrolname"),
    h: Math.round(t.getBoundingClientRect().height),
  }));
  const maxA = document.querySelector('input[formcontrolname="maxAccessCount"]');
  return {
    headerPadTop: header ? getComputedStyle(header).paddingTop : null,
    headerH: header ? Math.round(header.getBoundingClientRect().height) : null,
    tabbarDisplay: tabbar ? getComputedStyle(tabbar).display : "(无标签栏)",
    footer,
    textareas: tas,
    maxPh: maxA ? maxA.getAttribute("placeholder") : null,
    stepBtns: [...document.querySelectorAll('[data-testid^="max-access-count-"]')].filter((x) => x.getClientRects().length)
      .length,
  };
});
console.log("  ", JSON.stringify(dlg));
check("线上对话框页头已压缩(padTop<=2px)", dlg.headerPadTop === "2px", `padTop=${dlg.headerPadTop}`);
check("线上页头高度 <= 64px", (dlg.headerH ?? 999) <= 64, `h=${dlg.headerH}`);
check("线上底部标签栏已藏掉", dlg.tabbarDisplay === "none", `display=${dlg.tabbarDisplay}`);
check("线上页脚「保存/取消」都在且未被遮挡", dlg.footer.length >= 2 && dlg.footer.every((f) => f.b <= 844), JSON.stringify(dlg.footer));
check("线上「要分享的文本」压成一行 32px", dlg.textareas.find((t) => t.fc === "text")?.h === 32, JSON.stringify(dlg.textareas));
check("线上「私密备注」压成一行 32px", dlg.textareas.find((t) => t.fc === "notes")?.h === 32, JSON.stringify(dlg.textareas));
check("线上 placeholder = 不限制", dlg.maxPh === "不限制", `ph=${dlg.maxPh}`);
check("线上 − / + 按钮都在", dlg.stepBtns === 2, `n=${dlg.stepBtns}`);

/* 下拉贴着框 + 再点/点空白收回 */
const panelsOpen = () =>
  page.evaluate(
    () => [...document.querySelectorAll("ng-dropdown-panel")].filter((x) => x.getBoundingClientRect().height > 0).length,
  );
const selCount = await page.locator("bit-dialog bit-select").count();
check("线上对话框里有两个下拉(删除日期 / 谁可以查看)", selCount >= 2, `n=${selCount}`);
for (let i = 0; i < Math.min(2, selCount); i++) {
  const s = page.locator("bit-dialog bit-select").nth(i);
  await s.scrollIntoViewIfNeeded().catch(() => {});
  const cbox = s.locator(".ng-select-container").first();
  if (!(await cbox.count())) continue;
  const b = await cbox.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await sleep(900);
  const panel = await page.evaluate(() => {
    const vis = [...document.querySelectorAll("ng-dropdown-panel")].filter((x) => x.getBoundingClientRect().height > 0);
    if (!vis.length) return null;
    const x = vis[vis.length - 1];
    const r = x.getBoundingClientRect();
    return { top: Math.round(r.y), opts: x.querySelectorAll(".ng-option").length };
  });
  const label = await s.evaluate((el) => el.closest("bit-form-field")?.querySelector("bit-label")?.textContent?.trim() ?? "?");
  check(`线上下拉 #${i}(${label}) 面板贴着框下沿`, !!panel && panel.top >= Math.round(b.y + b.height) - 4, `panelTop=${panel?.top} fieldBottom=${Math.round(b.y + b.height)}`);
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await sleep(700);
  check(`线上下拉 #${i} 再点一次 ⇒ 收回`, (await panelsOpen()) === 0, `open=${await panelsOpen()}`);
}

/* ④ 松手才展开(CDP 真触摸) */
// ⚠️ 坐标取 `bit-select` **宿主**的中心并 `Math.round`(与本地 probe-u17-verify.mjs 里
//    通过的那版逐字一致)。取 `.ng-select-container` 的中心在对话框里会**落到控件下面的提示行上**
//    (宿主比容器高) ⇒ 触摸打空, 表现是 down=0/up=0, 看起来像"松手也不展开"。
//    所以这里顺手打一行 `elementFromPoint` 诊断, 打空时能立刻看出来。
const cdp = await ctx.newCDPSession(page);
const firstSel = page.locator("bit-dialog bit-select").first();
await firstSel.scrollIntoViewIfNeeded().catch(() => {});
await sleep(500);
const fb = await firstSel.boundingBox();
const px = Math.round(fb.x + fb.width / 2);
const py = Math.round(fb.y + fb.height / 2);
const hit = await page.evaluate(
  ([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return el ? `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}` : "null";
  },
  [px, py],
);
console.log(`  触点 (${px},${py}) 命中: ${hit}   宿主 box: ${JSON.stringify(fb)}`);
// 🔴 **不要在这里按 Escape**。实测(见 .scratch-u17-touch.mjs, 线上同一控件 5 种变体):
//    touchStart→touchEnd([]) 单独跑 ⇒ down=0 / **up=1**(正确);
//    一旦在它**前面加一次 Escape** ⇒ down=0 / up=0, 而且**之后的普通 tap 也开不了**(控件像卡住)。
//    本地 probe-u17-verify.mjs 里这段前面没有 Escape, 所以一直是绿的 —— 别"对齐"成有 Escape 的版本。
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: px, y: py }] });
await sleep(500);
const down = await panelsOpen();
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await sleep(900);
const up = await panelsOpen();
console.log(`  按下时可见面板=${down}, 松手后可见面板=${up}`);
check("线上按下(未松手)不展开", down === 0, `down=${down}`);
check("线上松手才展开", up === 1, `up=${up} 命中=${hit}`);
// 收拾现场: 再点一次把刚展开的面板收掉(与本地探针一致)。
// ⚠️ 漏了这句的后果实测过: 面板一直开着会挡住下面「谁可以查看」那一下点击 ⇒
//    ② 的密码断言会**无故变红**(上一版就是这样, 排查了半天)。
await page.touchscreen.tap(px, py);
await sleep(800);
check("松手测试后面板已收干净(不影响后续段落)", (await panelsOpen()) === 0, `open=${await panelsOpen()}`);

/* ② 密码授权区: 三个按钮其实早就存在 */
console.log("\n########## ② 密码设置(眼睛/随机/复制) ##########");
const authSel = page.locator("bit-dialog bit-select").last();
await authSel.scrollIntoViewIfNeeded().catch(() => {});
await authSel.locator(".ng-select-container").first().tap().catch(() => {});
await sleep(900);
const pwdOpt = page.locator('ng-dropdown-panel .ng-option:has-text("密码")').first();
check("线上「谁可以查看」里能选到带密码的那一项", (await pwdOpt.count()) > 0);
if (await pwdOpt.count()) {
  await pwdOpt.tap();
  await sleep(1000);
  const pwd = await page.evaluate(() => {
    const inp = [...document.querySelectorAll('input[formcontrolname="password"]')].find((i) => i.getClientRects().length);
    if (!inp) return { found: false };
    const ff = inp.closest("bit-form-field");
    const suff = ff?.querySelector("[bitsuffix]");
    return { found: true, h: Math.round(inp.getBoundingClientRect().height), btnCount: suff ? suff.querySelectorAll("button").length : 0 };
  });
  console.log("  ", JSON.stringify(pwd));
  check("线上密码输入框出现", pwd.found === true);
  check("线上眼睛/随机/复制三个按钮齐全", pwd.btnCount === 3, `btnCount=${pwd.btnCount}`);
}

console.log(`\npageerror: ${errs.length} ${JSON.stringify(errs.slice(0, 3))}`);
check("全程 0 pageerror", errs.length === 0, `n=${errs.length}`);
console.log(`\n===== U 段线上验收: ${pass} 通过 / ${fail} 失败 =====`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
