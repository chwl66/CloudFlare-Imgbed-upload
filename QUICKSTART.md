# 🚀 快速开始指南

## 5分钟快速安装

### 1️⃣ 下载扩展
```bash
# 下载并解压到本地目录
git clone https://github.com/your-repo/cloudflare-imgbed-uploader.git
# 或直接下载ZIP文件解压
```

### 2️⃣ 安装到浏览器
```
1. 打开浏览器扩展页面：edge://extensions/
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 image-up 文件夹
```

### 3️⃣ 配置服务
```
1. 点击扩展图标 📷
2. 填写API地址：https://your-domain.com
3. 填写认证码（如果需要）
4. 点击"测试连接" → "保存配置"
```

### 4️⃣ 开始使用
```
✅ 右键图片 → "上传图片到 ImgBed"
✅ 截图后右键 → "上传剪贴板图片"
✅ 拖拽图片文件到网页
✅ 快捷键：Ctrl+Shift+U
```

## 🎯 核心功能

| 功能 | 操作方式 | 说明 |
|------|----------|------|
| 🖼️ 右键上传 | 图片右键菜单 | 上传网页中的图片 |
| 📋 剪贴板上传 | Ctrl+Shift+U | 上传截图或复制的图片 |
| 📁 拖拽上传 | 拖拽文件到网页 | 上传本地图片文件 |
| 📝 多格式复制 | 点击通知中的链接 | 直链/Markdown/BBCode |

## ⚡ 常用配置

### 个人使用
```json
{
  "apiUrl": "https://img.yourdomain.com",
  "uploadChannel": "telegram",
  "uploadNameType": "default",
  "autoRetry": true
}
```

### 团队使用
```json
{
  "apiUrl": "https://team-img.company.com", 
  "uploadChannel": "cfr2",
  "uploadNameType": "short",
  "uploadFolder": "team/assets"
}
```

## 🔧 快速故障排除

| 问题 | 解决方案 |
|------|----------|
| 右键菜单不显示 | 刷新页面，确保扩展已启用 |
| 上传失败 | 检查API地址和网络连接 |
| 测试连接失败 | 确认地址格式：https://domain.com |
| 剪贴板上传无效 | 确保剪贴板中有图片数据 |
| 通知不显示 | 检查浏览器通知权限 |

## 📞 需要帮助？

- 📖 [完整文档](README.md)
- 🔧 [详细安装指南](install.md)
- 🐛 [报告问题](https://github.com/your-repo/issues)

---

**🎉 安装完成！现在就可以开始使用便捷的图片上传功能了！**