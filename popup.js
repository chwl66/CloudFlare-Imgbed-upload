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

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  bindEvents();
});

// 加载配置
async function loadConfig() {
  try {
    const config = await chrome.storage.sync.get(Object.keys(DEFAULT_CONFIG));
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    
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
  const authCode = document.getElementById('authCode').value.trim();
  
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
    
    const uploadChannel = document.getElementById('uploadChannel').value;
    const params = new URLSearchParams({
      uploadChannel: uploadChannel,
      uploadNameType: 'short' // 使用短链接避免文件名冲突
    });
    
    // 只有当认证码不为空时才添加
    if (authCode) {
      params.append('authCode', authCode);
    }
    
    const uploadUrl = `${apiUrl.replace(/\/$/, '')}/upload?${params.toString()}`;
    
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