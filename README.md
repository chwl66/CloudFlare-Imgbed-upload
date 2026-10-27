# CloudFlare ImgBed 上传器 - 浏览器扩展

[![release](https://img.shields.io/github/v/release/chwl66/CloudFlare-Imgbed-upload?label=release&color=blue)](https://github.com/chwl66/CloudFlare-Imgbed-upload/releases/latest)
[![downloads](https://img.shields.io/github/downloads/chwl66/CloudFlare-Imgbed-upload/total?color=brightgreen)](https://github.com/chwl66/CloudFlare-Imgbed-upload/releases)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-orange)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![license](https://img.shields.io/github/license/chwl66/CloudFlare-Imgbed-upload?color=green)](./LICENSE)

一个功能强大的浏览器扩展，支持多种方式上传图片与文件到 CloudFlare ImgBed，提供外链收录、上传记录与图床文件管理能力。

> **⬇️ 下载安装**：到 [Releases](https://github.com/chwl66/CloudFlare-Imgbed-upload/releases/latest) 下载 `cloudflare-imgbed-uploader-v1.9.0.zip`，解压后在扩展管理页点「加载已解压的扩展程序」选择解压出来的目录即可，详见[安装指南](#-安装指南)。

## ✨ 核心特性

### 🖱️ 多种上传方式
- **右键菜单上传**：在任意网页图片上右键，一键上传到图床
- **剪贴板上传**：支持截图、复制图片后直接上传，默认快捷键 `Ctrl+Shift+U`（可在 `chrome://extensions/shortcuts` 自定义）
- **拖拽上传**：将本地图片文件直接拖拽到网页即可上传
- **任意文件上传**：上游是文件床，拖拽或粘贴 PDF、压缩包、音视频等非图片文件同样可以上传
- **外链收录**：右键图片 → 「以外链方式收录」，只登记原图地址、不下载文件，防盗链站点也能收录
- **跨域图片处理**：智能处理防盗链保护，多重fallback机制确保上传成功

### 📋 智能复制格式
- **直链格式**：纯图片链接，适用于直接分享
- **Markdown格式**：`![image](url)` 格式，适用于文档编写
- **BBCode格式**：`[img]url[/img]` 格式，适用于论坛发帖
- **一键复制**：点击任意格式自动复制到剪贴板

### 🎨 用户体验优化
- **美观通知**：现代化设计的上传结果通知，支持多格式显示
- **智能截断**：长链接自动截断显示，悬停查看完整链接
- **实时反馈**：上传进度实时显示，成功/失败状态清晰提示
- **错误处理**：详细的错误信息和解决建议
- **上传记录**：独立弹窗查看最近 200 条上传记录，支持搜索、状态筛选、多格式复制与删除
- **图床文件管理**：独立窗口浏览实例中的文件，支持服务端搜索、分页、复制链接、打开与删除（需带 `list` / `delete` 权限的 API Token）

### ⚙️ 丰富配置选项
- **API服务配置**：支持自定义CloudFlare ImgBed服务地址
- **认证管理**：可选的上传认证码配置，支持私有部署
- **存储渠道**：支持Telegram、CloudFlare R2、S3多种存储后端
- **文件命名**：4种命名策略（默认前缀_原名、仅前缀、仅原名、短链接）
- **目录管理**：支持自定义上传目录，便于文件分类
- **智能重试**：上传失败时自动切换渠道重试
- **压缩优化**：Telegram渠道支持服务端图片压缩

### 🔒 安全与兼容性
- **权限说明**：核心权限仅 `contextMenus` / `storage` / `activeTab` / `clipboardRead`；`host_permissions` 为 `*://*/*`，用于从任意网页读取右键选中的图片并绕过防盗链，这是右键上传功能的必要前提
- **跨域支持**：智能处理各种网站的防盗链保护
- **多浏览器支持**：兼容Edge、Chrome等Chromium内核浏览器
- **隐私保护**：API Token 与认证码仅保存在浏览器本地（`chrome.storage.local`），不参与跨设备同步，也不会上传到第三方服务器；其余配置通过浏览器账号同步，仅存于你的浏览器账户中

## 📦 安装指南

### 🎯 快速安装（推荐）

#### 步骤1：获取扩展文件

**方式1（推荐）：下载 Release 压缩包**

打开 [Releases](https://github.com/chwl66/CloudFlare-Imgbed-upload/releases/latest) 下载 `cloudflare-imgbed-uploader-v1.9.0.zip`，解压到任意目录。压缩包内已剔除 `test/`、文档与图标生成工具，只有运行所需的 18 个文件。

**方式2：克隆仓库**

```bash
git clone https://github.com/chwl66/CloudFlare-Imgbed-upload.git
cd CloudFlare-Imgbed-upload
```

> 克隆下来的是完整源码，同样可以直接加载；只是目录里多了测试脚本与文档，不影响运行。

#### 步骤2：浏览器安装
1. **打开扩展管理页面**
   - **Edge浏览器**：地址栏输入 `edge://extensions/`
   - **Chrome浏览器**：地址栏输入 `chrome://extensions/`
   - 或通过菜单：`⋮` → `扩展` → `管理扩展`

2. **启用开发者模式**
   - 在页面右上角找到"开发者模式"开关
   - 点击开启（开关变为蓝色）

3. **加载扩展**
   - 点击"加载已解压的扩展程序"按钮
   - 选择解压出来的目录（或克隆下来的仓库目录，只要里面有 `manifest.json`）
   - 点击"选择文件夹"确认

4. **验证安装**
   - 扩展出现在列表中，状态为"已启用"
   - 浏览器工具栏显示扩展图标 📷
   - 右键网页应显示相关菜单项

### 🔧 高级安装选项

#### 打包安装（适用于团队部署）

生成一个只含运行时文件的 zip，解压后按上面「步骤2」加载即可：

```bash
node test/package.mjs
# 输出：dist/cloudflare-imgbed-uploader-v1.9.0.zip（18 个文件，约 75 KB）
```

压缩包内 `manifest.json` 位于根目录，不含 `test/`、文档与图标生成工具，可直接分发。

也可以用浏览器自带的方式打包成 `.crx`：

```bash
# 1. 在扩展管理页面点击"打包扩展程序"
# 2. 选择 CloudFlare-Imgbed-upload 文件夹
# 3. 生成 .crx 和 .pem 文件
# 4. 分发 .crx 文件给团队成员安装
```

> ⚠️ Chrome / Edge 已限制非商店来源的 `.crx` 直接安装，团队内部分发建议用上面的 zip + 「加载已解压的扩展程序」，或走企业策略下发。

#### 企业策略部署
```json
// 适用于企业环境的策略配置
{
  "ExtensionInstallForcelist": [
    "your-extension-id;https://your-domain.com/extension.crx"
  ]
}
```

## ⚙️ 配置指南

### 🚀 快速配置

#### 基础配置（必需）
1. **打开配置界面**
   ```
   方式1：点击浏览器工具栏的扩展图标 📷
   方式2：扩展管理页面 → 扩展详情 → 选项
   ```

2. **填写服务信息**
   ```
   API 地址：https://your-imgbed-domain.com
   API Token：your-api-token（可选，推荐，需 upload 权限）
   认证码：your-auth-code（可选，取决于服务配置）
   ```
   > API Token 与认证码二选一：API Token 通过 `Authorization: Bearer` 请求头传递，认证码通过 `authCode` 请求头传递，都不会出现在 URL 里。

3. **验证连接**
   - 点击"测试连接"按钮
   - 等待显示"连接测试成功！"
   - 如果失败，检查地址和认证信息是否正确

#### 高级配置（可选）
```yaml
存储配置:
  上传渠道: telegram | cfr2 | s3 | discord | huggingface | webdav
  渠道名称: "r2-main" # 可选，同一渠道配置多个存储时指定
  文件命名: default | index | origin | short
  上传目录: "img/uploads" # 可留空使用根目录

功能选项:
  服务端压缩: true  # 仅Telegram渠道有效
  自动重试: true    # 失败时切换渠道
  显示通知: true    # 上传结果通知
```

### 📋 配置模板

#### 个人博客配置
```json
{
  "apiUrl": "https://img.yourblog.com",
  "apiToken": "your-api-token",
  "uploadChannel": "telegram",
  "uploadNameType": "default",
  "uploadFolder": "blog/images",
  "serverCompress": true,
  "autoRetry": true
}
```

#### 团队协作配置
```json
{
  "apiUrl": "https://team-img.company.com",
  "authCode": "team-shared-token",
  "uploadChannel": "cfr2",
  "channelName": "team-r2",
  "uploadNameType": "short",
  "uploadFolder": "team/assets",
  "serverCompress": false,
  "autoRetry": true
}
```

### 配置项详解

所有配置项均可直接在扩展弹窗中修改。

> **存储说明**：非敏感配置保存在 `chrome.storage.sync`（登录同一浏览器账号可跨设备同步）；敏感配置（API Token、认证码）仅保存在 `chrome.storage.local`，不会同步、不会上传到第三方。旧版本遗留的敏感配置会自动迁移到本地存储。

#### 配置一览

| 配置键 | 名称 | 默认值 | 存储位置 |
|--------|------|--------|----------|
| `apiUrl` | API 地址 | 空（必填） | sync |
| `apiToken` | API Token | 空 | local |
| `authCode` | 上传认证码 | 空 | local |
| `uploadChannel` | 上传渠道 | `telegram` | sync |
| `channelName` | 渠道名称 | 空 | sync |
| `uploadNameType` | 文件命名方式 | `default` | sync |
| `returnFormat` | 返回格式 | `full` | sync |
| `uploadFolder` | 上传目录 | 空（根目录） | sync |
| `uploadTimeout` | 上传超时 | `60000`（60 秒） | sync |
| `serverCompress` | 服务端压缩 | `true` | sync |
| `autoRetry` | 失败自动重试 | `true` | sync |

#### 各项详细说明

**API 地址（`apiUrl`）** — 必填
- CloudFlare ImgBed 服务根地址，例如 `https://img.example.com`
- 仅支持 `http:` / `https:` 协议，不能填写示例域名 `your.domain`
- 末尾的 `/` 会被自动去掉；填写服务根地址即可，不要包含 `/upload` 路径

**API Token（`apiToken`）** — 可选，推荐
- 在 ImgBed 管理后台创建的 Token，上传需要 `upload` 权限；「图床文件」窗口还需要 `list` 与 `delete` 权限
- 与认证码二选一；配置后通过 `Authorization: Bearer <token>` 请求头传递，优先级高于认证码
- 敏感信息，仅保存在浏览器本地；保存后重新打开弹窗会以掩码（`••••••`）显示，留空保存不会覆盖原值

**上传认证码（`authCode`）** — 可选
- 服务端启用了认证码时填写；与 API Token 二选一
- 未配置 API Token 时，通过 `authCode` 请求头随上传请求发送（上游 `extractAuthCode` 支持请求头；不再拼进 URL，避免被服务端日志留存）
- 认证码改成请求头后，需要服务端为较新版本；如果实例很旧（只读 URL 参数），请先升级图床服务端
- 敏感信息，处理方式同 API Token

**上传渠道（`uploadChannel`）**

| 值 | 说明 |
|----|------|
| `telegram` | Telegram 存储（默认） |
| `cfr2` | CloudFlare R2 |
| `s3` | S3 兼容存储 |
| `discord` | Discord |
| `huggingface` | Hugging Face |
| `webdav` | WebDAV |

> 以上取值与上游 `/upload` 接口的 `uploadChannel` 枚举一致（见 [官方上传 API 文档](https://cfbed.sanyue.de/api/upload.html)）。上游另有 `external`（外链渠道）：它提交的是 `url` 而不是文件，只登记链接、不落存储，因此不放进上传渠道下拉，而是做成独立的「外链收录」入口。

**渠道名称（`channelName`）** — 可选
- 同一渠道配置了多个存储时，指定使用的渠道名称（对应服务端 `channelName` 参数）

**文件命名方式（`uploadNameType`）**

| 值 | 说明 |
|----|------|
| `default` | 默认前缀_原名 |
| `index` | 仅前缀 |
| `origin` | 仅原名 |
| `short` | 短链接 |

**返回格式（`returnFormat`）**

| 值 | 说明 |
|----|------|
| `full` | 完整链接（默认） |
| `default` | 短链接（`/file/id` 格式，扩展会自动补全服务端域名） |

**上传目录（`uploadFolder`）** — 可选
- 留空表示上传到根目录
- 自动规范化：反斜杠转正斜杠、合并多余斜杠、去除首尾斜杠；不允许包含 `..`

**上传超时（`uploadTimeout`）**
- 弹窗中以秒为单位显示，存储为毫秒
- 取值范围 10~300 秒，默认 60 秒；超出范围会自动截断到边界值

**服务端压缩（`serverCompress`）**
- 开启后由服务端压缩图片；仅对 Telegram 渠道有效

**失败自动重试（`autoRetry`）**
- 开启后上传失败自动重试，采用指数退避策略（最多 3 次，间隔 1s/2s/4s）

> **配置版本**：`_version` 字段由扩展自动维护，用于配置迁移，无需手动修改。

### 📦 文件大小限制与分块上传

扩展按上游接口的限制校验文件大小，并对大文件自动启用分块上传（初始化 → 逐块上传 → 合并），无需手动干预。

| 渠道 | 单文件上限 | 传输方式 |
|------|-----------|----------|
| `telegram` | 100MB | ≤8MB 单请求；>8MB 分块（16MB/块） |
| `cfr2` | 100MB | ≤8MB 单请求；>8MB 分块（8MB/块） |
| `s3` | 100MB | ≤8MB 单请求；>8MB 分块（8MB/块） |
| `discord` | 100MB | ≤8MB 单请求；>8MB 分块（8MB/块） |
| `webdav` | 100MB | 单请求（上游不支持 WebDAV 分块） |
| `huggingface` | 20MB | 单请求；≥20MB 需走 HuggingFace 直传，扩展暂不支持 |

说明：

- 100MB 来自 Cloudflare Pages 的请求体限制；自建实例若另有反向代理限制，需按实际情况调整。
- 分块上传过程中会显示「分块上传中 n/N」；中途失败会自动向服务端发送清理请求，避免残留临时分块。
- Discord 免费账号附件上限 10MB、Nitro 25MB，超出时由服务端返回错误，扩展会原样提示。

## 📖 使用方法

### 1. 右键上传图片
- 在任意网页图片上右键
- 选择"上传图片到 ImgBed"
- 等待上传完成，链接自动复制到剪贴板

### 2. 上传剪贴板图片
- 复制图片到剪贴板（截图、复制图片等）
- 在网页任意位置右键，选择"上传剪贴板图片到 ImgBed"
- 或使用快捷键 `Ctrl+Shift+U`（可在 `chrome://extensions/shortcuts` 中修改）

### 3. 拖拽上传
- 直接将图片或任意文件从文件管理器拖拽到网页
- 自动开始上传，多文件依次处理

### 4. 查看配置
- 点击扩展图标查看和修改配置

### 5. 查看上传记录
- 点击配置界面底部的"上传记录"按钮，在独立弹窗中查看最近 200 条记录
- 记录包含文件名、上传来源（右键图片/剪贴板/拖拽/外链收录）、时间与成功或失败原因
- 支持按文件名、链接、错误信息搜索，并按成功/失败筛选
- 每条记录可复制直链、Markdown、BBCode 格式，或在新标签页打开原图
- 支持单条删除与一键清空；已打开的窗口会在新的上传完成后自动刷新

> 记录仅保存在浏览器本地（`chrome.storage.local`），不会同步到其他设备，也不会上传给第三方。

### 6. 外链收录
- 在任意网页图片上右键，选择"以外链方式收录到 ImgBed"
- 只把原图地址登记到图床（上游 `external` 渠道），不下载、不转存文件
- 适合有防盗链保护、或不想重复占用存储的图片；收录后的链接会复制到剪贴板
- 需要实例支持上游的外链渠道（`uploadChannel=external`）

### 7. 管理图床文件
- 点击配置界面底部的"图床文件"按钮，在独立窗口中浏览实例里的文件
- 支持按文件名服务端搜索、分页、复制链接、在新标签页打开与删除（删除需二次确认）
- 管理接口（`/api/manage/*`）要求管理员身份：请填写在 ImgBed 后台创建的、带 `list` 与 `delete` 权限的 API Token；认证码对管理接口无效

## 🔧 故障排除

### ❗ 常见问题及解决方案

#### 🚫 上传相关问题

**问题1：上传失败，提示"Failed to fetch"**
```bash
原因：网络连接问题或API地址错误
解决：
1. 检查API地址格式：https://your-domain.com（不要包含/upload）
2. 确认服务器可正常访问
3. 检查防火墙和代理设置
4. 使用"测试连接"功能验证
```

**问题2：右键上传图片失败，提示403错误**
```bash
原因：目标网站有防盗链保护
解决：
1. 扩展会自动尝试多种方式绕过防盗链
2. 如仍失败，建议先保存图片到本地再上传
3. 或使用拖拽上传功能
```

**问题3：剪贴板上传无响应**
```bash
原因：剪贴板权限或内容问题
解决：
1. 确保剪贴板中包含图片数据
2. 检查浏览器是否允许剪贴板访问权限
3. 尝试重新截图或复制图片
4. 重启浏览器后重试
```

#### 🎛️ 界面和功能问题

**问题4：右键菜单不显示**
```bash
检查清单：
□ 扩展是否已启用
□ 是否在图片元素上右键
□ 刷新页面后重试
□ 检查扩展权限设置
```

**问题5：通知框自动消失**
```bash
解决：最新版本已修复自动关闭问题
如仍出现：
1. 更新到最新版本
2. 重新安装扩展
3. 检查浏览器通知权限
```

**问题6：配置保存失败**
```bash
原因：浏览器存储权限问题
解决：
1. 检查扩展存储权限
2. 清除浏览器缓存后重试
3. 重新安装扩展
```

### 🔍 调试方法

#### 开发者工具调试
```javascript
// 1. 打开开发者工具（F12）
// 2. 切换到Console标签
// 3. 查看错误信息

// 检查扩展状态
chrome.runtime.getManifest()

// 查看存储的配置
chrome.storage.sync.get(null, console.log)

// 手动触发上传测试
// 在content script中执行相关函数
```

#### 网络请求调试
```bash
# 1. 开发者工具 → Network标签
# 2. 执行上传操作
# 3. 查看请求详情：
#    - 请求URL是否正确
#    - 请求头是否包含认证信息
#    - 响应状态码和内容
```

### 🛡️ 权限说明

| 权限 | 用途 | 必需性 |
|------|------|--------|
| `contextMenus` | 创建右键菜单 | 必需 |
| `storage` | 保存用户配置 | 必需 |
| `activeTab` | 访问当前页面 | 必需 |
| `clipboardRead` | 读取剪贴板图片 | 剪贴板上传必需 |
| `notifications` | 显示上传结果 | 可选 |
| `scripting` | 扩展更新后向已打开的标签页补注入内容脚本，免去手动刷新 |
| `host_permissions` | 跨域下载图片 | 右键上传必需 |

### 📞 获取帮助

如果问题仍未解决：

1. **收集信息**
   - 浏览器版本和操作系统
   - 扩展版本号
   - 具体错误信息和复现步骤
   - 开发者工具中的错误日志

2. **联系支持**
   - 提交Issue到项目仓库
   - 包含上述收集的信息
   - 提供配置信息（隐藏敏感数据）

## 📝 版本历史

完整记录见 [CHANGELOG.md](./CHANGELOG.md)，各版本安装包见 [Releases](https://github.com/chwl66/CloudFlare-Imgbed-upload/releases)。当前版本 **v1.9.0** 的主要变化：

- 对照上游 main 分支修正 `/api/channels` 解析，测试连接后按实例实际渠道过滤下拉并给出渠道名候选
- 透传上游错误原因（如 `No R2 channel provided`），不再只提示 `上传失败: 500`
- 新增「外链收录」，对应上游 `external` 渠道
- 支持上传任意文件类型（上游是文件床），拖拽与剪贴板均可
- 新增「图床文件」窗口，接入上游 `/api/manage/list` 与 `/api/manage/delete`
- 认证码改走 `authCode` 请求头，不再出现在 URL 中

## 🚀 路线图

### 计划中的功能
- [ ] 多语言界面
- [ ] 云端配置同步

### 长期规划
- [ ] 支持更多图床服务
- [ ] 图片编辑功能
- [ ] 团队协作功能
- [ ] API接口开放

## 🧪 开发与测试

本项目无需构建，直接在浏览器中「加载已解压的扩展程序」即可调试。仓库内置一个零依赖的冒烟测试，用 Node 启动模拟的上游 `/upload` 接口，覆盖参数拼装、分块上传链路、`publicUrl` 保留与上传记录写入：

```bash
node test/smoke.mjs   # 需要 Node 18+
```

## 🤝 贡献指南

### 参与开发
```bash
# 1. Fork项目
git clone https://github.com/chwl66/CloudFlare-Imgbed-upload.git

# 2. 创建功能分支
git checkout -b feature/new-feature

# 3. 提交更改
git commit -m "Add: 新功能描述"

# 4. 推送分支
git push origin feature/new-feature

# 5. 创建Pull Request
```

### 报告问题
- 使用GitHub Issues报告bug
- 提供详细的复现步骤
- 包含浏览器和扩展版本信息

### 功能建议
- 在Issues中标记为"enhancement"
- 详细描述功能需求和使用场景
- 欢迎提供设计方案或原型

## 📞 支持与反馈

### 获取帮助
- 📖 查看[详细文档](./install.md)
- 🐛 [报告问题](https://github.com/chwl66/CloudFlare-Imgbed-upload/issues)
- 💡 [功能建议](https://github.com/chwl66/CloudFlare-Imgbed-upload/issues/new)
- 📚 服务端问题请查阅上游 [CloudFlare ImgBed 文档](https://cfbed.sanyue.de)

### 相关项目
- 服务端本体：[MarSeventh/CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed)
- Web 前端：[MarSeventh/Sanyue-ImgHub](https://github.com/MarSeventh/Sanyue-ImgHub)

## 📄 许可证

本项目基于 [MIT License](./LICENSE) 开源协议发布。

---

<div align="center">

**⭐ 如果这个项目对您有帮助，请给我们一个Star！**

[🏠 首页](README.md) | [📦 安装指南](install.md) | [🔧 配置说明](#配置指南) | [❓ 常见问题](#故障排除)

</div>