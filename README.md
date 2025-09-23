# CloudFlare ImgBed 上传器 - 浏览器扩展

一个功能强大的浏览器扩展，支持多种方式上传图片到 CloudFlare ImgBed 图床，提供便捷的图片管理解决方案。

## ✨ 核心特性

### 🖱️ 多种上传方式
- **右键菜单上传**：在任意网页图片上右键，一键上传到图床
- **剪贴板上传**：支持截图、复制图片后直接上传，快捷键 `Ctrl+Shift+U`
- **拖拽上传**：将本地图片文件直接拖拽到网页即可上传
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

### ⚙️ 丰富配置选项
- **API服务配置**：支持自定义CloudFlare ImgBed服务地址
- **认证管理**：可选的上传认证码配置，支持私有部署
- **存储渠道**：支持Telegram、CloudFlare R2、S3多种存储后端
- **文件命名**：4种命名策略（默认前缀_原名、仅前缀、仅原名、短链接）
- **目录管理**：支持自定义上传目录，便于文件分类
- **智能重试**：上传失败时自动切换渠道重试
- **压缩优化**：Telegram渠道支持服务端图片压缩

### 🔒 安全与兼容性
- **权限最小化**：仅请求必要的浏览器权限
- **跨域支持**：智能处理各种网站的防盗链保护
- **多浏览器支持**：兼容Edge、Chrome等Chromium内核浏览器
- **隐私保护**：所有配置信息本地存储，不上传到第三方服务器

## 📦 安装指南

### 🎯 快速安装（推荐）

#### 步骤1：获取扩展文件
```bash
# 方式1：Git克隆
git clone https://github.com/your-repo/cloudflare-imgbed-uploader.git
cd cloudflare-imgbed-uploader/image-up

# 方式2：直接下载
# 下载ZIP文件并解压到本地目录
```

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
   - 选择下载的 `image-up` 文件夹
   - 点击"选择文件夹"确认

4. **验证安装**
   - 扩展出现在列表中，状态为"已启用"
   - 浏览器工具栏显示扩展图标 📷
   - 右键网页应显示相关菜单项

### 🔧 高级安装选项

#### 打包安装（适用于团队部署）
```bash
# 1. 在扩展管理页面点击"打包扩展程序"
# 2. 选择 image-up 文件夹
# 3. 生成 .crx 和 .pem 文件
# 4. 分发 .crx 文件给团队成员安装
```

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
   方式2：右键网页 → "ImgBed 配置"
   方式3：扩展管理页面 → 扩展详情 → 选项
   ```

2. **填写服务信息**
   ```
   API 地址：https://your-imgbed-domain.com
   认证码：your-auth-code（可选，取决于服务配置）
   ```

3. **验证连接**
   - 点击"测试连接"按钮
   - 等待显示"连接测试成功！"
   - 如果失败，检查地址和认证码是否正确

#### 高级配置（可选）
```yaml
存储配置:
  上传渠道: telegram | cfr2 | s3
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
  "authCode": "your-personal-token",
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
  "uploadNameType": "short",
  "uploadFolder": "team/assets",
  "serverCompress": false,
  "autoRetry": true
}
```

### 配置项详解

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| API 地址 | CloudFlare ImgBed 服务地址 | https://your.domain |
| 上传认证码 | 身份验证码 | 无 |
| 上传渠道 | 存储后端选择 | telegram |
| 文件命名方式 | 文件名格式 | default |
| 返回格式 | 链接格式 | default |
| 上传目录 | 目标目录 | 空（根目录） |
| 复制格式 | 剪贴板格式 | markdown |
| 服务端压缩 | Telegram 图片压缩 | 开启 |
| 自动重试 | 失败重试 | 开启 |
| 自动复制 | 自动复制链接 | 开启 |
| 显示通知 | 通知提醒 | 开启 |

## 📖 使用方法

### 1. 右键上传图片
- 在任意网页图片上右键
- 选择"上传图片到 ImgBed"
- 等待上传完成，链接自动复制到剪贴板

### 2. 上传剪贴板图片
- 复制图片到剪贴板（截图、复制图片等）
- 在网页任意位置右键，选择"上传剪贴板图片到 ImgBed"
- 或使用快捷键 `Ctrl+Shift+U`

### 3. 拖拽上传
- 直接将图片文件从文件管理器拖拽到网页
- 自动开始上传

### 4. 查看配置
- 点击扩展图标查看和修改配置
- 右键菜单中也有"ImgBed 配置"选项

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

### v1.2.0 (最新) - 2024/01/15
```diff
+ 新增：智能防盗链绕过机制
+ 新增：多重fallback上传策略
+ 优化：通知框UI设计，支持多格式显示
+ 优化：链接截断显示，悬停查看完整内容
+ 修复：通知框自动关闭问题
+ 修复：跨域图片上传失败问题
+ 改进：错误提示更加友好和详细
```

### v1.1.0 - 2024/01/01
```diff
+ 新增：拖拽上传功能
+ 新增：多种复制格式支持
+ 新增：上传进度显示
+ 优化：配置界面UI设计
+ 修复：部分网站兼容性问题
```

### v1.0.0 - 2023/12/15
```diff
+ 初始版本发布
+ 支持右键菜单上传
+ 支持剪贴板上传
+ 基础配置管理界面
+ 多渠道存储支持
```

## 🚀 路线图

### 计划中的功能
- [ ] 批量上传支持
- [ ] 上传历史记录
- [ ] 图片压缩选项
- [ ] 自定义快捷键
- [ ] 暗色主题支持
- [ ] 多语言界面
- [ ] 云端配置同步

### 长期规划
- [ ] 支持更多图床服务
- [ ] 图片编辑功能
- [ ] 团队协作功能
- [ ] API接口开放

## 🤝 贡献指南

### 参与开发
```bash
# 1. Fork项目
git clone https://github.com/your-username/cloudflare-imgbed-uploader.git

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
- 🐛 [报告问题](https://github.com/your-repo/issues)
- 💡 [功能建议](https://github.com/your-repo/issues/new?template=feature_request.md)
- 📧 邮件支持：support@your-domain.com

### 社区交流
- 💬 QQ群：123456789
- 📱 微信群：扫码加入
- 🌐 官方网站：https://your-website.com

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源协议发布。

```
MIT License

Copyright (c) 2024 CloudFlare ImgBed Uploader

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

---

<div align="center">

**⭐ 如果这个项目对您有帮助，请给我们一个Star！**

[🏠 首页](README.md) | [📦 安装指南](install.md) | [🔧 配置说明](#配置指南) | [❓ 常见问题](#故障排除)

</div>