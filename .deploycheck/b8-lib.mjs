/**
 * 第八批运行期验证的公共件: 登录 / 引导拦截 / 路由跳转 / RFC 6238 TOTP。
 *
 * 为什么单独抽出来: `seed-b8.mjs` 与 `verify-batch8.mjs` 需要**完全一样**的登录流程,
 * 而这段流程踩过两次坑(见下), 分成两份拷贝迟早会各自修一半。实测代价:
 *   ① 登录后可能落在 **整页的** `#/setup-extension` 上(不是 cdk 覆盖层);
 *   ② 点「稍后添加」还会再弹一层确认框, 真正的"跳过"按钮是 **「跳到网页 App」**;
 *   ③ 多次登录会被服务端限流 —— 所以 verify 脚本只登录一次, 之后用 storageState
 *      复制到第二个 context(桌面 / 窄屏), 不再各自登录。
 *
 * 用法: import { login, openContext, goRoute, totp, selfTest, ... } from "./b8-lib.mjs";
 */
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

/** 读同目录的 `.env.local`(已 gitignore) —— 凭据只留本地, 不进版本控制。 */
function loadLocalEnv() {
  const f = path.join(import.meta.dirname, ".env.local");
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadLocalEnv();

/**
 * ⚠️ 凭据**刻意不给默认值** —— 本文件是要进版本控制的, 而 `shiranzby/warden-worker`
 *    是 **public** 仓库。本地把这两项写在同目录的 `.env.local`(已 gitignore), 或直接 export。
 *    缺失时 `login()` 会明确报错, 而不是静默拿一个错账号去撞限流。
 */
export const BASE = process.env.WARDEN_TEST_BASE || "https://localhost:8099";
export const ACCOUNT = process.env.WARDEN_TEST_MAIL || "";
export const PASSWORD = process.env.WARDEN_TEST_PASS || "";
export const CHROME =
  "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";
export const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
export const SHOTS = path.resolve(import.meta.dirname, "shots");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 「跳过引导」按钮的文案, **按顺序**点。
 *
 * ⚠️ 首选其实不是文案, 而是 `clickSkips()` 里那条按 `href="#/vault"` 的定位 ——
 *    因为 i18n 文案会变: `skipToWebApp` 的中文是**「跳转到网页 App」**,
 *    我一开始按「跳到网页 App」找(少一个"到"), count 恒为 0, 于是"点了半天没反应、
 *    页面一直停在 /setup-extension"(踩过两次)。文案只作为兜底留着。
 */
const SKIP_TEXTS = [
  "跳转到网页 App",
  "稍后添加",
  "以后再说",
  "跳过",
  "知道了",
  "开始使用",
  "完成",
  "关闭",
];

/**
 * 把 `location.hash`(`#/vault`) 归一成路由路径(`/vault`)。
 * ⚠️ 这是 hash 路由的经典 off-by-one: 直接 `location.hash.indexOf("/vault") === 0`
 *    永远为 false(真实串是 `#/vault`, `/` 在索引 1)。踩过一次 ——
 *    结果"明明已经登录并站在密码库页上", `onVault()` 还是返回 false, 白绕一大圈。
 */
export const pathOf = (hash) => String(hash || "").replace(/^#/, "");

/** 是否已经真的站在密码库页上(用路由 + 组件双重判定 —— 空库时表格里没有行)。 */
export const onVault = (page) =>
  page.evaluate(
    () =>
      location.hash.replace(/^#/, "").indexOf("/vault") === 0 &&
      !!document.querySelector("app-vault"),
  );

/** 点掉所有可见的引导按钮。返回是否真的点到了东西。 */
export async function clickSkips(page) {
  let acted = false;

  /*
   * ① 最稳的一条: 「稍后添加」弹出的确认框里, 跳过键本身就是 `<a routerLink="/vault">`
   *    (`add-extension-later-dialog.component.html`)。按 href 找, 完全不依赖 i18n 文案 ——
   *    文案差一个字(count 恒 0)就会让整个流程变成"原地打转"。
   * ② 文案兜底见下。
   */
  const hrefSkip = page.locator('.cdk-overlay-container a[href="#/vault"]').first();
  if (
    (await hrefSkip.count().catch(() => 0)) > 0 &&
    (await hrefSkip.isVisible().catch(() => false))
  ) {
    await hrefSkip.click({ timeout: 5000 }).catch(() => {});
    acted = true;
    await sleep(1800);
  }

  for (const t of SKIP_TEXTS) {
    /*
     * ⚠️ 不能用 `button:has-text(...)`: 这些引导按钮是 `<bit-button>` / `<a bitButton>`
     *    渲染出来的, 外层宿主既不是 `<button>` 也不是 `<a>`, 按标签选会一个都命中不到。
     *    `text="..."` 是 Playwright 的文本引擎, 会取"精确包含该文案的最小元素",
     *    对 button / a / bit-button 一律成立。
     */
    const loc = page.locator(`text="${t}"`).first();
    if ((await loc.count().catch(() => 0)) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await loc.click({ timeout: 4000 }).catch(() => {});
    acted = true;
    await sleep(1500);
  }
  return acted;
}

/**
 * 登录并落到密码库页。失败时抛出带现场信息的错误(而不是静默返回空列表)。
 *
 * ⚠️ 必须用**真实键盘输入**(`keyboard.type`), 不能用 `fill()`:
 *    实测 `fill()` 把 value 写进去了, 但 Angular 的 FormControl **收不到输入事件** ——
 *    input 上的类是 `ng-pristine ng-invalid`, 表单因此一直卡在"主密码必填",
 *    `requestSubmit()` 触发的只是校验失败。换成键盘输入后立刻变 `ng-dirty ng-valid`。
 *    (踩过两次: 第一次以为是限流, 第二次才从 ng-* 类上看出是控件没拿到值。)
 *
 * ⚠️ 提交用 `form.requestSubmit()` 而不是点按钮: 页面上有个没 class 的 div 挡在按钮中心,
 *    点按钮会超时; 而 requestSubmit 只要控件是 ng-valid 就能正常触发 ngSubmit。
 */
export async function login(page, { verbose = true } = {}) {
  const log = verbose ? (m) => console.log("   " + m) : () => {};
  if (!ACCOUNT || !PASSWORD) {
    throw new Error(
      "缺少测试账号凭据: 请在同目录的 .env.local 里写 WARDEN_TEST_MAIL / WARDEN_TEST_PASS(该文件已 gitignore), " +
        "或直接 export 这两个环境变量。",
    );
  }
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
  await sleep(7000);

  const em = await page.$("input#email");
  if (em) {
    await em.click();
    await em.fill("");
    await page.keyboard.type(ACCOUNT, { delay: 25 });
    await sleep(500);
    await page.keyboard.press("Enter");
    await sleep(5500);
  }

  for (let i = 0; i < 4; i++) {
    const pw = await page.$("input#masterPassword");
    if (!pw) break;

    await pw.click();
    await pw.fill("");
    await page.keyboard.type(PASSWORD, { delay: 30 });
    await sleep(800);

    const ng = await page.evaluate(() => {
      const p = document.querySelector("input#masterPassword");
      return p ? (p.className.match(/ng-\w+/g) || []).join(",") : "";
    });
    log(`submit#${i} input ng 类: ${ng}`);

    await page.evaluate(() => {
      const p = document.querySelector("input#masterPassword");
      const f = p && p.closest("form");
      if (f) f.requestSubmit();
    });
    await sleep(10000);
    const h = await page.evaluate(() => location.hash);
    log(`submit#${i} -> ${h}`);
    if (h !== "#/login") break;
  }

  /*
   * 走完引导。这里的顺序是本文件最容易踩坑的地方:
   *
   *   `#/setup-extension` 那页的「稍后添加」只是**打开**一个对话框
   *   (`add-extension-later-dialog`), 真正写入"别再显示"标记 + 跳转的是对话框里那个
   *   `<a routerLink="/vault" (click)="dismissExtensionPage()">「跳到网页 App」`。
   *
   *   ⚠️ 所以两轮 `clickSkips` 之间**不能**改 hash: 一改 hash 就会先触发导航把对话框拆掉,
   *      对话框的 `onDismiss` 永远不执行 ⇒ 标记没写 ⇒ 守卫每次都把你弹回 /setup-extension。
   *      这是一个"看起来在动、其实原地打转"的死循环(踩过一次)。
   *      `clickSkips` 内部把「跳到网页 App」排在第一位, 因此第一轮点开对话框、
   *      第二轮正好先点掉它。
   */
  for (let i = 0; i < 8; i++) {
    if (await onVault(page)) break;
    await clickSkips(page); // 第 1 轮: 点「稍后添加」, 打开确认框
    await sleep(1200);
    await clickSkips(page); // 第 2 轮: 点掉确认框里的「跳到网页 App」
    if (await onVault(page)) break;
    await page.evaluate(() => {
      location.hash = "#/vault";
    });
    await sleep(2500);
  }

  if (!(await onVault(page))) {
    const hash = await page.evaluate(() => location.hash);
    const text = (await page.evaluate(() => document.body.innerText))
      .slice(0, 300)
      .replace(/\n+/g, " | ");
    throw new Error(`登录后没能进入密码库 (hash=${hash})。页面文字: ${text}`);
  }
  await sleep(1500);
}

/** 切到某个 hash 路由, 等目标选择器出现。 */
export async function goRoute(page, hash, waitSel, timeout = 12000) {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate((sel) => !!document.querySelector(sel), waitSel)) break;
    await sleep(400);
  }
  await sleep(1500);
}

/* ---------- 会话缓存(⚠️ 实测基本无效, 保留只为"万一") ---------- */
/**
 * ⚠️ **不要指望它**: 实测 web-vault 的登录态存在 **sessionStorage**
 *    (`<userId>_token_accessToken` / `_token_refreshToken` / `_crypto_localUserData` …),
 *    而 Playwright 的 `storageState()` 只覆盖 cookies + localStorage ⇒ 这份文件写出去的会话
 *    **恢复不了登录**, 每次都会走真登录(日志里那句"缓存会话不可用"就是它)。
 *    曾据此以为"能省掉登录、规避限流", 结果在第八批误判了一轮。
 *    真要规避限流, 办法是"同一个 page 里跑完所有场景"(见 verify-batch8 的窄屏一节),
 *    而不是换 context。
 */
export const STATE_FILE = path.join(import.meta.dirname, "shypwd-auth.json");

/** 存在就交给 `newContext({ storageState })` 用。 */
export function savedState() {
  return fs.existsSync(STATE_FILE) ? STATE_FILE : undefined;
}

export function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
  return STATE_FILE;
}

/**
 * 优先复用缓存会话; 没有(或已失效)才真登录, 登录成功后把会话存下来。
 * ⚠️ 事实上"复用"这条路**从不生效**(token 在 sessionStorage, 见 STATE_FILE 处的说明),
 *    所以这里等于"每次真登录"。短时间重复登录会被服务端限流(第 3 次起停在 #/login
 *    且没有任何提示), 因此**一个脚本里只应登录一次**, 后续场景复用同一个 page。
 */
export async function ensureLoggedIn(page, ctx, { verbose = true } = {}) {
  await page.goto(BASE + "/#/vault", { waitUntil: "domcontentloaded", timeout: 90000 });
  await sleep(9000);
  if (await onVault(page)) {
    return "复用已保存的会话";
  }
  if (verbose) console.log("   [登录] 缓存会话不可用, 走一次真登录");
  await login(page, { verbose });
  saveState(await ctx.storageState());
  return `重新登录并已保存会话 -> ${STATE_FILE}`;
}

/* ---------- RFC 6238 TOTP: 独立算出"期望的码" ---------- */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Decode(s) {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error(`bad base32 char: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secretB32, counter, digits = 6, alg = "sha1") {
  const key = base32Decode(secretB32);
  const c = Buffer.alloc(8);
  c.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac(alg, key).update(c).digest();
  const o = h[h.length - 1] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** 自检: 必须对上 RFC 6238 的三条官方向量, 否则这份验证脚本本身不可信。 */
export function selfTest() {
  const S = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  return (
    totp(S, Math.floor(59 / 30), 8) === "94287082" &&
    totp(S, Math.floor(1111111109 / 30), 8) === "07081804" &&
    totp(S, Math.floor(1234567890 / 30), 8) === "89005924"
  );
}

/** "123456" -> "123 456"(与组件里的显示格式一致)。 */
export const fmt = (c) => `${c.slice(0, 3)} ${c.slice(3)}`;
