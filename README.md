# SillyTavern Automatic Cache Refreshing Extension

[![Status](https://img.shields.io/badge/status-ready-green.svg)](https://github.com/OneinfinityN7/Cache-Refresh-SillyTavern)
[![SillyTavern](https://img.shields.io/badge/SillyTavern-1.15.0+-blue.svg)](https://github.com/SillyTavern/SillyTavern)

This extension for [SillyTavern](https://github.com/SillyTavern/SillyTavern) automatically keeps your language model's cache "warm" by sending periodic, minimal requests. While designed primarily for Claude Sonnet, it works with other models as well. By preventing cache expiration, you can significantly reduce API costs.

## Version 2.0.0 - SillyTavern 1.15.0 Compatibility Update

This version has been updated for full compatibility with SillyTavern 1.15.0+, including:

- ✅ Migrated to stable `SillyTavern.getContext()` API
- ✅ Updated event handling for the new event system
- ✅ Compatible with Macros 2.0
- ✅ Compatible with unified group chat metadata format
- ✅ Improved error handling and cleanup
- ✅ Better support for the refactored Chat Completion API

## The Problem: Cache Expiration

AI language models (LLMs) like Claude (through OpenRouter), OpenAI's GPT, and others use caching to improve performance and reduce costs. When you send a prompt that's similar to a recent one, or enable caching on your prompts, the service can often return a cached response instead of recomputing everything, resulting in a cache discount (90% reduction of the cached input price for Claude).

However, these caches typically have a short lifespan (often just a few minutes). If you pause your interaction with the model longer than the cache timeout, the cache expires, and your next request incurs the full cost.

## The Solution: Automatic Cache Refreshing

- When you send a message and receive a response, the extension captures the prompt data.
- It then schedules a series of refresh requests (up to the maximum number configured).
- If a new message is sent, the refresh timer will stop and then restart after the new response is received.
- Each refresh request sends a minimal request to the API to just keep the cache alive.
- A floating status indicator shows the number of remaining refreshes and a countdown timer.
- Notifications appear after each successful refresh.
- If you change or leave the conversation, the timer will stop.

## Installation

### Prerequisites
- SillyTavern 1.15.0 or later installed and running
- Chat Completion mode configured (Claude, OpenRouter, etc.)

### Method 1: Via Extension Installer (Recommended)

1. In SillyTavern, go to the **Extensions** menu (puzzle piece icon)
2. Click the **Install extension** button (top right)
3. Enter: `https://github.com/OneinfinityN7/Cache-Refresh-SillyTavern`
4. Click **Install**
5. Restart SillyTavern

### Method 2: Manual Installation

1. Navigate to your SillyTavern extensions folder:
   - For user-specific: `data/<your-user>/extensions/`
   - For all users: `public/scripts/extensions/third-party/`

2. Clone or download this repository:
   ```bash
   cd data/<your-user>/extensions/
   git clone https://github.com/OneinfinityN7/Cache-Refresh-SillyTavern.git
   ```

3. Restart SillyTavern

## Configuration

After installation, find the **Cache Refresher** panel in the Extensions menu.

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enable Cache Refresh | On | Toggle the extension on/off |
| Refresh Interval | 240 seconds | Time between cache refresh requests |
| Max Refreshes | 5 | Maximum refresh requests per message |
| Show Notifications | On | Display toastr notifications on refresh |
| Show Status Indicator | On | Show floating countdown indicator |
| Debug Mode | Off | Enable detailed console logging |

### Recommended Settings for Claude

| Model | Interval | Max Refreshes |
|-------|----------|---------------|
| Claude 3.5 Sonnet | 240s (4 min) | 5-10 |
| Claude 3 Opus | 240s (4 min) | 5-10 |
| Claude 3 Haiku | 240s (4 min) | 10-15 |

Claude's cache expires after 5 minutes, so a 4-minute interval provides a safe margin.

## Troubleshooting

### Extension Not Appearing
1. Ensure SillyTavern is version 1.15.0 or later
2. Check that the extension is in the correct folder
3. Restart SillyTavern completely
4. Check the browser console (F12) for error messages

### No Cache Reduction
1. Verify your model supports caching
2. Check your `config.yaml` for caching settings:
   ```yaml
   claude:
     enableSystemPromptCache: true
     cachingAtDepth: 2
   ```
3. Ensure you're using **Chat Completion** mode
4. For OpenRouter: system prompt caching is always enabled

### Timer Not Starting
1. Make sure the extension is enabled
2. Send a message and wait for a response
3. The timer should start automatically after the response
4. Check the console for debug messages (enable Debug Mode)

### Cache Still Expiring
1. Decrease the refresh interval (try 180 seconds)
2. Increase max refreshes
3. Check the browser console for errors
4. Verify API connectivity

## API Compatibility

| Provider | Compatible | Notes |
|----------|------------|-------|
| OpenRouter Claude | ✅ Yes | Recommended |
| Claude Direct API | ✅ Yes | Requires config.yaml setup |
| OpenAI GPT | ⚠️ Partial | May not significantly reduce costs |
| Anthropic Direct | ✅ Yes | Requires caching enabled |

## Cost Savings Example

### Claude Sonnet 3.7 with 76-message conversation:

| Caching Method | Prompt Tokens Cost | Completion Cost | Total | Savings |
|----------------|-------------------|-----------------|-------|---------|
| No caching | $0.04323 | $0.00447 | $0.0477 | 0% |
| Depth 2 + System | $0.00653 | $0.00447 | $0.011 | 77% |
| Cache refresh | $0.00541 | $0.00003 | $0.00544 | **89%** |

## Changelog

### v2.0.0 (2025-01-04)
- 🔄 Migrated to `SillyTavern.getContext()` API for stability
- 🎯 Updated event handling for SillyTavern 1.15.0
- 🛡️ Added `minimum_client_version` to manifest
- 🐛 Improved error handling and cleanup
- 📝 Added Debug Mode setting
- 🎨 Updated UI styling for better theme compatibility

### v1.x.x
- Initial release
- Basic cache refresh functionality

## Development

### Building from Source

This extension doesn't require a build step. Simply edit the JavaScript, HTML, and CSS files directly.

### Testing

1. Enable Debug Mode in settings
2. Open browser console (F12)
3. Look for `[CacheRefresher]` prefixed messages
4. Send a message and verify timer starts
5. Wait for refresh and check for success message

### Contributing

Pull requests are welcome! Please ensure:
- Code follows existing style
- Changes are tested with SillyTavern 1.15.0+
- Update the README if adding features

## License

This extension is released under the [GNU AGPL License](LICENSE).

## Credits

- Original development by OneinfinityN7
- v2.0.0 compatibility update for SillyTavern 1.15.0
- Built for the SillyTavern community
- Built with Claude

## Support

- [GitHub Issues](https://github.com/OneinfinityN7/Cache-Refresh-SillyTavern/issues)
- [SillyTavern Discord](https://discord.gg/sillytavern)
