// 公共工具模块通过 manifest.json 的 content_scripts 配置加载
// utils.js 在此脚本之前加载，其中定义的函数在全局作用域可用

// ==================== 通知模块 ====================
// 提供上传结果通知和复制反馈功能

/**
 * 通知管理器类
 */
class NotificationManager {
  static activeNotifications = new Set();
  static MAX_NOTIFICATIONS = 3;
  
  /**
   * 添加通知
   * @param {HTMLElement} notification - 通知元素
   */
  static add(notification) {
    // 限制同时显示的通知数量
    if (this.activeNotifications.size >= this.MAX_NOTIFICATIONS) {
      const oldest = this.activeNotifications.values().next().value;
      this.remove(oldest);
    }
    
    this.activeNotifications.add(notification);
    this.updateNotificationPositions();
  }
  
  /**
   * 移除通知
   * @param {HTMLElement} notification - 通知元素
   */
  static remove(notification) {
    this.activeNotifications.delete(notification);
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
    this.updateNotificationPositions();
  }
  
  /**
   * 清理所有通知
   */
  static clearAll() {
    this.activeNotifications.forEach(notification => {
      this.remove(notification);
    });
  }
  
  /**
   * 更新通知位置
   */
  static updateNotificationPositions() {
    const notifications = Array.from(this.activeNotifications);
    notifications.forEach((notification, index) => {
      const topOffset = 20 + (index * 120);
      notification.style.top = `${topOffset}px`;
    });
  }
  
  /**
   * 获取通知位置
   * @returns {Object} 位置信息
   */
  static getNotificationPosition() {
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };
    
    // 检查现有通知的位置
    const existingCount = this.activeNotifications.size;
    const topOffset = 20 + (existingCount * 120);
    
    // 确保不超出视窗
    const maxTop = viewport.height - 200;
    const finalTop = Math.min(topOffset, maxTop);
    
    return {
      top: `${finalTop}px`,
      right: '20px'
    };
  }
}

/**
 * 创建上传结果通知
 * @param {Object} result - 上传结果对象，成功时包含 url，失败时包含 error
 * @param {string} type - 通知类型：'success' 或 'error'
 * @returns {HTMLElement} 通知元素
 */
function createResultNotification(result, type) {
  const notification = document.createElement('div');
  
  // 设置CSS类 - 使用 imgbed- 前缀避免与其他网站（如Discourse）冲突
  notification.className = `imgbed-notification imgbed-notification-${type}`;
  
  // 获取通知位置
  const position = NotificationManager.getNotificationPosition();
  notification.style.top = position.top;
  notification.style.right = position.right;
  
  if (type === 'success') {
    // 图片给图片语法，其他文件给链接语法（扩展已支持任意文件类型）
    const isImage = result.isImage !== false;
    const fileLabel = result.fileName || '文件';
    const formats = isImage
      ? [
          { label: '直链', value: result.url },
          { label: 'Markdown', value: `![image](${result.url})` },
          { label: 'BBCode', value: `[img]${result.url}[/img]` }
        ]
      : [
          { label: '直链', value: result.url },
          { label: 'Markdown', value: `[${fileLabel}](${result.url})` },
          { label: 'HTML', value: `<a href="${result.url}">${fileLabel}</a>` }
        ];
    
    const formatItems = formats.map(format => `
      <div class="imgbed-format-item">
        <div class="imgbed-format-label">${escapeHtml(format.label)}</div>
        <div class="imgbed-link-item" data-text="${escapeHtml(format.value)}" title="${escapeHtml(format.value)}">
          ${escapeHtml(truncateText(format.value))}
        </div>
      </div>
    `).join('');
    
    notification.innerHTML = `
      <div class="imgbed-notification-header">
        <div class="imgbed-notification-title imgbed-success">
          <div class="imgbed-status-icon imgbed-success">✓</div>
          <strong>上传成功！</strong>
        </div>
        <button class="imgbed-close-btn">×</button>
      </div>
      <div class="imgbed-notification-content">
        ${formatItems}
      </div>
    `;
  } else {
    notification.innerHTML = `
      <div class="imgbed-notification-header">
        <div class="imgbed-notification-title imgbed-error">
          <div class="imgbed-status-icon imgbed-error">✕</div>
          <strong>上传失败</strong>
        </div>
        <button class="imgbed-close-btn">×</button>
      </div>
      <div class="imgbed-notification-content">
        <div class="imgbed-error-message">
          <div class="imgbed-error-label">错误信息：</div>
          <div class="imgbed-error-text">${escapeHtml(result.error)}</div>
        </div>
        <div class="imgbed-error-hint">
          <span>🔧 请检查配置或重试</span>
        </div>
      </div>
    `;
  }
  
  document.body.appendChild(notification);
  
  // 添加到管理器
  NotificationManager.add(notification);
  
  // 添加事件监听器
  setupNotificationEvents(notification, type);
  
  return notification;
}

// ==================== 通知移除功能 ====================

/**
 * 移除通知元素（带动画效果）
 * @param {HTMLElement} element - 要移除的通知元素
 */
function removeNotification(element) {
  if (element && element.parentNode) {
    element.style.opacity = '0';
    element.style.transform = 'translateX(20px)';
    setTimeout(() => {
      NotificationManager.remove(element);
    }, 300);
  }
}

// ==================== 事件设置功能 ====================

/**
 * 设置通知事件监听器
 * @param {HTMLElement} notification - 通知元素
 * @param {string} type - 通知类型
 */
function setupNotificationEvents(notification, type) {
  // 设置关闭按钮事件
  setupCloseButton(notification, type);
  
  // 设置链接点击复制事件（仅成功通知）
  if (type === 'success') {
    setupLinkCopyEvents(notification);
  }
}

/**
 * 设置关闭按钮事件
 * @param {HTMLElement} notification - 通知元素
 * @param {string} type - 通知类型
 */
function setupCloseButton(notification, type) {
  const closeBtn = notification.querySelector('.imgbed-close-btn');
  if (!closeBtn) return;
  
  // 点击关闭
  closeBtn.addEventListener('click', () => {
    removeNotification(notification);
  });
  
  // 悬停效果颜色配置
  const colors = type === 'success'
    ? { hover: 'rgba(14, 165, 233, 0.2)', hoverBorder: 'rgba(14, 165, 233, 0.5)', normal: 'rgba(14, 165, 233, 0.1)', normalBorder: 'rgba(14, 165, 233, 0.3)' }
    : { hover: 'rgba(239, 68, 68, 0.2)', hoverBorder: 'rgba(239, 68, 68, 0.5)', normal: 'rgba(239, 68, 68, 0.1)', normalBorder: 'rgba(239, 68, 68, 0.3)' };
  
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.background = colors.hover;
    closeBtn.style.borderColor = colors.hoverBorder;
  });
  
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.style.background = colors.normal;
    closeBtn.style.borderColor = colors.normalBorder;
  });
}

/**
 * 设置链接复制事件
 * @param {HTMLElement} notification - 通知元素
 */
function setupLinkCopyEvents(notification) {
  const linkItems = notification.querySelectorAll('.imgbed-link-item');
  
  linkItems.forEach(item => {
    // 使用事件管理器添加事件监听器
    EventManager.add(item, 'click', async () => {
      const text = item.getAttribute('data-text');
      try {
        await copyTextToClipboard(text, item);
      } catch (error) {
        console.error('复制失败:', error);
        // 显示错误提示
        showCopyError(item, error.message);
      }
    });
    
    // 悬停效果通过CSS类处理
    EventManager.add(item, 'mouseenter', () => {
      item.classList.add('imgbed-hover');
    });
    
    EventManager.add(item, 'mouseleave', () => {
      item.classList.remove('imgbed-hover');
    });
  });
}

/**
 * 显示复制错误提示
 * @param {HTMLElement} element - 触发复制的元素
 * @param {string} errorMessage - 错误消息
 */
function showCopyError(element, errorMessage) {
  const feedback = document.createElement('div');
  feedback.innerHTML = '✕ 复制失败';
  feedback.className = 'imgbed-copy-feedback imgbed-error';
  
  // 定位到元素右上角
  const rect = element.getBoundingClientRect();
  feedback.style.left = (rect.right - 80) + 'px';
  feedback.style.top = (rect.top - 40) + 'px';
  
  document.body.appendChild(feedback);
  
  // 显示动画
  setTimeout(() => {
    feedback.classList.add('imgbed-show');
  }, 10);
  
  // 2秒后移除
  setTimeout(() => {
    feedback.classList.remove('imgbed-show');
    setTimeout(() => {
      if (feedback.parentNode) {
        feedback.parentNode.removeChild(feedback);
      }
    }, 300);
  }, 2000);
}

// copyTextToClipboard 和 showCopyFeedback 函数已移至 utils.js
