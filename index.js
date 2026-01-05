/**
 * Cache Refresher & Monitor Extension for SillyTavern
 *
 * Cache Refresher: Keeps LLM cache warm with periodic minimal requests.
 * Cache Monitor: Tracks Claude API prompt caching performance in real-time.
 *
 * Version: 2.1.0
 * Compatible with: SillyTavern 1.15.0+
 * Author: OneinfinityN7
 * Cache Monitor inspired by: zwheeler/SillyTavern-CacheMonitor
 * License: AGPL-3.0
 */

const MODULE_NAME = 'cache_refresher';
const LOG_PREFIX = '[CacheRefresher]';
const CACHE_TTL_SECONDS = 300; // 5 minutes

// Claude pricing (per million tokens)
const PRICING_MODELS = {
    'claude-sonnet-4': { input: 3.00, cacheWrite: 3.75, cacheRead: 0.30 },
    'claude-sonnet-4.5': { input: 3.00, cacheWrite: 3.75, cacheRead: 0.30 },
    'claude-opus-4': { input: 15.00, cacheWrite: 18.75, cacheRead: 1.50 },
    'claude-opus-4.5': { input: 15.00, cacheWrite: 18.75, cacheRead: 1.50 },
    'claude-haiku-4.5': { input: 0.80, cacheWrite: 1.00, cacheRead: 0.08 },
    'claude-3.5-sonnet': { input: 3.00, cacheWrite: 3.75, cacheRead: 0.30 },
    'claude-3.5-haiku': { input: 0.80, cacheWrite: 1.00, cacheRead: 0.08 },
    'claude-3-opus': { input: 15.00, cacheWrite: 18.75, cacheRead: 1.50 }
};

// Default settings
const defaultSettings = Object.freeze({
    // Cache Refresher
    enabled: true,
    interval: 240000,
    maxRefreshes: 5,
    showNotifications: true,
    showStatusIndicator: true,
    debug: false,
    // Cache Monitor
    monitorEnabled: true,
    showWidget: true,
    trackCost: true,
    widgetPosition: 'bottom-right',
    pricingModel: 'claude-sonnet-4',
    widgetMinimized: false,
    consecutiveMissWarning: 3,
    showTTLTimer: true,
    // Widget position (for dragging)
    widgetX: null,
    widgetY: null
});

// State - Cache Refresher
let refreshTimer = null;
let refreshCount = 0;
let lastPromptData = null;
let currentChatId = null;
let statusIndicator = null;
let countdownInterval = null;
let secondsRemaining = 0;
let eventListenersRegistered = false;

// State - Cache Monitor
let monitorWidget = null;
let originalFetch = null;
let ttlInterval = null;
let lastCacheHitTime = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

// Session statistics
let sessionStats = {
    requests: 0,
    hits: 0,
    misses: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    savings: 0,
    consecutiveMisses: 0,
    history: []
};

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

function formatTokens(tokens) {
    if (tokens >= 1000000) return (tokens / 1000000).toFixed(2) + 'M';
    if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
    return tokens.toLocaleString();
}

function formatCost(cost) {
    if (cost < 0.0001) return '$0.0000';
    if (cost < 0.01) return '$' + cost.toFixed(4);
    return '$' + cost.toFixed(3);
}

// ============================================================================
// Cache Refresher Functions
// ============================================================================

function updateStatusIndicator() {
    const settings = getSettings();
    if (!settings.showStatusIndicator || !settings.enabled) {
        if (statusIndicator) statusIndicator.style.display = 'none';
        return;
    }

    if (!statusIndicator) {
        statusIndicator = document.createElement('div');
        statusIndicator.id = 'cache-refresh-indicator';
        statusIndicator.className = 'cache-refresh-indicator';
        document.body.appendChild(statusIndicator);
    }

    const mins = Math.floor(secondsRemaining / 60);
    const secs = secondsRemaining % 60;
    const remaining = settings.maxRefreshes - refreshCount;

    statusIndicator.innerHTML = `
        <div class="cache-refresh-indicator-content">
            <span class="cache-refresh-icon">🔄</span>
            <span class="cache-refresh-timer">${mins}:${secs.toString().padStart(2, '0')}</span>
            <span class="cache-refresh-count">(${remaining} left)</span>
        </div>
    `;
    statusIndicator.style.display = 'flex';
}

function startCountdown() {
    const settings = getSettings();
    secondsRemaining = Math.floor(settings.interval / 1000);
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        secondsRemaining--;
        if (secondsRemaining >= 0) updateStatusIndicator();
    }, 1000);
    updateStatusIndicator();
}

function stopCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    secondsRemaining = 0;
}

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
    if (!settings.enabled || refreshCount >= settings.maxRefreshes) return;

    startCountdown();
    refreshTimer = setTimeout(sendCacheRefresh, settings.interval);
}

function stopRefreshTimer() {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }
    stopCountdown();
    if (statusIndicator) statusIndicator.style.display = 'none';
}

function resetRefresherState() {
    stopRefreshTimer();
    refreshCount = 0;
    lastPromptData = null;
    currentChatId = null;
}

// ============================================================================
// Cache Monitor Functions
// ============================================================================

function createMonitorWidget() {
    if (monitorWidget) monitorWidget.remove();

    const settings = getSettings();
    monitorWidget = document.createElement('div');
    monitorWidget.id = 'cache-monitor-widget';

    // Apply saved position or default
    if (settings.widgetX !== null && settings.widgetY !== null) {
        monitorWidget.style.left = settings.widgetX + 'px';
        monitorWidget.style.top = settings.widgetY + 'px';
        monitorWidget.style.right = 'auto';
        monitorWidget.style.bottom = 'auto';
    } else {
        applyWidgetPosition();
    }

    document.body.appendChild(monitorWidget);
    updateWidgetContent();
    updateWidgetVisibility();
    setupWidgetDragging();
    startTTLTimer();
}

function applyWidgetPosition() {
    if (!monitorWidget) return;
    const settings = getSettings();

    // Reset all position properties
    monitorWidget.style.top = 'auto';
    monitorWidget.style.bottom = 'auto';
    monitorWidget.style.left = 'auto';
    monitorWidget.style.right = 'auto';

    switch (settings.widgetPosition) {
        case 'top-left':
            monitorWidget.style.top = '80px';
            monitorWidget.style.left = '20px';
            break;
        case 'top-right':
            monitorWidget.style.top = '80px';
            monitorWidget.style.right = '20px';
            break;
        case 'bottom-left':
            monitorWidget.style.bottom = '20px';
            monitorWidget.style.left = '20px';
            break;
        case 'bottom-right':
        default:
            monitorWidget.style.bottom = '20px';
            monitorWidget.style.right = '20px';
            break;
    }
}

function setupWidgetDragging() {
    if (!monitorWidget) return;

    const header = monitorWidget.querySelector('.cm-header');
    if (!header) return;

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.cm-toggle') || e.target.closest('.cm-close')) return;

        isDragging = true;
        const rect = monitorWidget.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        monitorWidget.style.cursor = 'grabbing';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const x = e.clientX - dragOffset.x;
        const y = e.clientY - dragOffset.y;

        // Keep widget within viewport
        const maxX = window.innerWidth - monitorWidget.offsetWidth;
        const maxY = window.innerHeight - monitorWidget.offsetHeight;

        monitorWidget.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
        monitorWidget.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
        monitorWidget.style.right = 'auto';
        monitorWidget.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            monitorWidget.style.cursor = '';

            // Save position
            const settings = getSettings();
            settings.widgetX = parseInt(monitorWidget.style.left);
            settings.widgetY = parseInt(monitorWidget.style.top);
            saveSettings();
        }
    });
}

function getTTLRemaining() {
    if (!lastCacheHitTime) return 0;
    const elapsed = (Date.now() - lastCacheHitTime) / 1000;
    return Math.max(0, CACHE_TTL_SECONDS - elapsed);
}

function startTTLTimer() {
    if (ttlInterval) clearInterval(ttlInterval);
    ttlInterval = setInterval(() => {
        if (getSettings().showWidget && getSettings().showTTLTimer) {
            updateTTLDisplay();
        }
    }, 1000);
}

function updateTTLDisplay() {
    const ttlFill = monitorWidget?.querySelector('.cm-ttl-fill');
    const ttlText = monitorWidget?.querySelector('.cm-ttl-text');
    if (!ttlFill || !ttlText) return;

    const remaining = getTTLRemaining();
    const percent = (remaining / CACHE_TTL_SECONDS) * 100;

    ttlFill.style.width = percent + '%';

    if (remaining <= 0) {
        ttlText.textContent = 'Cache expired';
        ttlFill.className = 'cm-ttl-fill expired';
    } else {
        const mins = Math.floor(remaining / 60);
        const secs = Math.floor(remaining % 60);
        ttlText.textContent = `TTL: ${mins}:${secs.toString().padStart(2, '0')}`;
        ttlFill.className = 'cm-ttl-fill ' + (percent > 50 ? 'good' : percent > 20 ? 'warning' : 'critical');
    }
}

function updateWidgetContent() {
    if (!monitorWidget) return;
    const settings = getSettings();
    const isMin = settings.widgetMinimized;

    const hitRate = sessionStats.requests > 0
        ? Math.round((sessionStats.hits / sessionStats.requests) * 100)
        : 0;

    const hitRateClass = hitRate >= 70 ? 'good' : hitRate >= 40 ? 'warning' : 'poor';
    const lastHit = sessionStats.history[sessionStats.history.length - 1];
    const lastStatus = lastHit ? (lastHit.isHit ? 'hit' : 'miss') : 'none';

    monitorWidget.innerHTML = `
        <div class="cm-header" title="Drag to move">
            <div class="cm-title">
                <span class="cm-icon">📊</span>
                <span>Cache Monitor</span>
                ${isMin ? `<span class="cm-mini-rate ${hitRateClass}">${hitRate}%</span>` : ''}
            </div>
            <div class="cm-controls">
                <button class="cm-toggle" title="${isMin ? 'Expand' : 'Collapse'}">${isMin ? '▲' : '▼'}</button>
            </div>
        </div>
        ${!isMin ? `
        <div class="cm-body">
            <!-- Last Request Status -->
            <div class="cm-last-request ${lastStatus}">
                <div class="cm-last-label">Last Request</div>
                <div class="cm-last-status">
                    ${lastHit ? `
                        <span class="cm-status-badge ${lastStatus}">${lastHit.isHit ? '✓ HIT' : '✗ MISS'}</span>
                        <span class="cm-last-tokens">${formatTokens(lastHit.cacheRead)} cached</span>
                    ` : '<span class="cm-status-badge none">No data</span>'}
                </div>
            </div>

            <!-- Consecutive Miss Warning -->
            ${sessionStats.consecutiveMisses >= settings.consecutiveMissWarning ? `
            <div class="cm-warning">
                <span class="cm-warning-icon">⚠️</span>
                <span>${sessionStats.consecutiveMisses} consecutive misses - check prompt stability</span>
            </div>
            ` : ''}

            <!-- TTL Timer -->
            ${settings.showTTLTimer ? `
            <div class="cm-ttl">
                <div class="cm-ttl-bar">
                    <div class="cm-ttl-fill good" style="width: ${(getTTLRemaining() / CACHE_TTL_SECONDS) * 100}%"></div>
                </div>
                <div class="cm-ttl-text">TTL: --:--</div>
            </div>
            ` : ''}

            <!-- Main Stats -->
            <div class="cm-stats-grid">
                <div class="cm-stat main">
                    <div class="cm-stat-value ${hitRateClass}">${hitRate}%</div>
                    <div class="cm-stat-label">Hit Rate</div>
                    <div class="cm-stat-sub">${sessionStats.hits}/${sessionStats.requests} requests</div>
                </div>
            </div>

            <!-- Token Stats -->
            <div class="cm-stats-row">
                <div class="cm-stat">
                    <div class="cm-stat-value">${formatTokens(sessionStats.cacheReadTokens)}</div>
                    <div class="cm-stat-label">Cache Read</div>
                </div>
                <div class="cm-stat">
                    <div class="cm-stat-value">${formatTokens(sessionStats.cacheWriteTokens)}</div>
                    <div class="cm-stat-label">Cache Write</div>
                </div>
            </div>

            <!-- Cost Savings -->
            ${settings.trackCost ? `
            <div class="cm-savings">
                <div class="cm-savings-label">Estimated Savings</div>
                <div class="cm-savings-value">${formatCost(sessionStats.savings)}</div>
            </div>
            ` : ''}

            <!-- Action Buttons -->
            <div class="cm-actions">
                <button class="cm-btn cm-btn-history" title="View History">📋 History</button>
                <button class="cm-btn cm-btn-reset" title="Reset Stats">🔄 Reset</button>
            </div>
        </div>
        ` : ''}
    `;

    // Re-attach event listeners
    const toggle = monitorWidget.querySelector('.cm-toggle');
    if (toggle) toggle.addEventListener('click', toggleWidgetMinimized);

    const resetBtn = monitorWidget.querySelector('.cm-btn-reset');
    if (resetBtn) resetBtn.addEventListener('click', resetCacheStats);

    const historyBtn = monitorWidget.querySelector('.cm-btn-history');
    if (historyBtn) historyBtn.addEventListener('click', showHistoryModal);

    setupWidgetDragging();

    if (settings.showTTLTimer && !isMin) {
        updateTTLDisplay();
    }
}

function toggleWidgetMinimized(e) {
    e?.stopPropagation();
    const settings = getSettings();
    settings.widgetMinimized = !settings.widgetMinimized;
    saveSettings();
    updateWidgetContent();
}

function updateWidgetVisibility() {
    if (!monitorWidget) return;
    const settings = getSettings();
    monitorWidget.style.display = (settings.monitorEnabled && settings.showWidget) ? 'block' : 'none';
}

function showHistoryModal() {
    // Remove existing modal
    document.getElementById('cache-history-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'cache-history-modal';
    modal.className = 'cm-modal';

    const recentHistory = sessionStats.history.slice(-50).reverse();

    modal.innerHTML = `
        <div class="cm-modal-backdrop"></div>
        <div class="cm-modal-content">
            <div class="cm-modal-header">
                <h3>Cache History (Last 50 Requests)</h3>
                <button class="cm-modal-close">&times;</button>
            </div>
            <div class="cm-modal-body">
                <table class="cm-history-table">
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Status</th>
                            <th>Cache Read</th>
                            <th>Cache Write</th>
                            <th>Input</th>
                            <th>Output</th>
                            <th>Savings</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${recentHistory.map(h => `
                            <tr class="${h.isHit ? 'hit-row' : 'miss-row'}">
                                <td>${new Date(h.timestamp).toLocaleTimeString()}</td>
                                <td><span class="cm-status-badge ${h.isHit ? 'hit' : 'miss'}">${h.isHit ? 'HIT' : 'MISS'}</span></td>
                                <td class="${h.cacheRead > 0 ? 'good' : ''}">${formatTokens(h.cacheRead)}</td>
                                <td>${formatTokens(h.cacheWrite)}</td>
                                <td>${formatTokens(h.input)}</td>
                                <td>${formatTokens(h.output)}</td>
                                <td class="good">${formatCost(h.savings)}</td>
                            </tr>
                        `).join('') || '<tr><td colspan="7" style="text-align:center">No history yet</td></tr>'}
                    </tbody>
                </table>
            </div>
            <div class="cm-modal-footer">
                <div class="cm-modal-stats">
                    <span><strong>Total Requests:</strong> ${sessionStats.requests}</span>
                    <span><strong>Hit Rate:</strong> <span class="${sessionStats.requests > 0 && (sessionStats.hits/sessionStats.requests) >= 0.7 ? 'good' : ''}">${sessionStats.requests > 0 ? Math.round((sessionStats.hits/sessionStats.requests)*100) : 0}%</span></span>
                    <span><strong>Total Savings:</strong> <span class="good">${formatCost(sessionStats.savings)}</span></span>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.cm-modal-backdrop').addEventListener('click', () => modal.remove());
    modal.querySelector('.cm-modal-close').addEventListener('click', () => modal.remove());
}

function calculateSavings(cacheReadTokens) {
    const settings = getSettings();
    const pricing = PRICING_MODELS[settings.pricingModel] || PRICING_MODELS['claude-sonnet-4'];

    // Savings = cost if read as regular input - cost as cached read
    const regularCost = (cacheReadTokens / 1_000_000) * pricing.input;
    const cachedCost = (cacheReadTokens / 1_000_000) * pricing.cacheRead;

    return Math.max(0, regularCost - cachedCost);
}

function processCacheUsage(usage) {
    if (!usage) return;
    const settings = getSettings();
    if (!settings.monitorEnabled) return;

    const cacheRead = usage.cache_read_input_tokens || 0;
    const cacheWrite = usage.cache_creation_input_tokens || 0;
    const input = usage.input_tokens || 0;
    const output = usage.output_tokens || 0;

    debugLog('Cache usage:', { cacheRead, cacheWrite, input, output });

    const isHit = cacheRead > 0;
    const savings = calculateSavings(cacheRead);

    // Update session stats
    sessionStats.requests++;
    sessionStats.cacheReadTokens += cacheRead;
    sessionStats.cacheWriteTokens += cacheWrite;
    sessionStats.inputTokens += input;
    sessionStats.outputTokens += output;
    sessionStats.savings += savings;

    if (isHit) {
        sessionStats.hits++;
        sessionStats.consecutiveMisses = 0;
        lastCacheHitTime = Date.now();
    } else {
        sessionStats.misses++;
        sessionStats.consecutiveMisses++;

        // Show warning for consecutive misses
        if (sessionStats.consecutiveMisses === settings.consecutiveMissWarning) {
            showNotification(`⚠️ ${sessionStats.consecutiveMisses} consecutive cache misses - check prompt stability`, 'warning');
        }
    }

    // Add to history
    const historyEntry = {
        timestamp: Date.now(),
        isHit,
        cacheRead,
        cacheWrite,
        input,
        output,
        savings
    };
    sessionStats.history.push(historyEntry);

    // Keep history manageable
    if (sessionStats.history.length > 100) {
        sessionStats.history = sessionStats.history.slice(-100);
    }

    // Save to message metadata
    saveToMessageMetadata(historyEntry);

    // Update widget
    updateWidgetContent();

    debugLog('Updated stats:', sessionStats);
}

function saveToMessageMetadata(cacheData) {
    try {
        const ctx = SillyTavern.getContext();
        const chat = ctx.chat;
        if (!chat?.length) return;

        const lastMessage = chat[chat.length - 1];
        if (!lastMessage) return;

        // Initialize cache data on message if not present
        if (!lastMessage.extra) lastMessage.extra = {};
        lastMessage.extra.cache_stats = {
            timestamp: cacheData.timestamp,
            isHit: cacheData.isHit,
            cacheRead: cacheData.cacheRead,
            cacheWrite: cacheData.cacheWrite,
            input: cacheData.input,
            output: cacheData.output,
            savings: cacheData.savings
        };

        debugLog('Saved cache data to message metadata');
    } catch (error) {
        debugLog('Error saving to message metadata:', error);
    }
}

function setupFetchInterceptor() {
    if (originalFetch) return;
    originalFetch = window.fetch;

    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);

        try {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

            if (url && (
                url.includes('/chat/completions') ||
                url.includes('/v1/messages') ||
                url.includes('api.anthropic.com') ||
                url.includes('openrouter.ai') ||
                url.includes('/api/backends/chat-completions/generate')
            )) {
                const cloned = response.clone();
                const contentType = cloned.headers.get('content-type') || '';

                if (contentType.includes('text/event-stream')) {
                    handleStreamingResponse(cloned);
                } else if (contentType.includes('application/json')) {
                    handleNonStreamingResponse(cloned);
                }
            }
        } catch (error) {
            debugLog('Fetch interceptor error:', error);
        }

        return response;
    };

    debugLog('Fetch interceptor installed');
}

async function handleStreamingResponse(response) {
    try {
        const reader = response.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = '';
        let usageProcessed = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;

                try {
                    const parsed = JSON.parse(data);

                    // Look for usage in various formats
                    let usage = null;

                    if (parsed.usage) {
                        usage = parsed.usage;
                    } else if (parsed.message?.usage) {
                        usage = parsed.message.usage;
                    } else if (parsed.type === 'message_delta' && parsed.usage) {
                        usage = parsed.usage;
                    } else if (parsed.type === 'message_start' && parsed.message?.usage) {
                        usage = parsed.message.usage;
                    }

                    if (usage && !usageProcessed) {
                        // Check if this has actual cache data
                        if (usage.cache_read_input_tokens !== undefined ||
                            usage.cache_creation_input_tokens !== undefined ||
                            usage.input_tokens !== undefined) {
                            processCacheUsage(usage);
                            usageProcessed = true;
                        }
                    }
                } catch (e) {
                    // Not valid JSON, skip
                }
            }
        }
    } catch (error) {
        debugLog('Streaming response error:', error);
    }
}

async function handleNonStreamingResponse(response) {
    try {
        const data = await response.json();
        const usage = data.usage || data.message?.usage;
        if (usage) processCacheUsage(usage);
    } catch (error) {
        debugLog('Non-streaming response error:', error);
    }
}

function removeFetchInterceptor() {
    if (originalFetch) {
        window.fetch = originalFetch;
        originalFetch = null;
    }
}

function resetCacheStats() {
    sessionStats = {
        requests: 0,
        hits: 0,
        misses: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        savings: 0,
        consecutiveMisses: 0,
        history: []
    };
    lastCacheHitTime = null;
    updateWidgetContent();
    showNotification('Cache statistics reset', 'info');
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

    // Cache Refresher settings
    bindCheckbox('cache_refresh_enabled', 'enabled', (v) => !v && stopRefreshTimer());
    bindNumber('cache_refresh_interval', 'interval', 1000, 30, 600);
    bindNumber('cache_refresh_max', 'maxRefreshes', 1, 1, 20);
    bindCheckbox('cache_refresh_notifications', 'showNotifications');
    bindCheckbox('cache_refresh_status', 'showStatusIndicator', (v) => !v && statusIndicator && (statusIndicator.style.display = 'none'));
    bindCheckbox('cache_refresh_debug', 'debug');

    document.getElementById('cache_refresh_stop')?.addEventListener('click', () => {
        stopRefreshTimer();
        refreshCount = 0;
        showNotification('Cache refresh timer stopped', 'info');
    });

    // Cache Monitor settings
    bindCheckbox('cache_monitor_enabled', 'monitorEnabled', (v) => {
        updateWidgetVisibility();
        if (v) setupFetchInterceptor();
    });
    bindCheckbox('cache_monitor_widget', 'showWidget', () => updateWidgetVisibility());
    bindCheckbox('cache_monitor_cost', 'trackCost', () => updateWidgetContent());
    bindSelect('cache_monitor_position', 'widgetPosition', () => {
        const settings = getSettings();
        settings.widgetX = null;
        settings.widgetY = null;
        saveSettings();
        applyWidgetPosition();
    });
    bindSelect('cache_monitor_pricing', 'pricingModel');

    document.getElementById('cache_monitor_reset')?.addEventListener('click', resetCacheStats);

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

function bindSelect(id, setting, callback) {
    const el = document.getElementById(id);
    if (!el) return;
    const settings = getSettings();
    el.value = settings[setting];
    el.addEventListener('change', (e) => {
        settings[setting] = e.target.value;
        saveSettings();
        callback?.();
    });
}

// ============================================================================
// Initialization
// ============================================================================

async function init() {
    log('Initializing Cache Refresher & Monitor v2.1.0');

    try {
        getSettings();
        await initSettingsUI();
        registerEventListeners();

        const settings = getSettings();
        if (settings.monitorEnabled) {
            setupFetchInterceptor();
        }

        createMonitorWidget();
        log('Initialization complete');
    } catch (error) {
        logError('Initialization failed:', error);
    }
}

function cleanup() {
    unregisterEventListeners();
    resetRefresherState();
    removeFetchInterceptor();

    if (ttlInterval) clearInterval(ttlInterval);
    document.getElementById('cache_refresher_settings')?.remove();
    statusIndicator?.remove();
    monitorWidget?.remove();
    document.getElementById('cache-history-modal')?.remove();

    statusIndicator = null;
    monitorWidget = null;
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
