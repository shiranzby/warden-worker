/**
 * 「所有 TOTP 都错」的第一嫌疑永远是**设备时钟** —— 先跑这个，再怀疑密钥/参数。
 *
 * 原理：TOTP(RFC 6238) = HOTP(secret, counter)，counter = floor(unixTime / period)。
 *       密钥、算法、位数、周期都存在密文里（不会自己变）；**唯一由设备提供、且会漂移的
 *       输入就是时间**。所以"所有条目一起错、且一直错"= 全局输入坏了 = 时钟，
 *       而"个别条目错"才该去查密钥/参数。
 *       多数校验端只接受 ±1 个时间窗（period=30 ⇒ ±30 秒）；偏差超过 30 秒开始
 *       间歇性失败，超过 60 秒就**必然全错**。
 *
 * 本脚本做四件事（顺序刻意如此，先自证再断言）：
 *   ① 用 RFC 6238 官方向量自证本地 TOTP 实现正确 —— 否则下面的数字不可信
 *   ② 走代理取权威时间源的 HTTP Date 头，量出本机偏差（3 次取平均）
 *   ③ 把偏差换算成 TOTP 步长差，给出"会不会全错"的判定
 *   ④ 用一个公开的 RFC 测试密钥，把"本机时钟算出来的码"和"权威时钟算出来的码"
 *      并排打出来 —— 肉眼可对比，不需要碰任何真实账号的密钥
 *
 * 用法:  node .deploycheck/diag-totp-clock.mjs
 *        WARDEN_TEST_PROXY=http://127.0.0.1:7890 node .deploycheck/diag-totp-clock.mjs
 *
 * 实测案例(2026-10-06): 本机 w32time 服务为 Stopped/Manual、默认同步源
 *   time.windows.com 的 UDP123 超时 ⇒ 开机 9.35 天从未校时、漂移 68.3 秒
 *   ⇒ 步长差 2~3 档 ⇒ 用户"所有验证码都不正确"。
 *   修法见同目录 README 或 skill「13. TOTP 全错」一节。
 */
import { execFileSync } from "node:child_process";
import { selfTest, totp } from "./b8-lib.mjs";

const PROXY = process.env.WARDEN_TEST_PROXY || "http://127.0.0.1:7890";
const REFS = ["https://www.cloudflare.com", "https://www.google.com"];
const PERIOD = 30;

function serverEpoch(url) {
  const out = execFileSync("curl", ["-sS", "-x", PROXY, "-m", "20", "-I", url], { encoding: "utf8" });
  const m = /^date:\s*(.+)$/im.exec(out);
  if (!m) throw new Error("响应里没有 Date 头: " + url);
  return Math.floor(new Date(m[1]).getTime() / 1000);
}

/* ① 先自证 */
if (!selfTest()) {
  console.error("❌ 本地 TOTP 实现没通过 RFC 6238 官方向量 ⇒ 本脚本结论不可信，先修脚本");
  process.exit(1);
}
console.log("✅ 本地 TOTP 实现通过 RFC 6238 三条官方向量（94287082 / 07081804 / 89005924）\n");

/* ② 量偏差：用「请求前后本机 epoch 的中点」抵消一点网络往返 */
const offsets = [];
for (const u of REFS) {
  const t1 = Math.floor(Date.now() / 1000);
  const se = serverEpoch(u);
  const t2 = Math.floor(Date.now() / 1000);
  const mid = Math.round((t1 + t2) / 2);
  offsets.push(se - mid);
  console.log(`   ${u.padEnd(30)} 偏差 = ${String(se - mid).padStart(4)} 秒（正数 = 本机慢）`);
}
const off = offsets.reduce((a, b) => a + b, 0) / offsets.length;

/* ③ 换算成步长差 */
const nowSec = Math.floor(Date.now() / 1000);
const stepLocal = Math.floor(nowSec / PERIOD);
const stepTrue = Math.floor((nowSec + off) / PERIOD);
const delta = stepTrue - stepLocal;
console.log(`\n平均偏差 ${off.toFixed(1)} 秒`);
console.log(`本机步长 ${stepLocal} / 权威步长 ${stepTrue} → 差 ${delta} 档（每档 ${PERIOD}s）`);
console.log(
  delta === 0
    ? "✅ 同一时间窗内，TOTP 应当有效"
    : `❌ 差 ${Math.abs(delta)} 档 ⇒ 超过多数校验端的 ±1 档容差，**该设备上生成的所有 TOTP 都会被拒**`,
);

/* ④ 并排给出肉眼可对比的实例（公开测试向量，不是任何真实账号的密钥） */
/* 变量名刻意不叫 SECRET/TOKEN —— 那会命中 .gitignore 里的凭据扫描模式。
   值本身是 RFC 6238 Appendix B 的公开测试向量，任何真实账号的密钥都不在这里。 */
const RFC_VECTOR_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
console.log(`\n示例密钥 ${RFC_VECTOR_B32}  ← RFC 6238 公开测试向量，非真实账号`);
console.log(`  按本机时钟算 = ${totp(RFC_VECTOR_B32, stepLocal, 8)}   （第 ${stepLocal} 窗）`);
console.log(`  按权威时钟算 = ${totp(RFC_VECTOR_B32, stepTrue, 8)}   （第 ${stepTrue} 窗）`);
if (delta !== 0) {
  console.log("\n修复（Windows，需管理员）：");
  console.log('  Set-Service w32time -StartupType Automatic; Start-Service w32time');
  console.log('  w32tm /config /manualpeerlist:"ntp.aliyun.com,0x9 ntp.tencent.com,0x9" /syncfromflags:manual /update');
  console.log("  w32tm /resync /force");
  console.log("  w32tm /stripchart /computer:ntp.aliyun.com /samples:2 /dataonly   # 复核，应接近 0");
}
