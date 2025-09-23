// 监听来自 background script 的消息
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  switch (request.action) {
    case 'uploadImage':
      await handleImageUpload(request.imageUrl);
      break;
      
    case 'uploadClipboard':
      await handleClipboardUpload();
      break;
      
    case 'copyText':
      await copyToClipboard(request.text);
      break;
  }
});

// 通用的消息发送函数，使用 Promise 包装
function sendMessageToBackground(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Chrome runtime error:', chrome.runtime.lastError);
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response || { success: false, error: '未收到响应' });
      }
    });
  });
}

// 处理图片上传
async function handleImageUpload(imageUrl) {
  try {
    console.log('正在上传图片...', imageUrl);
    
    let blob;
    let fileName = getFileNameFromUrl(imageUrl);
    
    try {
      // 尝试直接 fetch（适用于同域或允许跨域的图片）
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      blob = await response.blob();
    } catch (fetchError) {
      console.log('直接 fetch 失败，尝试通过 canvas 转换:', fetchError.message);
      
      // 降级方案：通过 canvas 转换图片
      try {
        blob = await convertImageToBlob(imageUrl);
      } catch (canvasError) {
        console.log('Canvas 转换失败，尝试通过 background script 获取:', canvasError.message);
        
        // 最后的降级方案：通过 background script 获取图片
        try {
          const uploadResponse = await sendMessageToBackground({
            action: 'uploadImageUrl',
            imageUrl: imageUrl,
            fileName: fileName
          });
          
          if (uploadResponse.success) {
            showUploadResult(uploadResponse.result, 'success');
            console.log('通过 background script 上传成功:', uploadResponse.result);
          } else {
            // 如果是 403 错误，提供更友好的错误信息和解决方案
            let errorMessage = uploadResponse.error;
            if (errorMessage.includes('403')) {
              // 显示特殊的防盗链错误提示
              showAntiHotlinkError(imageUrl);
              return;
            } else if (errorMessage.includes('404')) {
              errorMessage = '图片不存在或已被删除';
            } else if (errorMessage.includes('网络')) {
              errorMessage = '网络连接失败，请检查网络连接';
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
    
    // 转换为 base64
    const reader = new FileReader();
    reader.onload = async function() {
      // 使用 Promise 包装的消息发送
      const uploadResponse = await sendMessageToBackground({
        action: 'uploadFile',
        fileData: reader.result,
        fileName: fileName
      });
      
      console.log('收到响应:', uploadResponse);
      
      if (uploadResponse.success) {
        // 显示成功结果
        showUploadResult(uploadResponse.result, 'success');
        console.log('上传成功:', uploadResponse.result);
      } else {
        showUploadResult({ error: uploadResponse.error }, 'error');
        console.error('上传失败:', uploadResponse.error);
      }
    };
    reader.readAsDataURL(blob);
    
  } catch (error) {
    showUploadResult({ error: error.message }, 'error');
    console.error('上传错误:', error);
  }
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

// 处理剪贴板上传
async function handleClipboardUpload() {
  try {
    const clipboardItems = await navigator.clipboard.read();
    
    for (const item of clipboardItems) {
      const imageType = item.types.find(type => type.startsWith('image/'));
      
      if (imageType) {
        const blob = await item.getType(imageType);
        const reader = new FileReader();
        
        reader.onload = async function() {
          const fileName = `clipboard-image.${imageType.split('/')[1]}`;
          
          console.log('正在上传剪贴板图片...');
          
          // 使用 Promise 包装的消息发送
          const uploadResponse = await sendMessageToBackground({
            action: 'uploadFile',
            fileData: reader.result,
            fileName: fileName
          });
          
          console.log('收到响应:', uploadResponse);
          
          if (uploadResponse.success) {
            // 显示成功结果
            showUploadResult(uploadResponse.result, 'success');
            console.log('上传成功:', uploadResponse.result);
          } else {
            showUploadResult({ error: uploadResponse.error }, 'error');
            console.error('上传失败:', uploadResponse.error);
          }
        };
        
        reader.readAsDataURL(blob);
        return;
      }
    }
    
    console.log('剪贴板中没有图片');
    
  } catch (error) {
    console.log('无法访问剪贴板');
    console.error('剪贴板访问错误:', error);
  }
}

// 复制文本到剪贴板
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    // 降级方案
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }
}

// 从 URL 获取文件名
function getFileNameFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const fileName = pathname.split('/').pop();
    return fileName || 'image.jpg';
  } catch {
    return 'image.jpg';
  }
}



// 拖拽上传功能
document.addEventListener('dragover', function(e) {
  e.preventDefault();
});

document.addEventListener('drop', function(e) {
  e.preventDefault();
  
  const files = Array.from(e.dataTransfer.files);
  const imageFiles = files.filter(file => file.type.startsWith('image/'));
  
  if (imageFiles.length > 0) {
    imageFiles.forEach(async (file) => {
      const reader = new FileReader();
      reader.onload = async function() {
        console.log('正在上传拖拽的图片...');
        
        // 使用 Promise 包装的消息发送
        const uploadResponse = await sendMessageToBackground({
          action: 'uploadFile',
          fileData: reader.result,
          fileName: file.name
        });
        
        console.log('收到响应:', uploadResponse);
        
        if (uploadResponse.success) {
          // 显示成功结果
          showUploadResult(uploadResponse.result, 'success');
          console.log('上传成功:', uploadResponse.result);
        } else {
          showUploadResult({ error: uploadResponse.error }, 'error');
          console.error('上传失败:', uploadResponse.error);
        }
      };
      reader.readAsDataURL(file);
    });
  }
});

// 键盘快捷键 (Ctrl+Shift+U 上传剪贴板图片)
document.addEventListener('keydown', function(e) {
  if (e.ctrlKey && e.shiftKey && e.key === 'U') {
    e.preventDefault();
    handleClipboardUpload();
  }
});

// 上传结果显示
let resultNotification = null;

function showUploadResult(result, type) {
  // 移除现有的结果通知
  if (resultNotification) {
    resultNotification.remove();
  }
  
  resultNotification = createResultNotification(result, type);
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
      <button class="close-btn" style="background: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 5px; font-size: 14px; cursor: pointer; color: #856404; padding: 2px 6px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">×</button>
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
  const closeBtn = notification.querySelector('.close-btn');
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