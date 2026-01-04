<div class="cache-refresher-settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Cache Refresher & Monitor</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <!-- Cache Refresher Section -->
            <div class="cache-section">
                <h4 class="cache-section-title">🔄 Cache Refresher</h4>
                <p class="cache-section-description">
                    Automatically keeps your LLM cache warm by sending periodic minimal requests.
                </p>
                
                <div class="cache-setting">
                    <label class="checkbox_label" for="cache_refresh_enabled">
                        <input type="checkbox" id="cache_refresh_enabled" />
                        <span>Enable Cache Refresher</span>
                    </label>
                </div>
                
                <div class="cache-setting">
                    <label for="cache_refresh_interval">Refresh Interval (seconds)</label>
                    <input type="number" 
                           id="cache_refresh_interval" 
                           class="text_pole" 
                           min="30" 
                           max="600" 
                           step="10" 
                           title="Time between cache refresh requests (30-600 seconds)" />
                    <small class="cache-hint">Recommended: 240s for Claude's 5-minute cache</small>
                </div>
                
                <div class="cache-setting">
                    <label for="cache_refresh_max">Maximum Refreshes</label>
                    <input type="number" 
                           id="cache_refresh_max" 
                           class="text_pole" 
                           min="1" 
                           max="20" 
                           step="1" 
                           title="Maximum number of refresh requests per message (1-20)" />
                    <small class="cache-hint">Limits how many times cache is refreshed after a message</small>
                </div>
                
                <div class="cache-setting">
                    <label class="checkbox_label" for="cache_refresh_notifications">
                        <input type="checkbox" id="cache_refresh_notifications" />
                        <span>Show Notifications</span>
                    </label>
                </div>
                
                <div class="cache-setting">
                    <label class="checkbox_label" for="cache_refresh_status">
                        <input type="checkbox" id="cache_refresh_status" />
                        <span>Show Countdown Timer</span>
                    </label>
                </div>
                
                <div class="cache-setting">
                    <button id="cache_refresh_stop" class="menu_button">
                        <i class="fa-solid fa-stop"></i> Stop Refresh Timer
                    </button>
                </div>
            </div>
            
            <hr class="cache-divider" />
            
            <!-- Cache Monitor Section -->
            <div class="cache-section">
                <h4 class="cache-section-title">📊 Cache Monitor</h4>
                <p class="cache-section-description">
                    Track Claude API prompt caching performance in real-time.
                    <br><small>Inspired by <a href="https://github.com/zwheeler/SillyTavern-CacheMonitor" target="_blank">zwheeler/SillyTavern-CacheMonitor</a></small>
                </p>
                
                <div class="cache-setting">
                    <label class="checkbox_label" for="cache_monitor_enabled">
                        <input type="checkbox" id="cache_monitor_enabled" />
                        <span>Enable Cache Monitor</span>
                    </label>
                </div>
                
                <div class="cache-setting">
                    <label class="checkbox_label" for="cache_monitor_widget">
                        <input type="checkbox" id="cache_monitor_widget" />
                        <span>Show Floating Widget</span>
                    </label>
                </div>
                
                <div class="cache-setting">
                    <label class="checkbox_label" for="cache_monitor_cost">
                        <input type="checkbox" id="cache_monitor_cost" />
                        <span>Track Cost Savings</span>
                    </label>
                </div>
                
                <div class="cache-setting">
                    <label for="cache_monitor_position">Widget Position</label>
                    <select id="cache_monitor_position" class="text_pole">
                        <option value="bottom-left">Bottom Left</option>
                        <option value="bottom-right">Bottom Right</option>
                        <option value="top-left">Top Left</option>
                        <option value="top-right">Top Right</option>
                    </select>
                </div>
                
                <div class="cache-setting">
                    <label for="cache_monitor_pricing">Pricing Model</label>
                    <select id="cache_monitor_pricing" class="text_pole">
                        <option value="claude-sonnet-4.5">Claude Sonnet 4.5</option>
                        <option value="claude-opus-4.5">Claude Opus 4.5</option>
                        <option value="claude-haiku-4.5">Claude Haiku 4.5</option>
                        <option value="claude-sonnet-4">Claude Sonnet 4</option>
                        <option value="claude-opus-4">Claude Opus 4</option>
                        <option value="custom">Custom</option>
                    </select>
                    <small class="cache-hint">Used for cost savings calculations</small>
                </div>
                
                <div class="cache-setting">
                    <button id="cache_monitor_reset" class="menu_button">
                        <i class="fa-solid fa-rotate-right"></i> Reset Statistics
                    </button>
                </div>
            </div>
            
            <hr class="cache-divider" />
            
            <!-- Debug Section -->
            <div class="cache-section">
                <h4 class="cache-section-title">🛠️ Debug</h4>
                
                <div class="cache-setting">
                    <label class="checkbox_label" for="cache_refresh_debug">
                        <input type="checkbox" id="cache_refresh_debug" />
                        <span>Enable Debug Logging</span>
                    </label>
                    <small class="cache-hint">Logs detailed info to browser console (F12)</small>
                </div>
            </div>
            
            <hr class="cache-divider" />
            
            <!-- Info Section -->
            <div class="cache-section cache-info">
                <h4 class="cache-section-title">ℹ️ About</h4>
                <p>
                    <strong>Cache Refresher</strong> keeps your cache warm by sending periodic "ping" requests,
                    preventing expensive cache misses when you pause between messages.
                </p>
                <p>
                    <strong>Cache Monitor</strong> tracks your cache hit rate, showing how efficiently
                    caching is working and estimating your cost savings.
                </p>
                <p class="cache-tips">
                    <strong>Tips for better caching:</strong>
                    <ul>
                        <li>Set <code>cachingAtDepth</code> to 2 in config.yaml</li>
                        <li>Enable <code>enableSystemPromptCache</code> for static prompts</li>
                        <li>Avoid random macros like <code>{{random}}</code> in system prompts</li>
                        <li>Use Chat Completion mode (caching not available for Text Completion)</li>
                    </ul>
                </p>
                <p class="cache-version">
                    Version 2.1.0 • 
                    <a href="https://github.com/OneinfinityN7/Cache-Refresh-SillyTavern" target="_blank">GitHub</a>
                </p>
            </div>
        </div>
    </div>
</div>
