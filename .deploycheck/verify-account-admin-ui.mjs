/**
 * AC 段（账号管理并入设置栏目 + 角色权限）的**运行期验收** —— 测试通道上的闸门。
 *
 * 用户指令：「帮我先部署测试上线，**截图测试没有问题后再上线生产实例**」。
 * 所以本脚本是"上生产"的闸门：必须在 `test.shytest.cc.cd` 上全绿，并把双视口截图落盘，
 * 供**人工逐张过目**（脚本能抓"错"，抓不到"丑"）。
 *
 * ## 为什么必须在这里验 /api/admin/me
 * `GET /api/admin/me` 是**只认会话**的（令牌通道走的是另一条分支），所以它**用 curl 验不到**。
 * 唯一能证明"登录会话真的能判出角色"的办法，就是拿一个真实登录的浏览器去调它。
 * 本脚本会把该请求的**状态码与响应体**打出来，并断言它是 200 —— 这就是那条断言的机器证据。
 *
 * ## 三重角色对照（本批的负向对照）
 * 登录身份固定用 `WARDEN_TEST_MAIL`（`shypwd.verify.test@qq.com`，生产里默认 `user`），
 * 用**令牌**把它依次改成 `admin` → `owner` → 再降回 `user`，每一步**刷新页面**后断言：
 *
 *   | 角色  | 设置导航里有没有「账号管理」 | 角色下拉 |
 *   |-------|------------------------------|----------|
 *   | user  | **没有**                     | 进不去页面 |
 *   | admin | 有                           | **置灰**（管理者改不了角色） |
 *   | owner | 有                           | **可选**（所有者才能改） |
 *
 * 1 与 2/3 构成"可见性真的由角色驱动"的对照；2 与 3 构成"admin ≠ owner"的对照。
 * 只验 3 的话，"入口对谁都显示"也能过 —— 那是哑弹。
 * 终态 = 起点（`user`），不留下任何需要人记着回滚的状态。
 *
 * ⚠️ 写操作**只碰 `shypwd.verify.test@qq.com` 这一个账号**，且每一步都立刻读回确认。
 * ⚠️ 别用 `| head -N` 跑本脚本（管道提前关闭会让 node 收 SIGPIPE 中途死掉）。要留档就 `> 文件`。
 *
 * 用法:
 *   node .deploycheck/verify-account-admin-ui.mjs
 *   AC_UI_BASE=https://test.shytest.cc.cd node .deploycheck/verify-account-admin-ui.mjs
 * 退出码：有 FAIL 就是 1。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ⚠️ 必须在 **动态 import** b8-lib 之前设置：b8-lib 在模块顶层就把 WARDEN_TEST_BASE 读进常量了，
//    用静态 import（会被提升到本行之前）会让它永远停在默认的 localhost:8099。
process.env.WARDEN_TEST_BASE ||= "https://test.shytest.cc.cd";
const { login, sleep, PASSWORD } = await import("./b8-lib.mjs");

const { chromium } = await import(
  "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs"
);

const BASE = (process.env.AC_UI_BASE || "https://test.shytest.cc.cd").replace(/\/+$/, "");
const TOKEN = process.env.ADMIN_TOKEN || "";
const MAIL = process.env.WARDEN_TEST_MAIL || "";
const CHROME =
  process.env.WARDEN_CHROME ||
  "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/131.0.0.0 Safari/537.36";
/** 本机**直连 Cloudflare 边缘会被 TLS reset**（curl 打 test 通道返回 000），浏览器同样要挂代理。 */
const PROXY = /localhost|127\.0\.0\.1/.test(BASE) ? "" : "http://127.0.0.1:7890";
const SHOTS = path.resolve(import.meta.dirname, "shots", "ac-roles");

/** 生产库里的账号表 —— 验收需要一个稳定的 id，而 id 是 uuid，只能查出来。 */
const PROD = "https://shypwd.cc.cd";

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
  ok ? pass++ : fail++;
};
const group = (t) => console.log(`\n── ${t} ──`);

fs.mkdirSync(SHOTS, { recursive: true });
if (!TOKEN || !MAIL) {
  console.error("缺少 ADMIN_TOKEN 或 WARDEN_TEST_MAIL（应在 .deploycheck/.env.local 里）。");
  process.exit(2);
}
console.log(`BASE  = ${BASE}`);
console.log(`账号  = ${MAIL}`);
console.log(`代理  = ${PROXY || "(直连)"}`);
console.log(`截图  = ${SHOTS}`);

/* ------------------------------- 后端小工具 ------------------------------- */

/** 走代理调**生产**的 /api/admin/*（验收目标账号在生产库里）。 */
function api(method, p, body) {
  const cmd = [
    "curl", "-sS", "-x", "http://127.0.0.1:7890", "--retry", "3", "--retry-all-errors",
    "--max-time", "40", "-X", method, "-w", "\n%{http_code}", "-H", `X-Admin-Token: ${TOKEN}`,
  ];
  if (body !== undefined) {
    cmd.push("-H", "Content-Type: application/json", "--data-binary", JSON.stringify(body));
  }
  cmd.push(PROD + p);
  const raw = execFileSync(cmd[0], cmd.slice(1), { encoding: "utf-8" }).trimEnd();
  const i = raw.lastIndexOf("\n");
  const status = Number(raw.slice(i + 1).trim());
  let data = null;
  try {
    data = JSON.parse(raw.slice(0, i));
  } catch {
    data = raw.slice(0, i);
  }
  return { status, data };
}

const users = () => {
  const r = api("GET", "/api/admin/users");
  return r.status === 200 && r.data?.users ? r.data.users : [];
};
const roleOf = () => users().find((u) => u.email === MAIL)?.role ?? "(找不到)";
const setRole = (id, role) => api("POST", `/api/admin/users/${id}/role`, { role });

/* --------------------------------- 浏览器 --------------------------------- */

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  proxy: PROXY ? { server: PROXY, bypass: "localhost,127.0.0.1" } : undefined,
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  userAgent: UA,
  locale: "zh-CN",
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

/** `/api/admin/me` 的每次响应都留档 —— 这是"会话身份判定走通"的直接证据。 */
const meCalls = [];
page.on("response", async (r) => {
  if (!/\/api\/admin\/me(\?|$)/.test(r.url())) return;
  let body = "";
  try {
    body = (await r.text()).slice(0, 240);
  } catch {
    body = "(读不到)";
  }
  meCalls.push({ status: r.status(), body });
});

/** 等 `/api/admin/me` 的响应回来（每刷新一次就该有一条）。 */
async function waitForMe(before, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (meCalls.length > before) return meCalls.at(-1);
    await sleep(250);
  }
  return null;
}

/**
 * 🔴 **刷新会让 web-vault 锁屏**（第一版没料到，整轮 20 条失败）。
 *
 * 现象：`page.reload()` 之后 `location.hash` 变成 `#/lock?promptBiometric=true`，
 * 应用停在解锁页 ⇒ `user-layout` 没渲染 ⇒ `AccountAdminService`（root 级、由布局注入）
 * **根本不会被实例化** ⇒ `/api/admin/me` 一次都没发出。
 * 后果比"少几条断言"严重：此时"设置导航里没有账号管理"是**假绿** —— 导航压根不在 DOM 里，
 * 跟角色是 user 还是 owner 毫无关系。（第一版 A 组就是这么绿的。）
 *
 * 为什么必须刷新：`AccountAdminService.ensureLoaded()` 是**幂等**的（同一个账号只拉一次），
 * 所以改完角色不重启应用就读不到新身份。而应用内换 hash 不会重建服务。
 *
 * ⇒ 于是：刷新 + 输入主密码解锁（解锁走的是主密码，**不是登录**，不消耗登录限流额度）。
 */
async function ensureUnlocked(label = "") {
  const hash = await page.evaluate(() => location.hash);
  if (!hash.startsWith("#/lock")) return true;

  const diag = await page.evaluate(() => ({
    inputs: [...document.querySelectorAll("input")].map((i) => ({
      id: i.id,
      type: i.type,
      ph: i.placeholder,
    })),
    texts: [...document.querySelectorAll("button,a")].slice(0, 14)
      .map((b) => (b.textContent || "").trim().slice(0, 18)).filter(Boolean),
  }));
  console.log(`     [解锁] ${label} 落在 ${hash}`);
  console.log(`     [解锁] inputs=${JSON.stringify(diag.inputs)}`);
  console.log(`     [解锁] 可点文字=${diag.texts.join(" / ")}`);

  // 解锁页可能先要你选"用主密码解锁"（另一条路是生物识别）。
  for (const t of ["使用主密码解锁", "用主密码解锁", "主密码"]) {
    const b = page.locator(`text="${t}"`).first();
    if ((await b.count().catch(() => 0)) > 0 && (await b.isVisible().catch(() => false))) {
      await b.click({ timeout: 4000 }).catch(() => {});
      await sleep(1200);
      break;
    }
  }

  for (let i = 0; i < 3; i++) {
    const box = await page.$("input#masterPassword, input[type=password]");
    if (!box) {
      await sleep(1500);
      continue;
    }
    await box.click();
    await box.fill("");
    await page.keyboard.type(PASSWORD, { delay: 30 });
    await sleep(700);
    await page.evaluate(() => {
      const p = document.querySelector("input#masterPassword, input[type=password]");
      const f = p && p.closest("form");
      if (f) f.requestSubmit();
      else if (p) p.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await sleep(6000);
    if (!(await page.evaluate(() => location.hash)).startsWith("#/lock")) {
      console.log(`     [解锁] ✅ 已解锁 -> ${await page.evaluate(() => location.hash)}`);
      return true;
    }
  }
  console.log("     [解锁] ❌ 尝试 3 次仍停在 lock 页");
  return false;
}

/**
 * 断言"我们真的站在设置页、导航真的渲染了"。
 *
 * 🔴 这条是**给其他断言兜底的**：没有它，"导航里没有账号管理"分不清
 * 「角色是普通用户」和「页面根本没渲染」。第一版就是因为缺这条而出了 20 个假 FAIL + 假绿。
 */
async function assertOnSettingsPage(tag) {
  const st = await page.evaluate(() => {
    const subnav = document.querySelector("#warden-subnav");
    return {
      hash: location.hash,
      navItems: document.querySelectorAll("bit-nav-item").length,
      subnav: !!subnav,
      subnavVisible: subnav ? getComputedStyle(subnav).display !== "none" : false,
    };
  });
  check(`[${tag}] 真的在设置分区（hash 以 #/settings 开头）`, st.hash.startsWith("#/settings"), st.hash);
  check(`[${tag}] 桌面设置导航已渲染（bit-nav-item >= 5）`, st.navItems >= 5, `navItems=${st.navItems}`);
  return st;
}

/** 刷新并等身份重新拉一次（`AccountAdminService` 的 effect 只在服务实例创建时拉 —— 刷新即可重建）。 */
async function reloadAndSettle(hash = "#/settings/account") {
  const before = meCalls.length;
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await sleep(6000);
  await ensureUnlocked(hash);
  await sleep(1500);
  // 解锁后 web-vault 往往把人送回 /vault —— 再导航一次到目标路由。
  // 这是 SPA 内换 hash，不会重新锁屏；若目标被守卫拦掉(普通用户进管理页)，最终 hash 就不是它，
  // 那正是第 5 组要断言的行为，不在这里纠。
  const now = await page.evaluate(() => location.hash);
  if (!now.startsWith(hash)) {
    await page.evaluate((h) => {
      location.hash = h;
    }, hash);
    await sleep(4000);
  }
  return await waitForMe(before);
}

/** 桌面「设置」导航里的子项（窄屏下这些子项根本不在 DOM 里，见 mobile-sub-nav 的注释）。 */
const desktopEntry = () =>
  page.locator('bit-nav-item, bit-nav-group bit-nav-item').filter({ hasText: "账号管理" });

/** 窄屏二级导航 chips（`#warden-subnav`）。 */
const mobileEntry = () => page.locator('#warden-subnav a[data-href="#/settings/account-admin"]');

/** 窄屏二级导航的**全部** chips 文案 —— 用它数项数（"5 或 6 项"没有任何脚本在守）。 */
async function subNavLabels() {
  return await page.evaluate(() =>
    [...document.querySelectorAll("#warden-subnav a")].map((a) => (a.textContent || "").trim()),
  );
}

async function visibleCount(loc) {
  const n = await loc.count().catch(() => 0);
  let v = 0;
  for (let i = 0; i < n; i++) {
    if (await loc.nth(i).isVisible().catch(() => false)) v++;
  }
  return { n, v };
}

async function shot(name, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await sleep(900);
  const f = path.join(SHOTS, `${name}-${w}.png`);
  await page.screenshot({ path: f, fullPage: false });
  console.log(`     📸 ${path.relative(process.cwd(), f)}`);
  return f;
}

/* ---------------------------------- 开跑 ---------------------------------- */

console.log("\n========== AC 段 UI 验收（测试通道）==========");

const all = users();
const target = all.find((u) => u.email === MAIL);
if (!target) {
  console.error(`❌ 生产账号列表里找不到 ${MAIL} —— 先确认后端已部署。`);
  await browser.close();
  process.exit(2);
}
console.log(`目标账号 id = ${target.id}（当前 role=${target.role}）`);

/* ---- 起点：确保是 user（这样"没有入口"才是真的由角色驱动，而不是因为上一轮没收拾干净）---- */
group("0. 起点归零");
{
  const r = setRole(target.id, "user");
  check("把验收账号设回 user -> 200", r.status === 200, `http=${r.status}`);
  check("读回确认 = user", roleOf() === "user", `实际=${roleOf()}`);
}

/* ---- 登录（测试通道反代生产，所以这是**生产账号**的真实会话）---- */
group("1. 登录测试通道");
await login(page, { verbose: true });
check("已落到密码库页", await page.evaluate(() => !!document.querySelector("app-vault")));

/* ---- A. user：两处入口都不该出现 ---- */
group("A. role=user —— 入口必须不存在（负向对照）");
{
  const me = await reloadAndSettle("#/settings/account");
  await assertOnSettingsPage("A");
  check(
    "GET /api/admin/me 被调用且 200（只认会话的端点真的解开了会话 token）",
    me?.status === 200,
    me ? `http=${me.status} body=${me.body}` : "15s 内没有拿到响应",
  );
  check(
    "响应里 role=user 且 is_admin=false",
    !!me && /"role"\s*:\s*"user"/.test(me.body) && /"is_admin"\s*:\s*false/.test(me.body),
    me?.body ?? "",
  );

  const d = await visibleCount(desktopEntry());
  check("桌面(1440)设置导航里没有「账号管理」", d.v === 0, `命中 ${d.n} 个、可见 ${d.v} 个`);

  // ⚠️ 窄屏必须切到 390 再数（见 B 组注释）：不切视口的话 `#warden-subnav` 是 display:none，
  //    这条恒为 0 —— 那就是**假绿**，"入口对普通用户隐藏"根本没被真正验证过。
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(1000);
  const m = await visibleCount(mobileEntry());
  check("窄屏(390)二级导航里没有「账号管理」", m.v === 0, `命中 ${m.n} 个、可见 ${m.v} 个`);

  const labels = await subNavLabels();
  check("窄屏二级导航此刻是 5 项（普通用户的设置）", labels.length === 5,
    `${labels.length} 项: ${labels.join(" / ")}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(700);
}

/* ---- B. admin：入口出现，但角色下拉置灰 ---- */
group("2. 提为 admin —— 入口出现，但改不了角色");
{
  const r = setRole(target.id, "admin");
  check("设为 admin -> 200", r.status === 200, `http=${r.status}`);
  check("读回确认 = admin", roleOf() === "admin", `实际=${roleOf()}`);

  const me = await reloadAndSettle("#/settings/account");
  await assertOnSettingsPage("B");
  check("重新判定后 is_admin=true / is_owner=false",
    !!me && /"is_admin"\s*:\s*true/.test(me.body) && /"is_owner"\s*:\s*false/.test(me.body),
    me?.body ?? "");

  const d = await visibleCount(desktopEntry());
  check("桌面(1440)设置导航里**出现**「账号管理」", d.v >= 1, `可见 ${d.v} 个`);
  await shot("admin-desktop-settings", 1440, 900);

  // ⚠️ 窄屏入口必须**先切到 390 视口**再断言：`#warden-subnav` 在桌面是 `display:none`，
  //    在 1440 下数它恒为 0 —— 那是**假 FAIL**；反过来（在 1440 下断言"没有入口"）
  //    就是**假绿**，A 组第一版正是这么绿的。
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(1000);
  const m = await visibleCount(mobileEntry());
  check("窄屏(390)二级导航里**出现**「账号管理」", m.v >= 1, `可见 ${m.v} 个`);
  await shot("admin-mobile-settings", 390, 844);
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(700);

  const labels = await subNavLabels();
  check("窄屏二级导航此刻是 6 项", labels.length === 6, `${labels.length} 项: ${labels.join(" / ")}`);

  // 进页面
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    location.hash = "#/settings/account-admin";
  });
  await sleep(5000);
  const hasPage = await page.locator('[data-testid="admin-table"]').count();
  check("管理页渲染出来了（admin-table 存在）", hasPage > 0, `count=${hasPage}`);

  const rows = await page.locator('[data-testid="admin-table"] tbody tr').count().catch(() => 0);
  check("表格里有账号行", rows > 0, `rows=${rows}`);
  check("行数 == 后端返回的账号数（跨源一致性）", rows === all.length,
    `UI=${rows} API=${all.length}`);

  // ⚠️ 角色下拉在**详情弹窗**里：`<dialog #detailDlg>` 的正文由 `@if (detail())` 控制，
  //    没打开时那些节点**根本不在 DOM 里** ⇒ 必须先点该行的「管理」按钮把它打开。
  //    （第一版直接去 `tr[data-uid]` 里找下拉，命中不到 ⇒ `isDisabled()` 抛错 ⇒ 拿到 null，
  //      报出来像"下拉没置灰"，其实是判据没到位。）
  await page
    .locator(`[data-testid="admin-manage-${target.id}"]`)
    .first()
    .click({ timeout: 10000 })
    .catch(() => {});
  await sleep(1800);
  const dlgOpen = await page.evaluate(() => {
    const d = document.querySelector("dialog.warden-admin-dlg");
    return !!d && d.open === true;
  });
  check("点「管理」后详情弹窗已打开", dlgOpen);

  const mine = page.locator(`[data-testid="admin-role-${target.id}"]`).first();
  const disabled = await mine.isDisabled().catch(() => null);
  check("角色下拉**置灰**（管理者改不了角色）", disabled === true, `disabled=${disabled}`);
  check("页面提示了为什么不能改",
    (await page.locator(".warden-admin-hint").first().innerText().catch(() => "")).length > 0);

  await page.keyboard.press("Escape").catch(() => {});
  await sleep(900);

  await shot("admin-page-desktop", 1440, 900);
  await shot("admin-page-mobile", 390, 844);

  // 窄屏：表格必须降级成卡片列表，且**不许横向滚动**
  group("2b. 窄屏形态（390px）");
  {
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(1200);
    const geo = await page.evaluate(() => {
      const wrap = document.querySelector(".warden-admin-tablewrap");
      const thead = document.querySelector(".warden-admin-table thead");
      const extras = [...document.querySelectorAll(".warden-admin-extra")];
      const vis = (el) => !!el && getComputedStyle(el).display !== "none";
      return {
        docScrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        wrapScrollW: wrap ? wrap.scrollWidth : -1,
        wrapClientW: wrap ? wrap.clientWidth : -1,
        theadVisible: vis(thead),
        extrasTotal: extras.length,
        extrasVisible: extras.filter(vis).length,
      };
    });
    check("整页没有横向滚动（不变量：scrollWidth <= innerWidth+1）",
      geo.docScrollW <= geo.innerW + 1, `doc=${geo.docScrollW} win=${geo.innerW}`);
    check("表格容器本身也不横向滚（scrollWidth <= clientWidth+1）",
      geo.wrapScrollW <= geo.wrapClientW + 1, `scrollW=${geo.wrapScrollW} clientW=${geo.wrapClientW}`);
    check("窄屏把 <thead> 藏掉了（降级成卡片列表）", geo.theadVisible === false);
    check("窄屏把次要列 .warden-admin-extra 藏掉了",
      geo.extrasTotal > 0 && geo.extrasVisible === 0,
      `${geo.extrasVisible}/${geo.extrasTotal} 可见`);
  }

  // 窄屏二级导航 chips：不换行、不溢出
  group("2c. 窄屏二级导航 6 项不挤");
  {
    await page.evaluate(() => {
      location.hash = "#/settings/account";
    });
    await sleep(3500);
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(1200);
    const g = await page.evaluate(() => {
      const nav = document.querySelector("#warden-subnav");
      if (!nav) return null;
      const as = [...nav.querySelectorAll("a")];
      const tops = as.map((a) => Math.round(a.getBoundingClientRect().top));
      const navBox = nav.getBoundingClientRect();
      const last = as.at(-1)?.getBoundingClientRect();
      return {
        n: as.length,
        rowCount: [...new Set(tops)].length,
        scrollW: nav.scrollWidth,
        clientW: nav.clientWidth,
        lastRight: last ? Math.round(last.right) : null,
        navRight: Math.round(navBox.right),
        navVisible: getComputedStyle(nav).display !== "none",
      };
    });
    check("窄屏二级导航可见", g?.navVisible === true);
    check("6 项排成**一行**（不换行）", g?.rowCount === 1, `rowCount=${g?.rowCount} n=${g?.n}`);
    check("不溢出容器（scrollWidth <= clientWidth+1）", g && g.scrollW <= g.clientW + 1,
      `scrollW=${g?.scrollW} clientW=${g?.clientW}`);
    check("最后一项没有超出容器右边界",
      g && g.lastRight !== null && g.lastRight <= g.navRight + 1,
      `lastRight=${g?.lastRight} navRight=${g?.navRight}`);
    await shot("admin-mobile-subnav", 390, 844);
  }
}

/* ---- C. owner：角色下拉变为可选 ---- */
group("3. 提为 owner —— 角色下拉变为可选（admin ≠ owner 的对照）");
{
  const r = setRole(target.id, "owner");
  check("设为 owner -> 200", r.status === 200, `http=${r.status}`);
  check("读回确认 = owner", roleOf() === "owner", `实际=${roleOf()}`);

  const me = await reloadAndSettle("#/settings/account-admin");
  check("重新判定后 is_owner=true",
    !!me && /"is_owner"\s*:\s*true/.test(me.body), me?.body ?? "");

  await page
    .locator(`[data-testid="admin-manage-${target.id}"]`)
    .first()
    .click({ timeout: 10000 })
    .catch(() => {});
  await sleep(1800);
  const mine = page.locator(`[data-testid="admin-role-${target.id}"]`).first();
  const disabled = await mine.isDisabled().catch(() => null);
  check("角色下拉**不再置灰**（所有者能改角色）", disabled === false, `disabled=${disabled}`);
  const opts = await mine.locator("option").allTextContents().catch(() => []);
  check("下拉里恰好有 普通用户/管理者/所有者 三个选项",
    opts.length === 3, `options=${JSON.stringify(opts)}`);
  await shot("owner-page-desktop", 1440, 900);
}

/* ---- D. 降回 user：入口必须再次消失 ---- */
group("4. 降回 user —— 入口必须再次消失（闭合负向对照）");
{
  const r = setRole(target.id, "user");
  check("降回 user -> 200", r.status === 200, `http=${r.status}`);
  const me = await reloadAndSettle("#/settings/account");
  await assertOnSettingsPage("D");
  check("重新判定后 role 回到 user",
    !!me && /"role"\s*:\s*"user"/.test(me.body), me?.body ?? "");

  const d = await visibleCount(desktopEntry());
  check("桌面(1440)设置导航里「账号管理」再次消失", d.v === 0, `可见 ${d.v} 个`);
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(1000);
  const m = await visibleCount(mobileEntry());
  check("窄屏(390)二级导航里「账号管理」再次消失", m.v === 0, `可见 ${m.v} 个`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(700);
}

/* ---- E. 直接访问 URL 也要被守卫挡住 ---- */
group("5. 直接敲 URL —— 守卫必须把人送回设置页");
{
  await page.evaluate(() => {
    location.hash = "#/settings/account-admin";
  });
  await sleep(4000);
  const hash = await page.evaluate(() => location.hash);
  check("普通用户敲 /settings/account-admin 会被重定向走",
    !hash.startsWith("#/settings/account-admin"), `最终 hash=${hash}`);
  const leaked = await page.locator('[data-testid="admin-table"]').count();
  check("页面上没有泄漏出管理表格", leaked === 0, `count=${leaked}`);
}

/* ---- F. 收尾 ---- */
group("6. 收尾：确认终态与起点一致");
{
  const final = roleOf();
  check("验收账号终态 = user", final === "user", `实际=${final}`);
  const owners = users().filter((u) => u.role === "owner").map((u) => u.email);
  console.log(`     当前 owner: ${owners.length ? owners.join(", ") : "(无)"}`);
}

const errs = consoleErrors.filter((e) => !/favicon|net::ERR_|status of 4\d\d/i.test(e));
check("运行期没有意外的 JS 错误", errs.length === 0, errs.slice(0, 3).join(" | "));

await browser.close();

console.log("\n" + "=".repeat(62));
console.log(`结果: ${pass} 通过 / ${fail} 失败`);
console.log(`截图: ${SHOTS}  ← 请**逐张人工过目**（脚本抓不到"丑"）`);
console.log("=".repeat(62));
process.exit(fail ? 1 : 0);
