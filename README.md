# Cache Refresher & Monitor for SillyTavern

A comprehensive extension for SillyTavern that helps you maximize Claude API prompt caching efficiency and save money.

## Features

### 🔄 Cache Refresher
Automatically keeps your LLM cache "warm" by sending periodic minimal requests, preventing expensive cache misses when you pause between messages.

- **Automatic Cache Refresh**: Sends periodic "ping" requests to keep cache alive
- **Configurable Intervals**: Set refresh timing from 30 to 600 seconds
- **Refresh Limits**: Control maximum refreshes per message
- **Visual Countdown**: Floating timer shows next refresh
- **Smart Detection**: Automatically stops when chat changes

### 📊 Cache Monitor
Real-time monitoring of your Claude API prompt caching performance with detailed statistics.

> *Cache Monitor feature inspired by [zwheeler/SillyTavern-CacheMonitor](https://github.com/zwheeler/SillyTavern-CacheMonitor)*

- **Hit Rate Tracking**: See how often your prompts hit the cache
- **Token Statistics**: Track cached vs uncached tokens
- **Cost Savings Calculator**: Estimate how much money caching saves
- **Model Presets**: Pre-configured pricing for Claude 4.5 models
- **Floating Widget**: Minimizable real-time statistics display

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

Access settings via **Extensions** → **Cache Refresher & Monitor**

#### Cache Refresher Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enable Cache Refresher | On | Toggle automatic cache refresh |
| Refresh Interval | 240s | Time between refresh requests |
| Maximum Refreshes | 5 | Limit per message |
| Show Notifications | On | Toast notifications on refresh |
| Show Countdown Timer | On | Floating timer display |

#### Cache Monitor Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enable Cache Monitor | On | Toggle cache monitoring |
| Show Floating Widget | On | Display stats widget |
| Track Cost Savings | On | Calculate estimated savings |
| Widget Position | Bottom Left | Where to show the widget |
| Pricing Model | Sonnet 4.5 | Model for cost calculations |

## Recommended Settings by Model

### Claude Sonnet 4.5 / Opus 4.5
- **Refresh Interval**: 240 seconds (4 minutes)
- **Max Refreshes**: 5-10
- **Caching TTL**: 5 minutes (default) or 1 hour

### Claude Haiku 4.5
- **Refresh Interval**: 240 seconds
- **Max Refreshes**: 10-15 (lower cost per refresh)

## Understanding Cache Statistics

### Hit Rate
- **Excellent (70%+)**: Caching is working great! 🟢
- **Moderate (40-70%)**: Some cache misses, review your setup 🟡
- **Poor (<40%)**: Most prompts miss cache, troubleshoot needed 🔴

### What Causes Cache Misses?
- Cache expired (>5 minutes idle without refresh)
- System prompt changed (random macros, lorebooks)
- Message history truncated by context limit
- Different model or endpoint used

## Cost Savings Example

**Scenario**: 50,000 token conversation with Claude Sonnet 4.5

| Without Caching | With Caching (80% hit rate) |
|-----------------|------------------------------|
| $0.15 per message | $0.0345 per message |
| 50 messages = $7.50 | 50 messages = $1.73 |
| | **Savings: $5.77 (77%)** |

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

### Monitor Shows No Data
- Enable Cache Monitor in settings
- Generate some messages to collect data
- Check debug mode for detailed logs

### High Cache Miss Rate
- Reduce system prompt variability
- Check if context is being truncated
- Ensure cachingAtDepth is set properly
- Verify refresh timer is running

## Version History

### v2.1.0 (Latest)
- Added Cache Monitor feature
- Real-time cache hit/miss tracking
- Cost savings calculator
- Model pricing presets
- Minimizable floating widget
- Credit: Cache Monitor inspired by zwheeler/SillyTavern-CacheMonitor

### v2.0.0
- Migrated to SillyTavern 1.15.0 stable APIs
- Updated event handling system
- Improved group chat support
- Enhanced error handling

### v1.x
- Initial release for older SillyTavern versions

## Credits

- **OneinfinityN7** - Cache Refresher development
- **zwheeler** - Cache Monitor concept ([SillyTavern-CacheMonitor](https://github.com/zwheeler/SillyTavern-CacheMonitor))
- **SillyTavern Team** - Platform and extension system

## License

AGPL-3.0 License - See [LICENSE](LICENSE) file

## Support

- **Issues**: [GitHub Issues](https://github.com/Cheesedozer/Cache-Refresh-SillyTavern-Update/issues)
- **SillyTavern Discord**: Join the community for support
- **Claude Caching Guide**: [Anthropic Documentation](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)

---

*Making Claude caching actually work for everyone* 💰
