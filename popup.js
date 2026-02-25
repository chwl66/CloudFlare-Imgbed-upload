// 使用公共配置文件中的 DEFAULT_CONFIG、CONFIG_KEYS 和相关函数
// 注意：config.js 需要在 popup.html 中先于 popup.js 加载

// 保存原始配置用于比较
let originalConfig = null;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  bindEvents();
});

// 加载配置
async function loadConfig() {
  try {
    const mergedConfig = await getConfig();
    
    // 保存原始配置
    originalConfig = { ...mergedConfig };
    
    // 使用掩码配置显示敏感信息
    const maskedConfig = getMaskedConfig ? getMaskedConfig(mergedConfig) : mergedConfig;
    
    // 填充表单
    Object.keys(maskedConfig).forEach(key => {
      const element = document.getElementById(key);
      if (element) {
        if (element.type === 'checkbox') {
          element.checked = mergedConfig[key]; // 使用原始值
        } else if (key === 'authCode') {
          // 认证码特殊处理：显示掩码但保留原值标记
          element.value = maskedConfig[key];
          element.dataset.isMasked = 'true';
        } else if (key === 'uploadTimeout') {
          // 超时时间转换为秒显示
          element.value = Math.round((mergedConfig[key] || 60000) / 1000);
        } else {
          element.value = maskedConfig[key];
        }
      }
    });
  } catch (error) {
    showStatus('加载配置失败: ' + error.message, 'error');
  }
}

// 保存配置（表单处理）
async function saveFormConfig() {
  try {
    const config = {};
    
    // 收集表单数据
    CONFIG_KEYS.forEach(key => {
      const element = document.getElementById(key);
      if (element) {
        if (element.type === 'checkbox') {
          config[key] = element.checked;
        } else if (key === 'uploadTimeout') {
          // 超时时间从秒转换为毫秒
          const seconds = parseInt(element.value) || 60;
          config[key] = Math.max(10, Math.min(300, seconds)) * 1000;
        } else {
          config[key] = element.value.trim();
        }
      }
    });
    
    // 兼容未暴露在 UI 的配置项
    if (!Object.prototype.hasOwnProperty.call(config, 'returnFormat')) {
      config.returnFormat = (originalConfig && originalConfig.returnFormat) || DEFAULT_CONFIG.returnFormat;
    }

    // 使用公共验证函数
    const validation = validateConfig(config);
    if (!validation.valid) {
      showStatus(validation.errors[0], 'error');
      return false;
    }
    
    // 使用公共保存函数，传入原始配置用于处理掩码值
    const savedConfig = await saveConfig(config, originalConfig);

    // 使用保存后的规范化配置覆盖本地快照
    originalConfig = { ...originalConfig, ...savedConfig };

    // 更新原始配置（如果认证码被修改了）
    const authCodeElement = document.getElementById('authCode');
    if (authCodeElement && !isMaskedValue(config.authCode)) {
      originalConfig.authCode = config.authCode;
    }
    
    showStatus('配置已保存！', 'success');
    
    return true;
  } catch (error) {
    showStatus('保存配置失败: ' + error.message, 'error');
    return false;
  }
}

// 测试连接（改进版本）
async function testConnection() {
  const apiUrlInput = document.getElementById('apiUrl').value.trim();
  const authCodeInput = document.getElementById('authCode').value.trim();

  const apiUrl = typeof normalizeApiUrlValue === 'function' ? normalizeApiUrlValue(apiUrlInput) : apiUrlInput;
  let authCode = authCodeInput;

  // 认证码掩码值恢复为原始值，避免测试连接误用掩码字符
  if (isMaskedValue(authCodeInput) && originalConfig && originalConfig.authCode) {
    authCode = originalConfig.authCode;
  }

  if (!apiUrl) {
    showStatus('请先填写 API 地址！', 'error');
    return;
  }

  if (typeof isInvalidApiHost === 'function' && isInvalidApiHost(apiUrl)) {
    showStatus('请填写真实 API 地址，不能使用示例域名！', 'error');
    return;
  }

  try {
    showStatus('正在测试连接...', 'info');
    hideUploadProgress();

    // 首先尝试简单的健康检查
    const healthCheckUrl = `${apiUrl.replace(/\/$/, '')}/health`;
    try {
      const healthResponse = await fetchWithTimeout(healthCheckUrl, {
        method: 'HEAD',
        headers: authCode ? { 'Authorization': `Bearer ${authCode}` } : {}
      }, CONSTANTS.TEST_TIMEOUT);

      if (healthResponse.ok) {
        showStatus('连接测试成功！', 'success');
        return;
      }
    } catch (healthError) {
      console.log('健康检查失败，尝试上传测试:', healthError.message);
    }

    // 如果健康检查失败，进行上传测试
    await performUploadTest(apiUrl, authCode);

  } catch (error) {
    const friendlyMessage = getFriendlyErrorMessage(error);
    showStatus(`连接测试失败: ${friendlyMessage}`, 'error');
  }
}

// 执行上传测试
async function performUploadTest(apiUrl, authCode) {
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
  
  // 使用带超时的 fetch
  const uploadResponse = await fetchWithTimeout(uploadUrl, {
    method: 'POST',
    body: formData
  }, CONSTANTS.TEST_TIMEOUT);
  
  if (uploadResponse.ok) {
    const result = await uploadResponse.json();
    if (result && result.length > 0 && result[0].src) {
      showStatus('连接测试成功！', 'success');
    } else {
      showStatus('连接成功，但返回格式异常', 'error');
    }
  } else {
    const friendlyMessage = getFriendlyErrorMessage(null, uploadResponse.status);
    showStatus(`连接失败: ${friendlyMessage}`, 'error');
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

// 隐藏上传进度
function hideUploadProgress() {
  const progressElement = document.getElementById('uploadProgress');
  if (progressElement) {
    progressElement.style.display = 'none';
  }
}

// 显示上传进度
function showUploadProgress(text, percent = 0) {
  const progressElement = document.getElementById('uploadProgress');
  const progressText = document.getElementById('progressText');
  const progressPercent = document.getElementById('progressPercent');
  const progressFill = document.getElementById('progressFill');
  
  if (progressElement) {
    progressElement.style.display = 'block';
    if (progressText) progressText.textContent = text;
    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (progressFill) progressFill.style.width = `${percent}%`;
  }
}

// 绑定事件
function bindEvents() {
  // 表单提交
  document.getElementById('configForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveFormConfig();
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
      
      // 认证码输入框获得焦点时，如果是掩码值则清空
      if (input.id === 'authCode' && input.dataset.isMasked === 'true') {
        input.value = '';
        input.dataset.isMasked = 'false';
        input.placeholder = '输入新认证码（留空保持原值）';
      }
    });
    
    // 认证码输入框失焦时，如果为空则恢复掩码显示
    if (input.id === 'authCode') {
      input.addEventListener('blur', () => {
        if (input.value === '' && originalConfig && originalConfig.authCode) {
          input.value = AUTH_CODE_MASK_MARKER;
          input.dataset.isMasked = 'true';
          input.placeholder = '输入认证码（如果需要）';
        }
      });
    }
    
    // 实时验证输入
    input.addEventListener('input', () => {
      if (input.id === 'apiUrl') {
        validateApiUrlInput(input);
      }
    });
  });
}

// 验证API地址输入
function validateApiUrlInput(input) {
  const value = input.value.trim();
  if (!value) {
    input.style.borderColor = '#ddd';
    return;
  }
  
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      input.style.borderColor = '#ef4444';
    } else {
      input.style.borderColor = '#10b981';
    }
  } catch {
    input.style.borderColor = '#ef4444';
  }
}