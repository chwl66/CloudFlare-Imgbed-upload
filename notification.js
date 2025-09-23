// 简化的通知功能
function createResultNotification(result, type) {
  const notification = document.createElement('div');
  
  // 更舒适的颜色方案
  const bgColor = type === 'success' ? '#f0f9ff' : '#fef2f2';
  const borderColor = type === 'success' ? '#0ea5e9' : '#ef4444';
  const textColor = type === 'success' ? '#0c4a6e' : '#991b1b';
  
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    width: 350px;
    background: ${bgColor};
    border: 2px solid ${borderColor};
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0,0,0,0.12);
    z-index: 10001;
    padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    color: ${textColor};
    transition: all 0.3s ease;
    backdrop-filter: blur(10px);
  `;
  
  if (type === 'success') {
    const formats = [
      { label: '直链', value: result.url },
      { label: 'Markdown', value: `![image](${result.url})` },
      { label: 'BBCode', value: `[img]${result.url}[/img]` }
    ];
    
    // 优化链接显示长度
    const truncateText = (text, maxLength = 55) => {
      if (text.length <= maxLength) return text;
      const start = text.substring(0, 30);
      const end = text.substring(text.length - 20);
      return `${start}...${end}`;
    };
    

    
    const formatItems = formats.map(format => `
      <div class="format-item" style="margin-bottom: 4px;">
        <div style="color: #64748b; font-weight: 500; font-size: 9px; margin-bottom: 2px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${format.label}</div>
        <div class="link-item" style="background: rgba(14, 165, 233, 0.1); padding: 6px 8px; border-radius: 4px; font-family: 'Consolas', 'Monaco', monospace; font-size: 11px; cursor: pointer; transition: all 0.2s; border: 1px solid rgba(14, 165, 233, 0.2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" data-text="${format.value}" title="${format.value}">
          ${truncateText(format.value)}
        </div>
      </div>
    `).join('');
    
    notification.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <div style="width: 20px; height: 20px; background: #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">✓</div>
          <strong style="color: #059669; font-size: 13px;">上传成功！</strong>
        </div>
        <button class="close-btn" style="background: rgba(14, 165, 233, 0.1); border: 1px solid rgba(14, 165, 233, 0.3); border-radius: 5px; font-size: 14px; cursor: pointer; color: ${textColor}; padding: 2px 6px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">×</button>
      </div>
      <div style="margin-bottom: 10px;">
        ${formatItems}
      </div>
    `;
  } else {
    notification.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <div style="width: 20px; height: 20px; background: #ef4444; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">✕</div>
          <strong style="color: #dc2626; font-size: 13px;">上传失败</strong>
        </div>
        <button class="close-btn" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 5px; font-size: 14px; cursor: pointer; color: ${textColor}; padding: 2px 6px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">×</button>
      </div>
      <div style="margin-bottom: 10px; padding: 10px; background: rgba(239, 68, 68, 0.1); border-radius: 5px; border-left: 3px solid #ef4444;">
        <div style="font-weight: 500; margin-bottom: 3px; font-size: 12px;">错误信息：</div>
        <div style="font-family: 'Consolas', 'Monaco', monospace; font-size: 11px; word-break: break-word;">${result.error}</div>
      </div>
      <div style="margin-top: 12px; font-size: 11px; color: #64748b; text-align: center; padding: 6px; background: rgba(239, 68, 68, 0.05); border-radius: 5px;">
        <span>🔧 请检查配置或重试</span>
      </div>
    `;
  }
  
  document.body.appendChild(notification);
  
  // 添加事件监听器
  setupNotificationEvents(notification, type);
  
  return notification;
}

// 设置通知事件
function setupNotificationEvents(notification, type) {
  // 关闭按钮事件
  const closeBtn = notification.querySelector('.close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      removeNotification(notification);
    });
    
    // 关闭按钮悬停效果
    closeBtn.addEventListener('mouseenter', () => {
      if (type === 'success') {
        closeBtn.style.background = 'rgba(14, 165, 233, 0.2)';
        closeBtn.style.borderColor = 'rgba(14, 165, 233, 0.5)';
      } else {
        closeBtn.style.background = 'rgba(239, 68, 68, 0.2)';
        closeBtn.style.borderColor = 'rgba(239, 68, 68, 0.5)';
      }
    });
    
    closeBtn.addEventListener('mouseleave', () => {
      if (type === 'success') {
        closeBtn.style.background = 'rgba(14, 165, 233, 0.1)';
        closeBtn.style.borderColor = 'rgba(14, 165, 233, 0.3)';
      } else {
        closeBtn.style.background = 'rgba(239, 68, 68, 0.1)';
        closeBtn.style.borderColor = 'rgba(239, 68, 68, 0.3)';
      }
    });
  }
  
  // 链接点击复制事件（仅成功通知）
  if (type === 'success') {
    const linkItems = notification.querySelectorAll('.link-item');
    linkItems.forEach(item => {
      item.addEventListener('click', async () => {
        const text = item.getAttribute('data-text');
        try {
          await navigator.clipboard.writeText(text);
          
          // 视觉反馈
          const originalBg = item.style.backgroundColor;
          const originalBorder = item.style.borderColor;
          item.style.backgroundColor = 'rgba(16, 185, 129, 0.2)';
          item.style.borderColor = 'rgba(16, 185, 129, 0.5)';
          setTimeout(() => {
            item.style.backgroundColor = originalBg;
            item.style.borderColor = originalBorder;
          }, 300);
          
          // 显示复制成功提示
          showCopyFeedback(item);
        } catch (error) {
          console.error('复制失败:', error);
          // 降级方案
          fallbackCopy(text);
        }
      });
      
      // 鼠标悬停效果
      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = 'rgba(14, 165, 233, 0.15)';
        item.style.borderColor = 'rgba(14, 165, 233, 0.4)';
        item.style.transform = 'translateY(-1px)';
      });
      
      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = 'rgba(14, 165, 233, 0.1)';
        item.style.borderColor = 'rgba(14, 165, 233, 0.2)';
        item.style.transform = 'translateY(0)';
      });
    });
  }
  
  // 移除通知
  function removeNotification(element) {
    if (element && element.parentNode) {
      element.style.opacity = '0';
      setTimeout(() => {
        if (element.parentNode) {
          element.parentNode.removeChild(element);
        }
      }, 300);
    }
  }
}

// 显示复制成功反馈
function showCopyFeedback(element) {
  const feedback = document.createElement('div');
  feedback.innerHTML = '✓ 已复制';
  feedback.style.cssText = `
    position: absolute;
    background: linear-gradient(135deg, #10b981, #059669);
    color: white;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 500;
    z-index: 10002;
    pointer-events: none;
    opacity: 0;
    transform: translateY(10px) scale(0.9);
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
    backdrop-filter: blur(10px);
  `;
  
  // 定位到元素右上角
  const rect = element.getBoundingClientRect();
  feedback.style.left = (rect.right - 80) + 'px';
  feedback.style.top = (rect.top - 40) + 'px';
  
  document.body.appendChild(feedback);
  
  // 显示动画
  setTimeout(() => {
    feedback.style.opacity = '1';
    feedback.style.transform = 'translateY(0) scale(1)';
  }, 10);
  
  // 1.5秒后移除
  setTimeout(() => {
    feedback.style.opacity = '0';
    feedback.style.transform = 'translateY(-10px) scale(0.9)';
    setTimeout(() => {
      if (feedback.parentNode) {
        feedback.parentNode.removeChild(feedback);
      }
    }, 300);
  }, 1500);
}

// 降级复制方案
function fallbackCopy(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  document.body.removeChild(textArea);
}