/**
 * Cache Refresher Extension for SillyTavern
 *
 * Keeps LLM cache warm with periodic minimal requests to prevent
 * expensive cache misses when pausing between messages.
 *
 * Version: 3.0.0
 * Compatible with: SillyTavern 1.15.0+
 * Author: OneinfinityN7
 * License: AGPL-3.0
 */

const MODULE_NAME = 'cache_refresher';
const LOG_PREFIX = '[CacheRefresher]';

// Default settings
const defaultSettings = Object.freeze({
    enabled: true,
    interval: 240000,        // 4 minutes (240 seconds)
    maxRefreshes: 5,
    showNotifications: true,
    showTimer: true,
    debug: false,
    // Timer position (for dragging)
    timerX: null,
    timerY: null
});

// State
let refreshTimer = null;
let refreshCount = 0;
let lastPromptData = null;
let currentChatId = null;
let countdownInterval = null;
let secondsRemaining = 0;
let timerWidget = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let eventListenersRegistered = false;
let dragListenersRegistered = false;

// ============================================================================
// Utility Functions
// ============================================================================

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }
    return extensionSettings[MODULE_NAME];
}

function saveSettings() {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    saveSettingsDebounced();
}

function debugLog(...args) {
    if (getSettings().debug) console.log(LOG_PREFIX, ...args);
}

function log(...args) {
    console.log(LOG_PREFIX, ...args);
}

function logError(...args) {
    console.error(LOG_PREFIX, ...args);
}

function showNotification(message, type = 'info') {
    const settings = getSettings();
    if (!settings.showNotifications) return;
    if (typeof toastr !== 'undefined') {
        toastr[type]?.(message) || toastr.info(message);
    }
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ============================================================================
// Cache Refresher Core Functions
// ============================================================================

function getCurrentChatId() {
    const ctx = SillyTavern.getContext();
    if (ctx.selected_group) return `group-${ctx.selected_group}`;
    if (ctx.characterId != null) {
        const char = ctx.characters?.[ctx.characterId];
        return char ? (ctx.chat_metadata?.file_name || char.name) : null;
    }
    return null;
}

function capturePromptData() {
    const ctx = SillyTavern.getContext();
    const settings = getSettings();
    if (!settings.enabled) return;

    try {
        const chat = ctx.chat;
        if (!chat?.length) return;

        const newChatId = getCurrentChatId();
        if (newChatId !== currentChatId) {
            refreshCount = 0;
            currentChatId = newChatId;
        }

        lastPromptData = {
            chatId: newChatId,
            messageCount: chat.length,
            timestamp: Date.now()
        };

        startRefreshTimer();
    } catch (error) {
        logError('Error capturing prompt data:', error);
    }
}

async function sendCacheRefresh() {
    const settings = getSettings();
    if (!settings.enabled || !lastPromptData) {
        stopRefreshTimer();
        return;
    }

    if (refreshCount >= settings.maxRefreshes) {
        showNotification('Cache refresh limit reached', 'info');
        stopRefreshTimer();
        return;
    }

    if (getCurrentChatId() !== lastPromptData.chatId) {
        stopRefreshTimer();
        return;
    }

    try {
        debugLog('Sending cache refresh...');
        const { generateQuietPrompt } = SillyTavern.getContext();
        if (typeof generateQuietPrompt === 'function') {
            await generateQuietPrompt({
                quietPrompt: '',
                skipWIAN: true,
                maxTokens: 1,
                skipSanitize: true
            });
        }
        refreshCount++;
        log(`Cache refresh ${refreshCount}/${settings.maxRefreshes}`);
        showNotification(`Cache refreshed (${refreshCount}/${settings.maxRefreshes})`, 'success');
        startRefreshTimer();
    } catch (error) {
        logError('Cache refresh failed:', error);
        showNotification('Cache refresh failed', 'error');
        setTimeout(() => settings.enabled && startRefreshTimer(), 5000);
    }
}

function startRefreshTimer() {
    const settings = getSettings();
    stopRefreshTimer();

    if (!settings.enabled || refreshCount >= settings.maxRefreshes) {
        updateTimerWidget();
        return;
    }

    secondsRemaining = Math.floor(settings.interval / 1000);
    updateTimerWidget();

    // Start countdown
    countdownInterval = setInterval(() => {
        secondsRemaining--;
        if (secondsRemaining >= 0) {
            updateTimerDisplay();
        }
    }, 1000);

    // Set the actual refresh timer
    refreshTimer = setTimeout(sendCacheRefresh, settings.interval);
    debugLog(`Refresh timer started: ${settings.interval}ms`);
}

function stopRefreshTimer() {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    secondsRemaining = 0;
    updateTimerWidget();
}

function resetRefresherState() {
    stopRefreshTimer();
    refreshCount = 0;
    lastPromptData = null;
    currentChatId = null;
}

// ============================================================================
// Timer Widget
// ============================================================================

function createTimerWidget() {
    if (timerWidget) timerWidget.remove();

    const settings = getSettings();
    timerWidget = document.createElement('div');
    timerWidget.id = 'cache-refresh-timer';

    // Apply saved position or default
    if (settings.timerX !== null && settings.timerY !== null) {
        timerWidget.style.left = settings.timerX + 'px';
        timerWidget.style.top = settings.timerY + 'px';
        timerWidget.style.right = 'auto';
        timerWidget.style.bottom = 'auto';
    } else {
        timerWidget.style.bottom = '20px';
        timerWidget.style.right = '20px';
    }

    document.body.appendChild(timerWidget);
    setupWidgetDragging(); // Set up document-level listeners once
    updateTimerWidget();   // This will call attachWidgetMouseDown
}

function updateTimerWidget() {
    if (!timerWidget) return;
    const settings = getSettings();

    // Hide if disabled or timer not shown
    if (!settings.enabled || !settings.showTimer) {
        timerWidget.style.display = 'none';
        return;
    }

    timerWidget.style.display = 'flex';

    const isActive = refreshTimer !== null;
    const remaining = settings.maxRefreshes - refreshCount;
    const progress = isActive ? (secondsRemaining / (settings.interval / 1000)) * 100 : 0;

    timerWidget.className = isActive ? 'active' : 'idle';
    timerWidget.innerHTML = `
        <div class="crt-content">
            <div class="crt-icon">${isActive ? '🔄' : '⏸'}</div>
            <div class="crt-info">
                <div class="crt-time">${isActive ? formatTime(secondsRemaining) : 'Idle'}</div>
                <div class="crt-status">${remaining}/${settings.maxRefreshes} remaining</div>
            </div>
        </div>
        ${isActive ? `
        <div class="crt-progress">
            <div class="crt-progress-fill" style="width: ${progress}%"></div>
        </div>
        ` : ''}
    `;

    // Re-attach mousedown handler since innerHTML was replaced
    attachWidgetMouseDown();
}

function updateTimerDisplay() {
    const timeEl = timerWidget?.querySelector('.crt-time');
    const progressEl = timerWidget?.querySelector('.crt-progress-fill');
    const settings = getSettings();

    if (timeEl) {
        timeEl.textContent = formatTime(secondsRemaining);
    }
    if (progressEl) {
        const progress = (secondsRemaining / (settings.interval / 1000)) * 100;
        progressEl.style.width = progress + '%';
    }
}

function setupWidgetDragging() {
    if (!timerWidget || dragListenersRegistered) return;

    // Only register document-level listeners once
    document.addEventListener('mousemove', (e) => {
        if (!isDragging || !timerWidget) return;

        const x = e.clientX - dragOffset.x;
        const y = e.clientY - dragOffset.y;

        const maxX = window.innerWidth - timerWidget.offsetWidth;
        const maxY = window.innerHeight - timerWidget.offsetHeight;

        timerWidget.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
        timerWidget.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
        timerWidget.style.right = 'auto';
        timerWidget.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging && timerWidget) {
            isDragging = false;
            timerWidget.style.cursor = '';

            const settings = getSettings();
            settings.timerX = parseInt(timerWidget.style.left);
            settings.timerY = parseInt(timerWidget.style.top);
            saveSettings();
        }
    });

    dragListenersRegistered = true;
}

function attachWidgetMouseDown() {
    if (!timerWidget) return;

    timerWidget.onmousedown = (e) => {
        if (e.target.closest('button')) return;

        isDragging = true;
        const rect = timerWidget.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        timerWidget.style.cursor = 'grabbing';
        e.preventDefault();
    };
}

function updateTimerVisibility() {
    if (!timerWidget) return;
    const settings = getSettings();
    timerWidget.style.display = (settings.enabled && settings.showTimer) ? 'flex' : 'none';
}

// ============================================================================
// Event Handlers
// ============================================================================

function onChatChanged() {
    const newChatId = getCurrentChatId();
    if (newChatId !== currentChatId) {
        resetRefresherState();
    }
}

function onGenerationEnded() {
    capturePromptData();
}

function registerEventListeners() {
    if (eventListenersRegistered) return;

    const { eventSource, event_types } = SillyTavern.getContext();
    if (!eventSource || !event_types) {
        logError('Event system not available');
        return;
    }

    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
    eventSource.on(event_types.GENERATION_STOPPED, () => {});

    eventListenersRegistered = true;
}

function unregisterEventListeners() {
    if (!eventListenersRegistered) return;

    const { eventSource, event_types } = SillyTavern.getContext();
    if (!eventSource || !event_types) return;

    eventSource.removeListener(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.removeListener(event_types.GENERATION_ENDED, onGenerationEnded);

    eventListenersRegistered = false;
}

// ============================================================================
// Settings UI
// ============================================================================

function getExtensionPath() {
    const scripts = document.querySelectorAll('script[src*="cache"]');
    for (const script of scripts) {
        const src = script.getAttribute('src');
        if (src?.includes('index.js')) {
            return src.replace('/index.js', '');
        }
    }
    return '/scripts/extensions/third-party/Cache-Refresh-SillyTavern-Update';
}

async function initSettingsUI() {
    const settings = getSettings();
    const extPath = getExtensionPath();

    const response = await fetch(`${extPath}/cache-refresher.html`);
    if (!response.ok) {
        logError('Failed to load settings template');
        return;
    }

    const html = await response.text();
    const extBlock = document.getElementById('extensions_settings');
    if (!extBlock) {
        logError('Extensions settings block not found');
        return;
    }

    const container = document.createElement('div');
    container.id = 'cache_refresher_settings';
    container.innerHTML = html;
    extBlock.appendChild(container);

    // Bind settings
    bindCheckbox('cache_refresh_enabled', 'enabled', (v) => {
        if (!v) stopRefreshTimer();
        updateTimerVisibility();
    });
    bindNumber('cache_refresh_interval', 'interval', 1000, 30, 600);
    bindNumber('cache_refresh_max', 'maxRefreshes', 1, 1, 20);
    bindCheckbox('cache_refresh_notifications', 'showNotifications');
    bindCheckbox('cache_refresh_timer', 'showTimer', () => updateTimerVisibility());
    bindCheckbox('cache_refresh_debug', 'debug');

    document.getElementById('cache_refresh_stop')?.addEventListener('click', () => {
        stopRefreshTimer();
        refreshCount = 0;
        showNotification('Cache refresh timer stopped', 'info');
        updateTimerWidget();
    });

    document.getElementById('cache_refresh_reset_position')?.addEventListener('click', () => {
        const settings = getSettings();
        settings.timerX = null;
        settings.timerY = null;
        saveSettings();
        if (timerWidget) {
            timerWidget.style.left = 'auto';
            timerWidget.style.top = 'auto';
            timerWidget.style.bottom = '20px';
            timerWidget.style.right = '20px';
        }
        showNotification('Timer position reset', 'info');
    });

    log('Settings UI initialized');
}

function bindCheckbox(id, setting, callback) {
    const el = document.getElementById(id);
    if (!el) return;
    const settings = getSettings();
    el.checked = settings[setting];
    el.addEventListener('change', (e) => {
        settings[setting] = e.target.checked;
        saveSettings();
        callback?.(e.target.checked);
    });
}

function bindNumber(id, setting, multiplier = 1, min, max) {
    const el = document.getElementById(id);
    if (!el) return;
    const settings = getSettings();
    el.value = settings[setting] / multiplier;
    el.addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < min || val > max) {
            e.target.value = settings[setting] / multiplier;
            return;
        }
        settings[setting] = val * multiplier;
        saveSettings();
    });
}

// ============================================================================
// Initialization
// ============================================================================

async function init() {
    log('Initializing Cache Refresher v3.0.0');

    try {
        getSettings();
        await initSettingsUI();
        registerEventListeners();
        createTimerWidget();
        log('Initialization complete');
    } catch (error) {
        logError('Initialization failed:', error);
    }
}

function cleanup() {
    unregisterEventListeners();
    resetRefresherState();
    document.getElementById('cache_refresher_settings')?.remove();
    timerWidget?.remove();
    timerWidget = null;
    dragListenersRegistered = false;
}

export { MODULE_NAME, init, cleanup };

jQuery(async () => {
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        const { eventSource, event_types } = SillyTavern.getContext();
        eventSource.on(event_types.APP_READY, init);
    } else {
        logError('SillyTavern context not available');
    }
});
