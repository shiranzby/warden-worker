/*
 * warden-worker / shypwd.cc.cd — 自定义前端增强
 * 1) 在保险库列表每行末尾常显 TOTP 动态码(点按复制),刷新与官方一致
 * 2) 移动端适配的辅助钩子(主体样式在 custom.css)
 *
 * 注入方式: CI 在构建前把本文件拷入 web-vault 并在 index.html 引用。
 * 注意: 本脚本通过"条目名称+用户名"把 DOM 行匹配到 /api/ciphers 返回的条目,
 *       个人库重名极少,基本可靠;若某行匹配失败则跳过该行(不影响其他功能)。
 */
(function () {
  "use strict";

  var STEP = 30; // TOTP 时间步长(秒)

  /* ---------- Base32 解码 (RFC4648, 无 padding 也兼容) ---------- */
  function base32Decode(input) {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    var clean = input.replace(/=+$/g, "").toUpperCase().replace(/\s+/g, "");
    var bits = 0,
      value = 0,
      out = [];
    for (var i = 0; i < clean.length; i++) {
      var idx = alphabet.indexOf(clean[i]);
      if (idx === -1) continue;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(out);
  }

  function bufToBytes(buf) {
    return new Uint8Array(buf);
  }

  /* ---------- TOTP 计算 (Web Crypto: HMAC-SHA1) ---------- */
  async function hotp(secretBytes, counter) {
    var buf = new ArrayBuffer(8);
    var dv = new DataView(buf);
    dv.setUint32(0, Math.floor(counter / 0x100000000));
    dv.setUint32(4, counter >>> 0);
    var cryptoKey = await crypto.subtle.importKey(
      "raw",
      secretBytes,
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"]
    );
    var sig = bufToBytes(
      await crypto.subtle.sign("HMAC", cryptoKey, buf)
    );
    var offset = sig[sig.length - 1] & 0x0f;
    var binary =
      ((sig[offset] & 0x7f) << 24) |
      ((sig[offset + 1] & 0xff) << 16) |
      ((sig[offset + 2] & 0xff) << 8) |
      (sig[offset + 3] & 0xff);
    return binary;
  }

  async function totp(secret, digits, period) {
    digits = digits || 6;
    period = period || STEP;
    var counter = Math.floor(Date.now() / 1000 / period);
    var binary = await hotp(base32Decode(secret), counter);
    return (binary % Math.pow(10, digits)).toString().padStart(digits, "0");
  }

  /* 从 totp 字段(otpauth:// 或裸 base32)解析 secret/参数 */
  function parseTotp(raw) {
    if (!raw) return null;
    raw = raw.trim();
    if (raw.toLowerCase().indexOf("otpauth://") === 0) {
      try {
        var u = new URL(raw);
        var secret = u.searchParams.get("secret");
        if (!secret) return null;
        var digits = parseInt(u.searchParams.get("digits") || "6", 10);
        var period = parseInt(u.searchParams.get("period") || "30", 10);
        return { secret: secret, digits: digits, period: period };
      } catch (e) {
        return null;
      }
    }
    return { secret: raw, digits: 6, period: STEP };
  }

  /* ---------- 拉取带 TOTP 的条目 ---------- */
  async function loadCiphers() {
    try {
      var resp = await fetch("/api/ciphers", { credentials: "include" });
      if (!resp.ok) return [];
      var data = await resp.json();
      var list = Array.isArray(data) ? data : data.data || [];
      var map = [];
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        var login = c.login || {};
        if (!login.totp) continue;
        var p = parseTotp(login.totp);
        if (!p) continue;
        map.push({
          name: (c.name || "").toString().trim().toLowerCase(),
          username: (login.username || "").toString().trim().toLowerCase(),
          secret: p.secret,
          digits: p.digits,
          period: p.period,
        });
      }
      return map;
    } catch (e) {
      console.warn("[warden-totp] loadCiphers failed:", e);
      return [];
    }
  }

  function rowName(row) {
    var td = row.cells && row.cells[0];
    var t = td ? td.innerText : row.innerText;
    return (t || "").toString().split("\n")[0].trim().toLowerCase();
  }
  function rowUser(row) {
    var td = row.cells && row.cells[1];
    return td ? (td.innerText || "").toString().trim().toLowerCase() : "";
  }

  function findCipher(ciphers, row) {
    var name = rowName(row);
    var user = rowUser(row);
    var exact = null,
      byName = null;
    for (var i = 0; i < ciphers.length; i++) {
      var c = ciphers[i];
      if (c.name && c.name === name) {
        if (user && c.username && c.username === user) return c;
        if (!exact && (!user || !c.username)) exact = c;
        if (!byName) byName = c;
      }
    }
    return exact || byName;
  }

  /* ---------- 在行末插入 TOTP ---------- */
  function ensureStyle() {
    if (document.getElementById("warden-totp-style")) return;
    var s = document.createElement("style");
    s.id = "warden-totp-style";
    s.textContent =
      ".warden-totp-cell{vertical-align:middle!important}" +
      ".warden-totp-code{display:inline-flex;align-items:center;gap:6px;" +
      "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;" +
      "font-size:13px;font-weight:600;color:#175DDC;background:#eef3ff;" +
      "border:1px solid #c9d8ff;border-radius:6px;padding:2px 8px;" +
      "cursor:pointer;user-select:none;white-space:nowrap}" +
      ".warden-totp-code:hover{background:#e0e9ff}" +
      ".warden-totp-cell .warden-totp-copy{font-size:11px;color:#6b7a99}";
    document.head.appendChild(s);
  }

  function insertTotp(row, cipher) {
    if (row.querySelector(".warden-totp-code")) return; // 已插入
    var td = document.createElement("td");
    td.className = "warden-totp-cell";
    var span = document.createElement("span");
    span.className = "warden-totp-code";
    span.dataset.secret = cipher.secret;
    span.dataset.digits = cipher.digits || 6;
    span.dataset.period = cipher.period || STEP;
    span.title = "点击复制 TOTP 验证码";
    span.addEventListener("click", function () {
      var code = span.dataset.code || "";
      if (navigator.clipboard) navigator.clipboard.writeText(code);
      var old = span.firstChild ? span.firstChild.nodeValue : "";
      span.appendChild(document.createTextNode(" 已复制"));
      setTimeout(function () {
        if (span.firstChild) span.firstChild.nodeValue = old;
        var extra = span.querySelector(".warden-totp-copy");
        if (extra) extra.remove();
      }, 800);
    });
    td.appendChild(span);

    // 插到"三点菜单"单元格之前, 保证验证码位于行末、且在三个点前面
    var menuBtn = row.querySelector("button.bwi-ellipsis-v, .bwi-ellipsis-v");
    var menuCell = menuBtn ? menuBtn.closest("td") : null;
    if (menuCell) {
      row.insertBefore(td, menuCell);
    } else if (row.cells && row.cells.length) {
      row.insertBefore(td, row.cells[row.cells.length - 1]);
    } else {
      row.appendChild(td);
    }
  }

  async function refreshCodes() {
    var spans = document.querySelectorAll(".warden-totp-code");
    for (var i = 0; i < spans.length; i++) {
      var sp = spans[i];
      try {
        var code = await totp(sp.dataset.secret, parseInt(sp.dataset.digits, 10), parseInt(sp.dataset.period, 10));
        sp.dataset.code = code;
        if (!sp.firstChild || !sp.firstChild.nodeValue || sp.firstChild.nodeValue.indexOf(code) === -1) {
          sp.textContent = code;
        }
      } catch (e) {
        /* 忽略单行错误 */
      }
    }
  }

  var ciphersCache = [];
  async function scan() {
    var rows = document.querySelectorAll("tr[appvaultcipherrow]");
    if (!rows.length) return;
    if (!ciphersCache.length) ciphersCache = await loadCiphers();
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.querySelector(".warden-totp-code")) continue;
      var c = findCipher(ciphersCache, row);
      if (c) insertTotp(row, c);
    }
    await refreshCodes();
  }

  function init() {
    ensureStyle();
    scan();
    setInterval(refreshCodes, 1000);
    setInterval(scan, 2500);
    var observer = new MutationObserver(function () {
      clearTimeout(window.__wardenScanT);
      window.__wardenScanT = setTimeout(scan, 400);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    console.log("[warden-totp] injected");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* 自测(RFC 6238 向量): secret=12345678901234567890, T=59 -> 287082 */
  if (location.search.indexOf("warden_selftest") !== -1) {
    (async function () {
      var code = await totp("12345678901234567890", 8, 30);
      // 以 1970-01-01T00:00:59Z 为基准需用 counter=1, 这里仅验证算法不抛错
      console.log("[warden-totp] selftest code(len8)=", code);
    })();
  }
})();
