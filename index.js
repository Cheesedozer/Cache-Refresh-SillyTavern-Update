/**
 * Cache Refresher & Monitor Extension for SillyTavern
 *
 * Cache Refresher: Automatically keeps LLM cache warm by sending periodic minimal requests.
 * Cache Monitor: Tracks Claude API prompt caching performance in real-time.
 *
 * Version: 2.1.0
 * Compatible with: SillyTavern 1.15.0+
 * Author: OneinfinityN7
 * Cache Monitor inspired by: zwheeler/SillyTavern-CacheMonitor
 * License: AGPL-3.0
 */

// Module identifier - must be unique
const MODULE_NAME = 'cache_refresher';
const LOG_PREFIX = '[CacheRefresher]';

// Claude model pricing (per million tokens)
const PRICING_MODELS = {
    'claude-sonnet-4.5': {
        name: 'Claude Sonnet 4.5',
        input: 3.00,
        output: 15.00,
        cacheWrite: 3.75,  // 25% more than input
        cacheRead: 0.30    // 90% less than input
    },
    'claude-opus-4.5': {
        name: 'Claude Opus 4.5',
        input: 15.00,
        output: 75.00,
        cacheWrite: 18.75,
        cacheRead: 1.50
    },
    'claude-haiku-4.5': {
        name: 'Claude Haiku 4.5',
        input: 0.80,
        output: 4.00,
        cacheWrite: 1.00,
        cacheRead: 0.08
    },
    'claude-sonnet-4': {
        name: 'Claude Sonnet 4',
        input: 3.00,
        output: 15.00,
        cacheWrite: 3.75,
        cacheRead: 0.30
    },
    'claude-opus-4': {
        name: 'Claude Opus 4',
        input: 15.00,
        output: 75.00,
        cacheWrite: 18.75,
        cacheRead: 1.50
    },
    'custom': {
        name: 'Custom',
        input: 3.00,
        output: 15.00,
        cacheWrite: 3.75,
        cacheRead: 0.30
    }
};

// Default settings
const defaultSettings = Object.freeze({
    // Cache Refresher settings
    enabled: true,
    interval: 240000, // 4 minutes (240 seconds) in milliseconds
    maxRefreshes: 5,
    showNotifications: true,
    showStatusIndicator: true,
    debug: false,
    // Cache Monitor settings
    monitorEnabled: true,
    showWidget: true,
    trackCost: true,
    widgetPosition: 'bottom-left',
    pricingModel: 'claude-sonnet-4.5',
    widgetMinimized: false
});

// State variables - Cache Refresher
let refreshTimer = null;
let refreshCount = 0;
let lastPromptData = null;
let currentChatId = null;
let statusIndicator = null;
let countdownInterval = null;
let secondsRemaining = 0;
let eventListenersRegistered = false;

// State variables - Cache Monitor
let monitorWidget = null;
let originalFetch = null;
let cacheStats = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    estimatedSavings: 0,
    lastRequestHit: null,
    lastCacheReadTokens: 0,
    lastCacheWriteTokens: 0
};

/**
 * Gets the current extension settings, initializing with defaults if needed.
 * @returns {Object} Current settings
 */
function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();

    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }

    // Ensure all default keys exist (helpful after updates)
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }

    return extensionSettings[MODULE_NAME];
}

/**
 * Saves the current settings
 */
function saveSettings() {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    saveSettingsDebounced();
}

/**
 * Logs a debug message if debug mode is enabled
 */
function debugLog(...args) {
    if (getSettings().debug) {
        console.log(LOG_PREFIX, ...args);
    }
}

/**
 * Logs an info message
 */
function log(...args) {
    console.log(LOG_PREFIX, ...args);
}

/**
 * Logs an error message
 */
function logError(...args) {
    console.error(LOG_PREFIX, ...args);
}

/**
 * Shows a notification to the user if notifications are enabled
 */
function showNotification(message, type = 'info') {
    const settings = getSettings();
    if (!settings.showNotifications) return;

    if (typeof toastr !== 'undefined') {
        switch (type) {
            case 'success':
                toastr.success(message);
                break;
            case 'error':
                toastr.error(message);
                break;
            case 'warning':
                toastr.warning(message);
                break;
            default:
                toastr.info(message);
        }
    }
}

// ============================================================================
// Cache Refresher Functions
// ============================================================================

/**
 * Creates or updates the floating status indicator for cache refresh
 */
function updateStatusIndicator() {
    const settings = getSettings();

    if (!settings.showStatusIndicator || !settings.enabled) {
        removeStatusIndicator();
        return;
    }

    if (!statusIndicator) {
        statusIndicator = document.createElement('div');
        statusIndicator.id = 'cache-refresh-indicator';
        statusIndicator.className = 'cache-refresh-indicator';
        document.body.appendChild(statusIndicator);
    }

    const minutes = Math.floor(secondsRemaining / 60);
    const seconds = secondsRemaining % 60;
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    const remainingRefreshes = settings.maxRefreshes - refreshCount;

    statusIndicator.innerHTML = `
        <div class="cache-refresh-indicator-content">
            <span class="cache-refresh-icon">🔄</span>
            <span class="cache-refresh-timer">${timeStr}</span>
            <span class="cache-refresh-count">(${remainingRefreshes} left)</span>
        </div>
    `;

    statusIndicator.style.display = 'flex';
}

/**
 * Removes the status indicator from the DOM
 */
function removeStatusIndicator() {
    if (statusIndicator) {
        statusIndicator.style.display = 'none';
    }
}

/**
 * Starts the countdown display
 */
function startCountdown() {
    const settings = getSettings();
    secondsRemaining = Math.floor(settings.interval / 1000);

    if (countdownInterval) {
        clearInterval(countdownInterval);
    }

    countdownInterval = setInterval(() => {
        secondsRemaining--;
        if (secondsRemaining >= 0) {
            updateStatusIndicator();
        }
    }, 1000);

    updateStatusIndicator();
}

/**
 * Stops the countdown display
 */
function stopCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    secondsRemaining = 0;
}

/**
 * Gets the current chat's unique identifier
 */
function getCurrentChatId() {
    const context = SillyTavern.getContext();

    if (context.selected_group) {
        return `group-${context.selected_group}`;
    }

    if (context.characterId !== undefined && context.characterId !== null) {
        const character = context.characters?.[context.characterId];
        if (character) {
            return context.chat_metadata?.file_name || character.name || `char-${context.characterId}`;
        }
    }

    return null;
}

/**
 * Captures the prompt data after a successful generation
 */
function capturePromptData(data) {
    const context = SillyTavern.getContext();
    const settings = getSettings();

    if (!settings.enabled) {
        debugLog('Extension disabled, not capturing prompt data');
        return;
    }

    try {
        const chat = context.chat;
        if (!chat || chat.length === 0) {
            debugLog('No chat messages available');
            return;
        }

        const newChatId = getCurrentChatId();

        if (newChatId !== currentChatId) {
            debugLog('Chat changed, resetting refresh counter');
            refreshCount = 0;
            currentChatId = newChatId;
        }

        lastPromptData = {
            chatId: newChatId,
            messageCount: chat.length,
            timestamp: Date.now(),
            lastMessageIds: chat.slice(-3).map((m, i) => m.id || `msg-${chat.length - 3 + i}`)
        };

        debugLog('Captured prompt data:', lastPromptData);
        startRefreshTimer();

    } catch (error) {
        logError('Error capturing prompt data:', error);
    }
}

/**
 * Sends a cache refresh request to keep the cache warm
 */
async function sendCacheRefresh() {
    const settings = getSettings();

    if (!settings.enabled) {
        stopRefreshTimer();
        return;
    }

    if (!lastPromptData) {
        debugLog('No prompt data available for refresh');
        stopRefreshTimer();
        return;
    }

    if (refreshCount >= settings.maxRefreshes) {
        debugLog('Max refreshes reached');
        showNotification('Cache refresh limit reached', 'info');
        stopRefreshTimer();
        return;
    }

    const currentId = getCurrentChatId();
    if (currentId !== lastPromptData.chatId) {
        debugLog('Chat changed, stopping refresh');
        stopRefreshTimer();
        return;
    }

    try {
        debugLog('Sending cache refresh request...');

        const { generateQuietPrompt } = SillyTavern.getContext();

        if (typeof generateQuietPrompt === 'function') {
            await generateQuietPrompt({
                quietPrompt: '',
                skipWIAN: true,
                maxTokens: 1,
                skipSanitize: true
            });
        } else {
            throw new Error('generateQuietPrompt not available');
        }

        refreshCount++;
        log(`Cache refresh ${refreshCount}/${settings.maxRefreshes} successful`);
        showNotification(`Cache refreshed (${refreshCount}/${settings.maxRefreshes})`, 'success');

        startRefreshTimer();

    } catch (error) {
        logError('Cache refresh failed:', error);
        showNotification('Cache refresh failed', 'error');

        setTimeout(() => {
            if (getSettings().enabled) {
                startRefreshTimer();
            }
        }, 5000);
    }
}

/**
 * Starts the refresh timer
 */
function startRefreshTimer() {
    const settings = getSettings();

    stopRefreshTimer();

    if (!settings.enabled) {
        return;
    }

    if (refreshCount >= settings.maxRefreshes) {
        debugLog('Max refreshes reached, not starting timer');
        return;
    }

    debugLog(`Starting refresh timer: ${settings.interval}ms`);

    startCountdown();

    refreshTimer = setTimeout(() => {
        sendCacheRefresh();
    }, settings.interval);
}

/**
 * Stops the refresh timer
 */
function stopRefreshTimer() {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }

    stopCountdown();
    removeStatusIndicator();

    debugLog('Refresh timer stopped');
}

/**
 * Resets all cache refresher state
 */
function resetRefresherState() {
    stopRefreshTimer();
    refreshCount = 0;
    lastPromptData = null;
    currentChatId = null;
}

// ============================================================================
// Cache Monitor Functions
// ============================================================================

/**
 * Creates the floating cache monitor widget
 */
function createMonitorWidget() {
    const settings = getSettings();

    if (monitorWidget) {
        monitorWidget.remove();
    }

    monitorWidget = document.createElement('div');
    monitorWidget.id = 'cache-monitor-widget';
    monitorWidget.className = `cache-monitor-widget cache-monitor-${settings.widgetPosition}`;

    updateWidgetContent();

    document.body.appendChild(monitorWidget);

    // Add click handler for minimize/expand
    const header = monitorWidget.querySelector('.cache-monitor-header');
    if (header) {
        header.addEventListener('click', toggleWidgetMinimized);
    }

    updateWidgetVisibility();
}

/**
 * Updates the widget content with current stats
 */
function updateWidgetContent() {
    if (!monitorWidget) return;

    const settings = getSettings();
    const hitRate = cacheStats.totalRequests > 0
        ? Math.round((cacheStats.cacheHits / cacheStats.totalRequests) * 100)
        : 0;

    const hitRateClass = hitRate >= 70 ? 'status-good' : hitRate >= 40 ? 'status-warning' : 'status-poor';

    const lastStatusClass = cacheStats.lastRequestHit === true ? 'hit' : cacheStats.lastRequestHit === false ? 'miss' : '';
    const lastStatusText = cacheStats.lastRequestHit === true ? 'HIT' : cacheStats.lastRequestHit === false ? 'MISS' : '-';

    const formatTokens = (tokens) => {
        if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
        if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
        return tokens.toString();
    };

    const isMinimized = settings.widgetMinimized;

    monitorWidget.innerHTML = `
        <div class="cache-monitor-header ${isMinimized ? 'minimized' : ''}">
            <span class="cache-monitor-title">📊 Cache Monitor</span>
            ${isMinimized ? `<span class="cache-monitor-mini-stat ${hitRateClass}">${hitRate}%</span>` : ''}
            <span class="cache-monitor-toggle">${isMinimized ? '▲' : '▼'}</span>
        </div>
        ${!isMinimized ? `
        <div class="cache-monitor-body">
            <div class="cache-monitor-last-request">
                <span class="last-status ${lastStatusClass}">${lastStatusText}</span>
                <span class="last-tokens">${formatTokens(cacheStats.lastCacheReadTokens)} read</span>
            </div>
            <div class="cache-monitor-stats">
                <div class="cache-monitor-stat main-stat">
                    <span class="stat-label">Hit Rate</span>
                    <span class="stat-value ${hitRateClass}">${hitRate}%</span>
                    <span class="stat-sublabel">${cacheStats.cacheHits}/${cacheStats.totalRequests} requests</span>
                </div>
                <div class="cache-monitor-stat-row">
                    <div class="cache-monitor-stat small">
                        <span class="stat-label">Cache Read</span>
                        <span class="stat-value">${formatTokens(cacheStats.cacheReadTokens)}</span>
                    </div>
                    <div class="cache-monitor-stat small">
                        <span class="stat-label">Cache Write</span>
                        <span class="stat-value">${formatTokens(cacheStats.cacheWriteTokens)}</span>
                    </div>
                </div>
                ${settings.trackCost ? `
                <div class="cache-monitor-stat-row cost-row">
                    <div class="cache-monitor-stat small savings">
                        <span class="stat-label">Est. Savings</span>
                        <span class="stat-value">$${cacheStats.estimatedSavings.toFixed(4)}</span>
                    </div>
                </div>
                ` : ''}
            </div>
        </div>
        ` : ''}
    `;

    // Re-attach header click handler
    const header = monitorWidget.querySelector('.cache-monitor-header');
    if (header) {
        header.addEventListener('click', toggleWidgetMinimized);
    }
}

/**
 * Toggles the widget minimized state
 */
function toggleWidgetMinimized() {
    const settings = getSettings();
    settings.widgetMinimized = !settings.widgetMinimized;
    saveSettings();
    updateWidgetContent();
}

/**
 * Updates the widget visibility based on settings
 */
function updateWidgetVisibility() {
    if (!monitorWidget) return;

    const settings = getSettings();

    if (settings.monitorEnabled && settings.showWidget) {
        monitorWidget.style.display = 'block';
    } else {
        monitorWidget.style.display = 'none';
    }
}

/**
 * Updates the widget position
 */
function updateWidgetPosition() {
    if (!monitorWidget) return;

    const settings = getSettings();

    // Remove all position classes
    monitorWidget.classList.remove(
        'cache-monitor-bottom-left',
        'cache-monitor-bottom-right',
        'cache-monitor-top-left',
        'cache-monitor-top-right'
    );

    // Add the current position class
    monitorWidget.classList.add(`cache-monitor-${settings.widgetPosition}`);
}

/**
 * Calculates cost savings based on cache usage
 */
function calculateSavings(cacheReadTokens, cacheWriteTokens, inputTokens) {
    const settings = getSettings();
    const pricing = PRICING_MODELS[settings.pricingModel] || PRICING_MODELS['claude-sonnet-4.5'];

    // Cost if all tokens were regular input
    const regularCost = (cacheReadTokens / 1000000) * pricing.input;

    // Actual cost with caching
    const cachedCost = (cacheReadTokens / 1000000) * pricing.cacheRead;

    // Savings = what we would have paid - what we actually paid
    const savings = regularCost - cachedCost;

    return Math.max(0, savings);
}

/**
 * Processes cache usage data from API response
 */
function processCacheUsage(usage) {
    if (!usage) return;

    const settings = getSettings();
    if (!settings.monitorEnabled) return;

    const cacheReadTokens = usage.cache_read_input_tokens || 0;
    const cacheWriteTokens = usage.cache_creation_input_tokens || 0;
    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;

    debugLog('Cache usage:', { cacheReadTokens, cacheWriteTokens, inputTokens, outputTokens });

    // Update stats
    cacheStats.totalRequests++;
    cacheStats.cacheReadTokens += cacheReadTokens;
    cacheStats.cacheWriteTokens += cacheWriteTokens;
    cacheStats.totalInputTokens += inputTokens;
    cacheStats.totalOutputTokens += outputTokens;
    cacheStats.lastCacheReadTokens = cacheReadTokens;
    cacheStats.lastCacheWriteTokens = cacheWriteTokens;

    // Determine if this was a cache hit (had cached tokens read)
    if (cacheReadTokens > 0) {
        cacheStats.cacheHits++;
        cacheStats.lastRequestHit = true;
    } else {
        cacheStats.cacheMisses++;
        cacheStats.lastRequestHit = false;
    }

    // Calculate savings
    if (settings.trackCost) {
        const savings = calculateSavings(cacheReadTokens, cacheWriteTokens, inputTokens);
        cacheStats.estimatedSavings += savings;
    }

    // Update widget
    updateWidgetContent();

    debugLog('Updated cache stats:', cacheStats);
}

/**
 * Intercepts fetch to monitor API responses for cache data
 */
function setupFetchInterceptor() {
    if (originalFetch) return; // Already set up

    originalFetch = window.fetch;

    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);

        try {
            const url = args[0]?.url || args[0];

            // Check if this is a chat completions request
            if (typeof url === 'string' && (
                url.includes('/chat/completions') ||
                url.includes('/v1/messages') ||
                url.includes('api.anthropic.com') ||
                url.includes('openrouter.ai')
            )) {
                // Clone the response so we can read it
                const clonedResponse = response.clone();

                // Handle streaming responses
                if (clonedResponse.headers.get('content-type')?.includes('text/event-stream')) {
                    handleStreamingResponse(clonedResponse);
                } else {
                    // Handle non-streaming responses
                    handleNonStreamingResponse(clonedResponse);
                }
            }
        } catch (error) {
            debugLog('Error in fetch interceptor:', error);
        }

        return response;
    };

    debugLog('Fetch interceptor installed');
}

/**
 * Handles streaming SSE responses
 */
async function handleStreamingResponse(response) {
    try {
        const reader = response.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE events
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);

                        // Check for usage in different response formats
                        if (parsed.usage) {
                            processCacheUsage(parsed.usage);
                        } else if (parsed.message?.usage) {
                            processCacheUsage(parsed.message.usage);
                        }

                        // Claude API format - check for message_delta with usage
                        if (parsed.type === 'message_delta' && parsed.usage) {
                            processCacheUsage(parsed.usage);
                        }

                        // Check for message_start which may contain usage
                        if (parsed.type === 'message_start' && parsed.message?.usage) {
                            processCacheUsage(parsed.message.usage);
                        }
                    } catch (e) {
                        // Not valid JSON, skip
                    }
                }
            }
        }
    } catch (error) {
        debugLog('Error handling streaming response:', error);
    }
}

/**
 * Handles non-streaming JSON responses
 */
async function handleNonStreamingResponse(response) {
    try {
        const data = await response.json();

        if (data.usage) {
            processCacheUsage(data.usage);
        } else if (data.message?.usage) {
            processCacheUsage(data.message.usage);
        }
    } catch (error) {
        debugLog('Error handling non-streaming response:', error);
    }
}

/**
 * Removes the fetch interceptor
 */
function removeFetchInterceptor() {
    if (originalFetch) {
        window.fetch = originalFetch;
        originalFetch = null;
        debugLog('Fetch interceptor removed');
    }
}

/**
 * Resets cache monitor statistics
 */
function resetCacheStats() {
    cacheStats = {
        totalRequests: 0,
        cacheHits: 0,
        cacheMisses: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        estimatedSavings: 0,
        lastRequestHit: null,
        lastCacheReadTokens: 0,
        lastCacheWriteTokens: 0
    };

    updateWidgetContent();
    showNotification('Cache statistics reset', 'info');
    log('Cache statistics reset');
}

// ============================================================================
// Event Handlers
// ============================================================================

function onChatChanged(chatId) {
    debugLog('Chat changed event received');

    const newChatId = getCurrentChatId();

    if (newChatId !== currentChatId) {
        log('Chat changed, resetting cache refresh state');
        resetRefresherState();
    }
}

function onGenerationEnded(data) {
    debugLog('Generation ended event received', data);
    capturePromptData(data);
}

function onGenerationStopped() {
    debugLog('Generation stopped by user');
}

function registerEventListeners() {
    if (eventListenersRegistered) {
        return;
    }

    const { eventSource, event_types } = SillyTavern.getContext();

    if (!eventSource || !event_types) {
        logError('Event system not available');
        return;
    }

    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
    eventSource.on(event_types.GENERATION_STOPPED, onGenerationStopped);

    eventListenersRegistered = true;
    debugLog('Event listeners registered');
}

function unregisterEventListeners() {
    if (!eventListenersRegistered) {
        return;
    }

    const { eventSource, event_types } = SillyTavern.getContext();

    if (!eventSource || !event_types) {
        return;
    }

    eventSource.removeListener(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.removeListener(event_types.GENERATION_ENDED, onGenerationEnded);
    eventSource.removeListener(event_types.GENERATION_STOPPED, onGenerationStopped);

    eventListenersRegistered = false;
    debugLog('Event listeners unregistered');
}

// ============================================================================
// Settings UI
// ============================================================================

function getExtensionPath() {
    const scripts = document.querySelectorAll('script[src*="cache"]');
    for (const script of scripts) {
        const src = script.getAttribute('src');
        if (src && src.includes('index.js')) {
            return src.replace('/index.js', '');
        }
    }

    return '/scripts/extensions/third-party/Cache-Refresh-SillyTavern-Update';
}

async function initSettingsUI() {
    const settings = getSettings();
    const extensionPath = getExtensionPath();

    const response = await fetch(`${extensionPath}/cache-refresher.html`);
    if (!response.ok) {
        logError('Failed to load settings template');
        return;
    }

    const html = await response.text();

    const extensionsBlock = document.getElementById('extensions_settings');
    if (!extensionsBlock) {
        logError('Extensions settings block not found');
        return;
    }

    const settingsContainer = document.createElement('div');
    settingsContainer.id = 'cache_refresher_settings';
    settingsContainer.innerHTML = html;
    extensionsBlock.appendChild(settingsContainer);

    // Cache Refresher settings
    const enabledCheckbox = document.getElementById('cache_refresh_enabled');
    const intervalInput = document.getElementById('cache_refresh_interval');
    const maxRefreshesInput = document.getElementById('cache_refresh_max');
    const notificationsCheckbox = document.getElementById('cache_refresh_notifications');
    const statusCheckbox = document.getElementById('cache_refresh_status');
    const debugCheckbox = document.getElementById('cache_refresh_debug');
    const stopButton = document.getElementById('cache_refresh_stop');

    // Cache Monitor settings
    const monitorEnabledCheckbox = document.getElementById('cache_monitor_enabled');
    const widgetCheckbox = document.getElementById('cache_monitor_widget');
    const costCheckbox = document.getElementById('cache_monitor_cost');
    const positionSelect = document.getElementById('cache_monitor_position');
    const pricingSelect = document.getElementById('cache_monitor_pricing');
    const resetButton = document.getElementById('cache_monitor_reset');

    // Initialize Cache Refresher UI
    if (enabledCheckbox) {
        enabledCheckbox.checked = settings.enabled;
        enabledCheckbox.addEventListener('change', (e) => {
            settings.enabled = e.target.checked;
            saveSettings();
            if (!settings.enabled) {
                stopRefreshTimer();
            }
            log(`Cache Refresher ${settings.enabled ? 'enabled' : 'disabled'}`);
        });
    }

    if (intervalInput) {
        intervalInput.value = settings.interval / 1000;
        intervalInput.addEventListener('change', (e) => {
            const seconds = parseInt(e.target.value, 10);
            if (!isNaN(seconds) && seconds >= 30 && seconds <= 600) {
                settings.interval = seconds * 1000;
                saveSettings();
                log(`Interval set to ${seconds} seconds`);
            } else {
                e.target.value = settings.interval / 1000;
                showNotification('Interval must be between 30 and 600 seconds', 'warning');
            }
        });
    }

    if (maxRefreshesInput) {
        maxRefreshesInput.value = settings.maxRefreshes;
        maxRefreshesInput.addEventListener('change', (e) => {
            const max = parseInt(e.target.value, 10);
            if (!isNaN(max) && max >= 1 && max <= 20) {
                settings.maxRefreshes = max;
                saveSettings();
                log(`Max refreshes set to ${max}`);
            } else {
                e.target.value = settings.maxRefreshes;
                showNotification('Max refreshes must be between 1 and 20', 'warning');
            }
        });
    }

    if (notificationsCheckbox) {
        notificationsCheckbox.checked = settings.showNotifications;
        notificationsCheckbox.addEventListener('change', (e) => {
            settings.showNotifications = e.target.checked;
            saveSettings();
        });
    }

    if (statusCheckbox) {
        statusCheckbox.checked = settings.showStatusIndicator;
        statusCheckbox.addEventListener('change', (e) => {
            settings.showStatusIndicator = e.target.checked;
            saveSettings();
            if (!settings.showStatusIndicator) {
                removeStatusIndicator();
            } else if (refreshTimer) {
                updateStatusIndicator();
            }
        });
    }

    if (debugCheckbox) {
        debugCheckbox.checked = settings.debug;
        debugCheckbox.addEventListener('change', (e) => {
            settings.debug = e.target.checked;
            saveSettings();
        });
    }

    if (stopButton) {
        stopButton.addEventListener('click', () => {
            stopRefreshTimer();
            refreshCount = 0;
            showNotification('Cache refresh timer stopped', 'info');
        });
    }

    // Initialize Cache Monitor UI
    if (monitorEnabledCheckbox) {
        monitorEnabledCheckbox.checked = settings.monitorEnabled;
        monitorEnabledCheckbox.addEventListener('change', (e) => {
            settings.monitorEnabled = e.target.checked;
            saveSettings();
            updateWidgetVisibility();
            if (settings.monitorEnabled) {
                setupFetchInterceptor();
            }
            log(`Cache Monitor ${settings.monitorEnabled ? 'enabled' : 'disabled'}`);
        });
    }

    if (widgetCheckbox) {
        widgetCheckbox.checked = settings.showWidget;
        widgetCheckbox.addEventListener('change', (e) => {
            settings.showWidget = e.target.checked;
            saveSettings();
            updateWidgetVisibility();
        });
    }

    if (costCheckbox) {
        costCheckbox.checked = settings.trackCost;
        costCheckbox.addEventListener('change', (e) => {
            settings.trackCost = e.target.checked;
            saveSettings();
            updateWidgetContent();
        });
    }

    if (positionSelect) {
        positionSelect.value = settings.widgetPosition;
        positionSelect.addEventListener('change', (e) => {
            settings.widgetPosition = e.target.value;
            saveSettings();
            updateWidgetPosition();
        });
    }

    if (pricingSelect) {
        pricingSelect.value = settings.pricingModel;
        pricingSelect.addEventListener('change', (e) => {
            settings.pricingModel = e.target.value;
            saveSettings();
        });
    }

    if (resetButton) {
        resetButton.addEventListener('click', resetCacheStats);
    }

    log('Settings UI initialized');
}

// ============================================================================
// Initialization
// ============================================================================

async function init() {
    log('Initializing Cache Refresher & Monitor extension v2.1.0');

    try {
        getSettings();

        await initSettingsUI();

        registerEventListeners();

        // Initialize Cache Monitor
        const settings = getSettings();
        if (settings.monitorEnabled) {
            setupFetchInterceptor();
        }

        // Create the monitor widget
        createMonitorWidget();

        log('Initialization complete');

    } catch (error) {
        logError('Initialization failed:', error);
    }
}

function cleanup() {
    log('Cleaning up Cache Refresher & Monitor extension');

    unregisterEventListeners();
    resetRefresherState();
    removeFetchInterceptor();

    const settingsContainer = document.getElementById('cache_refresher_settings');
    if (settingsContainer) {
        settingsContainer.remove();
    }

    if (statusIndicator) {
        statusIndicator.remove();
        statusIndicator = null;
    }

    if (monitorWidget) {
        monitorWidget.remove();
        monitorWidget = null;
    }
}

// Export for SillyTavern's module system
export { MODULE_NAME, init, cleanup };

// Wait for SillyTavern to be ready
jQuery(async () => {
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        const { eventSource, event_types } = SillyTavern.getContext();
        eventSource.on(event_types.APP_READY, init);
    } else {
        logError('SillyTavern context not available. Make sure you are running SillyTavern 1.15.0 or later.');
    }
});
