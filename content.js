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
    console.log('正在上传图片...');
    
    // 获取图片数据
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    
    // 转换为 base64
    const reader = new FileReader();
    reader.onload = async function() {
      const fileName = getFileNameFromUrl(imageUrl);
      
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
    showNotification(`上传失败：${error.message}`, 'error');
    console.error('上传错误:', error);
  }
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

// 引入增强的通知功能（将在页面加载时动态加载）