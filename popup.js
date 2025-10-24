import { DEFAULT_CONFIG } from './utils/constants.js';
import { getConfig } from './utils/config.js';
import { buildUploadUrl } from './utils/api.js';

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  bindEvents();
});

// 加载配置
async function loadConfig() {
  try {
    const mergedConfig = await getConfig();
    
    // 填充表单
    Object.keys(mergedConfig).forEach(key => {
      const element = document.getElementById(key);
      if (element) {
        if (element.type === 'checkbox') {
          element.checked = mergedConfig[key];
        } else {
          element.value = mergedConfig[key];
        }
      }
    });
  } catch (error) {
    showStatus('加载配置失败: ' + error.message, 'error');
  }
}

// 保存配置
async function saveConfig() {
  try {
    const config = {};
    
    // 收集表单数据
    Object.keys(DEFAULT_CONFIG).forEach(key => {
      const element = document.getElementById(key);
      if (element) {
        if (element.type === 'checkbox') {
          config[key] = element.checked;
        } else {
          config[key] = element.value.trim();
        }
      }
    });
    
    // 验证必填项
    if (!config.apiUrl) {
      showStatus('请输入 API 地址！', 'error');
      return false;
    }
    
    // 验证 URL 格式
    try {
      new URL(config.apiUrl);
    } catch {
      showStatus('API 地址格式不正确！', 'error');
      return false;
    }
    
    // 保存配置
    await chrome.storage.sync.set(config);
    showStatus('配置已保存！', 'success');
    
    return true;
  } catch (error) {
    showStatus('保存配置失败: ' + error.message, 'error');
    return false;
  }
}

// 测试连接
async function testConnection() {
  const apiUrl = document.getElementById('apiUrl').value.trim();
  if (!apiUrl) {
    showStatus('请先填写 API 地址！', 'error');
    return;
  }
  
  try {
    showStatus('正在测试连接...', 'info');
    
    // 创建一个测试用的小图片 (1x1 像素的透明 PNG)
    const testImageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    
    const response = await fetch(testImageData);
    const blob = await response.blob();
    
    const formData = new FormData();
    formData.append('file', blob, 'test.png');
    
    // 从表单收集当前配置
    const currentConfig = {};
    Object.keys(DEFAULT_CONFIG).forEach(key => {
      const element = document.getElementById(key);
      if (element) {
        if (element.type === 'checkbox') {
          currentConfig[key] = element.checked;
        } else {
          currentConfig[key] = element.value.trim();
        }
      }
    });
    
    const uploadUrl = await buildUploadUrl(
      { uploadNameType: 'short' }, // 额外参数
      currentConfig // 覆盖配置
    );
    
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      body: formData
    });
    
    if (uploadResponse.ok) {
      const result = await uploadResponse.json();
      if (result && result.length > 0 && result[0].src) {
        showStatus('连接测试成功！', 'success');
      } else {
        showStatus('连接成功，但返回格式异常', 'error');
      }
    } else {
      const errorText = await uploadResponse.text();
      showStatus(`连接失败: ${uploadResponse.status} ${uploadResponse.statusText}`, 'error');
    }
    
  } catch (error) {
    showStatus(`连接测试失败: ${error.message}`, 'error');
  }
}

// 显示状态消息
function showStatus(message, type = 'info') {
  const statusElement = document.getElementById('status');
  statusElement.textContent = message;
  statusElement.className = `status ${type}`;
  statusElement.style.display = 'block';
  
  // 3秒后自动隐藏成功消息
  if (type === 'success') {
    setTimeout(() => {
      statusElement.style.display = 'none';
    }, 3000);
  }
}

// 绑定事件
function bindEvents() {
  // 表单提交
  document.getElementById('configForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveConfig();
  });
  
  // 测试连接按钮
  document.getElementById('testBtn').addEventListener('click', async () => {
    await testConnection();
  });
  
  // 输入框失焦时隐藏错误消息
  const inputs = document.querySelectorAll('input, select');
  inputs.forEach(input => {
    input.addEventListener('focus', () => {
      const statusElement = document.getElementById('status');
      if (statusElement.classList.contains('error')) {
        statusElement.style.display = 'none';
      }
    });
  });
}