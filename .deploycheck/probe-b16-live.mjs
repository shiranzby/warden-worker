/**
 * 第十六批(T 段)**线上**验收 —— 三处修复各在真站上断一次。
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
 *     node .deploycheck/probe-b16-live.mjs
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import { BASE, CHROME, ensureLoggedIn, goRoute, sleep } from "./b8-lib.mjs";

const PROXY = process.env.WARDEN_TEST_PROXY || "http://127.0.0.1:7890";
const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  proxy: { server: PROXY },
});
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

/* ============ ① 窄屏下拉(T1) ============ */
console.log("\n########## ① 窄屏下拉(T1) ##########");
await goRoute(page, "/settings/appearance");
await sleep(600);

const panel = () =>
  page.evaluate(() => {
    const vis = [...document.querySelectorAll("ng-dropdown-panel")].filter((p) => {
      const cs = getComputedStyle(p);
      return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.01 && p.getClientRects().length > 0;
    });
    const p = vis[0];
    if (!p) return { open: false, n: 0, firstH: 0, text: null };
    const o = [...p.querySelectorAll(".ng-option")].filter((x) => x.getClientRects().length > 0);
    return {
      open: true,
      n: o.length,
      firstH: o[0] ? Math.round(o[0].getBoundingClientRect().height) : 0,
      text: o[0] ? (o[0].textContent || "").replace(/\s+/g, " ").trim().slice(0, 12) : null,
    };
  });

const box = async () =>
  page.locator("bit-select").first().locator(".ng-select-container").first().boundingBox();
const reset = async () => {
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(300);
};

const nSel = await page.locator("bit-select").count();
check("线上外观页有 bit-select", nSel >= 1, `count=${nSel}`);
if (nSel) {
  await reset();
  let b = await box();
  const y = b.y + b.height / 2;
  await page.touchscreen.tap(b.x + b.width / 2, y);
  await sleep(450);
  let f = await panel();
  check("① 线上轻点 → 展开", f.open, `选项=${f.n} 首个="${f.text}"`);
  check("① 选项真渲染", f.n >= 1 && f.firstH >= 20, `选项=${f.n} 首项高=${f.firstH}px`);

  await page.touchscreen.tap(b.x + b.width / 2, y);
  await sleep(450);
  check("② 线上再轻点 → 收起", !(await panel()).open);

  await reset();
  b = await box();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  const frames = [];
  for (let i = 0; i < 15; i++) {
    await sleep(40);
    frames.push((await panel()).open ? "O" : ".");
  }
  check("③ 线上展开后 0~600ms 无「关闭帧」", !frames.join("").includes("."), `采样=${frames.join("")}`);
  await reset();
}

/* ============ ② 自定义域名行(T2) ============ */
console.log("\n########## ② 自定义域名行几何(T2) ##########");
await goRoute(page, "#/settings/domain-rules", "main#main-content", 25000);
await sleep(1800);
let rows = await page.locator("bit-form-field textarea[bitInput]").count();
if (rows === 0) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (e) => /自定义域名/.test(e.textContent || "") && e.getBoundingClientRect().width > 0,
    );
    b && b.click();
  });
  await sleep(1000);
}
const geo = await page.evaluate(() => {
  const ta = document.querySelector("bit-form-field textarea[bitInput]");
  if (!ta) return null;
  const row = ta.closest(".warden-domain-row");
  const box = ta.closest("bit-form-field");
  const btn = box?.parentElement?.querySelector("button");
  if (!row) return { hasHook: false };
  const cy = (el) => {
    const r = el.getBoundingClientRect();
    return Math.round(r.y + r.height / 2);
  };
  return {
    hasHook: true,
    rowAlign: getComputedStyle(row).alignItems,
    taCy: cy(ta),
    taH: Math.round(ta.getBoundingClientRect().height),
    btnCy: btn ? cy(btn) : null,
    btnH: btn ? Math.round(btn.getBoundingClientRect().height) : null,
  };
});
if (!geo) {
  check("线上自定义域名页读到输入框", false, "没渲染出来(测试账号可能没有域名行且按钮未找到)");
} else {
  check("线上行上有页级钩子 .warden-domain-row", geo.hasHook === true);
  check("线上行对齐 = flex-end", geo.rowAlign === "flex-end", `alignItems=${geo.rowAlign}`);
  check("线上域名输入框仍是 32px(S2 居中仍生效)", geo.taH === 32, `h=${geo.taH}px`);
  check(
    "线上减号按钮与输入框中线对齐(残差 ≤2px)",
    geo.btnCy != null && Math.abs(geo.btnCy - geo.taCy) <= 2,
    `按钮 cy=${geo.btnCy}(${geo.btnH}px) vs 输入框 cy=${geo.taCy}(${geo.taH}px)`,
  );
}

/* ============ ③ TOTP 升格(T3) ============ */
console.log("\n########## ③ TOTP 升格(T3) ##########");
await goRoute(page, "#/vault", "main#main-content", 25000);
await sleep(1500);
const badge = page.locator(".warden-totp-code").first();
if (!(await badge.count())) {
  check("线上保险库有 TOTP 徽章", false, "测试账号库里没有带 TOTP 的条目?");
} else {
  await badge.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(250);
  const snap = () =>
    page.evaluate(() => {
      const b = document.querySelector(".warden-totp-code");
      if (!b) return null;
      const t = (s) => (b.querySelector(s)?.textContent || "").trim();
      return {
        rolling: b.classList.contains("warden-totp-rolling"),
        sec: t(".warden-totp-sec"),
        ghost: t(".warden-totp-ghost"),
        digits: t(".warden-totp-digits"),
        next: t(".warden-totp-next"),
      };
    });
  let pre = null;
  for (let i = 0; i < 400; i++) {
    const s = await snap();
    if (s && !s.rolling && Number(s.sec) <= 10 && Number(s.sec) >= 4 && s.next) {
      pre = s;
      break;
    }
    await sleep(100);
  }
  if (!pre) {
    check("抓到升格前地面真值", false, "次码一直不可见");
  } else {
    console.log(`  旧码 C="${pre.digits}"  新码 N="${pre.next}"  sec=${pre.sec}`);
    await page.evaluate(() => {
      const orig = window.setTimeout;
      window.setTimeout = function (fn, ms, ...rest) {
        return orig.call(window, fn, ms === 300 ? 3000 : ms, ...rest);
      };
    });
    await page.evaluate(() => {
      for (const r of document.querySelectorAll(".warden-totp-row")) r.style.animationDuration = "3s";
    });
    await page.waitForFunction(
      () => document.querySelector(".warden-totp-code")?.classList.contains("warden-totp-rolling"),
      null,
      { timeout: 40000, polling: 20 },
    );
    const frames = [];
    for (let i = 0; i < 14; i++) {
      frames.push(await snap());
      await sleep(100);
    }
    const f0 = frames[0];
    check("① 线上升格第一帧主码即新码 N", f0.digits === pre.next, `f0="${f0.digits}" N="${pre.next}"`);
    check("① 线上升格第一帧 ghost 即旧码 C", f0.ghost === pre.digits, `f0.ghost="${f0.ghost}"`);
    const bad = frames.filter((f) => f.ghost && f.digits && f.ghost === f.digits).length;
    check("② 线上升格期间无 ghost===digits 帧", bad === 0, bad ? `命中 ${bad} 帧` : "14 帧全过");
    const back = frames.filter((f) => f.digits === pre.digits).length;
    check("③ 线上主码行从未退回旧码", back === 0, back ? `命中 ${back} 帧` : "14 帧全过");
  }
}

check("④ 0 个 pageerror", errs.length === 0, errs.length ? errs[0] : "");
console.log(`\n===== 线上合计: ${pass} 通过 / ${fail} 失败 =====`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
