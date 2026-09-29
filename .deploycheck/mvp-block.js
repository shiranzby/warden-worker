/* =====================================================================
 * ⑥ MVP 上线验收：设计系统是否真的作用到了这个域上
 *    判据一律量"渲染出来的东西"，不看文件是否存在。
 *    ⚠️ 两个视口都要跑 —— 这是第二十批用 6 个批次换来的教训。
 * ===================================================================== */
console.log("\n########## ⑥ MVP 上线验收（设计系统 / 图标栏 / 导航）##########");
{
  /* ⚠️ 必须回到 /vault 再量。设计稿那 6 项导轨对应的是"分组全收起"的状态；
     而本段紧跟在 ⑤(设置页)之后，那时「工具」「设置」两个组是**展开**的：
       · 导轨里会多出子项(生成器/导入/导出、我的账户/安全/外观/域)
       · 组头自身的容器带 `bit-nav-group` 祖先 ⇒ 被下面的过滤排除掉，
         于是"六项"变成四项(实测 got=["密码库","验证码","发送","报告"]) */
  await closeAllDialogs();
  await goRoute(page, "/vault", "app-vault", 25000).catch(() => {});
  await sleep(2500);
  const sheets = await page.evaluate(() => [...document.styleSheets].map((s) => s.href || "(inline)"));
  check("⑥ warden-design.css 已加载", sheets.some((h) => h.includes("warden-design.css")),
    sheets.filter((h) => h.includes("warden") || h.includes("vaultwarden")).join(" , "));

  const d = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const grid = document.querySelector("app-layout div.tw-grid");
    const rail = document.querySelector("app-side-nav");
    // ⚠️ 一级导航**不要**靠 DOM 层级判断（试过两次都错）：
    //    · `app-side-nav > bit-nav-item` 命中 0 个 —— 项目被投影进 bit-side-nav 内层
    //    · 用 `!closest("bit-nav-group")` 过滤组内子项会**连组头一起滤掉**：
    //      「工具」「设置」本身就是 bit-nav-group，它们的组头容器也在 bit-nav-group 里
    //      ⇒ 六项变四项（missing=["工具","设置"]，白跑一轮）
    //    ⇒ 判据改成"每个期望的名字，都必须能在**已渲染**的导航项文字里找到"，
    //      这既不依赖层级，也天然排除"没画出来"的项。
    const containers = [...document.querySelectorAll('app-side-nav [data-testid="nav-item-container"]')];
    const painted = (e) => {
      if (!e) return false;
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && e.getClientRects().length > 0;
    };
    const itemText = (c) => {
      const sp = c.querySelector("span.tw-truncate");
      return ((sp ? sp.textContent : (c.textContent || "")) || "").trim().replace(/\s+/g, "");
    };
    const items = containers.filter(painted);
    const nav0 = containers[0];
    const icon0 = nav0 ? nav0.querySelector("bit-icon") : null;
    const label0 = nav0 ? nav0.querySelector("span.tw-truncate") : null;
    const b0 = nav0 ? nav0.getBoundingClientRect() : null;
    return {
      hasWd: document.body.classList.contains("wd"),
      bg: root.getPropertyValue("--bg").trim(),
      accent: root.getPropertyValue("--accent").trim(),
      fg: root.getPropertyValue("--fg").trim(),
      gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
      railW: rail ? Math.round(rail.getBoundingClientRect().width) : null,
      onVault: location.hash.replace(/^#/, "").startsWith("/vault"),
      paintedTexts: [...new Set(items.map(itemText).filter(Boolean))],
      allContainerCount: containers.length,
      nav0Rect: b0 ? [Math.round(b0.x), Math.round(b0.y), Math.round(b0.width), Math.round(b0.height)] : null,
      icon0Painted: painted(icon0),
      label0Painted: painted(label0),
      icon0Rect: icon0 ? (() => { const q = icon0.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height)]; })() : null,
      label0Rect: label0 ? (() => { const q = label0.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height)]; })() : null,
      railText: rail ? (rail.innerText || "").replace(/\s+/g, "") : "",
      innerDisplay: nav0 ? getComputedStyle(nav0.querySelector('[data-testid="nav-item-container"] > div')).display : null,
    };
  });
  console.log("  " + JSON.stringify(d));

  /* 期望的一级导航（与 user-layout.component.html 里那 6 个 bit-nav-item 对齐）。
     ⚠️ 用"逐个都必须出现在已渲染项里"，而不是"个数 == 6" —— 个数对不上时
     还能一眼看出**缺了哪一项**；同时不依赖"组有没有展开"。 */
  const EXPECT_NAV = ["密码库", "验证码", "发送", "工具", "报告", "设置"];
  const got = d.paintedTexts;
  const missing = EXPECT_NAV.filter((t) => !got.includes(t));

  check("⑥ body 带 wd 作用域类", d.hasWd === true, String(d.hasWd));
  check("⑥ 设计 token 已注入 --bg/--fg/--accent", !!d.bg && !!d.fg && !!d.accent,
    d.bg + " / " + d.fg + " / " + d.accent);
  check("⑥ 侧栏是 68px 图标栏", d.railW !== null && Math.abs(d.railW - 68) <= 2, "rail=" + d.railW + "px");
  check("⑥ 一级导航六项都渲染出来了", missing.length === 0 && d.onVault,
    "missing=" + JSON.stringify(missing) + " onVault=" + d.onVault +
    " painted=" + JSON.stringify(got) + " 容器总数=" + d.allContainerCount);
  check("⑥ 导航含「验证码」", got.includes("验证码"), JSON.stringify(got));
  /* 🔴 判据必须落在"用户看见的东西"上：容器有高度**不代表**内容画出来了
     —— 线上曾经出现"容器 56×52 但图标/标签全是 0×0"的空白黑条。 */
  check("⑥ 导轨内容层没被 display:none", d.innerDisplay === "block" || d.innerDisplay === "flex",
    String(d.innerDisplay));
  check("⑥ 首项图标真的画出来了", d.icon0Painted, JSON.stringify(d.icon0Rect));
  check("⑥ 首项标签真的画出来了", d.label0Painted, JSON.stringify(d.label0Rect));
  check("⑥ 导轨里能读到导航文字", d.railText.length >= 12, JSON.stringify(d.railText.slice(0, 30)));

  // 暗色桥接：切到 dark 后 --bg 必须真的变（否则整套暗色 token 是死的）
  const dark = await page.evaluate(() => {
    const r = document.documentElement;
    const before = getComputedStyle(r).getPropertyValue("--bg").trim();
    r.classList.remove("theme_light");
    r.classList.add("theme_dark");
    const after = getComputedStyle(r).getPropertyValue("--bg").trim();
    r.classList.remove("theme_dark");
    r.classList.add("theme_light");
    return { before, after, changed: before !== after };
  });
  console.log("  暗色桥接: " + JSON.stringify(dark));
  check("⑥ 暗色主题能真的换掉 --bg", dark.changed, JSON.stringify(dark));

  await shot("06-mvp-layout.png");
}

/* =====================================================================
 * ⑦ 窄屏回归 —— **同一个会话里切视口**，不再登录第二次。
 *
 *   为什么这么做：b8-lib 里写明"短时间重复登录会被服务端限流(第 3 次起停在
 *   #/login 且没有任何提示)"，而本项目又硬性要求"改动必须在两个视口验收"
 *   (第十三~十九批只跑 390px，漏掉了电脑端一个功能性缺陷，活了 6 批)。
 *   两个约束的交集就是这里：**一次登录、两次视口**。
 *   ⚠️ 只切 width/height 是有意为之 —— 我们的断点是 `@media (min-width:769px)`
 *      (纯视口宽度)，所以媒体查询会如实切换；`isMobile` 那类只能建 context 时
 *      指定的东西这里用不到，也就没必要为它再登录一次。
 * ===================================================================== */
console.log("\n########## ⑦ 窄屏回归（390×844，同一会话切视口）##########");
{
  await closeAllDialogs();
  await page.setViewportSize({ width: 390, height: 844 });
  await goRoute(page, "/vault", "app-vault", 25000).catch(() => {});
  await sleep(3000);

  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const rail = document.querySelector("app-side-nav");
    const railCs = rail ? getComputedStyle(rail) : null;
    const railRect = rail ? rail.getBoundingClientRect() : null;
    const tabbar = document.getElementById("warden-tabbar");
    const tabCs = tabbar ? getComputedStyle(tabbar) : null;
    const rows = [...document.querySelectorAll("main#main-content app-vault-items table tbody tr")];
    return {
      railW: railRect ? Math.round(railRect.width) : null,
      railDisp: railCs ? railCs.display : null,
      tabbarPresent: !!tabbar,
      tabbarDisp: tabCs ? tabCs.display : null,
      tabbarH: tabbar ? Math.round(tabbar.getBoundingClientRect().height) : null,
      docScrollW: de.scrollWidth,
      clientW: de.clientWidth,
      rowCount: rows.length,
      firstRowH: rows[0] ? Math.round(rows[0].getBoundingClientRect().height) : null,
    };
  });
  console.log("  " + JSON.stringify(m));

  check("⑦ 窄屏不再出现 68px 图标栏",
    m.railW === null || m.railW < 40 || m.railDisp === "none", "railW=" + m.railW + " disp=" + m.railDisp);
  check("⑦ 窄屏一级导航走底部标签栏", m.tabbarPresent && m.tabbarDisp !== "none",
    "present=" + m.tabbarPresent + " disp=" + m.tabbarDisp + " h=" + m.tabbarH);
  check("⑦ 没有横向溢出", m.docScrollW <= m.clientW + 1, m.docScrollW + " vs " + m.clientW);
  check("⑦ 密码库表格仍渲染出行", m.rowCount > 0 && m.firstRowH !== null && m.firstRowH > 20,
    "rows=" + m.rowCount + " firstRowH=" + m.firstRowH);
  await shot("07-mvp-narrow.png");
}

