// 默认配置
const DEFAULT_CONFIG = {
  apiUrl: 'https://your.domain',
  authCode: '',
  serverCompress: true,
  uploadChannel: 'telegram',
  autoRetry: true,
  uploadNameType: 'default',
  uploadFolder: ''
};

// 初始化扩展
chrome.runtime.onInstalled.addListener(async () => {
  // 初始化配置
  const config = await chrome.storage.sync.get(Object.keys(DEFAULT_CONFIG));
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  await chrome.storage.sync.set(mergedConfig);
  
  // 创建右键菜单
  createContextMenus();
});

// 创建右键菜单
function createContextMenus() {
  // 清除现有菜单
  chrome.contextMenus.removeAll(() => {
    // 图片右键菜单
    chrome.contextMenus.create({
      id: 'upload-image',
      title: '上传图片到 ImgBed',
      contexts: ['image']
    });
    
    // 页面右键菜单 - 上传剪贴板图片
    chrome.contextMenus.create({
      id: 'upload-clipboard',
      title: '上传剪贴板图片到 ImgBed',
      contexts: ['page']
    });
    
    // 分隔符
    chrome.contextMenus.create({
      id: 'separator',
      type: 'separator',
      contexts: ['page', 'image']
    });
    
    // 配置菜单
    chrome.contextMenus.create({
      id: 'open-config',
      title: 'ImgBed 配置',
      contexts: ['page', 'image']
    });
  });
}

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case 'upload-image':
      // 上传图片
      chrome.tabs.sendMessage(tab.id, {
        action: 'uploadImage',
        imageUrl: info.srcUrl
      });
      break;
      
    case 'upload-clipboard':
      // 上传剪贴板图片
      chrome.tabs.sendMessage(tab.id, {
        action: 'uploadClipboard'
      });
      break;
      
    case 'open-config':
      // 打开配置页面
      chrome.action.openPopup();
      break;
  }
});

// 处理来自 content script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'uploadFile') {
    // 使用立即返回的方式处理异步操作
    (async () => {
      try {
        const result = await uploadFile(request.fileData, request.fileName);
        sendResponse({ success: true, result });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // 保持消息通道开放
  }
  

  
  if (request.action === 'copyToClipboard') {
    // 通过 content script 复制到剪贴板
    chrome.tabs.sendMessage(sender.tab.id, {
      action: 'copyText',
      text: request.text
    });
    return false; // 同步操作，不需要保持通道
  }
});

// 简化的上传文件函数
async function uploadFile(fileData, fileName) {
  const config = await chrome.storage.sync.get(Object.keys(DEFAULT_CONFIG));
  
  if (!config.apiUrl) {
    throw new Error('请先配置 API 地址！');
  }
  
  // 构建查询参数
  const params = new URLSearchParams({
    serverCompress: config.serverCompress,
    uploadChannel: config.uploadChannel,
    autoRetry: config.autoRetry,
    uploadNameType: config.uploadNameType,
    returnFormat: 'full'  // 强制使用完整链接格式
  });
  
  // 只有当认证码不为空时才添加
  if (config.authCode && config.authCode.trim()) {
    params.append('authCode', config.authCode);
  }
  
  if (config.uploadFolder) {
    params.append('uploadFolder', config.uploadFolder);
  }
  
  const uploadUrl = `${config.apiUrl.replace(/\/$/, '')}/upload?${params.toString()}`;
  
  // 将 base64 转换为 blob
  const response = await fetch(fileData);
  const blob = await response.blob();
  
  const formData = new FormData();
  formData.append('file', blob, fileName);
  
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    body: formData
  });
  
  if (!uploadResponse.ok) {
    throw new Error(`上传失败: ${uploadResponse.status} ${uploadResponse.statusText}`);
  }
  
  const result = await uploadResponse.json();
  
  if (!result || !result.length || !result[0].src) {
    throw new Error('服务器返回格式错误');
  }
  
  let imageUrl = result[0].src;
  
  // 如果返回的是相对路径，添加域名
  if (imageUrl.startsWith('/')) {
    imageUrl = config.apiUrl.replace(/\/$/, '') + imageUrl;
  } else {
    // 强制域名替换：如果返回链接的域名与配置项中的域名不一致，替换为配置项中的域名
    try {
      const configUrl = new URL(config.apiUrl);
      const returnUrl = new URL(imageUrl);
      
      // 如果域名不一致，替换为配置项中的域名
      if (returnUrl.hostname !== configUrl.hostname) {
        returnUrl.protocol = configUrl.protocol;
        returnUrl.hostname = configUrl.hostname;
        returnUrl.port = configUrl.port;
        imageUrl = returnUrl.toString();
        console.log('域名已替换为配置项中的域名:', imageUrl);
      }
    } catch (error) {
      console.warn('域名替换失败:', error);
      // 如果URL解析失败，保持原链接
    }
  }
  
  return {
    url: imageUrl,
    formatted: imageUrl  // 直接返回完整链接，不进行格式化
  };
}

