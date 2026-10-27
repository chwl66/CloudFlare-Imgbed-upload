// 公共工具模块通过 manifest.json 的 content_scripts 配置加载
// utils.js 在此脚本之前加载，其中定义的函数在全局作用域可用

// 监听来自 background script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 使用立即执行的异步函数处理消息
  (async () => {
    try {
      let messageResult = { success: true };

      switch (request.action) {
        case 'uploadImage':
          messageResult = await handleImageUpload(request.imageUrl);
          break;

        case 'uploadClipboard':
          messageResult = await handleClipboardUpload();
          break;

        case 'copyText':
          await copyToClipboard(request.text);
          break;

        case 'ping':
          // 供背景脚本检测内容脚本是否已注入
          messageResult = { pong: true };
          break;
      }

      sendResponse(messageResult);
    } catch (error) {
      console.error('消息处理错误:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  return true; // 保持消息通道开放以支持异步响应
});


// 通用的消息发送函数，使用 Promise 包装
function sendMessageToBackground(message, options = {}) {
  const uploadActions = ['uploadFile', 'uploadImageUrl', 'chunkedUploadInit', 'chunkedUploadChunk', 'chunkedUploadMerge'];
  const isUploadAction = message && uploadActions.includes(message.action);
  const defaultTimeoutMs = isUploadAction
    ? (typeof CONSTANTS !== 'undefined' ? CONSTANTS.UPLOAD_TIMEOUT : 60000)
    : (typeof CONSTANTS !== 'undefined' ? CONSTANTS.CONNECTION_TIMEOUT : 15000);

  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? options.timeoutMs
    : defaultTimeoutMs;

  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ success: false, error: `请求超时（${timeoutMs}ms）` });
    }, timeoutMs);

    chrome.runtime.sendMessage(message, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (chrome.runtime.lastError) {
        console.error('Chrome runtime error:', chrome.runtime.lastError);
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response || { success: false, error: '未收到响应' });
      }
    });
  });
}

// ==================== 统一上传调度 ====================

/**
 * 获取本次上传的执行计划（渠道、单文件上限、分块参数、超时）
 * @returns {Promise<Object>}
 */
async function getUploadPlan() {
  const fallback = {
    channel: 'telegram',
    limit: CONSTANTS.MAX_FILE_SIZE,
    chunkSize: CONSTANTS.CHUNKED_UPLOAD_THRESHOLD,
    supportsChunked: false,
    chunkedThreshold: CONSTANTS.CHUNKED_UPLOAD_THRESHOLD,
    timeout: CONSTANTS.UPLOAD_TIMEOUT
  };

  const response = await sendMessageToBackground(
    { action: 'getUploadPlan' },
    { timeoutMs: CONSTANTS.CONNECTION_TIMEOUT }
  );

  if (response && response.success && response.plan) {
    return { ...fallback, ...response.plan };
  }

  return fallback;
}

/**
 * Blob 转 dataURL
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(blob);
  });
}

/**
 * 统一上传入口：按渠道上限与文件大小自动选择单请求或分块上传
 * @param {Blob} blob - 图片数据
 * @param {string} fileName - 文件名
 * @param {string} source - 上传来源（右键图片 / 剪贴板 / 拖拽）
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function uploadBlob(blob, fileName, source) {
  const plan = await getUploadPlan();

  if (blob.size > plan.limit) {
    const error = `文件大小 ${formatFileSize(blob.size)} 超过 ${plan.channel} 渠道上限 ${formatFileSize(plan.limit)}`;
    showUploadResult({ error }, 'error');
    console.error('[ImgBed]', error);
    return { success: false, error };
  }

  const useChunked = plan.supportsChunked && blob.size > plan.chunkedThreshold;

  try {
    const result = useChunked
      ? await uploadBlobChunked(blob, fileName, source, plan)
      : await uploadBlobSingle(blob, fileName, source, plan);

    // isImage / fileName 用于决定通知里提供图片格式还是文件格式
    showUploadResult({ ...result, isImage: isImageFile(blob), fileName }, 'success');
    console.log('[ImgBed] 上传成功:', result);
    return { success: true };
  } catch (error) {
    const message = error?.message || '上传失败';
    showUploadResult({ error: message }, 'error');
    console.error('[ImgBed] 上传失败:', message);
    return { success: false, error: message };
  }
}

/**
 * 单请求上传（小文件）
 */
async function uploadBlobSingle(blob, fileName, source, plan) {
  const fileData = await blobToDataUrl(blob);

  const response = await sendMessageToBackground({
    action: 'uploadFile',
    fileData,
    fileName,
    source
  }, { timeoutMs: plan.timeout + 5000 });

  if (!response || !response.success) {
    throw new Error(response?.error || '上传失败');
  }

  return response.result;
}

/**
 * 分块上传（大文件，对应上游 init → chunk → merge 流程）
 */
async function uploadBlobChunked(blob, fileName, source, plan) {
  const fileType = blob.type || 'application/octet-stream';
  const chunkSize = Math.max(1024 * 1024, plan.chunkSize);
  const totalChunks = Math.ceil(blob.size / chunkSize);

  const initResponse = await sendMessageToBackground({
    action: 'chunkedUploadInit',
    fileName,
    fileType,
    totalChunks
  }, { timeoutMs: plan.timeout + 5000 });

  if (!initResponse || !initResponse.success || !initResponse.uploadId) {
    throw new Error(initResponse?.error || '初始化分块上传失败');
  }

  const uploadId = initResponse.uploadId;

  try {
    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * chunkSize;
      const chunk = blob.slice(start, Math.min(start + chunkSize, blob.size));
      const chunkData = await blobToDataUrl(chunk);

      showUploadingStatus(`分块上传中 ${index + 1}/${totalChunks}...`);

      const chunkResponse = await sendMessageToBackground({
        action: 'chunkedUploadChunk',
        uploadId,
        chunkIndex: index,
        totalChunks,
        fileName,
        fileType,
        chunkData
      }, { timeoutMs: plan.timeout + 5000 });

      if (!chunkResponse || !chunkResponse.success) {
        throw new Error(chunkResponse?.error || `分块 ${index + 1}/${totalChunks} 上传失败`);
      }
    }

    showUploadingStatus('正在合并分块...');

    const mergeResponse = await sendMessageToBackground({
      action: 'chunkedUploadMerge',
      uploadId,
      totalChunks,
      fileName,
      fileType,
      source
    }, { timeoutMs: plan.timeout * 2 + 5000 });

    if (!mergeResponse || !mergeResponse.success) {
      throw new Error(mergeResponse?.error || '合并分块失败');
    }

    return mergeResponse.result;
  } catch (error) {
    // 失败时释放服务端临时分块，避免残留数据
    sendMessageToBackground({
      action: 'chunkedUploadAbort',
      uploadId,
      totalChunks
    }, { timeoutMs: CONSTANTS.CONNECTION_TIMEOUT });
    throw error;
  }
}

// 处理图片上传
async function handleImageUpload(imageUrl) {
  let response = null;

  showUploadingStatus('图片上传中...');

  try {
    console.log('正在上传图片...', imageUrl);

    let blob;
    let fileName = getFileNameFromUrl(imageUrl);

    try {
      // 尝试直接 fetch（适用于同域或允许跨域的图片）
      response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      blob = await response.blob();

      // 验证图片文件
      await validateImageFile(blob);

    } catch (fetchError) {
      console.log('直接 fetch 失败，尝试通过 canvas 转换:', fetchError.message);

      // 降级方案：通过 canvas 转换图片
      try {
        blob = await convertImageToBlob(imageUrl);
        await validateImageFile(blob);
      } catch (canvasError) {
        console.log('Canvas 转换失败，尝试通过 background script 获取:', canvasError.message);

        // 最后的降级方案：通过 background script 获取图片
        try {
          const uploadResponse = await sendMessageToBackground({
            action: 'uploadImageUrl',
            imageUrl: imageUrl,
            fileName: fileName,
            source: CONSTANTS.UPLOAD_SOURCES.IMAGE
          });

          if (uploadResponse.success) {
            showUploadResult(uploadResponse.result, 'success');
            console.log('通过 background script 上传成功:', uploadResponse.result);
          } else {
            // 使用工具函数处理错误消息
            let errorMessage = getFriendlyErrorMessage(
              new Error(uploadResponse.error),
              extractStatusCode(uploadResponse.error)
            );

            // 如果是 403 错误，提供更友好的错误信息和解决方案
            if (errorMessage.includes('403')) {
              // 显示特殊的防盗链错误提示
              removeCurrentResultNotification();
              showAntiHotlinkError(imageUrl);
              return;
            }

            showUploadResult({ error: errorMessage }, 'error');
            console.error('Background script 上传失败:', uploadResponse.error);
          }
        } catch (bgError) {
          showUploadResult({ error: '所有上传方式都失败了，请尝试拖拽图片到页面' }, 'error');
          console.error('Background script 调用失败:', bgError);
        }
        return;
      }
    }

    // 统一走单请求 / 分块上传调度
    return await uploadBlob(blob, fileName, CONSTANTS.UPLOAD_SOURCES.IMAGE);

  } catch (error) {
    showUploadResult({ error: error.message }, 'error');
    console.error('上传错误:', error);
    return { success: false, error: error.message };
  } finally {
    // 清理资源：body 已被消费时 cancel() 会抛错，需先判断 bodyUsed 并吞掉 Promise 拒绝
    if (response && response.body && !response.bodyUsed) {
      response.body.cancel().catch(() => {});
    }
  }
}

/**
 * 从错误消息中提取状态码
 * @param {string} errorMessage - 错误消息
 * @returns {number|null} 状态码
 */
function extractStatusCode(errorMessage) {
  const match = errorMessage.match(/\((\d{3})\)/);
  return match ? parseInt(match[1]) : null;
}

// 通过 canvas 转换图片为 blob（处理跨域图片）
function convertImageToBlob(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // 尝试跨域
    
    img.onload = function() {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        
        ctx.drawImage(img, 0, 0);
        
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Canvas toBlob 失败'));
          }
        }, 'image/png');
      } catch (error) {
        reject(error);
      }
    };
    
    img.onerror = function() {
      reject(new Error('图片加载失败'));
    };
    
    img.src = imageUrl;
  });
}

// ==================== 剪贴板读取 ====================

/**
 * 读取剪贴板条目
 * 右键菜单关闭后页面可能尚未重新获得焦点，此处做焦点重试，避免 NotAllowedError
 * @returns {Promise<Array<ClipboardItem>>}
 */
async function readClipboardItems() {
  if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
    const error = new Error('当前页面无法读取剪贴板（浏览器仅允许在 HTTPS 页面读取），请改用拖拽或右键图片上传');
    error.name = 'UnsupportedError';
    throw error;
  }

  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!document.hasFocus()) {
      window.focus();
      await sleep(80 * attempt);
    }

    try {
      return await navigator.clipboard.read();
    } catch (error) {
      lastError = error;
      const retryable = error.name === 'NotAllowedError' || error.name === 'InvalidStateError';
      if (!retryable || attempt === maxAttempts) break;

      console.warn(`[ImgBed] 剪贴板读取失败（第 ${attempt} 次），准备重试:`, error.name, error.message);
      await sleep(120 * attempt);
    }
  }

  throw lastError || new Error('剪贴板读取失败');
}

/**
 * 从剪贴板条目中挑出可上传的内容：优先图片，其次其他非文本类型
 * @param {Array<ClipboardItem>} items - 剪贴板条目
 * @returns {{item: ClipboardItem, type: string}|null} 选中的条目
 */
function findClipboardFileEntry(items) {
  const entries = (items || []).map(item => {
    const types = Array.isArray(item.types) ? item.types : [];
    const imageType = types.find(type => typeof type === 'string' && type.startsWith('image/'));
    const fileType = types.find(type => typeof type === 'string' && !type.startsWith('text/'));
    return { item, type: imageType || fileType };
  });

  return entries.find(entry => entry.type) || null;
}

/**
 * 根据 MIME 类型构建剪贴板文件名
 * @param {string} mimeType - 剪贴板内容类型
 * @returns {string} 文件名
 */
function buildClipboardFileName(mimeType) {
  const [group, subtype = ''] = String(mimeType || '').split('/');
  const extension = (subtype.split('+')[0] || '').replace(/[^a-z0-9]/gi, '') || 'bin';
  const prefix = group === 'image' ? 'clipboard-image' : 'clipboard-file';
  return `${prefix}.${extension}`;
}

/**
 * 把剪贴板异常翻译成用户可理解的提示
 * @param {Error} error
 * @returns {string}
 */
function describeClipboardError(error) {
  const name = error?.name || '';

  if (name === 'UnsupportedError') return error.message;
  if (name === 'NotFoundError' || name === 'DataError') return '剪贴板中没有图片数据';
  if (name === 'NotAllowedError') {
    return '剪贴板读取被拒绝：请确认页面处于激活状态；若该站点曾拒绝剪贴板权限，请在地址栏的权限设置中重新允许，或改用拖拽上传';
  }
  if (name === 'SecurityError') {
    return '当前页面的权限策略禁止读取剪贴板，请改用拖拽上传';
  }

  return error?.message || '剪贴板访问失败，请重试';
}

// 处理剪贴板上传
async function handleClipboardUpload() {
  showUploadingStatus('剪贴板上传中...');
  console.log('[ImgBed] 开始读取剪贴板', {
    focused: document.hasFocus(),
    secureContext: window.isSecureContext
  });

  let clipboardItems;
  try {
    clipboardItems = await readClipboardItems();
  } catch (error) {
    console.error('[ImgBed] 剪贴板读取失败:', error.name, error.message);
    const errorMessage = describeClipboardError(error);
    showUploadResult({ error: errorMessage }, 'error');
    return { success: false, error: errorMessage };
  }

  const clipboardEntry = findClipboardFileEntry(clipboardItems);

  if (!clipboardEntry) {
    console.log('[ImgBed] 剪贴板中没有可上传的图片或文件');
    const noFileError = '剪贴板中没有图片或文件数据';
    showUploadResult({ error: noFileError }, 'error');
    return { success: false, error: noFileError };
  }

  try {
    const blob = await clipboardEntry.item.getType(clipboardEntry.type);

    // 文件床：图片与任意文件均可上传，图片额外校验文件头
    await validateUploadFile(blob);

    const fileName = buildClipboardFileName(clipboardEntry.type);
    console.log('[ImgBed] 正在上传剪贴板内容...', { type: clipboardEntry.type, size: blob.size });

    return await uploadBlob(blob, fileName, CONSTANTS.UPLOAD_SOURCES.CLIPBOARD);
  } catch (error) {
    console.error('[ImgBed] 剪贴板图片处理失败:', error);
    const errorMessage = error?.message || '剪贴板图片读取失败';
    showUploadResult({ error: errorMessage }, 'error');
    return { success: false, error: errorMessage };
  }
}

// 复制文本到剪贴板（使用工具函数）
async function copyToClipboard(text) {
  try {
    await copyTextToClipboard(text);
  } catch (error) {
    console.error('复制失败:', error);
    throw error;
  }
}

// getFileNameFromUrl 函数已移至 utils.js，使用导入的版本



// 拖拽上传功能（使用事件管理器）
// 上游是文件床：拖入的任意类型文件都会上传，不再只限图片
function initializeDragAndDrop() {
  // 仅当拖拽的是文件时才接管默认行为，避免影响站点自身的拖拽交互（编辑器、网盘上传区等）
  EventManager.add(document, 'dragover', function(e) {
    const types = e.dataTransfer && e.dataTransfer.types;
    if (types && Array.from(types).includes('Files')) {
      e.preventDefault();
    }
  });

  EventManager.add(document, 'drop', async function(e) {
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);

    if (files.length === 0) return;

    e.preventDefault();

    // 逐个上传，避免多文件并发时通知互相覆盖
    for (const file of files) {
      try {
        await validateUploadFile(file);
        console.log('正在上传拖拽的文件...', file.name);
        await uploadBlob(file, file.name, CONSTANTS.UPLOAD_SOURCES.DRAG);
      } catch (error) {
        showUploadResult({ error: error.message }, 'error');
        console.error('文件验证失败:', error);
      }
    }
  });
}

// 快捷键由 manifest 的 commands 提供（默认 Ctrl+Shift+U），
// 用户可在 chrome://extensions/shortcuts 中自定义，背景脚本转发到当前标签页

// 初始化事件监听器
function initializeEventListeners() {
  initializeDragAndDrop();
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeEventListeners);
} else {
  initializeEventListeners();
}

// 页面卸载时清理事件监听器
window.addEventListener('beforeunload', function() {
  EventManager.cleanup();
});

// 上传结果显示
let resultNotification = null;

function removeCurrentResultNotification() {
  if (resultNotification) {
    resultNotification.remove();
    resultNotification = null;
  }
}

function showUploadingStatus(message = '图片上传中...') {
  removeCurrentResultNotification();

  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: rgba(30, 64, 175, 0.95);
    color: #fff;
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.2);
    z-index: 10001;
    padding: 10px 14px;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  notification.textContent = message;

  document.body.appendChild(notification);
  resultNotification = notification;
}

function createFallbackResultNotification(result, type) {
  const notification = document.createElement('div');
  const isSuccess = type === 'success';
  const message = isSuccess
    ? '上传成功'
    : `上传失败：${result?.error || '未知错误'}`;

  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${isSuccess ? 'rgba(16, 185, 129, 0.95)' : 'rgba(239, 68, 68, 0.95)'};
    color: #fff;
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.2);
    z-index: 10001;
    padding: 10px 14px;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    max-width: 360px;
    word-break: break-word;
  `;
  notification.textContent = message;

  document.body.appendChild(notification);
  return notification;
}

function showUploadResult(result, type) {
  removeCurrentResultNotification();

  try {
    if (typeof createResultNotification === 'function') {
      resultNotification = createResultNotification(result, type);
    } else {
      resultNotification = createFallbackResultNotification(result, type);
    }
  } catch (error) {
    console.error('显示上传结果通知失败，使用兜底通知:', error);
    resultNotification = createFallbackResultNotification(result, type);
  }
}

// 显示防盗链错误的特殊处理
function showAntiHotlinkError(imageUrl) {
  const notification = document.createElement('div');
  
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    width: 380px;
    background: #fff3cd;
    border: 2px solid #ffc107;
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0,0,0,0.12);
    z-index: 10001;
    padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    color: #856404;
    transition: all 0.3s ease;
    backdrop-filter: blur(10px);
  `;
  
  notification.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <div style="width: 20px; height: 20px; background: #ffc107; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">⚠</div>
        <strong style="color: #b45309; font-size: 13px;">防盗链保护</strong>
      </div>
      <button class="imgbed-close-btn" style="background: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 5px; font-size: 14px; cursor: pointer; color: #856404; padding: 2px 6px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">×</button>
    </div>
    
    <div style="margin-bottom: 12px; padding: 10px; background: rgba(255, 193, 7, 0.1); border-radius: 5px; border-left: 3px solid #ffc107;">
      <div style="font-weight: 500; margin-bottom: 6px; font-size: 12px;">图片服务器启用了防盗链保护</div>
      <div style="font-size: 11px; color: #6c5700; line-height: 1.4;">
        无法直接获取此图片，请尝试以下解决方案：
      </div>
    </div>
    
    <div style="margin-bottom: 12px;">
      <div style="font-size: 11px; font-weight: 600; margin-bottom: 8px; color: #b45309;">💡 推荐方案：</div>
      <button class="copy-image-btn" style="width: 100%; padding: 8px 12px; background: #ffc107; color: #000; border: none; border-radius: 5px; font-size: 12px; cursor: pointer; margin-bottom: 6px; transition: all 0.2s; font-weight: 500;">
        1️⃣ 右键图片 → 复制图片 → 粘贴上传 (Ctrl+Shift+U)
      </button>
      <div style="font-size: 10px; color: #6c5700; text-align: center; margin-bottom: 8px;">
        或者
      </div>
      <button class="save-image-btn" style="width: 100%; padding: 8px 12px; background: rgba(255, 193, 7, 0.2); color: #b45309; border: 1px solid rgba(255, 193, 7, 0.5); border-radius: 5px; font-size: 12px; cursor: pointer; transition: all 0.2s;">
        2️⃣ 右键图片 → 图片另存为 → 拖拽到页面
      </button>
    </div>
    
    <div style="margin-top: 12px; font-size: 10px; color: #6c5700; text-align: center; padding: 6px; background: rgba(255, 193, 7, 0.05); border-radius: 5px;">
      <span>💡 提示：复制图片后按 Ctrl+Shift+U 可快速上传剪贴板图片</span>
    </div>
  `;
  
  document.body.appendChild(notification);
  
  // 添加事件监听器
  const closeBtn = notification.querySelector('.imgbed-close-btn');
  closeBtn.addEventListener('click', () => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  });
  
  // 复制图片按钮点击事件
  const copyImageBtn = notification.querySelector('.copy-image-btn');
  copyImageBtn.addEventListener('click', () => {
    // 显示操作指引
    copyImageBtn.innerHTML = '✅ 现在右键图片选择"复制图片"，然后按 Ctrl+Shift+U';
    copyImageBtn.style.background = '#28a745';
    copyImageBtn.style.color = 'white';
    
    // 3秒后恢复
    setTimeout(() => {
      copyImageBtn.innerHTML = '1️⃣ 右键图片 → 复制图片 → 粘贴上传 (Ctrl+Shift+U)';
      copyImageBtn.style.background = '#ffc107';
      copyImageBtn.style.color = '#000';
    }, 3000);
  });
  
  // 保存图片按钮点击事件
  const saveImageBtn = notification.querySelector('.save-image-btn');
  saveImageBtn.addEventListener('click', () => {
    // 显示操作指引
    saveImageBtn.innerHTML = '✅ 现在右键图片选择"图片另存为"，保存后拖拽到页面';
    saveImageBtn.style.background = '#28a745';
    saveImageBtn.style.color = 'white';
    saveImageBtn.style.borderColor = '#28a745';
    
    // 3秒后恢复
    setTimeout(() => {
      saveImageBtn.innerHTML = '2️⃣ 右键图片 → 图片另存为 → 拖拽到页面';
      saveImageBtn.style.background = 'rgba(255, 193, 7, 0.2)';
      saveImageBtn.style.color = '#b45309';
      saveImageBtn.style.borderColor = 'rgba(255, 193, 7, 0.5)';
    }, 3000);
  });
  
  // 关闭按钮悬停效果
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.background = 'rgba(255, 193, 7, 0.2)';
    closeBtn.style.borderColor = 'rgba(255, 193, 7, 0.5)';
  });
  
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.style.background = 'rgba(255, 193, 7, 0.1)';
    closeBtn.style.borderColor = 'rgba(255, 193, 7, 0.3)';
  });
}

// 引入增强的通知功能（将在页面加载时动态加载）