-- 账号管理台（/admin/）所需的两个账号生命周期列。
--
-- 背景：既有 users 表只有"创建/更新"，没有任何"有效期 / 是否可用"的概念。
-- 管理台要能"给子账号设 7 天有效期""停用某个账号"，需要：
--   · expires_at  —— ISO8601 文本。到期后**不静默删除**，只由每日 cron 置 disabled_at。
--   · disabled_at —— ISO8601 文本，非 NULL 即拒绝登录（identity 侧在密码校验通过后再判，
--                    避免向未认证的调用者泄露"这个邮箱存在且被停用了"）。
--
-- 两列都可空且无默认值 ⇒ 既有用户全部落在"永不过期 / 未停用"，行为与升级前完全一致。
-- D1/SQLite 的 ALTER TABLE ADD COLUMN 是 O(1) 元数据操作，不需要重建表。
ALTER TABLE users ADD COLUMN expires_at TEXT;
ALTER TABLE users ADD COLUMN disabled_at TEXT;
