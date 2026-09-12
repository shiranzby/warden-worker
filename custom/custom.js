/*
 * warden-worker / shypwd.cc.cd — 自定义前端增强 (v6)
 *
 * 功能:
 *   1) 保险库列表每行末尾、三点菜单之前常显 TOTP 动态码
 *   2) 徽章 = 一个完整的圆角矩形: 码在矩形正中, 下沿 3px 倒计时进度线,
 *      下边"中间挖空"一段放剩余秒数, <5s 整体转红
 *   3) "名称"表头行兼作工具行: 右对齐放「选择」与「新增」(并排同尺寸胶囊)
 *   4) 选择模式(放出复选框列, 应用自带的"全选"同时生效)
 *      + 底部批量操作条(全选 / 已选N项 / 移入回收站 / 取消)
 *   5) 窄屏筛选抽屉: 11 个筛选 chip 不再横着塞满一行, 改为按钮展开竖排面板
 *   6) 独立的"验证码"页(复刻 Bitwarden Authenticator 卡片式列表)
 *   7) 窄屏底部标签栏(密码库/验证码/发送/工具/报告/设置)
 *   8) 窄屏留白压缩(custom.css 段 H) + 对话框压缩(段 K)
 *   9) 窄屏隐藏页头(h1 + 视图切换 + 头像), 账户动作挪到设置页
 *  10) 窄屏补回应用侧栏的"二级"层: 设置页 chips(我的账户/安全/外观/域名规则/
 *      紧急访问) 与工具页 chips(生成器/导入/导出)
 *  11) 行内三点菜单补一项「添加到文件夹」(走 REST, 见 7.4)
 *
 * v6 关键修正:
 *   - 拆掉 custom.css 里 `bit-layout > .tw-grid { ... 0 !important }` 那三列锁死。
 *     它把应用承载 bit-dialog 的"浮层列"压成 0, Send 的新增对话框变成
 *     width:0 / left:视口宽 -> 整个跑到屏幕外, 表现为"点新增没反应"。
 *     改由 relaxGrid() 运行时只替换 minmax(384px,→minmax(0,。
 *   - 徽章重做成"完整圆角矩形 + 下边中间挖空", 去掉 v5 那条 16px 高的底栏。
 *   - 表头右侧「选项」三点默认隐藏(它只有 作用于选中项的 两项), 选择模式才露。
 *
 * 线上实测结论(勿轻易改动):
 *   - 该版本 Web Vault 的加解密跑在 Rust/WASM 核心里, 不走 crypto.subtle,
 *     无法通过 hook SubtleCrypto 拿明文; 生产构建下 __ngContext__ 是数字,
 *     window.ng 不存在, 也拿不到组件实例。
 *   - DI 容器 window.bitwardenContainerService 只挂了三个方法:
 *       attachToGlobal / getKeyService / getEncryptService
 *     没有 getCipherService / getFolderService, 所以"改条目"只能走 REST。
 *   - 行结构 <tr appvaultcipherrow> 共 5 个 td:
 *       [0]复选框 [1]站标图标 [2]名称+用户名 [3]组织徽标 [4]操作菜单
 *     名称 = cell[2] 里 button[bitlink].innerText。
 *   - 表格是 table-fixed, 列宽只由 <thead> 决定, 表头 4 个 th 覆盖 5 列
 *     (th.tw-w-24 带 colspan=2 覆盖 复选框+图标)。所以:
 *       不可新增 <td>(会凭空多出第 6 列, 名称列被挤到 48px);
 *       不可给表头/单元格 display:none(会打乱列映射)。
 *     徽章放进已有的菜单单元格, 列宽收缩靠改 th 的宽度。
 *   - ⚠️ 给 <td> 写 display:flex 是错的: td 会退化成匿名单元格, 高度只按内容
 *     算(实测 46px vs 行高 79px), "相对整行居中"永远做不到。用原生
 *     table-cell + vertical-align:middle 才对。
 *   - ⚠️ MutationObserver(孩子的变化) + 400ms debounce -> boot()。任何
 *     "无条件写 textContent" 都会无限空转, 必须判变化再写。
 */

(function () {
  "use strict";

  var STEP = 30;
  var LOG = "[shypwd]";

  /* =====================================================================
   * 1. 提前劫持 fetch / XHR —— 必须在 Angular 发起请求之前装好
   *    同时抓两样东西: /api/sync 的响应体 + Authorization 请求头
   * ===================================================================== */

  var SYNC = null;         // 最近一次 /api/sync 的原始 JSON
  var AUTH = null;         // 应用自身的 Authorization 头, 复用于批量删除
  var syncWaiters = [];

  function isSyncUrl(u) {
    return typeof u === "string" && u.indexOf("/api/sync") !== -1;
  }

  function feedSync(json) {
    if (!json || !json.ciphers) return;
    SYNC = json;
    var w = syncWaiters;
    syncWaiters = [];
    for (var i = 0; i < w.length; i++) {
      try { w[i](json); } catch (e) { /* ignore */ }
    }
  }

  function onFirstSync(cb) {
    if (SYNC) { cb(SYNC); return; }
    syncWaiters.push(cb);
  }

  function pickAuth(headers) {
    if (!headers) return;
    try {
      if (typeof headers.get === "function") {
        var v = headers.get("Authorization");
        if (v) AUTH = v;
        return;
      }
      if (Array.isArray(headers)) {
        for (var i = 0; i < headers.length; i++) {
          if (String(headers[i][0]).toLowerCase() === "authorization") AUTH = headers[i][1];
        }
        return;
      }
      for (var k in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, k) &&
            String(k).toLowerCase() === "authorization") {
          AUTH = headers[k];
        }
      }
    } catch (e) { /* ignore */ }
  }

  if (typeof window.fetch === "function") {
    var _fetch = window.fetch;
    window.fetch = function (input, init) {
      var url = "";
      try {
        url = typeof input === "string" ? input : (input && input.url) || "";
      } catch (e) { /* ignore */ }

      try {
        pickAuth(init && init.headers);
        if (!AUTH) {
          var h = (input && typeof input === "object" && input.headers) || null;
          if (h) pickAuth(h);
        }
      } catch (e) { /* ignore */ }

      var p = _fetch.apply(this, arguments);
      if (isSyncUrl(url)) {
        try {
          p.then(function (resp) {
            if (!resp || !resp.ok) return;
            resp.clone().json().then(feedSync).catch(function () {});
          }).catch(function () {});
        } catch (e) { /* ignore */ }
      }
      return p;
    };
  }

  if (window.XMLHttpRequest && XMLHttpRequest.prototype) {
    var _open = XMLHttpRequest.prototype.open;
    var _send = XMLHttpRequest.prototype.send;
    var _setHdr = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function (method, url) {
      try { this.__wardenUrl = url; } catch (e) { /* ignore */ }
      return _open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      try {
        if (String(name).toLowerCase() === "authorization") AUTH = value;
      } catch (e) { /* ignore */ }
      return _setHdr.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var self = this;
      if (isSyncUrl(self.__wardenUrl)) {
        self.addEventListener("load", function () {
          try { feedSync(JSON.parse(self.responseText)); } catch (e) { /* ignore */ }
        });
      }
      return _send.apply(this, arguments);
    };
  }

  /* =====================================================================
   * 2. Base32 / HOTP / TOTP  (RFC 4648 / 4226 / 6238)
   * ===================================================================== */

  var B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  var keyCache = {};

  function base32Decode(input) {
    var clean = String(input).replace(/=+$/g, "").toUpperCase().replace(/[\s-]/g, "");
    var bits = 0, value = 0, out = [];
    for (var i = 0; i < clean.length; i++) {
      var idx = B32.indexOf(clean.charAt(i));
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

  function importKey(secret, alg) {
    var ck = secret + "|" + alg;
    if (!keyCache[ck]) {
      var raw = base32Decode(secret);
      if (!raw.length) return null;
      keyCache[ck] = crypto.subtle.importKey(
        "raw", raw, { name: "HMAC", hash: alg }, false, ["sign"]
      );
    }
    return keyCache[ck];
  }

  async function totpAt(secret, digits, period, alg, atSeconds) {
    var key = importKey(secret, alg || "SHA-1");
    if (!key) return "";
    var secs = typeof atSeconds === "number" ? atSeconds : Math.floor(Date.now() / 1000);
    var counter = Math.floor(secs / period);

    var buf = new ArrayBuffer(8);
    var dv = new DataView(buf);
    dv.setUint32(0, Math.floor(counter / 4294967296));
    dv.setUint32(4, counter >>> 0);

    var sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key, buf));
    var off = sig[sig.length - 1] & 0x0f;
    var binary =
      ((sig[off] & 0x7f) << 24) |
      ((sig[off + 1] & 0xff) << 16) |
      ((sig[off + 2] & 0xff) << 8) |
      (sig[off + 3] & 0xff);

    var s = String(binary % Math.pow(10, digits));
    while (s.length < digits) s = "0" + s;
    return s;
  }

  /* "068822" -> "068 822"; 8 位 -> "0688 2299" */
  function groupCode(code) {
    if (!code) return "------";
    if (code.length === 6) return code.slice(0, 3) + " " + code.slice(3);
    if (code.length === 8) return code.slice(0, 4) + " " + code.slice(4);
    return code;
  }

  /* 解析 totp 字段: otpauth:// URI 或裸 base32 */
  function parseTotp(raw) {
    if (!raw) return null;
    raw = String(raw).trim();
    if (!raw) return null;

    if (raw.toLowerCase().indexOf("otpauth://") === 0) {
      try {
        var u = new URL(raw.replace(/^otpauth:\/\//i, "https://"));
        var secret = u.searchParams.get("secret");
        if (!secret) return null;
        var alg = (u.searchParams.get("algorithm") || "SHA1").toUpperCase();
        if (alg === "SHA1") alg = "SHA-1";
        else if (alg === "SHA256") alg = "SHA-256";
        else if (alg === "SHA512") alg = "SHA-512";
        else alg = "SHA-1";
        var d = parseInt(u.searchParams.get("digits") || "6", 10);
        var p = parseInt(u.searchParams.get("period") || "30", 10);
        return {
          secret: secret,
          digits: (isNaN(d) || d < 4 || d > 10) ? 6 : d,
          period: (isNaN(p) || p < 1) ? STEP : p,
          algorithm: alg
        };
      } catch (e) {
        return null;
      }
    }
    var bare = raw.replace(/[\s-]+/g, "");
    if (!/^[A-Za-z2-7=]+$/.test(bare)) return null;
    return { secret: bare, digits: 6, period: STEP, algorithm: "SHA-1" };
  }

  /* =====================================================================
   * 3. 通过官方 DI 容器解密 /api/sync 中的密文
   * ===================================================================== */

  function container() {
    return window.bitwardenContainerService || null;
  }

  /* decryptString 只读 encryptedString + encryptionType, 故构造 shim */
  function encObj(s) {
    var t = parseInt(String(s).split(".")[0], 10);
    return { encryptedString: s, encryptionType: isNaN(t) ? 2 : t };
  }

  async function dec(es, key, s) {
    if (typeof s !== "string" || !s) return "";
    try {
      return (await es.decryptString(encObj(s), key)) || "";
    } catch (e) {
      return "";
    }
  }

  function norm(s) {
    return String(s == null ? "" : s).trim().toLowerCase();
  }

  /* =====================================================================
   * 4. 建立 TOTP 索引
   * ===================================================================== */

  var index = [];            // [{id,label,username,name,secret,digits,period,algorithm}]
  var indexBuiltFor = null;
  var deletedIds = {};       // 本地已删除(移入回收站)的 id, 防止 SYNC 未刷新时又出现

  async function buildIndex(sync) {
    var cs = container();
    if (!cs) return false;

    var ks, es, userKey;
    try {
      ks = cs.getKeyService();
      es = cs.getEncryptService();
      userKey = await ks.getUserKey();
    } catch (e) {
      console.warn(LOG, "取 KeyService/EncryptService 失败", e);
      return false;
    }
    if (!userKey) return false;

    var list = (sync && sync.ciphers) || [];
    var out = [];
    var skippedOrg = 0;

    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || !c.id || c.deletedDate) continue;
      if (deletedIds[c.id]) continue;

      var login = c.login;
      if (!login || !login.totp) continue;

      /* 组织条目用独立 cipher key 加密, 需额外一轮密钥派生, 这里跳过并计数 */
      if (c.key) { skippedOrg++; continue; }

      var rawTotp = await dec(es, userKey, login.totp);
      var p = parseTotp(rawTotp);
      if (!p) continue;

      var label = await dec(es, userKey, c.name);
      var user = login.username ? await dec(es, userKey, login.username) : "";

      out.push({
        id: c.id,
        label: label || "(未命名)",
        username: user || "",
        name: norm(label),
        secret: p.secret,
        digits: p.digits,
        period: p.period,
        algorithm: p.algorithm
      });
    }

    index = out;
    console.log(LOG, "索引完成, 带验证码的条目:", out.length,
      skippedOrg ? "(跳过组织条目 " + skippedOrg + " 个)" : "");
    return true;
  }

  /* =====================================================================
   * 5. 行匹配
   * ===================================================================== */

  function rowName(row) {
    var btn = row.querySelector("button[bitlink], a[bitlink]");
    if (btn) return norm(btn.innerText || btn.textContent);
    var td = row.cells && row.cells[2];
    if (td) return norm(String(td.innerText || "").split("\n")[0]);
    return "";
  }

  function findCipher(row) {
    var name = rowName(row);
    if (!name) return null;
    var fallback = null;
    var td = row.cells && row.cells[2];
    var txt = td ? norm(td.innerText) : "";
    for (var i = 0; i < index.length; i++) {
      if (index[i].name !== name) continue;
      if (!fallback) fallback = index[i];
      if (index[i].username && txt.indexOf(norm(index[i].username)) !== -1) return index[i];
    }
    return fallback;
  }

  /* 操作菜单所在的单元格(通常最后一个 td) */
  function menuCell(row) {
    var cells = row.cells || [];
    for (var i = cells.length - 1; i >= 0; i--) {
      var c = cells[i];
      if (
        c.querySelector("bit-menu") ||
        c.querySelector("button[biticonbutton*='ellipsis']") ||
        c.querySelector(".bwi-ellipsis-v")
      ) {
        return c;
      }
    }
    return null;
  }

  /* =====================================================================
   * 6. TOTP 徽章: 下边缘 = 剩余时间进度条, 中间截断处显示秒数
   * ===================================================================== */

  function ensureStyle() {
    if (document.getElementById("warden-totp-style")) return;
    var s = document.createElement("style");
    s.id = "warden-totp-style";
    s.textContent =
      /* 结构(照用户给的设计图):
           ┌────────────┐    .warden-totp-chip  淡蓝色圆角矩形 —— 完整, **不裁剪**
           │  524 453   │    .warden-totp-body  码, 铺满整个盒体 -> 落在矩形正中
           └─────  ────┘    .warden-totp-clip  只把"下面那条线"的中间挖掉 20px,
              └ 27 ┘           于是那条线被裁成左右两条(1px 边框 + 3px 进度条)
                             .warden-totp-sec   秒数, 骑在"下面的边"上(水平+垂直居中)
         为什么要把"裁剪"单独做一层: 只有那条**线**要被挖断, 底色不能挖 ——
         秒数的上半截落在淡蓝色盒体里、下半截落到页面上, 跟设计图一致。 */
      ".warden-totp-code{position:relative;display:inline-block;vertical-align:middle;" +
      "margin-right:8px;box-sizing:border-box;" +
      "min-width:84px;height:46px;border-radius:9px;background:transparent;" +
      "cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent}" +
      /* 淡蓝底: 一个完整的圆角矩形 */
      ".warden-totp-chip{position:absolute;inset:0;border-radius:9px;background:#eef3ff}" +
      ".warden-totp-code:hover .warden-totp-chip{background:#e3ecff}" +
      /* 裁剪层: 底部中间挖掉 20px 宽 / 4px 深的一块(正好盖住 1px 边框 + 3px 进度条)。
         ⚠️ 宽度要和 JS 里 GAP 常量保持一致, 否则线断的位置和时长换算对不上。
         ⚠️ border-radius:inherit + overflow:hidden 是**必需**的: clip-path 只按多边形裁,
            不认圆角; 少了它, 进度条左右两端会直愣愣戳到圆角外面去(用户原话"突出来很突兀")。 */
      ".warden-totp-clip{position:absolute;inset:0;border-radius:inherit;overflow:hidden;" +
      "clip-path:polygon(0 0,100% 0,100% 100%," +
      "calc(50% + 10px) 100%," +
      "calc(50% + 10px) calc(100% - 4px)," +
      "calc(50% - 10px) calc(100% - 4px)," +
      "calc(50% - 10px) 100%," +
      "0 100%)}" +
      /* 1px 边框。用 inset box-shadow 而不是 border: 不占盒模型尺寸,
         这样它和进度条严格叠在同一条基线上, 一起被上面那把剪刀裁。 */
      ".warden-totp-ring{position:absolute;inset:0;border-radius:9px;box-shadow:inset 0 0 0 1px #b9cdf3}" +
      ".warden-totp-body{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}" +
      ".warden-totp-digits{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;" +
      "font-size:13px;font-weight:700;letter-spacing:.05em;color:#175ddc;line-height:1;white-space:nowrap}" +
      /* 进度条: 沿下沿 3px。宽度由 JS 按"缺口不计入时长"换算成 px 写进来, 不用百分比 */
      ".warden-totp-fill{position:absolute;left:0;bottom:0;height:3px;width:0;" +
      "background:#175ddc;transition:width .9s linear}" +
      /* 秒数: 骑在"下面的边"上 —— 垂直中心正好落在下沿, 所以 bottom 是负值 */
      ".warden-totp-sec{position:absolute;left:50%;transform:translateX(-50%);bottom:-7px;" +
      "width:20px;height:13px;display:flex;align-items:center;justify-content:center;" +
      "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;" +
      "font-size:10px;font-weight:700;line-height:1;color:#175ddc}" +
      ".warden-totp-low .warden-totp-chip{background:#fdecec}" +
      ".warden-totp-low .warden-totp-ring{box-shadow:inset 0 0 0 1px #f0b4b4}" +
      ".warden-totp-low .warden-totp-digits{color:#c62828}" +
      ".warden-totp-low .warden-totp-fill{background:#e24b4a}" +
      ".warden-totp-low .warden-totp-sec{color:#c62828}" +
      ".warden-totp-copied .warden-totp-chip{background:#dff3e6!important}" +
      ".warden-totp-copied .warden-totp-ring{box-shadow:inset 0 0 0 1px #9fd8b6!important}" +
      ".warden-totp-copied .warden-totp-digits{color:#1b7a44!important}";
    document.head.appendChild(s);
  }

  /* 外层(透明) -> 淡蓝底(chip) + [clip 裁剪层: 1px 边框(ring) + 进度条(fill)]
     + 码区(body) + 骑在下边线上的秒数(sec) */
  function paintBadgeStructure(el) {
    if (el.__built) return;
    el.__built = true;
    el.textContent = "";

    /* 淡蓝底不参与裁剪, 单独一层 */
    var chip = document.createElement("span");
    chip.className = "warden-totp-chip";

    /* ring 与 fill 必须同住一个裁剪层, 这样"边框断开"和"进度条断开"是同一刀切出来的 */
    var clip = document.createElement("span");
    clip.className = "warden-totp-clip";
    var ring = document.createElement("span");
    ring.className = "warden-totp-ring";
    var fill = document.createElement("i");
    fill.className = "warden-totp-fill";
    clip.appendChild(ring);
    clip.appendChild(fill);

    var body = document.createElement("span");
    body.className = "warden-totp-body";
    var digits = document.createElement("span");
    digits.className = "warden-totp-digits";
    digits.textContent = "--- ---";
    body.appendChild(digits);

    var sec = document.createElement("span");
    sec.className = "warden-totp-sec";
    sec.textContent = "--";

    el.appendChild(chip);
    el.appendChild(clip);
    el.appendChild(body);
    el.appendChild(sec);

    el.__digits = digits;
    el.__fill = fill;
    el.__sec = sec;
  }

  /* 换码(仅在跨越 30s 步长时调用, 避免每秒做一次 HMAC) */
  async function refreshCode(el) {
    var period = parseFloat(el.dataset.period) || STEP;
    var step = Math.floor(Date.now() / 1000 / period);
    if (el.__step === step && el.__code) return;

    var code = await totpAt(
      el.dataset.secret,
      parseInt(el.dataset.digits, 10) || 6,
      period,
      el.dataset.algorithm || "SHA-1"
    );
    if (!code) return;
    el.__step = step;
    el.__code = code;
    el.dataset.code = code;
    if (el.__digits) el.__digits.textContent = groupCode(code);
  }

  /* 缺口宽度(px)。必须与 ensureStyle 里 clip-path 的 "50% ± 10px" 保持一致。 */
  var GAP = 20;

  /* 时间条/秒数: 每秒更新, 不做加密运算。
     ⚠️ 缺口那一段**不计入时长** —— 所以宽度不能用百分比, 要按"有效长度"换算成 px:
        被裁开的两条线共同覆盖整个周期, 于是每条线正好代表 period/2 秒(默认 15 秒)。
        进度条从左往右推进, 越过缺口时要把缺口宽度补回来(缺口本身被 clip-path 裁掉, 看不见)。 */
  function paintTimer(el) {
    var period = parseFloat(el.dataset.period) || STEP;
    var now = Math.floor(Date.now() / 1000);
    var remain = period - (now % period);

    if (el.__sec) el.__sec.textContent = String(remain);

    if (el.__fill) {
      /* 盒体宽度只量一次并缓存 —— 每秒对全部徽章读 offsetWidth 会强制同步布局 */
      var W = el.__w;
      if (!W) {
        W = el.offsetWidth;
        if (W) el.__w = W;
        else W = 84;            // 还没上屏, 本轮先用默认值, 下秒再量
      }
      var track = W - GAP;                          // 两条线的总长(缺口不占时长)
      var lit = (remain / period) * track;          // 剩余时间映射到多长
      var w = lit <= track / 2 ? lit : lit + GAP;   // 越过缺口就把缺口宽度补回来
      el.__fill.style.width = w.toFixed(1) + "px";
    }

    el.classList.toggle("warden-totp-low", remain <= 5);
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error("execCommand failed"));
      } catch (e) {
        reject(e);
      }
    });
  }

  function flashCopied(el) {
    var prev = { digits: el.__digits ? el.__digits.textContent : "" };
    el.classList.add("warden-totp-copied");
    if (el.__digits) el.__digits.textContent = "已复制";
    setTimeout(function () {
      el.classList.remove("warden-totp-copied");
      if (el.__digits) el.__digits.textContent = prev.digits || groupCode(el.dataset.code);
    }, 700);
  }

  function bindCopy(el, getCode) {
    function doCopy(ev) {
      ev.stopPropagation();
      ev.preventDefault();
      var code = getCode();
      if (!code) return;
      copyText(code).then(function () {
        flashCopied(el);
      }).catch(function () {
        try {
          var r = document.createRange();
          r.selectNodeContents(el);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        } catch (e) { /* ignore */ }
      });
    }
    el.addEventListener("click", doCopy);
    el.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") doCopy(ev);
    });
  }

  function makeBadge(c) {
    var el = document.createElement("span");
    el.className = "warden-totp-code";
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("title", "点击复制验证码");
    el.dataset.secret = c.secret;
    el.dataset.digits = c.digits || 6;
    el.dataset.period = c.period || STEP;
    el.dataset.algorithm = c.algorithm || "SHA-1";
    paintBadgeStructure(el);
    bindCopy(el, function () { return el.dataset.code || ""; });
    refreshCode(el);
    paintTimer(el);
    return el;
  }

  function insertTotp(row, c) {
    if (row.querySelector(".warden-totp-code")) return;
    var menu = menuCell(row);
    if (!menu) return;

    menu.classList.add("warden-totp-host");
    menu.insertBefore(makeBadge(c), menu.firstChild);
  }

  /* =====================================================================
   * 7. 表头工具行 —— 把「选择」与「新增」并入"名称"那一行
   *    应用自带每行复选框(aria-label="选择密码库项目")与表头全选(aria-label="全选"),
   *    平时用 CSS 把这两列塌缩为 0, 进入选择模式再放出来。
   *
   *    ⚠️ 窄屏的「新增」不能复制一份: 它弹出的 cdk-overlay-pane.bit-menu-panel
   *       是锚定"触发按钮"的浮层, 复制出来的按钮点开, 菜单仍弹在按钮旁边的原位置。
   *       做法是把原按钮整个 appendChild 进表头槽位 —— 浮层打开时读的是触发按钮
   *       当时的 rect, 节点搬到哪它就跟到哪。
   *
   *    ⚠️ v4 用的是 position:absolute + translate 平移到槽位, 已废弃。那个方案
   *       只在 syncChrome()/2s 轮询时重算坐标, 而展开筛选抽屉会把表格整体推下
   *       398px —— 实测按钮会悬在表头上方 398px, 且要等下一次轮询才纠正。
   *       appendChild 没有坐标可错, 布局怎么变都跟着走。
   * ===================================================================== */

  var NARROW_PX = 768;
  var selecting = false;

  function isNarrow() {
    return window.innerWidth <= NARROW_PX;
  }

  /* ---- 7.0 外层网格: 只放开中间列的最小宽度 ----------------------------
   *   应用给 bit-layout 的 grid 打了行内 style, 中间列是 minmax(384px,1fr);
   *   那个 384px 的下限在窄屏会顶出横向滚动条, 需要放宽成 minmax(0,1fr)。
   *
   *   ⚠️ 这件事**绝对不能**用 CSS 做。第 3 列是 tw-col-start-3 的"浮层列",
   *      打开 Send 的 bit-dialog 时应用会临时把它撑开来承载 dialog。v5 线上
   *      写的是 grid-template-columns: 0 minmax(0,1fr) 0 !important —— 三列
   *      全被锁死, dialog 于是变成 width:0 / left:视口宽, 整个跑到屏幕右侧
   *      外面。用户看到的现象就是"发送页点新增、菜单关了、什么都没发生"。
   *   所以改成运行时只替换 384px 这一段, 第 1/3 列原样保留。
   * -------------------------------------------------------------------- */
  function relaxGrid() {
    if (!isNarrow()) return;
    var g = document.querySelector("bit-layout > .tw-grid");
    if (!g) return;
    var t = g.style.gridTemplateColumns;
    if (!t || t.indexOf("384px") === -1) return;
    g.style.gridTemplateColumns = t.replace(/minmax\(\s*384px\s*,/g, "minmax(0,");
  }

  /* 应用每次开/关浮层都会重写这条行内样式, 盯着它才能第一时间纠正。
     注意不会自喂: relaxGrid 只在还能看到 384px 时才写, 写完下一轮就直接返回。 */
  function watchGrid() {
    var g = document.querySelector("bit-layout > .tw-grid");
    if (!g || g.__wardenGridWatched) return;
    g.__wardenGridWatched = true;
    new MutationObserver(relaxGrid).observe(g, {
      attributes: true,
      attributeFilter: ["style"]
    });
  }

  function nameTh() {
    var tr = document.querySelector("table thead tr");
    if (!tr) return null;

    var cached = tr.querySelector("th.warden-name-th");
    if (cached) return cached;

    var ths = tr.children;
    for (var i = 0; i < ths.length; i++) {
      // ⚠️ 只比对这个 th 直属的文本节点。工具行塞进去以后 th.textContent 会变成
      //    "名称 选择", 用 textContent 比对第二轮就找不到这一列了, 会把已经
      //    搬过去的「新增」还原、顺手把筛选抽屉删掉。
      var own = "";
      for (var n = 0; n < ths[i].childNodes.length; n++) {
        if (ths[i].childNodes[n].nodeType === 3) own += ths[i].childNodes[n].nodeValue;
      }
      if (norm(own) === "名称") {
        ths[i].classList.add("warden-name-th");
        return ths[i];
      }
    }
    return null;
  }

  /* 「新增」按钮的原始落点; 宽屏 / 离开列表页时要还回去 */
  var newBtnHome = null;

  function dockNewBtn() {
    var menu = document.querySelector("vault-new-cipher-menu");
    if (!menu) { newBtnHome = null; return; }

    var bar = document.getElementById("warden-headbar");
    var slot = bar ? bar.querySelector(".warden-headslot") : null;

    if (!isNarrow() || !slot) {
      if (newBtnHome && newBtnHome.parent && newBtnHome.parent.isConnected &&
          newBtnHome.parent !== slot && menu.parentNode !== newBtnHome.parent) {
        if (newBtnHome.next && newBtnHome.next.parentNode === newBtnHome.parent) {
          newBtnHome.parent.insertBefore(menu, newBtnHome.next);
        } else {
          newBtnHome.parent.appendChild(menu);
        }
      }
      return;
    }

    // 第一次(或上一次记的落点已被 Angular 销毁)时记下落点
    var homeOk = newBtnHome && newBtnHome.parent && newBtnHome.parent.isConnected;
    if (!homeOk && menu.parentNode !== slot) {
      newBtnHome = { parent: menu.parentNode, next: menu.nextSibling };
    }

    if (menu.parentNode !== slot) slot.appendChild(menu);
  }

  function ensureHeadbar() {
    var th = nameTh();
    if (!th) return;

    var bar = th.querySelector("#warden-headbar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "warden-headbar";

      var slot = document.createElement("span");
      slot.className = "warden-headslot";
      bar.appendChild(slot);

      var seed = document.createElement("button");
      seed.type = "button";
      seed.className = "warden-selbar-toggle";
      seed.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M4 7l4.5 5L4 17"/><path d="M12 19h8"/></svg><span>选择</span>';
      seed.addEventListener("click", function (ev) {
        ev.stopPropagation();
        setSelecting(!selecting);
      });
      bar.appendChild(seed);

      th.appendChild(bar);
    }

    var sl = bar.querySelector(".warden-headslot");
    if (sl) sl.style.display = isNarrow() ? "" : "none";
    dockNewBtn();
  }

  /* ---- 7.1 窄屏筛选抽屉 ------------------------------------------------
   *     原本 11 个筛选 chip 横着塞满一行还被裁掉一半, 改成"一个按钮 + 展开面板"。
   *     只切显隐, 不动应用自己的筛选 DOM。
   * -------------------------------------------------------------------- */

  function ensureFilterToggle() {
    var root = document.querySelector("app-vault-filter");
    if (!root) return;

    if (!document.getElementById("warden-filterbar")) {
      var bar = document.createElement("div");
      bar.id = "warden-filterbar";
      bar.className = "warden-filterbar";

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "warden-filter-toggle";
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M4 6h16M7 12h10M10 18h4"/></svg>' +
        '<span class="warden-filter-label"></span>' +
        '<svg class="warden-filter-caret" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M7 10l5 5 5-5"/></svg>';
      btn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        document.body.classList.toggle("warden-filter-open");
      });
      bar.appendChild(btn);
      // 放在搜索框下面(与原来 chip 条的位置一致); 拿不到搜索框就退到容器最前面
      var panel = root.querySelector("div.tw-p-5") || root;
      var search = root.querySelector("bit-search");
      var anchor = search && search.closest ? search.closest("div") : null;
      if (anchor && anchor.parentNode === panel) {
        panel.insertBefore(bar, anchor.nextSibling);
      } else {
        panel.insertBefore(bar, panel.firstChild);
      }

      // 点中某个筛选后自动收起
      root.addEventListener("click", function (ev) {
        var t = ev.target;
        var hit = t && t.closest ? t.closest("li.filter-option, a.filter-button") : null;
        if (!hit) return;
        setTimeout(function () {
          document.body.classList.remove("warden-filter-open");
          updateFilterToggle();
        }, 120);
      });
    }
    updateFilterToggle();
  }

  function updateFilterToggle() {
    var label = document.querySelector("#warden-filterbar .warden-filter-label");
    if (!label) return;
    // 应用自身会把当前筛选名写进页面标题(该页头在窄屏被 display:none 藏了,
    // 但 textContent 照样读得到)
    var h = document.querySelector("app-vault-header h1");
    var txt = h ? (h.textContent || "").trim() : "";
    var next = txt || "所有项目";
    // ⚠️ 必须判变化再写。直接重复赋值会替换文本节点 -> MutationObserver 又触发
    //    boot() -> 再赋值, 400ms 一轮空转。
    if (label.textContent !== next) label.textContent = next;
  }

  function dropFilterToggle() {
    var bar = document.getElementById("warden-filterbar");
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    document.body.classList.remove("warden-filter-open");
  }

  /* ---- 7.2 窄屏「设置」页的账户卡片 ------------------------------------
   *     窄屏把右上角头像藏了, 它的几个动作挪到设置页顶部。
   *     锁定/注销没有公开路由, 只能借应用自己的 account-menu 触发: 先给浮层挂
   *     一个"隐身"类(opacity:0), 程序化点开 + 点中目标项, 用户看不到左上角闪一下。
   * -------------------------------------------------------------------- */

  function triggerAccountAction(label) {
    var btn = document.querySelector("app-account-menu button");
    if (!btn) return false;
    document.body.classList.add("warden-ghost-menu");
    btn.click();
    setTimeout(function () {
      var items = document.querySelectorAll(
        ".cdk-overlay-pane.bit-menu-panel button, .cdk-overlay-pane.bit-menu-panel a"
      );
      for (var i = 0; i < items.length; i++) {
        if (norm(items[i].innerText || items[i].textContent) === norm(label)) {
          items[i].click();
          break;
        }
      }
      setTimeout(function () {
        document.body.classList.remove("warden-ghost-menu");
      }, 400);
    }, 60);
    return true;
  }

  /* ---- 7.3 窄屏的"二级导航" ----------------------------------------------
   *   应用桌面版本质是三分栏: 侧栏一级(密码库/Send/工具/报告/设置) + 每个分区
   *   自己的二级导航。窄屏把侧栏整个 display:none 了, 一级由底部标签栏接管,
   *   但二级没有任何替代 —— 于是:
   *     · "设置"页只剩「我的账户」, 进不去 安全/外观/域名规则/紧急访问
   *       (用户说的"移动端找不到更改密码等等一系列设置")
   *     · "工具"页困在生成器里, 出不去 导入/导出
   *   这里给这两类页面各补一条横向滚动的 chip 导航, 点击只改 location.hash。
   *   安全页自己还有一层(会话超时/主密码/两步登录/设备/密钥), 应用在窄屏
   *   原生就保留了, 不用我们管。
   * -------------------------------------------------------------------- */

  var NAV_SETS = {
    settings: [
      { href: "#/settings/account", label: "我的账户" },
      { href: "#/settings/security", label: "安全" },
      { href: "#/settings/appearance", label: "外观" },
      { href: "#/settings/domain-rules", label: "域名规则" },
      { href: "#/settings/emergency-access", label: "紧急访问" }
    ],
    tools: [
      { href: "#/tools/generator", label: "生成器" },
      { href: "#/tools/import", label: "导入" },
      { href: "#/tools/export", label: "导出" }
    ]
  };

  function navSetFor(route) {
    if (route.indexOf("/settings") === 0) return NAV_SETS.settings;
    if (route.indexOf("/tools") === 0) return NAV_SETS.tools;
    return null;
  }

  /* ---- 7.4 行内三点菜单补上「添加到文件夹」 -------------------------------
   *   表头那三点的菜单里只有「添加到文件夹 / 删除」, 都作用于"已选中条目";
   *   而行内三点(复制用户名/复制密码/…/删除)里偏偏没有这个最常用的。
   *
   *   ⚠️ window.bitwardenContainerService 只暴露 getKeyService 与
   *      getEncryptService, 拿不到 cipherService, 所以走不了应用自己的保存链路。
   *      改走 REST: GET /api/ciphers/{id} 取回原样 -> 只改 folderId -> PUT 回去。
   *      folderId 在 Bitwarden 数据模型里是**明文字段**, 不需要重新加密, 其余字段
   *      原封不动带回去, 所以这次 round-trip 不会动到任何密文。
   *
   *   名称 -> id 的映射要解密全部条目名, 有点贵, 所以按需构建、随 SYNC 失效。
   * -------------------------------------------------------------------- */

  var nameMap = null;        // { 规范化名称: [{id, username}, ...] }
  var nameMapBuiltFor = null;
  var folderList = null;     // [{id, name}]
  var lastMenuRow = null;    // 行内三点被点的行(菜单浮层在 DOM 上认不出来源)

  async function buildNameMap() {
    var cs = container();
    if (!cs || !SYNC) return false;
    var ks, es, userKey;
    try {
      ks = cs.getKeyService();
      es = cs.getEncryptService();
      userKey = await ks.getUserKey();
    } catch (e) { return false; }
    if (!userKey) return false;

    var list = SYNC.ciphers || [];
    var buckets = {};
    var order = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || !c.id || c.deletedDate || deletedIds[c.id]) continue;
      if (c.key) continue;               // 组织条目用独立 cipher key, 跳过
      var nm = await dec(es, userKey, c.name);
      var k = norm(nm);
      if (!k) continue;
      if (!buckets[k]) { buckets[k] = []; order.push(k); }
      buckets[k].push({ id: c.id, user: c.login && c.login.username ? c.login.username : "" });
    }

    /* 重名的才需要再解密一次用户名来消歧义 —— 没必要为全部条目付这个成本 */
    var map = {};
    for (var j = 0; j < order.length; j++) {
      var key = order[j];
      var arr = buckets[key];
      if (arr.length > 1) {
        for (var m = 0; m < arr.length; m++) {
          arr[m].username = arr[m].user ? await dec(es, userKey, arr[m].user) : "";
        }
      }
      map[key] = arr;
    }

    var fs = SYNC.folders || [];
    var fl = [];
    for (var n = 0; n < fs.length; n++) {
      var f = fs[n];
      if (!f || !f.id) continue;
      var fn = await dec(es, userKey, f.name);
      fl.push({ id: f.id, name: fn || "(未命名)" });
    }

    nameMap = map;
    folderList = fl;
    nameMapBuiltFor = SYNC;
    return true;
  }

  function pickIdForRow(row) {
    var name = rowName(row);
    var cand = nameMap && nameMap[name];
    if (!cand || !cand.length) return null;
    if (cand.length === 1) return cand[0].id;
    var td = row.cells && row.cells[2];
    var txt = td ? norm(td.innerText) : "";
    for (var i = 0; i < cand.length; i++) {
      if (cand[i].username && txt.indexOf(norm(cand[i].username)) !== -1) return cand[i].id;
    }
    return cand[0].id;
  }

  async function applyFolder(cipherId, folderId) {
    closeFolderPicker();
    if (!AUTH) { toast("未取得会话令牌，请刷新页面后重试"); return; }
    try {
      var g = await fetch("/api/ciphers/" + cipherId, { headers: { Authorization: AUTH } });
      if (!g.ok) throw new Error("HTTP " + g.status);
      var c = await g.json();
      c.folderId = folderId || null;
      var p = await fetch("/api/ciphers/" + cipherId, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: AUTH },
        body: JSON.stringify(c)
      });
      if (!p.ok) throw new Error("HTTP " + p.status);
      toast(folderId ? "已添加到文件夹" : "已移出文件夹");
    } catch (e) {
      toast("操作失败：" + (e && e.message ? e.message : e));
    }
  }

  function closeFolderPicker() {
    var p = document.getElementById("warden-folderpick");
    if (p && p.parentNode) p.parentNode.removeChild(p);
  }

  async function openFolderPicker(row) {
    if (!row) { toast("没有识别到要处理的条目"); return; }
    if (!nameMap || nameMapBuiltFor !== SYNC) {
      toast("正在读取文件夹…");
      var ok = await buildNameMap();
      if (!ok) { toast("无法读取文件夹列表"); return; }
    }
    var id = pickIdForRow(row);
    if (!id) { toast("无法确定该条目的 ID，请改用「选择」后批量添加"); return; }
    renderFolderPicker(id);
  }

  function renderFolderPicker(cipherId) {
    closeFolderPicker();
    var wrap = document.createElement("div");
    wrap.id = "warden-folderpick";
    wrap.className = "warden-folderpick";

    var mask = document.createElement("div");
    mask.className = "warden-foldermask";
    mask.addEventListener("click", closeFolderPicker);

    var sheet = document.createElement("div");
    sheet.className = "warden-foldersheet";

    var title = document.createElement("div");
    title.className = "warden-foldertitle";
    title.textContent = "添加到文件夹";
    sheet.appendChild(title);

    var list = document.createElement("div");
    list.className = "warden-folderlist";

    var opts = [{ id: "", name: "（不放入文件夹）" }].concat(folderList || []);
    for (var i = 0; i < opts.length; i++) {
      (function (o) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = o.name;                    // 用户数据 -> textContent
        if (!o.id) b.className = "warden-folder-none";
        b.addEventListener("click", function () { applyFolder(cipherId, o.id); });
        list.appendChild(b);
      })(opts[i]);
    }
    if ((folderList || []).length === 0) {
      var tip = document.createElement("div");
      tip.className = "warden-folder-tip";
      tip.textContent = "还没有文件夹，可先在密码库页新建。";
      list.appendChild(tip);
    }
    sheet.appendChild(list);

    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "warden-foldercancel";
    cancel.textContent = "取消";
    cancel.addEventListener("click", closeFolderPicker);
    sheet.appendChild(cancel);

    wrap.appendChild(mask);
    wrap.appendChild(sheet);
    document.body.appendChild(wrap);
  }

  /* 行内菜单条目多、带「克隆」; 表头菜单只有两项。用它区分。 */
  function isRowMenu(panel) {
    var t = panel.innerText || "";
    return t.indexOf("克隆") !== -1 || t.indexOf("归档") !== -1;
  }

  /* 文案: 这个动作改的是 Bitwarden 的"文件夹"(cipher.folderId), 不是标签体系,
     所以用 bwi-folder + 「文件夹」。三个字与相邻的 收藏/编辑/附件/克隆/归档/删除
     是同一个量级, 比原来的「添加到文件夹」短一截。想换词只改这两个常量即可。 */
  var FOLDER_ITEM_LABEL = "文件夹";
  var FOLDER_ITEM_ICON = "bwi-folder";

  function injectFolderItem(panel) {
    if (!panel || panel.querySelector(".warden-menu-fold")) return;
    var box = panel.querySelector('[role="menu"]') || panel;
    var btns = box.querySelectorAll('button[role="menuitem"], button');
    if (!btns.length) return;

    /* 位置(v8 改过): 「收藏」之下、「编辑」之上 —— 也就是插在「编辑」**前面**。
       class 抄「编辑」本身(它是普通项); ⚠️ 千万别抄「删除」—— 删除带
       tw-text-fg-danger / hover:tw-bg-bg-danger-soft, 抄了我们这项会变成红色危险项。 */
    var anchor = null;
    for (var i = 0; i < btns.length; i++) {
      if ((btns[i].innerText || "").trim().indexOf("编辑") === 0) { anchor = btns[i]; break; }
    }
    var styleSrc = anchor || btns[0];

    var item = document.createElement("button");
    item.type = "button";
    item.className = styleSrc.className + " warden-menu-fold";
    item.setAttribute("role", "menuitem");
    /* 与应用自带菜单项**逐层同构**(button > div.tw-flex > span.tw-flex > span.tw-truncate > i + 文本),
       于是字号/行高/图标列宽/hover 底色全部自动继承, 不用我们补任何样式。 */
    item.innerHTML =
      '<div class="tw-flex tw-w-full tw-justify-between tw-items-center tw-gap-2">' +
        '<span class="tw-flex tw-gap-2 tw-items-center tw-overflow-hidden tw-text-sm tw-font-medium">' +
          '<span class="tw-truncate"><i aria-hidden="true" class="bwi bwi-fw ' + FOLDER_ITEM_ICON + '"></i> ' +
            FOLDER_ITEM_LABEL +
          '</span>' +
        '</span>' +
      '</div>';
    item.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      openFolderPicker(lastMenuRow);
    });

    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(item, anchor);
    else box.appendChild(item);
  }

  /* 菜单浮层是动态插进 body 的, 借已有的 MutationObserver 一起扫 */
  function scanMenus(muts) {
    if (!muts) return;
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (!n || n.nodeType !== 1) continue;
        var panel = (n.classList && n.classList.contains("bit-menu-panel"))
          ? n
          : (n.querySelector ? n.querySelector(".cdk-overlay-pane.bit-menu-panel") : null);
        if (!panel || !isRowMenu(panel)) continue;
        // 菜单项可能晚一帧才由 Angular 渲染出来, 隔一拍再补一次(注入是幂等的)
        injectFolderItem(panel);
        setTimeout(function (p) { return function () { injectFolderItem(p); }; }(panel), 130);
      }
    }
  }

  function ensureSubNav() {
    var el = document.getElementById("warden-subnav");
    var route = currentRoute();
    var items = isNarrow() ? navSetFor(route) : null;

    /* body 上的这个类 = "当前页有二级导航"。CSS 靠它把设置页那个大标题页头
       (标题行 + 产品切换宫格) 藏掉 —— 窄屏上它们毫无信息量, 只是把内容往下压。 */
    document.body.classList.toggle("warden-has-subnav", !!items);

    if (!items) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      return;
    }

    var host = document.querySelector("main#main-content");
    if (!host) return;

    var setKey = route.indexOf("/settings") === 0 ? "settings" : "tools";

    /* 设置(5 项)和工具(3 项)是两套完全不同的条目, 必须整套重建 ——
       v6 只在"首次创建"时填条目, 于是设置 -> 工具会看到残留的
       「我的账户 / 安全 / …」。 */
    if (el && el.getAttribute("data-set") !== setKey) {
      if (el.parentNode) el.parentNode.removeChild(el);
      el = null;
    }

    if (!el) {
      el = document.createElement("nav");
      el.id = "warden-subnav";
      el.className = "warden-subnav";
      el.setAttribute("data-set", setKey);
      el.addEventListener("click", function (ev) {
        var a = ev.target && ev.target.closest ? ev.target.closest("a[data-href]") : null;
        if (!a) return;
        ev.preventDefault();
        /* 乐观高亮: 手指一抬起就变色, 不等 Angular 把新页面渲染完。
           设置子页的渲染实测 130~210ms(4x 降速时), 真机约 1s; 高亮要是跟着一起等,
           用户就会觉得"点了没反应"。 */
        var ls = el.querySelectorAll("a[data-href]");
        for (var n = 0; n < ls.length; n++) {
          ls[n].classList.toggle("warden-subnav-on", ls[n] === a);
        }
        location.hash = a.getAttribute("data-href");
      });
      for (var i = 0; i < items.length; i++) {
        var a = document.createElement("a");
        a.setAttribute("data-href", items[i].href);
        a.textContent = items[i].label;
        el.appendChild(a);
      }
    }

    /* ⚠️ v8: 直接挂到 main#main-content 上, **不要**挂进路由组件里。
       实测给 main 打的属性标记跨路由会保留(M1 还在), 但给 chips 打的标记会丢 ——
       说明路由一换, Angular 就把 ng-component 整块重建, 挂在里面的 chips 随之
       被销毁, 再由 MutationObserver 400ms 后补回。用户看到的就是
       "我的账户/安全 这一行消失一下又加载出来"。
       挂到 main 上之后 chips 全程不动, 闪烁彻底消失。
       顺序: [chips][账户卡片][路由内容(含三级 tabs)] —— 卡片位置也在所有设置页恒定。 */
    var misplaced = (el.parentNode !== host) || (host.firstElementChild !== el);
    if (misplaced) host.insertBefore(el, host.firstChild);

    // 高亮当前项。判变化再写, 否则会喂给 MutationObserver 空转。
    var links = el.querySelectorAll("a[data-href]");
    for (var k = 0; k < links.length; k++) {
      var on = route.indexOf(links[k].getAttribute("data-href").replace(/^#/, "")) === 0;
      if (on !== links[k].classList.contains("warden-subnav-on")) {
        links[k].classList.toggle("warden-subnav-on", on);
      }
    }
  }

  /* =====================================================================
   * 7.5 头像: 点自己的头像直接换图(真实上传)
   *     ⚠️ 后端 PUT /api/accounts/avatar **只接受 avatar_color** 一个字段
   *        (src/handlers/accounts.rs 的 put_avatar 里就一句 avatar_color),
   *        而且 web vault 的 dynamic-avatar 组件根本不渲染图片, 只画首字母。
   *        所以"真上传"只能在客户端落地: 选图 -> 居中裁方 -> 128px -> data URL
   *        -> localStorage(按用户 id 分键)。
   *        代价: **只在本设备/本浏览器生效, 不跨端同步**。要跨端得改 Rust 后端。
   * ===================================================================== */

  var AV_PREFIX = "warden.avatar.v1.";

  function avatarKey() {
    var p = (SYNC && SYNC.profile) || {};
    return AV_PREFIX + (p.id || p.email || "default");
  }

  function applyStoredAvatar() {
    var url = null;
    try { url = localStorage.getItem(avatarKey()); } catch (e) { /* 隐私模式下会抛 */ }
    if (url) {
      document.body.style.setProperty("--warden-avatar", 'url("' + url + '")');
      document.body.classList.add("warden-avatar-on");
    } else {
      document.body.style.removeProperty("--warden-avatar");
      document.body.classList.remove("warden-avatar-on");
    }
  }

  /* 藏掉应用自带的「64px 大头像 + 自定义」那一行 —— 窄屏上它只是占地方,
     而且那个「自定义」弹窗只有一个 color input(只能改底色)。
     换成: 点我们账户卡片上的头像直接选图。 */
  function hideAppAvatarRow() {
    var host = document.querySelector("main#main-content");
    if (!host) return;
    var nodes = host.querySelectorAll("dynamic-avatar");
    for (var i = 0; i < nodes.length; i++) {
      var row = nodes[i].parentElement;
      /* 往上找到"同时装了头像和那个按钮"的那一层就停 ——
         再往上一层还带着账户指纹短语, 一起藏就过头了 */
      while (row && row !== host && !row.querySelector("button")) row = row.parentElement;
      if (!row || row === host) continue;
      if (row.getBoundingClientRect().height > 90) continue;   // 明显不是那一行
      row.classList.add("warden-app-avatar-row");
    }
  }

  function pickAvatarFile() {
    var inp = document.getElementById("warden-avatar-input");
    if (!inp) {
      inp = document.createElement("input");
      inp.type = "file";
      inp.id = "warden-avatar-input";
      inp.accept = "image/*";
      inp.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0";
      document.body.appendChild(inp);
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0];
        inp.value = "";
        if (!f) return;
        var fr = new FileReader();
        fr.onload = function () {
          var img = new Image();
          img.onload = function () {
            try {
              var S = 128;
              var cv = document.createElement("canvas");
              cv.width = S;
              cv.height = S;
              var g = cv.getContext("2d");
              /* 居中裁成正方形, 免得被拉扁 */
              var side = Math.min(img.width, img.height);
              var sx = (img.width - side) / 2;
              var sy = (img.height - side) / 2;
              g.drawImage(img, sx, sy, side, side, 0, 0, S, S);
              localStorage.setItem(avatarKey(), cv.toDataURL("image/jpeg", 0.85));
              applyStoredAvatar();
              toast("头像已更新(仅本机生效)");
            } catch (e) {
              toast("图片处理失败:" + (e && e.message ? e.message : e));
            }
          };
          img.onerror = function () { toast("无法读取该图片"); };
          img.src = fr.result;
        };
        fr.readAsDataURL(f);
      });
    }
    inp.click();
  }

  function ensureAccountCard() {
    var card = document.getElementById("warden-acctcard");
    var want = isNarrow() && currentRoute().indexOf("/settings") === 0;

    if (!want) {
      if (card && card.parentNode) card.parentNode.removeChild(card);
      return;
    }

    var host = document.querySelector("main#main-content");
    if (!host) return;

    if (!card) {
      card = document.createElement("div");
      card.id = "warden-acctcard";
      card.className = "warden-acctcard";
      // 身份行 + 两个动作挤在同一行, 省掉一整行的高度。
      // 「账户设置」不再重复放 —— 上面那条 chips 导航里的「我的账户」就是它。
      card.innerHTML =
        /* 名称 / 电子邮箱 就在头像右侧 —— 这是用户明确要的移动端排布 */
        '<span class="warden-acct-avatar" title="点击更换头像"></span>' +
        '<span class="warden-acct-text">' +
          '<b class="warden-acct-name"></b>' +
          '<span class="warden-acct-mail"></span>' +
        '</span>' +
        '<span class="warden-acct-acts">' +
          '<button type="button" data-act="lock">锁定</button>' +
          '<button type="button" data-act="logout" class="warden-acct-danger">注销</button>' +
        '</span>';
      card.addEventListener("click", function (ev) {
        var t = ev.target;
        /* 点头像 = 直接换头像。不再需要应用那个只能改底色的「自定义」按钮 */
        if (t && t.closest && t.closest(".warden-acct-avatar")) {
          ev.preventDefault();
          ev.stopPropagation();
          pickAvatarFile();
          return;
        }
        var b = t && t.closest ? t.closest("button[data-act]") : null;
        if (!b) return;
        var act = b.getAttribute("data-act");
        if (act === "lock") triggerAccountAction("立即锁定");
        else if (act === "logout") {
          if (window.confirm("确定要注销当前账户吗？")) triggerAccountAction("注销");
        }
      });
    }

    /* 同样挂到 main#main-content 上(理由同 ensureSubNav: 路由组件会被重建)。
       顺序定为 [chips][账户卡片][路由内容], 卡片紧跟在 chips 后面。 */
    var sub = document.getElementById("warden-subnav");
    var subHere = (sub && sub.parentNode === host) ? sub : null;
    var wantPrev = subHere || null;
    if (card.parentNode !== host || (wantPrev && card.previousElementSibling !== wantPrev)) {
      host.insertBefore(card, subHere ? subHere.nextSibling : host.firstChild);
    }

    var p = (SYNC && SYNC.profile) || {};
    // 应用自己的头像缩写(如 "US")比 profile.name 可靠; 它被 CSS 藏了,
    // 但 textContent 照样读得到(innerText 会因 display:none 变空)
    var avBtn = document.querySelector("app-account-menu button");
    var initials = avBtn ? String(avBtn.textContent || "").replace(/\s+/g, "") : "";

    // 同样判变化再写, 免得喂给 MutationObserver
    var nm = card.querySelector(".warden-acct-name");
    var ml = card.querySelector(".warden-acct-mail");
    var av = card.querySelector(".warden-acct-avatar");
    // profile.name 有可能是空的, 那就把邮箱提到主行, 别显示一个空标题
    var mail = p.email || "";
    var name = p.name || mail || "账户";
    var sub = p.name ? mail : "";
    var initial = String(initials || name).trim().charAt(0).toUpperCase() || "?";
    if (nm && nm.textContent !== name) nm.textContent = name;
    if (ml && ml.textContent !== sub) ml.textContent = sub;
    if (av && av.textContent !== initial) av.textContent = initial;
  }

  // 全站通用的"外壳"(每个页面都要跑一遍)
  function syncChrome() {
    ensureTabbar();
    watchGrid();
    relaxGrid();
    if (nameTh()) {
      ensureHeadbar();
      if (isNarrow()) ensureFilterToggle();
      else dropFilterToggle();
    } else {
      dropFilterToggle();
      dockNewBtn();
    }
    // 顺序有讲究: 二级导航先插, 账户卡片再插到它后面 -> [chips][账户卡片][路由内容]
    ensureSubNav();
    ensureAccountCard();
    /* 头像: 图只存在本机 localStorage, 所以每次都要重新贴一遍
       (SYNC 到位与否会改变 key, 重贴一次就自动对齐) */
    applyStoredAvatar();
    if (isNarrow() && currentRoute().indexOf("/settings") === 0) hideAppAvatarRow();
  }

  function setSelecting(on) {
    selecting = on;
    document.body.classList.toggle("warden-selecting", on);
    if (!on) uncheckAll();
    updateSelbar();
  }

  function uncheckAll() {
    var boxes = document.querySelectorAll(
      'tr[appvaultcipherrow] input[type="checkbox"]:checked, thead input[type="checkbox"]:checked'
    );
    for (var i = 0; i < boxes.length; i++) {
      try { boxes[i].click(); } catch (e) { /* ignore */ }
    }
  }

  function checkedRows() {
    var out = [];
    var rows = document.querySelectorAll("tr[appvaultcipherrow]");
    for (var i = 0; i < rows.length; i++) {
      var cb = rows[i].querySelector('input[type="checkbox"]');
      if (cb && cb.checked) out.push(rows[i]);
    }
    return out;
  }

  /* =====================================================================
   * 8. 底部批量操作条
   * ===================================================================== */

  function ensureBulkBar() {
    if (document.getElementById("warden-bulkbar")) return;

    var bar = document.createElement("div");
    bar.id = "warden-bulkbar";
    bar.className = "warden-bulkbar";

    var all = document.createElement("button");
    all.type = "button";
    all.className = "warden-bulk-all";
    all.addEventListener("click", function () {
      var head = document.querySelector('thead input[aria-label="全选"]');
      if (head) head.click();
    });

    var count = document.createElement("span");
    count.className = "warden-bulk-count";

    var del = document.createElement("button");
    del.type = "button";
    del.className = "warden-bulk-del";
    del.textContent = "移入回收站";
    del.addEventListener("click", bulkTrash);

    var close = document.createElement("button");
    close.type = "button";
    close.className = "warden-bulk-cancel";
    close.textContent = "取消";
    close.addEventListener("click", function () { setSelecting(false); });

    bar.appendChild(all);
    bar.appendChild(count);
    bar.appendChild(del);
    bar.appendChild(close);
    document.body.appendChild(bar);
  }

  function updateSelbar() {
    ensureBulkBar();

    var seed = document.querySelector("#warden-headbar .warden-selbar-toggle");
    if (seed) {
      var lb = seed.querySelector("span");
      if (lb) lb.textContent = selecting ? "取消" : "选择";
      if (selecting) seed.classList.add("warden-selbar-on");
      else seed.classList.remove("warden-selbar-on");
    }

    var bar = document.getElementById("warden-bulkbar");
    if (!bar) return;

    if (!selecting) {
      bar.classList.remove("warden-bulk-on");
      return;
    }
    var rows = checkedRows();
    var total = document.querySelectorAll("tr[appvaultcipherrow]").length;

    bar.classList.add("warden-bulk-on");
    bar.querySelector(".warden-bulk-count").textContent = "已选 " + rows.length + " 项";
    var all = bar.querySelector(".warden-bulk-all");
    all.textContent = (total && rows.length === total) ? "取消全选" : "全选";
    bar.querySelector(".warden-bulk-del").disabled = rows.length === 0;
  }

  async function bulkTrash() {
    var rows = checkedRows();
    if (!rows.length) return;

    var ids = [];
    var seen = {};
    for (var i = 0; i < rows.length; i++) {
      var c = findCipher(rows[i]);
      if (c && c.id && !seen[c.id]) { seen[c.id] = 1; ids.push(c.id); }
    }
    if (!ids.length) {
      window.alert("无法确定选中条目的 ID, 已取消操作。");
      return;
    }
    if (!AUTH) {
      window.alert("未取得会话令牌, 请刷新页面后重试。");
      return;
    }
    if (!window.confirm("将选中的 " + ids.length + " 个项目移入回收站？\n\n可在「回收站」中恢复。")) return;

    var del = document.querySelector("#warden-bulkbar .warden-bulk-del");
    if (del) { del.disabled = true; del.textContent = "处理中…"; }

    try {
      var resp = await fetch("/api/ciphers/delete", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: AUTH },
        body: JSON.stringify({ ids: ids })
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);

      for (var k = 0; k < ids.length; k++) deletedIds[ids[k]] = 1;
      index = index.filter(function (e) { return !deletedIds[e.id]; });

      for (var j = 0; j < rows.length; j++) {
        if (rows[j].parentNode) rows[j].parentNode.removeChild(rows[j]);
      }
      if (window.__wardenAuthRerender) window.__wardenAuthRerender();
      setSelecting(false);
      toast("已移入回收站 (" + ids.length + " 项)");
    } catch (e) {
      window.alert("删除失败：" + (e && e.message ? e.message : e));
    } finally {
      if (del) { del.disabled = false; del.textContent = "移入回收站"; }
      updateSelbar();
    }
  }

  function toast(msg) {
    var t = document.getElementById("warden-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "warden-toast";
      t.className = "warden-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("warden-toast-on");
    clearTimeout(t.__timer);
    t.__timer = setTimeout(function () { t.classList.remove("warden-toast-on"); }, 2400);
  }

  /* =====================================================================
   * 9. 独立的"验证码"页(复刻 Bitwarden Authenticator 的卡片式列表)
   * ===================================================================== */

  var authOpen = false;

  function ensureAuthView() {
    if (document.getElementById("warden-authview")) return;

    var v = document.createElement("div");
    v.id = "warden-authview";
    v.className = "warden-authview";

    var head = document.createElement("div");
    head.className = "warden-auth-head";
    var h = document.createElement("div");
    h.className = "warden-auth-title";
    h.textContent = "验证码";
    head.appendChild(h);

    var search = document.createElement("input");
    search.type = "search";
    search.className = "warden-auth-search";
    search.placeholder = "搜索条目";
    search.addEventListener("input", renderAuthList);
    head.appendChild(search);

    var list = document.createElement("div");
    list.className = "warden-auth-list";
    list.id = "warden-auth-list";

    v.appendChild(head);
    v.appendChild(list);
    document.body.appendChild(v);

    window.__wardenAuthRerender = renderAuthList;
  }

  function renderAuthList() {
    var list = document.getElementById("warden-auth-list");
    if (!list) return;

    var q = "";
    var input = document.querySelector(".warden-auth-search");
    if (input) q = norm(input.value);

    var items = index.filter(function (c) {
      if (!q) return true;
      return c.name.indexOf(q) !== -1 || norm(c.username).indexOf(q) !== -1;
    });

    var subtitle = document.querySelector(".warden-auth-count");
    if (subtitle) subtitle.textContent = String(index.length);

    list.textContent = "";

    if (!items.length) {
      var empty = document.createElement("div");
      empty.className = "warden-auth-empty";
      empty.textContent = index.length ? "没有匹配的条目" : "还没有带验证码的条目";
      list.appendChild(empty);
      return;
    }

    var card = document.createElement("div");
    card.className = "warden-auth-card";

    for (var i = 0; i < items.length; i++) {
      (function (c) {
        var row = document.createElement("div");
        row.className = "warden-auth-row";

        var meta = document.createElement("div");
        meta.className = "warden-auth-meta";
        var nm = document.createElement("div");
        nm.className = "warden-auth-name";
        nm.textContent = c.label;                       // 用户数据 -> textContent
        var un = document.createElement("div");
        un.className = "warden-auth-user";
        un.textContent = c.username || "—";
        meta.appendChild(nm);
        meta.appendChild(un);

        var badge = makeBadge(c);
        badge.classList.add("warden-auth-badge");

        row.appendChild(meta);
        row.appendChild(badge);
        card.appendChild(row);
      })(items[i]);
    }
    list.appendChild(card);
    tickAll();
  }

  function openAuthView() {
    authOpen = true;
    ensureAuthView();
    renderAuthList();
    document.body.classList.add("warden-authview-on");
    updateTabbar();
  }

  function closeAuthView() {
    authOpen = false;
    document.body.classList.remove("warden-authview-on");
    updateTabbar();
  }

  /* =====================================================================
   * 10. 底部标签栏
   * ===================================================================== */

  var TAB_ICONS = {
    vault: '<path d="M12 3l7 2.6v5.3c0 4.3-3 8.2-7 9.5-4-1.3-7-5.2-7-9.5V5.6L12 3z"/>',
    totp: '<circle cx="12" cy="12" r="8.3"/><path d="M12 7.4V12l3.1 1.9"/>',
    sends: '<path d="M4.2 11.9 20 4.6l-7.3 15.8-2.1-6.4-6.4-2.1z"/>',
    tools:
      '<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/>' +
      '<rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/>',
    reports: '<path d="M5.5 20V11M12 20V4.5M18.5 20v-6"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/>' +
      '<path d="M12 3.6v2.1M12 18.3v2.1M3.6 12h2.1M18.3 12h2.1' +
      'M6.1 6.1l1.5 1.5M16.4 16.4l1.5 1.5M17.9 6.1l-1.5 1.5M7.6 16.4l-1.5 1.5"/>'
  };

  /* 对应桌面端侧栏第一分栏(密码库/Send/工具/报告/设置) + 我们额外拆出来的「验证码」。
     原先漏了「报告」—— 它的路由一直是通的, 只是窄屏没有任何入口。 */
  var TABS = [
    { key: "vault", label: "密码库", route: "/vault" },
    { key: "totp", label: "验证码", route: "/vault", auth: true },
    { key: "sends", label: "发送", route: "/sends" },
    { key: "tools", label: "工具", route: "/tools" },
    { key: "reports", label: "报告", route: "/reports" },
    { key: "settings", label: "设置", route: "/settings" }
  ];

  function currentRoute() {
    var h = (location.hash || "#/vault").replace(/^#/, "").split("?")[0];
    if (!h) return "/vault";
    if (h.charAt(0) !== "/") h = "/" + h;
    if (h === "/") return "/vault";
    return h;
  }

  function updateTabbar() {
    var bar = document.getElementById("warden-tabbar");
    if (!bar) return;
    var r = currentRoute();
    var onVault = r.indexOf("/vault") === 0;
    var links = bar.querySelectorAll("a[data-tab]");
    for (var i = 0; i < links.length; i++) {
      var a = links[i], key = a.getAttribute("data-tab"), active;
      if (key === "totp") active = authOpen;
      else if (key === "vault") active = onVault && !authOpen;
      else active = r.indexOf(a.getAttribute("data-route")) === 0;
      if (active) a.classList.add("warden-tab-active");
      else a.classList.remove("warden-tab-active");
    }
  }

  function ensureTabbar() {
    if (document.getElementById("warden-tabbar")) return;
    if (!document.querySelector("bit-layout") || !document.getElementById("main-content")) return;

    var bar = document.createElement("nav");
    bar.id = "warden-tabbar";
    bar.className = "warden-tabbar";

    for (var i = 0; i < TABS.length; i++) {
      (function (t) {
        var a = document.createElement("a");
        a.setAttribute("data-tab", t.key);
        a.setAttribute("data-route", t.route);
        a.setAttribute("href", "#" + t.route);
        a.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true">' + TAB_ICONS[t.key] + "</svg>" +
          "<span>" + t.label + "</span>";
        a.addEventListener("click", function (ev) {
          ev.preventDefault();
          var onVault = currentRoute().indexOf("/vault") === 0;
          if (t.auth) {
            if (!onVault) location.hash = "#/vault";
            openAuthView();
          } else {
            closeAuthView();
            if (!(t.key === "vault" && onVault)) location.hash = "#" + t.route;
          }
        });
        bar.appendChild(a);
      })(TABS[i]);
    }
    document.body.appendChild(bar);
    updateTabbar();
  }

  /* =====================================================================
   * 11. 每秒 tick
   * ===================================================================== */

  function tickAll() {
    var badges = document.querySelectorAll(".warden-totp-code");
    for (var i = 0; i < badges.length; i++) paintTimer(badges[i]);
  }

  async function refreshCodes() {
    var badges = document.querySelectorAll(".warden-totp-code");
    for (var i = 0; i < badges.length; i++) {
      try { await refreshCode(badges[i]); } catch (e) { /* 忽略单行错误 */ }
    }
  }

  /* =====================================================================
   * 12. 装饰列表 + 主循环
   * ===================================================================== */

  async function decorate() {
    if (!SYNC || !index.length) return;

    var rows = document.querySelectorAll("tr[appvaultcipherrow]");
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.querySelector(".warden-totp-code")) continue;
      var c = findCipher(row);
      if (c) insertTotp(row, c);
    }
  }

  async function boot() {
    syncChrome();
    if (!SYNC) return;
    if (SYNC !== indexBuiltFor) {
      var ok = await buildIndex(SYNC);
      if (ok) indexBuiltFor = SYNC;
      else return;
    }
    await decorate();
  }

  function init() {
    ensureStyle();
    ensureBulkBar();
    onFirstSync(function () { boot(); });
    boot();

    window.addEventListener("hashchange", function () {
      updateTabbar();
      if (currentRoute().indexOf("/vault") !== 0) {
        closeAuthView();
        document.body.classList.remove("warden-filter-open");
      }
      syncChrome();
    });

    // 断点切换(横竖屏)时重排"新增"按钮的落点
    window.addEventListener("resize", function () { syncChrome(); });
    window.addEventListener("orientationchange", function () {
      setTimeout(syncChrome, 250);
    });

    document.addEventListener("change", function (ev) {
      var t = ev.target;
      if (t && t.type === "checkbox") updateSelbar();
    }, true);

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && selecting) setSelecting(false);
    });

    setInterval(function () {
      tickAll();
      refreshCodes();
    }, 1000);
    setInterval(function () { boot(); }, 2000);

    // 行内三点的菜单浮层在 DOM 上认不出来源, 靠点击时先记下是哪一行
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      var b = t && t.closest ? t.closest("tr[appvaultcipherrow] button[biticonbutton]") : null;
      if (b) lastMenuRow = b.closest("tr[appvaultcipherrow]");
    }, true);

    var observer = new MutationObserver(function (muts) {
      scanMenus(muts);
      clearTimeout(window.__wardenScanT);
      window.__wardenScanT = setTimeout(function () { boot(); }, 400);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    console.log(LOG, "injected (v6)");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
