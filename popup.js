// 使用公共配置文件中的 DEFAULT_CONFIG、CONFIG_KEYS 和相关函数
// 注意：config.js 需要在 popup.html 中先于 popup.js 加载

// 保存原始配置用于比较
let originalConfig = null;

// 上传记录弹窗
const HISTORY_PAGE = 'history.html';
const HISTORY_WINDOW_ID_KEY = '_historyWindowId';
const HISTORY_WINDOW_WIDTH = 780;
const HISTORY_WINDOW_HEIGHT = 840;

// 图床文件管理弹窗
const MANAGE_PAGE = 'manage.html';
const MANAGE_WINDOW_ID_KEY = '_manageWindowId';
const MANAGE_WINDOW_WIDTH = 900;
const MANAGE_WINDOW_HEIGHT = 860;

// 最近一次测试连接拿到的渠道分组（用于渠道名称候选与可用渠道过滤）
const CHANNEL_GROUPS_KEY = '_channelGroups';
let channelGroups = null;

// 渠道显示名称
const CHANNEL_LABELS = {
  telegram: 'Telegram',
  cfr2: 'CloudFlare R2',
  s3: 'S3',
  discord: 'Discord',
  huggingface: 'Hugging Face',
  webdav: 'WebDAV'
};

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
    const maskedConfig = getMaskedConfig(mergedConfig);
    
    // 填充表单
    Object.keys(maskedConfig).forEach(key => {
      const element = document.getElementById(key);
      if (element) {
        if (element.type === 'checkbox') {
          element.checked = mergedConfig[key]; // 使用原始值
        } else if (SENSITIVE_CONFIG_KEYS.includes(key)) {
          // 敏感字段（认证码 / API Token）特殊处理：显示掩码但保留原值标记
          element.value = maskedConfig[key];
          element.dataset.isMasked = 'true';
        } else if (key === 'uploadTimeout') {
          // 超时时间转换为秒显示
          element.value = Math.round((mergedConfig[key] ?? DEFAULT_CONFIG.uploadTimeout) / 1000);
        } else {
          element.value = maskedConfig[key];
        }
      }
    });

    // 恢复上次测试连接拿到的渠道列表，保证重新打开弹窗仍能展示可选渠道
    await restoreChannelGroups();
  } catch (error) {
    showStatus('加载配置失败: ' + error.message, 'error');
  }
}

/**
 * 从 session 存储恢复渠道分组
 * @returns {Promise<void>}
 */
async function restoreChannelGroups() {
  try {
    const data = await chrome.storage.session.get(CHANNEL_GROUPS_KEY);
    const cached = data?.[CHANNEL_GROUPS_KEY];
    if (!cached || typeof cached !== 'object' || countChannelGroups(cached) === 0) return;

    channelGroups = cached;
    applyChannelGroups(channelGroups);
  } catch {
    // session 存储不可用时不做任何处理
  }
}

/**
 * 缓存渠道分组（仅当前浏览器会话）
 * @param {Object<string, string[]>} groups - 渠道分组
 * @returns {Promise<void>}
 */
async function rememberChannelGroups(groups) {
  try {
    await chrome.storage.session.set({ [CHANNEL_GROUPS_KEY]: groups });
  } catch (error) {
    console.warn('保存渠道列表失败:', error.message);
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
          const defaultTimeoutSeconds = Math.floor(DEFAULT_CONFIG.uploadTimeout / 1000);
          const seconds = parseInt(element.value, 10) || defaultTimeoutSeconds;
          const minTimeoutSeconds = Math.floor(UPLOAD_TIMEOUT_MIN / 1000);
          const maxTimeoutSeconds = Math.floor(UPLOAD_TIMEOUT_MAX / 1000);
          config[key] = Math.max(minTimeoutSeconds, Math.min(maxTimeoutSeconds, seconds)) * 1000;
        } else {
          config[key] = element.value.trim();
        }
      }
    });
    
    // 兼容未暴露在 UI 的配置项
    if (!Object.prototype.hasOwnProperty.call(config, 'returnFormat')) {
      config.returnFormat = originalConfig?.returnFormat ?? DEFAULT_CONFIG.returnFormat;
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

    // 更新原始配置（如果敏感字段被修改了）
    SENSITIVE_CONFIG_KEYS.forEach(key => {
      const element = document.getElementById(key);
      if (element && !isMaskedValue(config[key])) {
        originalConfig[key] = config[key];
      }
    });
    
    showStatus('配置已保存！', 'success');
    
    return true;
  } catch (error) {
    showStatus('保存配置失败: ' + error.message, 'error');
    return false;
  }
}

// 测试连接（非破坏性：不会向图床写入测试文件）
async function testConnection() {
  const apiUrlInput = document.getElementById('apiUrl').value.trim();
  const authCodeInput = document.getElementById('authCode').value.trim();
  const apiTokenInput = document.getElementById('apiToken').value.trim();

  const apiUrl = normalizeApiUrlValue(apiUrlInput);
  let authCode = authCodeInput;
  let apiToken = apiTokenInput;

  // 掩码值恢复为原始值，避免测试连接误用掩码字符
  if (isMaskedValue(authCodeInput)) {
    authCode = originalConfig?.authCode ?? DEFAULT_CONFIG.authCode;
  }
  if (isMaskedValue(apiTokenInput)) {
    apiToken = originalConfig?.apiToken ?? DEFAULT_CONFIG.apiToken;
  }

  if (!apiUrl) {
    showStatus('请先填写 API 地址！', 'error');
    return;
  }

  try {
    showStatus('正在测试连接...', 'info');
    hideUploadProgress();

    // 优先用 /api/channels：既能验证认证，又能拿到渠道名称候选
    const channelResult = await fetchChannelList(apiUrl, apiToken, authCode);

    if (channelResult.ok) {
      channelGroups = channelResult.groups;
      applyChannelGroups(channelGroups);
      await rememberChannelGroups(channelGroups);

      const total = countChannelGroups(channelGroups);
      if (total > 0) {
        const summary = Object.entries(channelGroups)
          .filter(([, names]) => names.length > 0)
          .map(([channel, names]) => `${CHANNEL_LABELS[channel] || channel} ${names.length}`)
          .join(' / ');

        const selected = document.getElementById('uploadChannel')?.value || '';
        const selectedNames = channelGroups[selected];
        const selectedMissing = Array.isArray(selectedNames) && selectedNames.length === 0;

        showStatus(
          selectedMissing
            ? `连接成功：${summary}；当前渠道 ${CHANNEL_LABELS[selected] || selected} 未在该实例配置`
            : `连接成功：${summary}`,
          selectedMissing ? 'info' : 'success'
        );
      } else {
        showStatus('连接成功，但该实例没有启用任何上传渠道', 'info');
      }
      return;
    }

    if (channelResult.status === 401 || channelResult.status === 403) {
      showStatus(`连接失败: ${getFriendlyErrorMessage(null, channelResult.status)}`, 'error');
      return;
    }

    // 实例未提供 /api/channels 时退回根路径探测，不写入任何数据
    const reachable = await probeApiReachable(apiUrl);
    if (reachable) {
      showStatus('地址可达，但该实例未提供渠道接口，未能验证上传权限', 'info');
    } else {
      showStatus('连接失败：无法访问该地址，请检查地址与网络', 'error');
    }
  } catch (error) {
    const friendlyMessage = getFriendlyErrorMessage(error);
    showStatus(`连接测试失败: ${friendlyMessage}`, 'error');
  }
}

/**
 * 获取实例可用渠道列表
 * @returns {Promise<{ok: boolean, status?: number, groups?: Object<string, string[]>}>}
 */
async function fetchChannelList(apiUrl, apiToken, authCode) {
  const baseUrl = apiUrl.replace(/\/$/, '');
  const headers = {};

  if (apiToken) {
    headers['Authorization'] = `Bearer ${apiToken}`;
  }
  if (authCode) {
    headers['authCode'] = authCode;
  }

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/api/channels`,
      { method: 'GET', headers },
      CONSTANTS.TEST_TIMEOUT
    );

    if (!response.ok) {
      return { ok: false, status: response.status };
    }

    const data = await response.json();
    return { ok: true, groups: parseChannelGroups(data) };
  } catch (error) {
    return { ok: false, status: 0 };
  }
}

/**
 * 按实例实际配置更新渠道下拉与渠道名称候选
 * @param {Object<string, string[]>} groups - 渠道类型 -> 渠道名称
 * @returns {void}
 */
function applyChannelGroups(groups) {
  const total = countChannelGroups(groups);
  const select = document.getElementById('uploadChannel');

  if (select) {
    Array.from(select.options).forEach(option => {
      // 只有响应里明确给出该渠道、且渠道列表为空时才禁用；响应未提及的渠道不做限制
      const names = groups ? groups[option.value] : undefined;
      const unavailable = total > 0 && Array.isArray(names) && names.length === 0;
      const label = CHANNEL_LABELS[option.value] || option.value;

      option.disabled = unavailable;
      option.textContent = unavailable ? `${label}（未配置）` : label;
    });
  }

  refreshChannelOptions();
}

/**
 * 按当前选中的渠道刷新「渠道名称」候选
 * @returns {void}
 */
function refreshChannelOptions() {
  const select = document.getElementById('uploadChannel');
  const names = channelGroups && select ? channelGroups[select.value] || [] : [];

  fillChannelOptions(names);

  const input = document.getElementById('channelName');
  if (input) {
    input.placeholder = names.length > 1
      ? `该渠道有 ${names.length} 个配置：${names.join(' / ')}`
      : '多渠道时指定，如 r2-main';
  }
}

/**
 * 探测服务地址是否可达（只发 HEAD，不写入数据）
 */
async function probeApiReachable(apiUrl) {
  try {
    const response = await fetchWithTimeout(
      `${apiUrl.replace(/\/$/, '')}/`,
      { method: 'HEAD' },
      CONSTANTS.TEST_TIMEOUT
    );
    return response.ok || response.status < 500;
  } catch (error) {
    return false;
  }
}

/**
 * 填充渠道名称候选
 */
function fillChannelOptions(names) {
  const datalist = document.getElementById('channelOptions');
  if (!datalist) return;

  datalist.innerHTML = '';
  names.forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    datalist.appendChild(option);
  });
}

// 打开上传记录弹窗（已打开时聚焦已有窗口）
async function openHistoryWindow() {
  await openExtensionWindow({
    page: HISTORY_PAGE,
    windowIdKey: HISTORY_WINDOW_ID_KEY,
    width: HISTORY_WINDOW_WIDTH,
    height: HISTORY_WINDOW_HEIGHT,
    errorPrefix: '打开上传记录失败: '
  });
}

// 打开图床文件管理弹窗（已打开时聚焦已有窗口）
async function openManageWindow() {
  await openExtensionWindow({
    page: MANAGE_PAGE,
    windowIdKey: MANAGE_WINDOW_ID_KEY,
    width: MANAGE_WINDOW_WIDTH,
    height: MANAGE_WINDOW_HEIGHT,
    errorPrefix: '打开图床文件失败: '
  });
}

/**
 * 打开扩展内页面窗口，已存在时聚焦
 * @param {Object} options - 窗口参数
 * @returns {Promise<void>}
 */
async function openExtensionWindow({ page, windowIdKey, width, height, errorPrefix }) {
  const windowId = await readWindowId(windowIdKey);

  if (typeof windowId === 'number') {
    try {
      await chrome.windows.update(windowId, { focused: true });
      return;
    } catch {
      // 记录中的窗口已被关闭，重新打开新窗口
    }
  }

  try {
    const created = await chrome.windows.create({
      url: chrome.runtime.getURL(page),
      type: 'popup',
      width,
      height
    });
    await rememberWindowId(windowIdKey, created?.id);
  } catch (error) {
    showStatus(errorPrefix + error.message, 'error');
  }
}

/**
 * 读取已保存的窗口 ID
 * @param {string} key - 存储键
 * @returns {Promise<number|undefined>}
 */
async function readWindowId(key) {
  try {
    const data = await chrome.storage.session.get(key);
    return data[key];
  } catch {
    return undefined;
  }
}

/**
 * 保存窗口 ID（session 存储不可用时忽略，重复点击只会多开窗口）
 * @param {string} key - 存储键
 * @param {number} windowId - 窗口 ID
 * @returns {Promise<void>}
 */
async function rememberWindowId(key, windowId) {
  if (typeof windowId !== 'number') return;

  try {
    await chrome.storage.session.set({ [key]: windowId });
  } catch (error) {
    console.warn('保存窗口 ID 失败:', error.message);
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

  // 上传记录按钮
  document.getElementById('historyBtn').addEventListener('click', async () => {
    await openHistoryWindow();
  });

  // 图床文件管理按钮
  document.getElementById('manageBtn').addEventListener('click', async () => {
    await openManageWindow();
  });

  // 切换渠道时刷新渠道名称候选
  const channelSelect = document.getElementById('uploadChannel');
  if (channelSelect) {
    channelSelect.addEventListener('change', refreshChannelOptions);
  }
  
  // 输入框失焦时隐藏错误消息
  const inputs = document.querySelectorAll('input, select');
  inputs.forEach(input => {
    input.addEventListener('focus', () => {
      const statusElement = document.getElementById('status');
      if (statusElement.classList.contains('error')) {
        statusElement.style.display = 'none';
      }
      
      // 敏感字段输入框获得焦点时，如果是掩码值则清空
      if (SENSITIVE_CONFIG_KEYS.includes(input.id) && input.dataset.isMasked === 'true') {
        input.value = '';
        input.dataset.isMasked = 'false';
        input.placeholder = input.id === 'apiToken'
          ? '输入新 API Token（留空保持原值）'
          : '输入新认证码（留空保持原值）';
      }
    });
    
    // 敏感字段输入框失焦时，如果为空则恢复掩码显示
    if (SENSITIVE_CONFIG_KEYS.includes(input.id)) {
      input.addEventListener('blur', () => {
        if (input.value === '' && originalConfig?.[input.id]) {
          input.value = AUTH_CODE_MASK_MARKER;
          input.dataset.isMasked = 'true';
          input.placeholder = input.id === 'apiToken'
            ? '输入 API Token（需 upload 权限，与认证码二选一）'
            : '输入认证码（服务需要时填写，否则留空）';
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
    if (!VALID_API_PROTOCOLS.includes(url.protocol)) {
      input.style.borderColor = '#ef4444';
    } else {
      input.style.borderColor = '#10b981';
    }
  } catch {
    input.style.borderColor = '#ef4444';
  }
}