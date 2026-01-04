/**
 * Cache Refresher Extension for SillyTavern
 * Automatically keeps LLM cache warm by sending periodic minimal requests.
 * 
 * Version: 2.0.0
 * Compatible with: SillyTavern 1.15.0+
 * Author: OneinfinityN7
 * License: AGPL-3.0
 * 
 * Changelog v2.0.0:
 * - Migrated to SillyTavern.getContext() API for stability
 * - Updated event handling for v1.15.0 compatibility
 * - Improved error handling and cleanup
 * - Added support for new Chat Completion API patterns
 */

// Module identifier - must be unique
const MODULE_NAME = 'cache_refresher';
const LOG_PREFIX = '[CacheRefresher]';

// Default settings
const defaultSettings = Object.freeze({
    enabled: true,
    interval: 240000, // 4 minutes (240 seconds) in milliseconds
    maxRefreshes: 5,
    showNotifications: true,
    showStatusIndicator: true,
    debug: false
});

// State variables
let refreshTimer = null;
let refreshCount = 0;
let lastPromptData = null;
let currentChatId = null;
let statusIndicator = null;
let countdownInterval = null;
let secondsRemaining = 0;
let eventListenersRegistered = false;

/**
 * Gets the current extension settings, initializing with defaults if needed.
 * Uses the stable SillyTavern.getContext() API.
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
 * @param  {...any} args - Arguments to log
 */
function debugLog(...args) {
    if (getSettings().debug) {
        console.log(LOG_PREFIX, ...args);
    }
}

/**
 * Logs an info message
 * @param  {...any} args - Arguments to log
 */
function log(...args) {
    console.log(LOG_PREFIX, ...args);
}

/**
 * Logs an error message
 * @param  {...any} args - Arguments to log
 */
function logError(...args) {
    console.error(LOG_PREFIX, ...args);
}

/**
 * Shows a notification to the user if notifications are enabled
 * @param {string} message - The message to display
 * @param {string} type - The notification type ('success', 'error', 'warning', 'info')
 */
function showNotification(message, type = 'info') {
    const settings = getSettings();
    if (!settings.showNotifications) return;
    
    // Use toastr if available (SillyTavern uses this)
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

/**
 * Creates or updates the floating status indicator
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
 * Works with both regular chats and group chats (v1.15.0 unified format)
 * @returns {string|null} The current chat identifier
 */
function getCurrentChatId() {
    const context = SillyTavern.getContext();
    
    // Handle group chats
    if (context.selected_group) {
        return `group-${context.selected_group}`;
    }
    
    // Handle regular chats
    if (context.characterId !== undefined && context.characterId !== null) {
        const character = context.characters?.[context.characterId];
        if (character) {
            // Use chat file name if available, otherwise use character name
            return context.chat_metadata?.file_name || character.name || `char-${context.characterId}`;
        }
    }
    
    return null;
}

/**
 * Captures the prompt data after a successful generation
 * This is called when GENERATION_ENDED event fires
 * @param {Object} data - Event data from generation
 */
function capturePromptData(data) {
    const context = SillyTavern.getContext();
    const settings = getSettings();
    
    if (!settings.enabled) {
        debugLog('Extension disabled, not capturing prompt data');
        return;
    }
    
    try {
        // Get the current chat messages
        const chat = context.chat;
        if (!chat || chat.length === 0) {
            debugLog('No chat messages available');
            return;
        }
        
        // Store the current chat ID
        const newChatId = getCurrentChatId();
        
        // If chat changed, reset the counter
        if (newChatId !== currentChatId) {
            debugLog('Chat changed, resetting refresh counter');
            refreshCount = 0;
            currentChatId = newChatId;
        }
        
        // Capture essential prompt data for cache refresh
        lastPromptData = {
            chatId: newChatId,
            messageCount: chat.length,
            timestamp: Date.now(),
            // Store last few message IDs for verification
            lastMessageIds: chat.slice(-3).map((m, i) => m.id || `msg-${chat.length - 3 + i}`)
        };
        
        debugLog('Captured prompt data:', lastPromptData);
        
        // Start the refresh timer
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
    
    // Check if we've exceeded max refreshes
    if (refreshCount >= settings.maxRefreshes) {
        debugLog('Max refreshes reached');
        showNotification('Cache refresh limit reached', 'info');
        stopRefreshTimer();
        return;
    }
    
    // Verify we're still in the same chat
    const currentId = getCurrentChatId();
    if (currentId !== lastPromptData.chatId) {
        debugLog('Chat changed, stopping refresh');
        stopRefreshTimer();
        return;
    }
    
    try {
        debugLog('Sending cache refresh request...');
        
        // Use the stable generateQuietPrompt API from SillyTavern 1.15.0
        const { generateQuietPrompt } = SillyTavern.getContext();
        
        if (typeof generateQuietPrompt === 'function') {
            // Send minimal request to refresh cache
            await generateQuietPrompt({
                quietPrompt: '', // Empty/minimal prompt
                skipWIAN: true,  // Skip World Info and Author's Note
                maxTokens: 1,    // Request minimal response
                skipSanitize: true
            });
        } else {
            // Fallback: Try alternative method for older versions
            await sendDirectRefreshRequest();
        }
        
        refreshCount++;
        log(`Cache refresh ${refreshCount}/${settings.maxRefreshes} successful`);
        showNotification(`Cache refreshed (${refreshCount}/${settings.maxRefreshes})`, 'success');
        
        // Schedule next refresh
        startRefreshTimer();
        
    } catch (error) {
        logError('Cache refresh failed:', error);
        showNotification('Cache refresh failed', 'error');
        
        // Retry with exponential backoff
        setTimeout(() => {
            if (getSettings().enabled) {
                startRefreshTimer();
            }
        }, 5000);
    }
}

/**
 * Fallback method to send a direct refresh request
 * Used if generateQuietPrompt is not available
 */
async function sendDirectRefreshRequest() {
    const context = SillyTavern.getContext();
    
    // Get the API settings
    const { oai_settings, main_api } = context;
    
    if (main_api !== 'openai') {
        throw new Error('Direct refresh only supported for Chat Completion API');
    }
    
    // Build minimal request
    const messages = [
        {
            role: 'user',
            content: ' '
        }
    ];
    
    // This would need to be adapted based on the actual API endpoint
    // The exact implementation depends on SillyTavern's internal API structure
    debugLog('Using fallback direct refresh method');
    
    // For now, throw to indicate generateQuietPrompt should be used
    throw new Error('Fallback method not implemented - please update SillyTavern');
}

/**
 * Starts the refresh timer
 */
function startRefreshTimer() {
    const settings = getSettings();
    
    // Clear any existing timer
    stopRefreshTimer();
    
    if (!settings.enabled) {
        return;
    }
    
    if (refreshCount >= settings.maxRefreshes) {
        debugLog('Max refreshes reached, not starting timer');
        return;
    }
    
    debugLog(`Starting refresh timer: ${settings.interval}ms`);
    
    // Start countdown display
    startCountdown();
    
    // Set the timer
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
 * Resets all state
 */
function resetState() {
    stopRefreshTimer();
    refreshCount = 0;
    lastPromptData = null;
    currentChatId = null;
}

/**
 * Handler for when chat changes
 * @param {string} chatId - The new chat ID (if provided)
 */
function onChatChanged(chatId) {
    debugLog('Chat changed event received');
    
    const newChatId = getCurrentChatId();
    
    if (newChatId !== currentChatId) {
        log('Chat changed, resetting cache refresh state');
        resetState();
    }
}

/**
 * Handler for when generation ends
 * @param {Object} data - Generation event data
 */
function onGenerationEnded(data) {
    debugLog('Generation ended event received', data);
    capturePromptData(data);
}

/**
 * Handler for when generation is stopped by user
 */
function onGenerationStopped() {
    debugLog('Generation stopped by user');
    // Don't capture data for stopped generations
}

/**
 * Registers event listeners with SillyTavern
 */
function registerEventListeners() {
    if (eventListenersRegistered) {
        return;
    }
    
    const { eventSource, event_types } = SillyTavern.getContext();
    
    if (!eventSource || !event_types) {
        logError('Event system not available');
        return;
    }
    
    // Listen for chat changes
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    
    // Listen for generation completion
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
    
    // Listen for generation stopped
    eventSource.on(event_types.GENERATION_STOPPED, onGenerationStopped);
    
    eventListenersRegistered = true;
    debugLog('Event listeners registered');
}

/**
 * Unregisters event listeners
 */
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

/**
 * Initializes the settings UI
 */
async function initSettingsUI() {
    const settings = getSettings();
    
    // Load the HTML template
    const response = await fetch(`/scripts/extensions/third-party/Cache-Refresh-SillyTavern/cache-refresher.html`);
    if (!response.ok) {
        logError('Failed to load settings template');
        return;
    }
    
    const html = await response.text();
    
    // Find the extensions settings container
    const extensionsBlock = document.getElementById('extensions_settings');
    if (!extensionsBlock) {
        logError('Extensions settings block not found');
        return;
    }
    
    // Add our settings panel
    const settingsContainer = document.createElement('div');
    settingsContainer.id = 'cache_refresher_settings';
    settingsContainer.innerHTML = html;
    extensionsBlock.appendChild(settingsContainer);
    
    // Initialize UI values from settings
    const enabledCheckbox = document.getElementById('cache_refresh_enabled');
    const intervalInput = document.getElementById('cache_refresh_interval');
    const maxRefreshesInput = document.getElementById('cache_refresh_max');
    const notificationsCheckbox = document.getElementById('cache_refresh_notifications');
    const statusCheckbox = document.getElementById('cache_refresh_status');
    const debugCheckbox = document.getElementById('cache_refresh_debug');
    const stopButton = document.getElementById('cache_refresh_stop');
    
    if (enabledCheckbox) {
        enabledCheckbox.checked = settings.enabled;
        enabledCheckbox.addEventListener('change', (e) => {
            settings.enabled = e.target.checked;
            saveSettings();
            
            if (!settings.enabled) {
                stopRefreshTimer();
            }
            
            log(`Extension ${settings.enabled ? 'enabled' : 'disabled'}`);
        });
    }
    
    if (intervalInput) {
        intervalInput.value = settings.interval / 1000; // Convert to seconds
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
    
    log('Settings UI initialized');
}

/**
 * Main initialization function
 */
async function init() {
    log('Initializing Cache Refresher extension v2.0.0 for SillyTavern 1.15.0+');
    
    try {
        // Initialize settings
        getSettings();
        
        // Initialize UI
        await initSettingsUI();
        
        // Register event listeners
        registerEventListeners();
        
        log('Initialization complete');
        
    } catch (error) {
        logError('Initialization failed:', error);
    }
}

/**
 * Cleanup function called when extension is disabled/unloaded
 */
function cleanup() {
    log('Cleaning up Cache Refresher extension');
    
    unregisterEventListeners();
    resetState();
    
    // Remove settings UI
    const settingsContainer = document.getElementById('cache_refresher_settings');
    if (settingsContainer) {
        settingsContainer.remove();
    }
    
    // Remove status indicator
    if (statusIndicator) {
        statusIndicator.remove();
        statusIndicator = null;
    }
}

// Export for SillyTavern's module system
export { MODULE_NAME, init, cleanup };

// Wait for SillyTavern to be ready, then initialize
jQuery(async () => {
    // Check if SillyTavern context is available
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
        const { eventSource, event_types } = SillyTavern.getContext();
        
        // Wait for app to be ready
        eventSource.on(event_types.APP_READY, init);
    } else {
        logError('SillyTavern context not available. Make sure you are running SillyTavern 1.15.0 or later.');
    }
});
