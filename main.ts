import { App, Plugin, PluginSettingTab, Setting, Notice, WorkspaceLeaf, ItemView } from 'obsidian';

interface ClaudeCodeSettings {
    apiEndpoint: string;
    enableAutoConnect: boolean;
    showStatusBar: boolean;
    savedChats?: StoredChat[];  // Persist chats
}

// Stored chat format for persistence
interface StoredChat {
    id: string;
    title: string;
    icon: string;
    createdAt: number;
    lastMessageAt: number;
    messages: ChatMessage[];
    tokenUsage?: {
        total: number;
        percentage: number;
    };
}

const DEFAULT_SETTINGS: ClaudeCodeSettings = {
    apiEndpoint: 'ws://localhost:7860',
    enableAutoConnect: true,
    showStatusBar: true
};

const VIEW_TYPE_CLAUDE_CHAT = "claude-chat-view";
const VIEW_TYPE_CHAT_LIST = "claude-chat-list";

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    tools?: string[];
}

interface TokenUsageData {
    totalTokens: number;
    percentage: number;
    inputTokens: number;
    outputTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    cacheTokens: number;
    cacheEfficiency: number;
    turnsUsed: number;
    contextLimit: number;
    warningLevel: 'safe' | 'caution' | 'warning' | 'critical';
}

interface ChatSessionData {
    id: string;
    title: string;
    icon: string;
    createdAt: number;
    lastMessageAt: number;
    messageCount: number;
    preview: string;
    tokenUsage?: {
        total: number;
        percentage: number;
    };
}

// Chat List View
class ChatListView extends ItemView {
    plugin: ClaudeCodePlugin;
    chatList: ChatSessionData[] = [];
    listContainer: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: ClaudeCodePlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return VIEW_TYPE_CHAT_LIST;
    }

    getDisplayText() {
        return "Chats";
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('claude-chat-list-view');

        // Header
        const header = container.createDiv({ cls: 'claude-list-header' });
        const titleRow = header.createDiv({ cls: 'claude-header-row' });
        titleRow.createEl('h4', { text: '🤖 Claude Assistant' });

        // New chat button
        const newChatBtn = titleRow.createEl('button', {
            text: '+ New Chat',
            cls: 'claude-new-chat-btn'
        });
        newChatBtn.onclick = () => this.createNewChat();

        // List container
        this.listContainer = container.createDiv({ cls: 'claude-chat-list-container' });

        // Load saved chats from settings first
        if (this.plugin.settings.savedChats && this.plugin.settings.savedChats.length > 0) {
            this.chatList = this.plugin.settings.savedChats.map(saved => ({
                id: saved.id,
                title: saved.title,
                icon: saved.icon,
                createdAt: saved.createdAt,
                lastMessageAt: saved.lastMessageAt,
                messageCount: saved.messages.length,
                preview: saved.messages[saved.messages.length - 1]?.content.substring(0, 100) || '',
                tokenUsage: saved.tokenUsage
            }));
            this.renderChatList();
        }

        // Request chat list from server (will update if server has more info)
        this.requestChatList();

        // Listen for WebSocket messages
        this.plugin.onListMessageCallback = (data) => this.handleServerMessage(data);
    }

    requestChatList() {
        if (this.plugin.wsConnection?.readyState === WebSocket.OPEN) {
            this.plugin.wsConnection.send(JSON.stringify({
                type: 'list_chats'
            }));
        }
    }

    handleServerMessage(data: string) {
        try {
            const message = JSON.parse(data);

            if (message.type === 'chat_list') {
                this.chatList = message.chats || [];
                this.renderChatList();
                // Sync to settings
                this.plugin.saveChatList(this.chatList);
            } else if (message.type === 'chat_created') {
                // Save the new chat immediately
                const newChat: StoredChat = {
                    id: message.chat.id,
                    title: message.chat.title,
                    icon: message.chat.icon,
                    createdAt: Date.now(),
                    lastMessageAt: Date.now(),
                    messages: [],
                    tokenUsage: { total: 0, percentage: 0 }
                };
                this.plugin.addStoredChat(newChat);
                // Navigate to the new chat
                this.plugin.openChat(message.chat.id);
            } else if (message.type === 'chat_deleted') {
                // Remove from saved chats
                if (message.chatId) {
                    this.plugin.removeStoredChat(message.chatId);
                }
                // Refresh the list
                this.requestChatList();
            }
        } catch (error) {
            console.error('Failed to handle server message:', error);
        }
    }

    createNewChat() {
        if (!this.plugin.wsConnection || this.plugin.wsConnection.readyState !== WebSocket.OPEN) {
            new Notice('Not connected to Claude SDK');
            return;
        }

        this.plugin.wsConnection.send(JSON.stringify({
            type: 'new_chat'
        }));
    }

    renderChatList() {
        this.listContainer.empty();

        if (this.chatList.length === 0) {
            // Empty state
            const emptyState = this.listContainer.createDiv({ cls: 'claude-empty-state' });
            emptyState.createEl('p', { text: 'No conversations yet' });
            emptyState.createEl('p', { text: 'Start a new chat to get help with your vault!', cls: 'claude-empty-hint' });
            return;
        }

        // Render each chat
        for (const chat of this.chatList) {
            const chatItem = this.listContainer.createDiv({ cls: 'claude-chat-item' });

            chatItem.onclick = () => this.plugin.openChat(chat.id);

            // Chat header
            const chatHeader = chatItem.createDiv({ cls: 'claude-chat-header' });
            chatHeader.createSpan({ text: `${chat.icon} ${chat.title}`, cls: 'claude-chat-title' });

            // Options menu
            const optionsBtn = chatHeader.createEl('button', {
                text: '⋮',
                cls: 'claude-chat-options'
            });
            optionsBtn.onclick = (e) => {
                e.stopPropagation();
                this.showChatOptions(chat, optionsBtn);
            };

            // Chat metadata
            const chatMeta = chatItem.createDiv({ cls: 'claude-chat-meta' });
            const timeAgo = this.formatTimeAgo(chat.lastMessageAt);
            chatMeta.createSpan({ text: `${timeAgo} • ${chat.messageCount} messages`, cls: 'claude-chat-stats' });

            if (chat.tokenUsage && chat.tokenUsage.percentage > 0) {
                const tokenClass = chat.tokenUsage.percentage > 75 ? 'high' :
                                  chat.tokenUsage.percentage > 50 ? 'medium' : 'low';
                chatMeta.createSpan({ text: ` • ${chat.tokenUsage.percentage.toFixed(0)}% context`, cls: `claude-chat-tokens ${tokenClass}` });
            }

            // Preview
            if (chat.preview) {
                const preview = chatItem.createDiv({ cls: 'claude-chat-preview' });
                preview.setText(chat.preview);
            }
        }
    }

    formatTimeAgo(timestamp: number): string {
        const now = Date.now();
        const diff = now - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return days === 1 ? 'Yesterday' : `${days} days ago`;
        if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
        if (minutes > 0) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
        return 'Just now';
    }

    showChatOptions(chat: ChatSessionData, button: HTMLElement) {
        // Create context menu using Obsidian's API
        const menu = document.body.createDiv({ cls: 'claude-context-menu' });

        // Position near button
        const rect = button.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top = `${rect.bottom + 5}px`;
        menu.style.right = `${window.innerWidth - rect.right}px`;

        // Menu items
        const renameItem = menu.createDiv({ cls: 'claude-menu-item' });
        renameItem.setText('✏️ Rename');
        renameItem.onclick = () => {
            this.renameChat(chat);
            menu.remove();
        };

        const deleteItem = menu.createDiv({ cls: 'claude-menu-item danger' });
        deleteItem.setText('🗑️ Delete');
        deleteItem.onclick = () => {
            this.deleteChat(chat);
            menu.remove();
        };

        // Handle clicks outside
        setTimeout(() => {
            const closeMenu = (e: MouseEvent) => {
                if (!menu.contains(e.target as Node)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            };
            document.addEventListener('click', closeMenu);
        }, 0);
    }

    renameChat(chat: ChatSessionData) {
        const newTitle = prompt('Enter new title:', chat.title);
        if (newTitle && newTitle !== chat.title) {
            this.plugin.wsConnection?.send(JSON.stringify({
                type: 'rename_chat',
                chatId: chat.id,
                title: newTitle
            }));
            this.requestChatList();
        }
    }

    deleteChat(chat: ChatSessionData) {
        if (confirm(`Delete "${chat.title}"?`)) {
            this.plugin.wsConnection?.send(JSON.stringify({
                type: 'delete_chat',
                chatId: chat.id
            }));
        }
    }

    async onClose() {
        this.plugin.onListMessageCallback = null;
    }
}

// Chat View (individual chat)
class ClaudeChatView extends ItemView {
    plugin: ClaudeCodePlugin;
    chatId: string | null = null;
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
    tokenUsage: TokenUsageData | null = null;
    tokenUsageContainer: HTMLElement | null = null;
    tokenProgressBar: HTMLElement | null = null;
    tokenDetailsEl: HTMLElement | null = null;
    backButton: HTMLElement | null = null;
    titleEl: HTMLElement | null = null;

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

        // Back button
        this.backButton = titleRow.createEl('button', {
            text: '← Chats',
            cls: 'claude-back-btn'
        });
        this.backButton.onclick = () => this.plugin.showChatList();

        // Chat title
        this.titleEl = titleRow.createEl('h4', { text: 'Claude Assistant' });

        // Clear history button
        const clearBtn = titleRow.createEl('button', {
            text: '🔄 Clear',
            cls: 'claude-clear-btn'
        });
        clearBtn.onclick = () => this.clearHistory();

        // Status row
        const statusRow = header.createDiv({ cls: 'claude-status-row' });
        this.statusEl = statusRow.createDiv({ cls: 'claude-status' });
        this.sessionInfoEl = statusRow.createDiv({ cls: 'claude-session-info' });
        this.updateStatus(this.plugin.wsConnection?.readyState === WebSocket.OPEN);

        // Token usage display
        this.tokenUsageContainer = container.createDiv({ cls: 'claude-token-usage' });
        this.createTokenUsageDisplay();

        // Chat container
        this.chatContainer = container.createDiv({ cls: "claude-chat-container" });

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

        // Load chat if provided - ensure all elements are initialized
        if (this.plugin.currentChatId && this.chatContainer && this.titleEl) {
            this.loadChat(this.plugin.currentChatId);
        }
    }

    loadChat(chatId: string) {
        this.chatId = chatId;

        // First try to load from saved chats
        const savedChat = this.plugin.settings.savedChats?.find(c => c.id === chatId);
        if (savedChat) {
            this.messages = savedChat.messages;
            if (this.titleEl) {
                this.titleEl.setText(`${savedChat.icon} ${savedChat.title}`);
            }
            this.renderMessages();
            this.scrollToBottom();

            // Send the chat history to the server so it knows about it
            if (this.plugin.wsConnection?.readyState === WebSocket.OPEN) {
                this.plugin.wsConnection.send(JSON.stringify({
                    type: 'load_chat',
                    chatId: chatId,
                    messages: savedChat.messages
                }));
            }
        } else {
            // No saved chat, clear and request from server
            this.messages = [];
            if (this.chatContainer) {
                this.chatContainer.empty();
            }

            // Request chat data from server
            if (this.plugin.wsConnection?.readyState === WebSocket.OPEN) {
                this.plugin.wsConnection.send(JSON.stringify({
                    type: 'load_chat',
                    chatId: chatId
                }));
            }
        }
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

    createTokenUsageDisplay() {
        if (!this.tokenUsageContainer) return;

        this.tokenUsageContainer.empty();

        // Progress bar container
        const progressContainer = this.tokenUsageContainer.createDiv({ cls: 'token-progress-container' });

        // Progress bar
        const progressBarBg = progressContainer.createDiv({ cls: 'token-progress-bg' });
        this.tokenProgressBar = progressBarBg.createDiv({ cls: 'token-progress-bar' });

        // Token details
        this.tokenDetailsEl = this.tokenUsageContainer.createDiv({ cls: 'token-details' });

        // Initialize with no data
        this.updateTokenUsage(null);
    }

    updateTokenUsage(usage: TokenUsageData | null) {
        this.tokenUsage = usage;

        if (!this.tokenProgressBar || !this.tokenDetailsEl) return;

        if (!usage) {
            // No usage data yet
            this.tokenProgressBar.style.width = '0%';
            this.tokenProgressBar.className = 'token-progress-bar';
            this.tokenDetailsEl.setText('Context: No data yet');
            return;
        }

        // Update progress bar
        const percentage = Math.min(usage.percentage, 100);
        this.tokenProgressBar.style.width = `${percentage}%`;

        // Update color based on warning level
        this.tokenProgressBar.className = `token-progress-bar ${usage.warningLevel}`;

        // Update text details
        const tokensText = `${usage.totalTokens.toLocaleString()} / ${usage.contextLimit.toLocaleString()}`;
        const percentageText = `${usage.percentage.toFixed(1)}%`;
        const turnsText = usage.turnsUsed > 0 ? ` • ${usage.turnsUsed} turns` : '';
        const cacheText = usage.cacheEfficiency > 0 ? ` • Cache: ${usage.cacheEfficiency.toFixed(0)}%` : '';

        this.tokenDetailsEl.empty();

        // Main token info
        const mainInfo = this.tokenDetailsEl.createDiv({ cls: 'token-main-info' });
        mainInfo.createSpan({ text: `Context: ${tokensText} (${percentageText})${turnsText}${cacheText}` });

        // Warning message if needed
        if (usage.warningLevel === 'warning' || usage.warningLevel === 'critical') {
            const warningEl = this.tokenDetailsEl.createDiv({ cls: `token-warning ${usage.warningLevel}` });
            if (usage.warningLevel === 'critical') {
                warningEl.setText('⚠️ Context nearly full! Consider clearing history.');
            } else {
                warningEl.setText('⚡ High context usage');
            }
        }

        // Last message stats (smaller text)
        if (usage.inputTokens > 0 || usage.outputTokens > 0) {
            const lastMsg = this.tokenDetailsEl.createDiv({ cls: 'token-last-message' });
            lastMsg.setText(`Last: +${usage.inputTokens} in, +${usage.outputTokens} out`);
        }
    }

    clearHistory() {
        if (!this.plugin.wsConnection || this.plugin.wsConnection.readyState !== WebSocket.OPEN) {
            new Notice('Not connected to Claude SDK');
            return;
        }

        // Clear local messages
        this.messages = [];
        if (this.chatContainer) {
            this.chatContainer.empty();
        }

        // Send clear history command to SDK server
        this.plugin.wsConnection.send(JSON.stringify({
            type: 'chat',
            chatId: this.chatId,
            clearHistory: true
        }));

        // Reset session state
        this.sessionActive = false;
        this.sessionId = null;
        this.updateSessionInfo();

        // Reset token usage
        this.updateTokenUsage(null);

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

        // Send to SDK server with chat ID
        this.plugin.wsConnection.send(JSON.stringify({
            type: 'chat',
            id: this.currentMessageId,
            chatId: this.chatId,
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

            if (message.type === 'chat_loaded') {
                // Only update if we don't already have messages (from saved data)
                if (this.messages.length === 0) {
                    this.messages = message.messages || [];
                    this.renderMessages();
                    this.scrollToBottom();
                }

                // Update token usage if available
                if (message.tokenUsage) {
                    this.updateTokenUsage(message.tokenUsage);
                }

                // If no messages, show welcome
                if (this.messages.length === 0) {
                    this.addMessage({
                        role: 'system',
                        content: 'Start a conversation with Claude about your vault!',
                        timestamp: Date.now()
                    });
                }
            } else if (message.type === 'chat_created') {
                // Update current chat ID and title
                this.chatId = message.chat.id;
                if (this.titleEl) {
                    this.titleEl.setText(`${message.chat.icon} ${message.chat.title}`);
                }
            } else if (message.type === 'chat_start') {
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
            } else if (message.type === 'token_usage_update') {
                // Update token usage display
                this.updateTokenUsage(message.usage);
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

                // Save the updated chat
                if (this.chatId) {
                    this.plugin.updateStoredChat(this.chatId, this.messages);
                }
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

        // Save to storage when messages are added
        if (this.chatId) {
            this.plugin.updateStoredChat(this.chatId, this.messages);
        }
    }

    renderMessages() {
        if (!this.chatContainer) return; // Safety check
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
        if (!this.chatContainer) return; // Safety check
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
    onListMessageCallback: ((data: string) => void) | null = null;
    currentChatId: string | null = null;

    async onload() {
        await this.loadSettings();

        // Register views
        this.registerView(
            VIEW_TYPE_CLAUDE_CHAT,
            (leaf) => new ClaudeChatView(leaf, this)
        );

        this.registerView(
            VIEW_TYPE_CHAT_LIST,
            (leaf) => new ChatListView(leaf, this)
        );

        // Add ribbon icon
        this.addRibbonIcon('bot', 'Claude Assistant', async () => {
            await this.showChatList();
        });

        // Add command to open Claude
        this.addCommand({
            id: 'open-claude-chat',
            name: 'Open Claude Assistant',
            callback: async () => {
                await this.showChatList();
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

    async showChatList() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT_LIST);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            // Check if chat view is open and replace it
            const chatLeaves = workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_CHAT);
            if (chatLeaves.length > 0) {
                leaf = chatLeaves[0];
                await leaf.setViewState({ type: VIEW_TYPE_CHAT_LIST });
            } else {
                leaf = workspace.getRightLeaf(false);
                if (leaf) {
                    await leaf.setViewState({ type: VIEW_TYPE_CHAT_LIST });
                }
            }
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    async openChat(chatId: string) {
        this.currentChatId = chatId;
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;

        // Check if list view is open and replace it
        const listLeaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT_LIST);
        if (listLeaves.length > 0) {
            leaf = listLeaves[0];
            await leaf.setViewState({ type: VIEW_TYPE_CLAUDE_CHAT });
        } else {
            // Check if chat view already exists
            const chatLeaves = workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_CHAT);
            if (chatLeaves.length > 0) {
                leaf = chatLeaves[0];
            } else {
                leaf = workspace.getRightLeaf(false);
                if (leaf) {
                    await leaf.setViewState({ type: VIEW_TYPE_CLAUDE_CHAT });
                }
            }
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
            // The view will load the chat automatically via currentChatId
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
                // Route messages to appropriate view
                if (this.onMessageCallback) {
                    this.onMessageCallback(event.data);
                }
                if (this.onListMessageCallback) {
                    this.onListMessageCallback(event.data);
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

    // Helper methods for chat persistence
    saveChatList(chats: ChatSessionData[]) {
        // Convert to stored format
        this.settings.savedChats = chats.map(chat => ({
            id: chat.id,
            title: chat.title,
            icon: chat.icon,
            createdAt: chat.createdAt,
            lastMessageAt: chat.lastMessageAt,
            messages: [], // Will be populated when chat is active
            tokenUsage: chat.tokenUsage
        }));
        this.saveSettings();
    }

    addStoredChat(chat: StoredChat) {
        if (!this.settings.savedChats) {
            this.settings.savedChats = [];
        }
        // Remove if exists (update)
        this.settings.savedChats = this.settings.savedChats.filter(c => c.id !== chat.id);
        // Add new/updated
        this.settings.savedChats.push(chat);
        this.saveSettings();
    }

    updateStoredChat(chatId: string, messages: ChatMessage[]) {
        if (!this.settings.savedChats) return;

        const chat = this.settings.savedChats.find(c => c.id === chatId);
        if (chat) {
            chat.messages = messages;
            chat.lastMessageAt = Date.now();
            this.saveSettings();
        }
    }

    removeStoredChat(chatId: string) {
        if (!this.settings.savedChats) return;

        this.settings.savedChats = this.settings.savedChats.filter(c => c.id !== chatId);
        this.saveSettings();
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