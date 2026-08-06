# 客服AI训练师工作台（云端版）

## 第一步：Supabase 建表

1. 登录 https://supabase.com
2. 打开你的项目，左侧菜单点 `SQL Editor`
3. 点 `New query`，把 `schema.sql` 的内容全部粘贴进去
4. 点 `Run`，看到成功提示即可

## 第二步：部署到 GitHub Pages

1. 在 GitHub 新建公开仓库 `ai-workbench`
2. 把 `index.html`、`schema.sql`、`README.md` 上传到仓库根目录
3. 仓库 `Settings` -> `Pages` -> `Source` 选 `Deploy from a branch`
4. 分支选 `main`，目录选 `/ (root)`，点 `Save`
5. 等待 1-2 分钟，访问 `https://你的用户名.github.io/ai-workbench/`

## 数据说明

- 数据存在 Supabase 的 `state` 表（单行 id=1，字段 days / shifts）
- 电脑和手机打开同一个网址，读写同一份数据
- 当前表策略是公开读写，适合个人使用；不要把网址公开传播
