import { App, Plugin, PluginSettingTab, Setting, Notice, WorkspaceLeaf, ItemView } from 'obsidian';

interface ClaudeCodeSettings {
    apiEndpoint: string;
    enableAutoConnect: boolean;
    showStatusBar: boolean;
}

const DEFAULT_SETTINGS: ClaudeCodeSettings = {
    apiEndpoint: 'ws://localhost:7860',
    enableAutoConnect: true,
    showStatusBar: true
};

const VIEW_TYPE_CLAUDE_CHAT = "claude-chat-view";

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    tools?: string[];
}

class ClaudeChatView extends ItemView {
    plugin: ClaudeCodePlugin;
    messages: ChatMessage[] = [];
    chatContainer: HTMLElement;
    inputContainer: HTMLElement;
    input: HTMLTextAreaElement;
    sendButton: HTMLButtonElement;
    currentMessageId: string | null = null;
    sessionId: string | null = null;
    sessionActive: boolean = false;
    sessionInfoEl: HTMLElement | null = null;
    statusEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: ClaudeCodePlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return VIEW_TYPE_CLAUDE_CHAT;
    }

    getDisplayText() {
        return "Claude Assistant";
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('claude-chat-view');

        // Header
        const header = container.createDiv({ cls: 'claude-header' });

        // Title and controls row
        const titleRow = header.createDiv({ cls: 'claude-header-row' });
        titleRow.createEl("h4", { text: "Claude Assistant" });

        // Clear history button
        const clearBtn = titleRow.createEl('button', {
            text: '🔄 Clear History',
            cls: 'claude-clear-btn'
        });
        clearBtn.onclick = () => this.clearHistory();

        // Status row
        const statusRow = header.createDiv({ cls: 'claude-status-row' });
        this.statusEl = statusRow.createDiv({ cls: 'claude-status' });
        this.sessionInfoEl = statusRow.createDiv({ cls: 'claude-session-info' });
        this.updateStatus(this.plugin.wsConnection?.readyState === WebSocket.OPEN);

        // Chat container
        this.chatContainer = container.createDiv({ cls: "claude-chat-container" });

        // Welcome message
        this.addMessage({
            role: 'system',
            content: 'Welcome! Claude can help you with your vault. Try asking:\n\n• "Summarize my recent notes"\n• "Find all notes about [topic]"\n• "Create a new note about..."\n• "Organize my daily notes"',
            timestamp: Date.now()
        });

        // Input container
        this.inputContainer = container.createDiv({ cls: "claude-input-container" });

        this.input = this.inputContainer.createEl("textarea", {
            placeholder: "Ask Claude about your vault...",
            cls: "claude-input"
        });

        this.sendButton = this.inputContainer.createEl("button", {
            text: "Send",
            cls: "claude-send-button"
        });

        // Event handlers
        this.sendButton.addEventListener("click", () => this.sendMessage());

        this.input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Listen for WebSocket messages
        this.plugin.onMessageCallback = (data) => this.handleServerMessage(data);
    }

    updateStatus(connected: boolean) {
        if (this.statusEl) {
            this.statusEl.empty();
            const dot = this.statusEl.createSpan({ cls: `status-dot ${connected ? 'connected' : 'disconnected'}` });
            this.statusEl.createSpan({ text: connected ? 'Connected' : 'Disconnected' });
        }
        this.updateSessionInfo();
    }

    updateSessionInfo() {
        if (this.sessionInfoEl) {
            this.sessionInfoEl.empty();
            if (this.sessionActive) {
                this.sessionInfoEl.createSpan({
                    cls: 'session-active',
                    text: `📝 Context Active`
                });
                if (this.sessionId) {
                    this.sessionInfoEl.createSpan({
                        cls: 'session-id',
                        text: ` (${this.sessionId.substring(0, 8)}...)`
                    });
                }
            } else {
                this.sessionInfoEl.createSpan({
                    cls: 'session-inactive',
                    text: '💭 New Conversation'
                });
            }
        }
    }

    clearHistory() {
        if (!this.plugin.wsConnection || this.plugin.wsConnection.readyState !== WebSocket.OPEN) {
            new Notice('Not connected to Claude SDK');
            return;
        }

        // Clear local messages
        this.messages = [];
        this.chatContainer.empty();

        // Send clear history command to SDK server
        this.plugin.wsConnection.send(JSON.stringify({
            type: 'chat',
            clearHistory: true
        }));

        // Reset session state
        this.sessionActive = false;
        this.sessionId = null;
        this.updateSessionInfo();

        // Add system message
        this.addMessage({
            role: 'system',
            content: 'Conversation history cleared. Starting fresh!',
            timestamp: Date.now()
        });

        new Notice('Chat history cleared');
    }

    async sendMessage() {
        const message = this.input.value.trim();
        if (!message) return;

        if (!this.plugin.wsConnection || this.plugin.wsConnection.readyState !== WebSocket.OPEN) {
            new Notice('Not connected to Claude SDK. Check settings.');
            return;
        }

        // Add user message to chat
        this.addMessage({
            role: 'user',
            content: message,
            timestamp: Date.now()
        });

        // Clear input
        this.input.value = "";
        this.input.focus();

        // Generate message ID
        this.currentMessageId = Math.random().toString(36).substring(7);

        // Send to SDK server
        this.plugin.wsConnection.send(JSON.stringify({
            type: 'chat',
            id: this.currentMessageId,
            prompt: message
        }));

        // Add placeholder for assistant response
        this.addMessage({
            role: 'assistant',
            content: '...',
            timestamp: Date.now()
        });
    }

    handleServerMessage(data: string) {
        try {
            const message = JSON.parse(data);

            if (message.type === 'chat_start') {
                // Update last message to show Claude is thinking
                this.updateLastAssistantMessage('🤔 Thinking...');
                // Update session info if provided
                if (message.isNewSession !== undefined) {
                    this.sessionActive = !message.isNewSession;
                    if (message.sessionId) {
                        this.sessionId = message.sessionId;
                    }
                    this.updateSessionInfo();
                }
            } else if (message.type === 'session_established') {
                // New session established
                this.sessionActive = true;
                this.sessionId = message.sessionId;
                this.updateSessionInfo();
                console.log(`Session established: ${message.sessionId}`);
            } else if (message.type === 'session_cleared') {
                // Session cleared confirmation
                this.sessionActive = false;
                this.sessionId = null;
                this.updateSessionInfo();
            } else if (message.type === 'chat_partial') {
                // Stream partial content
                const lastMessage = this.messages[this.messages.length - 1];
                if (lastMessage && lastMessage.role === 'assistant') {
                    if (lastMessage.content === '...' || lastMessage.content === '🤔 Thinking...') {
                        lastMessage.content = message.content;
                    } else {
                        lastMessage.content += message.content;
                    }
                    this.renderMessages();
                }
            } else if (message.type === 'chat_tool_use') {
                // Show tool usage
                console.log(`Tool used: ${message.tool}`);
            } else if (message.type === 'chat_complete') {
                // Final message
                if (message.toolsUsed && message.toolsUsed.length > 0) {
                    const lastMessage = this.messages[this.messages.length - 1];
                    if (lastMessage) {
                        lastMessage.tools = message.toolsUsed;
                    }
                }
                this.renderMessages();
                this.scrollToBottom();
            } else if (message.type === 'chat_error') {
                this.updateLastAssistantMessage(`❌ Error: ${message.error}`);
            } else if (message.type === 'init_response') {
                this.updateStatus(true);
            }
        } catch (error) {
            console.error('Failed to handle server message:', error);
        }
    }

    updateLastAssistantMessage(content: string) {
        const lastMessage = this.messages[this.messages.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
            lastMessage.content = content;
            this.renderMessages();
        }
    }

    addMessage(message: ChatMessage) {
        this.messages.push(message);
        this.renderMessages();
        this.scrollToBottom();
    }

    renderMessages() {
        this.chatContainer.empty();

        for (const message of this.messages) {
            const messageEl = this.chatContainer.createDiv({
                cls: `claude-message ${message.role}`
            });

            if (message.role === 'user') {
                messageEl.createSpan({ cls: 'message-role', text: 'You' });
            } else if (message.role === 'assistant') {
                messageEl.createSpan({ cls: 'message-role', text: 'Claude' });
                if (message.tools && message.tools.length > 0) {
                    const toolsEl = messageEl.createSpan({ cls: 'message-tools' });
                    toolsEl.createSpan({ text: ` (used: ${message.tools.join(', ')})` });
                }
            }

            const contentEl = messageEl.createDiv({ cls: 'message-content' });
            // Simple markdown rendering (you could enhance this)
            const lines = message.content.split('\n');
            for (const line of lines) {
                if (line.startsWith('• ')) {
                    contentEl.createEl('li', { text: line.substring(2) });
                } else if (line.trim()) {
                    contentEl.createEl('p', { text: line });
                }
            }
        }
    }

    scrollToBottom() {
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    async onClose() {
        this.plugin.onMessageCallback = null;
    }
}

export default class ClaudeCodePlugin extends Plugin {
    settings: ClaudeCodeSettings;
    statusBarItem: HTMLElement | null = null;
    wsConnection: WebSocket | null = null;
    onMessageCallback: ((data: string) => void) | null = null;

    async onload() {
        await this.loadSettings();

        // Register the chat view
        this.registerView(
            VIEW_TYPE_CLAUDE_CHAT,
            (leaf) => new ClaudeChatView(leaf, this)
        );

        // Add ribbon icon
        this.addRibbonIcon('bot', 'Claude Assistant', async () => {
            await this.activateChatView();
        });

        // Add command to open Claude chat
        this.addCommand({
            id: 'open-claude-chat',
            name: 'Open Claude Assistant',
            callback: async () => {
                await this.activateChatView();
            }
        });

        // Add settings tab
        this.addSettingTab(new ClaudeCodeSettingTab(this.app, this));

        // Status bar
        if (this.settings.showStatusBar) {
            this.statusBarItem = this.addStatusBarItem();
            this.updateStatusBar('Claude: Disconnected');
        }

        // Auto-connect if enabled
        if (this.settings.enableAutoConnect) {
            setTimeout(() => this.connectToSDK(), 1000);
        }
    }

    async activateChatView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_CHAT);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({ type: VIEW_TYPE_CLAUDE_CHAT });
            }
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    async connectToSDK() {
        if (this.wsConnection?.readyState === WebSocket.OPEN) {
            console.log('Already connected to Claude SDK');
            return;
        }

        try {
            this.wsConnection = new WebSocket(this.settings.apiEndpoint);

            this.wsConnection.onopen = () => {
                console.log('Connected to Claude SDK');
                new Notice('Connected to Claude SDK');
                this.updateStatusBar('Claude: Connected');

                // Send vault path
                const vaultPath = (this.app.vault.adapter as any).basePath;
                this.wsConnection?.send(JSON.stringify({
                    type: 'init',
                    vaultPath: vaultPath
                }));
            };

            this.wsConnection.onclose = () => {
                this.updateStatusBar('Claude: Disconnected');
                new Notice('Disconnected from Claude SDK');
            };

            this.wsConnection.onerror = (error) => {
                new Notice('Failed to connect to Claude SDK');
                console.error('WebSocket error:', error);
            };

            this.wsConnection.onmessage = (event) => {
                if (this.onMessageCallback) {
                    this.onMessageCallback(event.data);
                }
            };
        } catch (error) {
            new Notice('Failed to connect to Claude SDK');
            console.error('Connection error:', error);
        }
    }

    disconnectFromSDK() {
        if (this.wsConnection) {
            this.wsConnection.close();
            this.wsConnection = null;
            new Notice('Disconnected from Claude SDK');
        }
    }

    updateStatusBar(text: string) {
        if (this.statusBarItem) {
            this.statusBarItem.setText(text);
        }
    }

    onunload() {
        this.disconnectFromSDK();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class ClaudeCodeSettingTab extends PluginSettingTab {
    plugin: ClaudeCodePlugin;

    constructor(app: App, plugin: ClaudeCodePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();

        containerEl.createEl('h2', {text: 'Claude Code Assistant Settings'});

        new Setting(containerEl)
            .setName('SDK Endpoint')
            .setDesc('WebSocket endpoint for Claude Code SDK server')
            .addText(text => text
                .setPlaceholder('ws://localhost:7860')
                .setValue(this.plugin.settings.apiEndpoint)
                .onChange(async (value) => {
                    this.plugin.settings.apiEndpoint = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto-connect')
            .setDesc('Automatically connect to SDK when Obsidian starts')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableAutoConnect)
                .onChange(async (value) => {
                    this.plugin.settings.enableAutoConnect = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show status bar')
            .setDesc('Display connection status in the status bar')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showStatusBar)
                .onChange(async (value) => {
                    this.plugin.settings.showStatusBar = value;
                    await this.plugin.saveSettings();
                    new Notice('Restart required for status bar changes');
                }));

        containerEl.createEl('h3', {text: 'Connection'});

        new Setting(containerEl)
            .setName('Connection Status')
            .setDesc(this.plugin.wsConnection?.readyState === WebSocket.OPEN
                ? 'Connected to Claude SDK'
                : 'Not connected')
            .addButton(button => button
                .setButtonText(this.plugin.wsConnection?.readyState === WebSocket.OPEN
                    ? 'Disconnect'
                    : 'Connect')
                .onClick(() => {
                    if (this.plugin.wsConnection?.readyState === WebSocket.OPEN) {
                        this.plugin.disconnectFromSDK();
                    } else {
                        this.plugin.connectToSDK();
                    }
                    this.display();
                }));
    }
}