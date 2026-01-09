# Cache Refresher for SillyTavern

A lightweight extension for SillyTavern that keeps your Claude API prompt cache warm, preventing expensive cache misses when you pause between messages.

## Features

### 🔄 Cache Refresher
- **Automatic Cache Refresh**: Sends periodic minimal "ping" requests to keep cache alive
- **Configurable Intervals**: Set refresh timing from 30 to 600 seconds
- **Refresh Limits**: Control maximum refreshes per message to manage costs
- **Floating Timer**: Clean, minimal countdown widget that can be dragged anywhere
- **Smart Detection**: Automatically stops when chat changes

## Why Use This?

Claude's prompt cache has a **5-minute TTL** (Time To Live). If you pause between messages longer than 5 minutes, the cache expires and you pay full price for tokens that were previously cached.

**Example savings:**
- 50,000 token conversation with Claude Sonnet
- Without refresh: Cache expires, ~$7.50 for 50 messages
- With refresh: Cache stays warm, ~$1.73 for 50 messages
- **Savings: ~77%**

## Requirements

- **SillyTavern**: Version 1.15.0 or later
- **API**: Claude via Anthropic direct, OpenRouter, or compatible endpoints
- **Mode**: Chat Completion (caching not available for Text Completion)

## Installation

### Method 1: Via SillyTavern Extension Installer (Recommended)

1. Open SillyTavern
2. Go to **Extensions** (puzzle piece icon)
3. Click **Install Extension** (top right)
4. Enter: `https://github.com/Cheesedozer/Cache-Refresh-SillyTavern-Update`
5. Restart SillyTavern

### Method 2: Manual Installation

1. Navigate to your SillyTavern installation:
   ```
   SillyTavern/data/<user>/extensions/third-party/
   ```
2. Clone or download this repository:
   ```bash
   git clone https://github.com/Cheesedozer/Cache-Refresh-SillyTavern-Update
   ```
3. Restart SillyTavern

## Configuration

### SillyTavern Cache Settings (config.yaml)

For caching to work, configure these settings in your `config.yaml`:

```yaml
claude:
  # Enable system prompt caching (use only with static prompts)
  enableSystemPromptCache: true

  # Cache at message depth (2 = previous exchange, recommended)
  cachingAtDepth: 2

  # Extended TTL (optional, costs more but lasts 1 hour)
  extendedTTL: false
```

**⚠️ Important**: After modifying config.yaml, restart SillyTavern.

### Extension Settings

Access settings via **Extensions** → **Cache Refresher**

| Setting | Default | Description |
|---------|---------|-------------|
| Enable Cache Refresher | On | Toggle automatic cache refresh |
| Refresh Interval | 240s | Time between refresh requests |
| Maximum Refreshes | 5 | Limit per message |
| Show Notifications | On | Toast notifications on refresh |
| Show Floating Timer | On | Draggable countdown widget |

## Recommended Settings by Model

### Claude Sonnet 4.5 / Opus 4.5
- **Refresh Interval**: 240 seconds (4 minutes)
- **Max Refreshes**: 5-10

### Claude Haiku 4.5
- **Refresh Interval**: 240 seconds
- **Max Refreshes**: 10-15 (lower cost per refresh)

## Troubleshooting

### Extension Not Loading
- Verify SillyTavern version is 1.15.0+
- Check browser console (F12) for errors
- Ensure files are in correct directory

### Cache Not Working
- Confirm you're using Chat Completion mode
- Check config.yaml has caching enabled
- Avoid `{{random}}` macros in system prompts
- Verify model supports caching (Claude 3.5+, 4.x)

### Timer Not Appearing
- Check "Show Floating Timer" is enabled in settings
- Try clicking "Reset Position" button
- Refresh the page

## Version History

### v3.0.0 (Latest)
- **Major Update**: Removed Cache Monitor feature (was not functioning properly with SillyTavern's API architecture)
- New clean, minimal floating timer design
- Timer widget is now draggable to any position
- Added "Reset Position" button
- Simplified codebase for reliability
- Improved error handling

### v2.x
- Added Cache Monitor feature (removed in v3.0.0)
- Integrated timer into monitor widget

### v1.x
- Initial release for older SillyTavern versions

## Credits

- **OneinfinityN7** - Original Cache Refresher development
- **SillyTavern Team** - Platform and extension system

## License

AGPL-3.0 License - See [LICENSE](LICENSE) file

## Support

- **Issues**: [GitHub Issues](https://github.com/Cheesedozer/Cache-Refresh-SillyTavern-Update/issues)
- **SillyTavern Discord**: Join the community for support
- **Claude Caching Guide**: [Anthropic Documentation](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)

---

*Keep your cache warm, save money* 💰
