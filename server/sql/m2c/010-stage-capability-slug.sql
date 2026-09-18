-- 010: stage_capabilities 增加 slug（装载名）
-- 背景（57 号安装公司 skill 后发现）：worker 装载 skill 时按 codex 目录名/slug 匹配
-- （config.js skills.config enabled 判定：base=SKILL.md 父目录基名），而配置表 name 是
-- 中文显示名（如"代码审查"），命中不了真实 skill（rdc-code-review）。显示名与装载名
-- 分离：name 用于页面展示，slug 用于 worker 装载；slug 为空时回退 name（兼容旧数据）。
ALTER TABLE stage_capabilities
  ADD COLUMN slug text CHECK(slug IS NULL OR length(slug) BETWEEN 1 AND 200);
