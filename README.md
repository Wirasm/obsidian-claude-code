# Obsidian Claude Code Assistant

An Obsidian plugin that integrates Claude AI for intelligent vault management using the Claude Code SDK.

## Architecture

This project consists of two components:

1. **Obsidian Plugin** (`/`) - Runs inside Obsidian, provides UI and vault access
2. **Claude Code SDK Server** (`/sdk-server`) - Separate process that connects to Claude

## Setup Instructions

### Prerequisites

- Node.js 18+ and pnpm
- Obsidian 0.15.0+
- Claude Code SDK access

### Plugin Setup

1. Install dependencies:
```bash
pnpm install
```

2. Build the plugin:
```bash
pnpm run dev  # Development mode with watch
# or
pnpm run build  # Production build
```

3. Copy to your vault:
```bash
# Create plugin directory in your test vault
mkdir -p /path/to/vault/.obsidian/plugins/obsidian-claude-code

# Copy built files
cp main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/obsidian-claude-code/
```

4. Enable the plugin in Obsidian Settings → Community plugins

### SDK Server Setup

1. Navigate to sdk-server:
```bash
cd sdk-server
pnpm install
```

2. Run the server:
```bash
pnpm run dev  # Development with auto-reload
# or
pnpm run build && pnpm run start  # Production
```

The server runs on WebSocket port 7860 by default.

## Development Workflow

### Plugin Development

```bash
# Terminal 1: Run build watcher
pnpm run dev

# Terminal 2: Run SDK server
cd sdk-server && pnpm run dev
```

Then reload Obsidian (Cmd/Ctrl + R) to see changes.

### Available Commands

**Plugin:**
- `pnpm run dev` - Development build with watch
- `pnpm run build` - Production build
- `pnpm run version` - Bump version

**SDK Server:**
- `pnpm run dev` - Development with tsx watch
- `pnpm run build` - TypeScript compilation
- `pnpm run start` - Run production build

## Features

### Current
- WebSocket connection between plugin and SDK server
- Basic chat interface in Obsidian
- Settings for connection management
- Status bar indicator

### Planned SDK Tools
- `search_notes` - Full-text search across vault
- `read_note` - Read note content and metadata
- `write_note` - Create/update notes
- `list_files` - Browse vault structure
- `get_graph` - Access vault graph data

## Project Structure

```
obsi-cc/
├── main.ts           # Plugin entry point
├── styles.css        # Plugin styles
├── manifest.json     # Plugin metadata
├── package.json      # Plugin dependencies
├── esbuild.config.mjs # Build configuration
├── tsconfig.json     # TypeScript config
├── CLAUDE.md         # Development guidelines
│
└── sdk-server/       # Claude Code SDK server
    ├── src/
    │   └── index.ts  # MCP server with vault tools
    ├── package.json
    └── tsconfig.json
```

## Testing

1. Start the SDK server
2. Open Obsidian with the plugin enabled
3. Click the robot icon in the ribbon or use command palette
4. Check connection status in settings

## Troubleshooting

### Plugin won't load
- Check console for errors (Ctrl/Cmd + Shift + I)
- Ensure manifest.json version matches minAppVersion
- Verify all three files (main.js, manifest.json, styles.css) are present

### Can't connect to SDK
- Verify SDK server is running on port 7860
- Check firewall/security settings
- Look for WebSocket errors in console

### Build errors
- Run `pnpm install` to ensure dependencies
- Check TypeScript errors with `tsc --noEmit`
- Clear node_modules and reinstall if needed

## Contributing

This plugin follows Obsidian's official guidelines. See CLAUDE.md for development standards.

## License

MIT