/**
 * 注册页 UI 级验证 —— 服务端的错误原因到底有没有显示在用户眼前。
 *
 * 为什么需要它: `probe-register-errors.py` 只证到"HTTP 响应体带上了 message";
 * 用户在界面里看到的是 Bitwarden 的 Toast, 中间还隔着
 * `ValidationService.showError` 里 `data.message ? data.message : unexpectedError`
 * 这个三元式。本脚本走真实浏览器跑完整注册流程, 直接读 Toast 文本断言。
 *
 * 判据(两侧都断言, 防止"假绿"):
 *   ✓ Toast 文本必须**包含**服务端那句话的关键片段;
 *   ✗ Toast 文本**不得**出现 i18n 回退文案(unexpectedError) —— 只查一侧会假绿。
 *
 * 零副作用: 用的是**已注册**邮箱 ⇒ 服务端在查重处 400 拒绝, 走不到 INSERT。
 *
 * 用法:
 *   WARDEN_TEST_BASE=https://shypwd.cc.cd WARDEN_TEST_PROXY=http://127.0.0.1:7890 \
 *     node probe-register-ui.mjs
 */
import { chromium } from "file:///C:/Users/Administrator/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs";
import { BASE, CHROME, sleep } from "./b8-lib.mjs";

const PROXY = process.env.WARDEN_TEST_PROXY || "http://127.0.0.1:7890";
const EMAIL = (process.env.WARDEN_TEST_MAIL || "").trim();
// 一次性假口令 —— 服务端在查重处就 400 拒绝, 永远走不到哈希, 绝不使用真实口令。
const DUMMY_MASTER_KEY = "ProbeOnly-Pass-9f3x";

let pass = 0,
  fail = 0;
const check = (n, ok, d = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? "  " + d : ""}`);
  ok ? pass++ : fail++;
};

if (!EMAIL) {
  console.error("缺少 WARDEN_TEST_MAIL(放 .deploycheck/.env.local)");
  process.exit(2);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  ...(PROXY ? { proxy: { server: PROXY } } : {}),
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1280, height: 900 },
  locale: "zh-CN",
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));

const bodyText = async () =>
  (await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim())).slice(
    0,
    500,
  );

console.log(`\nBASE = ${BASE}\nEMAIL = ${EMAIL.slice(0, 2)}***@${EMAIL.split("@")[1]}\n`);

// ── 1. 注册起始页: 填邮箱 + 姓名 ────────────────────────────────────────────
await page.goto(`${BASE}/#/signup`, { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(6000);
console.log("--- ① 起始页 ---");
console.log("  url =", page.url());
console.log("  text =", await bodyText());

const emailSel = "#register-start_form_input_email";
const nameSel = "#register-start_form_input_name";
if (!(await page.locator(emailSel).count())) {
  check("找到邮箱输入框", false, "选择器 " + emailSel + " 不存在");
  await page.screenshot({ path: "shots/ui-signup-01.png" });
  await browser.close();
  console.log(`\n================ ${pass} 通过 / ${fail} 失败 ================`);
  process.exit(1);
}
await page.fill(emailSel, EMAIL);
if (await page.locator(nameSel).count()) await page.fill(nameSel, "UI Probe");
await page.locator('button[type="submit"]').first().click();
await sleep(8000);
console.log("--- ② 提交邮箱后 ---");
console.log("  url =", page.url());
console.log("  text =", await bodyText());
await page.screenshot({ path: "shots/ui-signup-02.png" });

// ── 2. 若停在"查收邮件"状态, 直接改道 finish-signup(本部署是免邮箱验证流程) ──
if (!/finish-signup/.test(page.url())) {
  console.log("  ↪ 未自动进入 finish-signup, 直接导航过去(免验证流程)");
  await page.goto(`${BASE}/#/finish-signup`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(6000);
  console.log("  url =", page.url());
  console.log("  text =", await bodyText());
}

// ── 3. 设主密码页: 填口令并提交 ─────────────────────────────────────────────
console.log("--- ③ 设主密码页 ---");
const pwInputs = await page.locator('input[type="password"]').count();
console.log("  password 输入框数 =", pwInputs);
if (!pwInputs) {
  check("找到主密码输入框", false, "本页没有 input[type=password]");
  await page.screenshot({ path: "shots/ui-signup-03.png" });
  await browser.close();
  console.log(`\n================ ${pass} 通过 / ${fail} 失败 ================`);
  process.exit(1);
}
for (let i = 0; i < pwInputs; i++) {
  await page.locator('input[type="password"]').nth(i).fill(DUMMY_MASTER_KEY);
}
if (await page.locator('input[type="password"] + input[type="password"]').count()) {
  await page.locator('input[type="password"]').nth(1).fill(DUMMY_MASTER_KEY);
}
await sleep(500);

// 提交按钮: 「创建账户」/ "createAccount"; 先按文案找, 退回第一个 submit
const submit = page.locator('button[type="submit"]').first();
console.log("  提交按钮文案 =", (await submit.innerText().catch(() => "?")).trim());
await submit.click();

// ── 4. 读 Toast ────────────────────────────────────────────────────────────
let toast = "";
for (let i = 0; i < 20; i++) {
  await sleep(700);
  toast = await page.evaluate(() => {
    const nodes = document.querySelectorAll(
      'bit-toast, .toast, .toast-container, [role="alert"], [role="status"], bit-toast-container *',
    );
    return [...nodes]
      .map((n) => (n.innerText || "").replace(/\s+/g, " ").trim())
      .filter((t) => t.length > 1)
      .join(" || ");
  });
  if (toast) break;
}
console.log("--- ④ Toast ---");
console.log("  url =", page.url());
console.log("  toast =", JSON.stringify(toast));
await page.screenshot({ path: "shots/ui-signup-04.png" });

// ── 5. 断言(两侧) ──────────────────────────────────────────────────────────
check("捕获到错误 Toast", toast.length > 0, JSON.stringify(toast).slice(0, 160));
check(
  "Toast 含服务端原因(「已注册」)",
  /已注册/.test(toast),
  "→ 服务端 message 已透传到界面",
);
check(
  "Toast **未**回退到通用文案(发生意外错误 / unexpected error)",
  !/意外错误|unexpected error/i.test(toast),
  "→ 说明走的是 data.message 分支而不是 i18n 兜底",
);

console.log(`\n================ ${pass} 通过 / ${fail} 失败 ================`);
await browser.close();
process.exit(fail ? 1 : 0);
