# Obsidian Claude Code Assistant

An Obsidian plugin that integrates Claude AI for intelligent vault management using the Claude Code SDK.

![Status](https://img.shields.io/badge/status-beta-yellow)
![Obsidian](https://img.shields.io/badge/Obsidian-0.15.0+-purple)
![Claude](https://img.shields.io/badge/Claude-Sonnet%204-blue)

## 🎯 Features

- **Chat with Claude Code** about your Obsidian vault directly within Obsidian
- **Real-time streaming** responses as Claude processes your requests
- **Full vault access** - Claude can read, create, edit, and organize your notes
- **Obsidian-aware** - Understands wikilinks, tags, frontmatter, and vault structure
- **Visual feedback** - See which tools Claude uses (Read, Write, Grep, etc.)

## 📋 Prerequisites

1. **Claude Code Max subscription** - Required for API access
2. **Claude Code CLI** installed and authenticated
3. **Node.js 18+** and **pnpm** package manager
4. **Obsidian** desktop app

## 🚀 Quick Start Guide

### Step 1: Install Claude Code CLI

```bash
# Install globally
npm install -g @anthropic-ai/claude-code

# Verify installation
claude --version

# Authenticate (requires Claude Code Max subscription)
claude login
```

### Step 2: Clone and Setup the Project

```bash
# Clone the repository
git clone https://github.com/yourusername/obsi-cc.git
cd obsi-cc

# Install dependencies
pnpm install
cd sdk-server && pnpm install && cd ..

# Build the plugin
pnpm run build
```

### Step 3: Install Plugin in Obsidian

#### Find Your Vault Path

First, locate your Obsidian vault folder. Common locations:

- **macOS**: `~/Documents/Obsidian Vault` or `~/obsidian`
- **Windows**: `C:\Users\YourName\Documents\Obsidian Vault`
- **Linux**: `~/Documents/obsidian` or `~/obsidian`

To find it:

1. Open Obsidian
2. Go to Settings → About
3. Look for "Current vault" - this shows your vault path

#### Install the Plugin

```bash
# Set your vault path (replace with your actual path)
VAULT_PATH="$HOME/Documents/Obsidian Vault"

# Create plugin directory
mkdir -p "$VAULT_PATH/.obsidian/plugins/obsidian-claude-code"

# Copy plugin files
cp main.js manifest.json styles.css "$VAULT_PATH/.obsidian/plugins/obsidian-claude-code/"
```

**Windows users** (PowerShell):

```powershell
# Set your vault path
$VAULT_PATH = "C:\Users\YourName\Documents\Obsidian Vault"

# Create plugin directory
New-Item -ItemType Directory -Force -Path "$VAULT_PATH\.obsidian\plugins\obsidian-claude-code"

# Copy plugin files
Copy-Item main.js,manifest.json,styles.css "$VAULT_PATH\.obsidian\plugins\obsidian-claude-code\"
```

### Step 4: Enable Plugin in Obsidian

1. Open Obsidian
2. Go to **Settings** (gear icon ⚙️)
3. Navigate to **Community plugins**
4. Turn **OFF** Safe Mode (if enabled)
5. Click **Reload plugins** button
6. Find **"Claude Code Assistant"** in the list
7. Toggle it **ON** ✅

### Step 5: Start the SDK Server

```bash
# From the project root directory
./start.sh

# You should see:
# 🚀 Claude Code SDK Server for Obsidian
# 📡 WebSocket server listening on port 7860
# ⏳ Waiting for Obsidian to connect...
```

**Windows users**: Create a `start.bat` file:

```batch
@echo off
echo Starting Claude Code SDK Server for Obsidian...
cd sdk-server
pnpm run dev
```

### Step 6: Open Claude Chat in Obsidian

**Option A:** Click the robot icon (🤖) in the left sidebar

**Option B:** Use Command Palette

- Press `Cmd/Ctrl + P`
- Type "Claude"
- Select "Open Claude Assistant"

## ✅ Verify Everything Works

When properly connected, you should see:

- **Green dot** (🟢) in the chat header = Connected
- **"Claude: Connected"** in the status bar
- Welcome message in the chat

Try these test prompts:

- "What notes are in my vault?"
- "List all my markdown files"
- "Create a test note called 'Hello Claude'"

## 🔧 Configuration

### Plugin Settings

Access via Obsidian Settings → Claude Code Assistant:

- **SDK Endpoint**: WebSocket URL (default: `ws://localhost:7860`)
- **Auto-connect**: Automatically connect when Obsidian starts
- **Show status bar**: Display connection status in bottom bar

### Customizing the Vault Path

If your SDK server needs a different vault path, edit `sdk-server/src/index.ts`:

```typescript
// Line 41 - Default vault path
const vaultPath = connection?.vaultPath || process.cwd();
```

## 🐛 Troubleshooting

### "Not connected" / Gray dot status

1. **Check SDK server is running**
   - Look for the terminal with `./start.sh`
   - Should show "WebSocket server listening on port 7860"

2. **Restart the SDK server**

   ```bash
   # Stop with Ctrl+C, then:
   ./start.sh
   ```

3. **Check Claude CLI auth**
   ```bash
   claude --version  # Should work
   claude login      # Re-authenticate if needed
   ```

### "Failed to connect to Claude SDK"

1. **Check port 7860 is free**

   ```bash
   lsof -i :7860  # macOS/Linux
   netstat -an | findstr 7860  # Windows
   ```

2. **Check firewall/antivirus** isn't blocking WebSocket connections

### Plugin doesn't appear in Obsidian

1. **Verify files are in correct location**

   ```bash
   ls -la "$VAULT_PATH/.obsidian/plugins/obsidian-claude-code/"
   # Should show: main.js, manifest.json, styles.css
   ```

2. **Reload Obsidian** with `Cmd/Ctrl + R`

3. **Check console for errors**
   - Open Developer Tools: `Cmd/Ctrl + Shift + I`
   - Look for red errors in Console tab

### Claude responses are generic/not Obsidian-aware

The SDK server should be using the Obsidian-specific prompt. Verify by checking:

```bash
# In sdk-server/src/index.ts, around line 62
# Should have: appendSystemPrompt: `You are an expert assistant...`
```

## 📁 Project Structure

```
obsi-cc/
├── main.ts              # Obsidian plugin source
├── manifest.json        # Plugin metadata
├── styles.css          # Chat UI styles
├── start.sh            # Quick start script
│
├── sdk-server/         # Claude Code SDK server
│   ├── src/
│   │   └── index.ts    # WebSocket server & Claude integration
│   └── package.json    # Server dependencies
│
└── README.md           # This file
```

## 🔄 Updating

To update the plugin:

```bash
# Pull latest changes
git pull

# Rebuild everything
pnpm install
pnpm run build
cd sdk-server && pnpm install && pnpm build && cd ..

# Copy updated files to vault
cp main.js manifest.json styles.css "$VAULT_PATH/.obsidian/plugins/obsidian-claude-code/"

# Restart SDK server and reload Obsidian
```

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - See LICENSE file for details

## ⚠️ Important Notes

- **Vault Access**: Claude has full read/write access to your vault when connected
- **API Usage**: Uses your Claude Code Max subscription quota
- **Local Only**: All processing happens locally; vault data isn't uploaded
- **Backup**: Always maintain backups of important notes

## 🔗 Links

- [Report Issues](https://github.com/yourusername/obsi-cc/issues)
- [Claude Code Documentation](https://docs.claude.com/en/docs/claude-code)
- [Obsidian Plugin Development](https://docs.obsidian.md/Plugins)

---

_Built with ❤️ by Rasmus Widing_
