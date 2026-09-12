-- 用户自定义头像图片(data URL), 用于替换默认的字母/纯色头像。
-- 保持可空: 未上传头像的用户仍走 avatar_color + 首字母那条老路径。
ALTER TABLE users ADD COLUMN avatar_image TEXT;
