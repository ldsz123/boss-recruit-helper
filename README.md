# Boss招聘小助手

> Boss直聘求职效率工具：抓取岗位 JD → 上传简历（PDF / Word / TXT）→ AI 定制优化 → 选岗匹配 → 生成专属话术 → 一键投递。
>
> 当前版本：**v1.3.0**

---

## ✨ 功能

| 能力 | 说明 |
|---|---|
| 🎯 抓取 JD | 在职位详情页一键捕获「岗位职责 / 任职要求」，多层选择器容错，抓不到可手动粘贴 |
| 📄 上传简历 | 支持 **PDF / Word(.docx) / TXT / MD**，也可直接粘贴全文；数据仅存本地浏览器 |
| ✨ AI 优化 | 按 JD 定制改写简历：关键词前置、STAR 量化、严禁虚构；优化后**自动生成该岗位打招呼话术** |
| 🔍 选岗匹配 | 在职位列表页扫描本页岗位，按简历匹配度打分（AI 或本地关键词），绿标=合适，可只看合适岗位 |
| 🎨 简历版式 | 内置 **现代简约 / 深色商务** 两套模板，导出的 PDF 与图片都套用该版式 |
| ⬇️ 导出 | 一键下载 **PDF**（多页 A4，中文不乱码）或 **.doc**（可再编辑） |
| 🖼 一键投递 | 在 HR 聊天页把简历渲染成**图片**直接发送（手机端预览清晰），或填入 AI 话术 |
| 🗣 话术模板 | 内置正式/精简/活泼三套，可自定义多套，支持 `{岗位}{公司}{薪资}{姓名}` 占位符 |
| 🔄 自动更新 | 脚本支持油猴自动检查更新（需部署到你自己的仓库） |

---

## 📦 安装

1. **装浏览器扩展**：Chrome / Edge 安装 [Tampermonkey（篡改猴）](https://www.tampermonkey.net/)，Firefox 可装 Greasemonkey。
2. **装脚本**：点下方链接，篡改猴会自动弹出安装页 → 点「安装」。
   ```
   https://gitee.com/zzc356/boss-recruit-helper/raw/master/boss-recruit-helper.user.js
   ```
   > 若没弹出安装页，复制链接 → 篡改猴面板 → 实用工具 → 导入 → 从 URL。
3. **打开 Boss 直聘**：`https://www.zhipin.com`，页面右下角出现 💼 悬浮按钮即安装成功。

### ⚠️ Edge 用户必看（高频坑）

Edge 138+ 之后，**光开「开发人员模式」不够**，还要单独给篡改猴开权限：

1. 地址栏输入 `edge://extensions/`
2. 打开左下角 **「开发人员模式」**
3. 找到「篡改猴」→ 点 **「详细信息」**
4. 往下翻，打开 **「允许用户脚本」（Allow User Scripts）** ← 关键
5. 同一页把 **「网站访问」设为「在所有网站上」**
6. **完全关闭 Edge 再重开**（不是刷新标签页），然后打开 Boss 页面按 `Ctrl+F5`

> 判断是否生效：篡改猴图标出现**数字角标**、下拉菜单里能看到「打开/收起小助手面板」。

---

## 💎 版本区别

| | 免费版 | 授权版（付费） |
|---|---|---|
| 安装文件 | `boss-recruit-helper.user.js` | `boss-recruit-helper-sell.user.js` |
| 抓取 JD / 上传简历 / 本地关键词匹配 | ✅ | ✅ |
| AI 简历优化、AI 话术生成 | ✅ | ✅（需激活码） |
| 岗位扫描匹配、简历图片发送、PDF/图片导出 | ✅ | ✅（需激活码） |
| 激活要求 | 无需 | 需激活码（在线激活页：见下） |

### 授权版安装

```
https://gitee.com/zzc356/boss-recruit-helper/raw/master/boss-recruit-helper-sell.user.js
```

未激活时，付费功能会弹出激活框；填入激活码即解锁。激活入口：面板 → **⚙️ 设置** → 激活码 → **🔑 激活**。

### 在线激活网页

- 本地双击打开：`activate.html`
- 部署后给买家访问：Gitee 仓库 → **服务 → Gitee Pages** → 部署目录选根目录 → 得到
  `https://zzc356.gitee.io/boss-recruit-helper/activate.html`（脚本里「获取激活码」按钮已指向它）
  部署到别处（Vercel / 自有域名）时，改 `sell-kit/license-ui.js` 的 `LICENSE_PAGE` 后重跑 `make-sell.js`

网页功能：① 用户粘贴激活码验证有效性；② 作者输入口令批量发码（永久 / 30 / 90 / 180 / 365 天），可复制或导出 CSV；③ 购买方式展示（在 `activate.html` 顶部 `CONFIG.buy` 里配置微信 / QQ / 闲鱼等）。

> ⚠️ 静态方案说明：激活码算法与口令都在前端可见，理论上可被逆向自签发。低价走量够用；若需要**一机一码 / 随时吊销 / 防泄漏**，请部署 `sell-kit/license-server-example.js`，并把脚本里 `LICENSE_API` 指向你的 `/verify` 接口后重跑 `make-sell.js`。

---

## ⚙️ 配置 AI

面板 → **⚙️ 设置** → 填「接口地址」+「API Key」+「模型名称」→ 保存 → 点「测试连通」。

| 服务 | Base URL | 模型示例 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |

> 没配 Key 也能用「🔍 选岗」的**本地关键词匹配**，但 AI 优化与话术生成需要 Key。

---

## 🚀 使用流程

1. **传简历**：「📄 简历」页上传 PDF/Word 或粘贴全文（一次即可，跨页面记住）
2. **选岗位**：「🔍 选岗」页，在职位列表页点扫描 → 挑合适的岗位点「应用此岗位」
3. **抓 JD**：「📋 JD」页点抓取（应用岗位后通常已自动带上）
4. **优化**：「✨ 优化」页点「🚀 开始优化」→ 等待 10~60 秒
5. **导出 / 投递**：下载 **PDF**，或在 HR 聊天页点「🖼 发送简历图片」直接发送

---

## 🔄 自动更新（部署者看）

本项目已内置更新检查，脚本托管在 **Gitee** `https://gitee.com/zzc356/boss-recruit-helper`，用户端会自动收到新版本。

脚本头部两行固定指向本仓库的 raw 文件（已填好，无需改动）：
```js
// @updateURL    https://gitee.com/zzc356/boss-recruit-helper/raw/master/boss-recruit-helper.user.js
// @downloadURL  https://gitee.com/zzc356/boss-recruit-helper/raw/master/boss-recruit-helper.user.js
```

**发版流程**（本仓库默认分支为 `master`）：

1. 改免费版脚本里的 `@version` 与 `VERSION`（如 `1.3.1`）
2. **重新生成授权版**（两个版本号必须同步）：
   ```bash
   cd sell-kit
   node make-sell.js      # 由免费版生成 ../boss-recruit-helper-sell.user.js
   node test-license.js   # 跑一遍授权自检，确认拦截与激活正常
   node build-activate.js # 若改过算法/模板，重新生成 activate.html
   ```
   > `make-sell.js` 会校验每一处注入点，若免费版改动导致匹配不上会明确报错（不会静默产出坏版本）。
3. 双击 `update-and-push.bat`，输入提交说明，自动 commit + push
4. 用户端：篡改猴会自动检查并提示更新；也可在面板「⚙️ 设置」点「🔄 检查更新」

> 若 Gitee raw 被限流导致更新失败，用户可在「⚙️ 设置 → 云端更新地址」填其他镜像地址覆盖默认地址。

```bash
git add .
git commit -m "release v1.3.0"
git push origin master
```

---

## ❓ 常见问题

**Q：装了脚本但页面没反应？**
九成是 Edge 权限问题，见上文「Edge 用户必看」。另确认地址是 `www.zhipin.com`。

**Q：抓不到 JD？**
Boss 改版可能导致选择器失效，直接在「📋 JD」页手动粘贴 JD 正文即可，不影响后续流程。

**Q：PDF 或图片生成失败？**
渲染依赖 CDN 加载 `html2canvas` / `jsPDF`，网络受限时可能失败。可改用「下载 .doc」，或刷新页面重试。

**Q：发送简历图片时提示"已下载，请手动发送"？**
Boss 聊天页偶尔会拦截自动附加，脚本会自动把图片下载到本地，点聊天窗口的「图片」按钮手动上传即可。

**Q：数据会上传吗？**
不会。简历、JD、API Key 全部存在本机浏览器（篡改猴存储），仅 AI 优化请求你配置的模型接口。

---

## 📝 更新日志

**v1.3.0**
- 新增两套简历版式（现代简约 / 深色商务），PDF 与图片导出均套用
- 下载改为 **PDF（推荐）** + .doc，移除 .md
- 「附加简历文件」改为 **发送简历图片** 到 HR 对话
- 设置页新增版式选择与云端更新地址

**v1.2.0**
- 支持 PDF / Word 简历解析；话术多模板；优化后自动生成岗位话术
- 新增云端自动更新机制

**v1.1.0**
- 新增「选岗」：按简历匹配度筛选职位列表

**v1.0.0**
- 初版：JD 捕获 + 简历 AI 优化 + 快捷投递

---

## ⚖️ 免责声明

本工具仅用于个人求职信息整理与文本润色，请遵守 Boss 直聘用户协议，合理控制使用频率，对投递内容的真实性负责。AI 生成内容请务必人工核验。

MIT License
