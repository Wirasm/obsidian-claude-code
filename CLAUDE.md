# Obsidian Plugin Development Guidelines

## 🚨 CRITICAL COMPLIANCE

All code changes MUST follow official Obsidian guidelines.

## 📚 Official Documentation

### Plugin Development

- [Build a Plugin](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- [Anatomy of a Plugin](https://docs.obsidian.md/Plugins/Getting+started/Anatomy+of+a+plugin)
- [Development Workflow](https://docs.obsidian.md/Plugins/Getting+started/Development+workflow)
- [Mobile Development](https://docs.obsidian.md/Plugins/Getting+started/Mobile+development)
- [Use React in Plugin](https://docs.obsidian.md/Plugins/Getting+started/Use+React+in+your+plugin)

### Optimization & Best Practices

- [Optimizing Load Time](https://docs.obsidian.md/Plugins/Guides/Optimizing+plugin+load+time)
- [Understanding Deferred Views](https://docs.obsidian.md/Plugins/Guides/Understanding+deferred+views)

### Release & Submission

- [Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [Release Process](https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions)
- [Submission Requirements](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)

### Style Guides

- [Obsidian Style Guide](https://help.obsidian.md/style-guide)
- [Writing Style](https://docs.openedx.org/en/latest/documentors/references/doc_english_writing.html)

**MANDATORY:** Read [Obsidian Plugin Documentation](https://docs.obsidian.md/Plugins) before making changes.

## 🛠️ Development Commands

### Build and Development

```bash
pnpm install          # Install dependencies
pnpm run dev         # Start development build with auto-reload
pnpm run build       # Production build with TypeScript checking
pnpm run version     # Bump version in manifest.json and versions.json
```

### Testing

1. Run `pnpm run dev` to start development build
2. Copy `main.js`, `manifest.json`, and `styles.css` to `.obsidian/plugins/shell-path-copy/`
3. Reload Obsidian or toggle plugin

## 🚀 Release Process

### Steps

1. **Update version:**

   ```bash
   pnpm run version
   ```

2. **Build plugin:**

   ```bash
   pnpm run build
   ```

3. **Verify build:**
   - Check `main.js` was generated
   - Ensure `manifest.json` has correct version
   - Confirm `styles.css` exists

4. **Commit changes:**

   ```bash
   git add manifest.json versions.json
   git commit -m "Bump version to X.Y.Z"
   git push
   ```

5. **Create GitHub release:**

   ```bash
   gh release create X.Y.Z main.js manifest.json styles.css \
     --title "Release X.Y.Z" \
     --notes "Release notes here"
   ```

6. **Verify release:**
   ```bash
   gh release view X.Y.Z --json assets
   ```

### ⚠️ Critical Requirements

- **ALWAYS** include three required files:
  - `main.js` - Compiled plugin code
  - `manifest.json` - Plugin metadata
  - `styles.css` - Plugin styles (even if empty)

### ❌ What NOT to do

- NEVER create release without plugin files
- NEVER upload old/cached `main.js`
- NEVER forget to build before releasing
- NEVER modify settings UI without explicit request

## 🏗️ Architecture Overview

### About This Plugin

Obsidian plugin for copying file paths with shell-friendly formatting.

### Core Components

#### `main.ts`

Main plugin class handling:

- Context menu registration for file explorer
- Command palette commands
- Settings and clipboard operations
- Platform-specific behavior (desktop/mobile)

#### Settings System

- Uses Obsidian's `PluginSettingTab` for UI
- Settings stored via Obsidian's data API
- Key settings:
  - `pathWrapping` - Quote/backtick wrapping
  - `menuDisplay` - Menu visibility options
  - `showAbsolutePath` - Absolute vs relative paths
  - `notifications` - Toast notifications

#### Path Formatting

- Unix/Linux/Mac paths (forward slashes) ↔ Windows paths (backslashes)
- Relative paths (from vault root) and absolute paths (full system path)
- Quote/backtick wrapping based on user preference

### Key Design Decisions

- **Platform Detection:** `Platform.isMobile` disables absolute paths on mobile
- **Dynamic Commands:** Registered based on `menuDisplay` setting
- **Clipboard API:** Modern `navigator.clipboard` with error handling
- **File Selection Logic:**
  1. Try active file (currently open)
  2. Fall back to focused file in explorer
  3. Show error if no selection
- **Menu Sections:** Groups path copy options together

### TypeScript Configuration

- Target: ES6 with ESNext modules
- Strict null checks enabled
- No implicit any
- Obsidian type definitions from npm

### Build Process

- **Bundler:** esbuild with tree shaking
- **Externals:** obsidian, electron, codemirror
- **Development:** Source maps enabled
- **Production:** Minified output
- **Format:** CommonJS for Obsidian compatibility
