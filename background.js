import { DEFAULT_CONFIG } from './utils/constants.js';
import { getConfig } from './utils/config.js';
import { buildUploadUrl } from './utils/api.js';

// 初始化扩展
chrome.runtime.onInstalled.addListener(async () => {
  // 初始化配置
  const config = await getConfig();
  await chrome.storage.sync.set(config);
  
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
  
  if (request.action === 'uploadImageUrl') {
    // 通过 background script 获取跨域图片
    (async () => {
      try {
        const result = await uploadImageFromUrl(request.imageUrl, request.fileName);
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
  const uploadUrl = await buildUploadUrl();
  
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
  const config = await getConfig();
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

// 通过 background script 获取跨域图片并上传
async function uploadImageFromUrl(imageUrl, fileName) {
  try {
    // 尝试多种请求头配置来绕过防盗链
    const requestOptions = [
      // 第一次尝试：模拟浏览器请求
      {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': new URL(imageUrl).origin,
          'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      },
      // 第二次尝试：简化请求头
      {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'image/*,*/*;q=0.8'
        }
      },
      // 第三次尝试：最基本的请求
      {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ImageUploader/1.0)'
        }
      }
    ];
    
    let lastError;
    
    // 依次尝试不同的请求配置
    for (let i = 0; i < requestOptions.length; i++) {
      try {
        console.log(`尝试获取图片 (方式 ${i + 1}):`, imageUrl);
        const response = await fetch(imageUrl, requestOptions[i]);
        
        if (response.ok) {
          const blob = await response.blob();
          
          // 检查是否真的是图片
          if (!blob.type.startsWith('image/')) {
            throw new Error(`响应不是图片格式: ${blob.type}`);
          }
          
          // 转换为 base64
          const arrayBuffer = await blob.arrayBuffer();
          const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
          const mimeType = blob.type || 'image/jpeg';
          const dataUrl = `data:${mimeType};base64,${base64}`;
          
          console.log('图片获取成功，开始上传...');
          // 调用现有的上传函数
          return await uploadFile(dataUrl, fileName);
        } else {
          lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
          console.log(`方式 ${i + 1} 失败:`, lastError.message);
        }
      } catch (error) {
        lastError = error;
        console.log(`方式 ${i + 1} 异常:`, error.message);
      }
    }
    
    // 所有方式都失败了
    throw lastError || new Error('所有获取方式都失败了');
    
  } catch (error) {
    throw new Error(`跨域图片上传失败: ${error.message}`);
  }
}

