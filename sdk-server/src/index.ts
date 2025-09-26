import { query } from '@anthropic-ai/claude-code';
import { WebSocketServer } from 'ws';

// WebSocket server for Obsidian plugin communication
const wss = new WebSocketServer({ port: 7860 });

// Token usage tracking for context awareness
interface TokenUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  currentTurn: number;
  contextLimit: number;  // Default 200K, but configurable
  lastMessageInput: number;
  lastMessageOutput: number;
}

// Individual chat session
interface ChatSession {
  id: string;              // Our internal chat ID (e.g., chat_xxxxx)
  sessionId?: string;      // Claude's session ID from SDK
  title: string;           // Display name for the chat
  icon: string;            // Emoji icon for the chat
  createdAt: number;       // Creation timestamp
  lastMessageAt: number;   // Last activity timestamp
  messageCount: number;    // Total messages in this chat
  tokenUsage: TokenUsage;  // Token tracking for this chat
  preview: string;         // Last message snippet for display
  messages: Array<{        // Recent messages for context
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }>;
}

// Connection state for maintaining conversation context
interface ConnectionState {
  ws: any;
  vaultPath?: string;
  currentChatId?: string;              // Currently active chat
  chats: Map<string, ChatSession>;    // All chat sessions
}

// Store active connections with their state
const connections = new Map<string, ConnectionState>();

console.log('🚀 Claude Code SDK Server for Obsidian');
console.log('📡 WebSocket server listening on port 7860');
console.log('⏳ Waiting for Obsidian to connect...\n');

wss.on('connection', (ws) => {
  const connectionId = Math.random().toString(36).substring(7);
  connections.set(connectionId, {
    ws,
    chats: new Map()  // Start with no chats
  });

  console.log(`✅ Obsidian connected (ID: ${connectionId})`);
  console.log(`   Session state: New (no active conversation)`);

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`📨 Received:`, message.type);

      if (message.type === 'init') {
        // Store vault path when Obsidian connects
        const connection = connections.get(connectionId);
        if (connection) {
          connection.vaultPath = message.vaultPath;
          console.log(`📁 Vault path set: ${message.vaultPath}`);
        }

        ws.send(JSON.stringify({
          type: 'init_response',
          status: 'ready',
          message: 'Claude Code SDK ready. You can start chatting!'
        }));

      } else if (message.type === 'list_chats') {
        // Return list of all chats
        const connection = connections.get(connectionId);
        if (!connection) {
          ws.send(JSON.stringify({ type: 'error', error: 'Connection not found' }));
          return;
        }

        const chatList = Array.from(connection.chats.values()).map(chat => ({
          id: chat.id,
          title: chat.title,
          icon: chat.icon,
          createdAt: chat.createdAt,
          lastMessageAt: chat.lastMessageAt,
          messageCount: chat.messageCount,
          preview: chat.preview,
          tokenUsage: {
            total: chat.tokenUsage.totalInputTokens + chat.tokenUsage.totalOutputTokens,
            percentage: ((chat.tokenUsage.totalInputTokens + chat.tokenUsage.totalOutputTokens) / chat.tokenUsage.contextLimit) * 100
          }
        }));

        ws.send(JSON.stringify({
          type: 'chat_list',
          chats: chatList
        }));

      } else if (message.type === 'new_chat') {
        // Create a new chat
        const connection = connections.get(connectionId);
        if (!connection) {
          ws.send(JSON.stringify({ type: 'error', error: 'Connection not found' }));
          return;
        }

        const chatId = `chat_${Math.random().toString(36).substring(7)}`;
        const newChat: ChatSession = {
          id: chatId,
          title: message.title || 'New Chat',
          icon: message.icon || '💬',
          createdAt: Date.now(),
          lastMessageAt: Date.now(),
          messageCount: 0,
          tokenUsage: {
            totalInputTokens: 0,
            totalOutputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            currentTurn: 0,
            contextLimit: 200_000,
            lastMessageInput: 0,
            lastMessageOutput: 0
          },
          preview: '',
          messages: []
        };

        connection.chats.set(chatId, newChat);
        connection.currentChatId = chatId;

        ws.send(JSON.stringify({
          type: 'chat_created',
          chat: {
            id: chatId,
            title: newChat.title,
            icon: newChat.icon
          }
        }));

      } else if (message.type === 'load_chat') {
        // Load an existing chat
        const connection = connections.get(connectionId);
        if (!connection) {
          ws.send(JSON.stringify({ type: 'error', error: 'Connection not found' }));
          return;
        }

        let chat = connection.chats.get(message.chatId);

        // If chat doesn't exist but messages are provided, create it
        if (!chat && message.messages) {
          chat = {
            id: message.chatId,
            title: 'Restored Chat',
            icon: '💬',
            createdAt: Date.now(),
            lastMessageAt: Date.now(),
            messageCount: message.messages.length,
            tokenUsage: {
              totalInputTokens: 0,
              totalOutputTokens: 0,
              cacheCreationTokens: 0,
              cacheReadTokens: 0,
              currentTurn: 0,
              contextLimit: 200_000,
              lastMessageInput: 0,
              lastMessageOutput: 0
            },
            preview: message.messages[message.messages.length - 1]?.content.substring(0, 100) || '',
            messages: message.messages
          };
          connection.chats.set(message.chatId, chat);
        }

        if (!chat) {
          ws.send(JSON.stringify({ type: 'error', error: 'Chat not found' }));
          return;
        }

        // If messages were provided, update the chat
        if (message.messages) {
          chat.messages = message.messages;
          chat.messageCount = message.messages.length;
          chat.lastMessageAt = Date.now();
          if (message.messages.length > 0) {
            chat.preview = message.messages[message.messages.length - 1].content.substring(0, 100);
          }
        }

        connection.currentChatId = message.chatId;

        ws.send(JSON.stringify({
          type: 'chat_loaded',
          chatId: message.chatId,
          messages: chat.messages,
          tokenUsage: {
            totalTokens: chat.tokenUsage.totalInputTokens + chat.tokenUsage.totalOutputTokens,
            percentage: ((chat.tokenUsage.totalInputTokens + chat.tokenUsage.totalOutputTokens) / chat.tokenUsage.contextLimit) * 100,
            inputTokens: chat.tokenUsage.lastMessageInput,
            outputTokens: chat.tokenUsage.lastMessageOutput,
            totalInputTokens: chat.tokenUsage.totalInputTokens,
            totalOutputTokens: chat.tokenUsage.totalOutputTokens,
            cacheTokens: chat.tokenUsage.cacheReadTokens,
            cacheEfficiency: chat.tokenUsage.cacheReadTokens > 0
              ? ((chat.tokenUsage.cacheReadTokens / (chat.tokenUsage.totalInputTokens + chat.tokenUsage.cacheReadTokens)) * 100)
              : 0,
            turnsUsed: chat.tokenUsage.currentTurn,
            contextLimit: chat.tokenUsage.contextLimit,
            warningLevel: ((chat.tokenUsage.totalInputTokens + chat.tokenUsage.totalOutputTokens) / chat.tokenUsage.contextLimit) * 100 < 50 ? 'safe' :
                         ((chat.tokenUsage.totalInputTokens + chat.tokenUsage.totalOutputTokens) / chat.tokenUsage.contextLimit) * 100 < 75 ? 'caution' :
                         ((chat.tokenUsage.totalInputTokens + chat.tokenUsage.totalOutputTokens) / chat.tokenUsage.contextLimit) * 100 < 90 ? 'warning' : 'critical'
          }
        }));

      } else if (message.type === 'delete_chat') {
        // Delete a chat
        const connection = connections.get(connectionId);
        if (!connection) {
          ws.send(JSON.stringify({ type: 'error', error: 'Connection not found' }));
          return;
        }

        connection.chats.delete(message.chatId);
        if (connection.currentChatId === message.chatId) {
          connection.currentChatId = undefined;
        }

        ws.send(JSON.stringify({
          type: 'chat_deleted',
          chatId: message.chatId
        }));

      } else if (message.type === 'rename_chat') {
        // Rename a chat
        const connection = connections.get(connectionId);
        if (!connection) {
          ws.send(JSON.stringify({ type: 'error', error: 'Connection not found' }));
          return;
        }

        const chat = connection.chats.get(message.chatId);
        if (!chat) {
          ws.send(JSON.stringify({ type: 'error', error: 'Chat not found' }));
          return;
        }

        chat.title = message.title;
        if (message.icon) {
          chat.icon = message.icon;
        }

        ws.send(JSON.stringify({
          type: 'chat_renamed',
          chatId: message.chatId,
          title: message.title,
          icon: chat.icon
        }));

      } else if (message.type === 'chat') {
        const connection = connections.get(connectionId);
        if (!connection) {
          console.error('❌ Connection not found');
          return;
        }

        const vaultPath = connection.vaultPath || process.cwd();

        // Get or create chat
        let chatId = message.chatId || connection.currentChatId;
        let chat: ChatSession;

        if (!chatId || !connection.chats.has(chatId)) {
          // Create new chat if none exists
          chatId = `chat_${Math.random().toString(36).substring(7)}`;

          // Auto-generate title from first message (truncate to 50 chars)
          const autoTitle = message.prompt.length > 50
            ? message.prompt.substring(0, 47) + '...'
            : message.prompt;

          // Choose icon based on content keywords
          let icon = '💬';
          const prompt = message.prompt.toLowerCase();
          if (prompt.includes('code') || prompt.includes('plugin') || prompt.includes('develop')) icon = '💻';
          else if (prompt.includes('note') || prompt.includes('vault') || prompt.includes('obsidian')) icon = '📝';
          else if (prompt.includes('research') || prompt.includes('study')) icon = '🔬';
          else if (prompt.includes('help') || prompt.includes('how')) icon = '❓';
          else if (prompt.includes('bug') || prompt.includes('error') || prompt.includes('fix')) icon = '🐛';
          else if (prompt.includes('idea') || prompt.includes('think')) icon = '💡';

          chat = {
            id: chatId,
            title: autoTitle,
            icon: icon,
            createdAt: Date.now(),
            lastMessageAt: Date.now(),
            messageCount: 0,
            tokenUsage: {
              totalInputTokens: 0,
              totalOutputTokens: 0,
              cacheCreationTokens: 0,
              cacheReadTokens: 0,
              currentTurn: 0,
              contextLimit: 200_000,
              lastMessageInput: 0,
              lastMessageOutput: 0
            },
            preview: '',
            messages: []
          };

          connection.chats.set(chatId, chat);
          connection.currentChatId = chatId;

          // Notify about new chat creation
          ws.send(JSON.stringify({
            type: 'chat_created',
            chat: {
              id: chatId,
              title: chat.title,
              icon: chat.icon
            }
          }));
        } else {
          chat = connection.chats.get(chatId)!;
        }

        // Handle clear history request for current chat
        if (message.clearHistory) {
          console.log(`🔄 Clearing conversation history for chat ${chatId}`);
          chat.sessionId = undefined;
          chat.messages = [];
          chat.messageCount = 0;
          chat.preview = '';

          // Reset token usage
          chat.tokenUsage = {
            totalInputTokens: 0,
            totalOutputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            currentTurn: 0,
            contextLimit: 200_000,
            lastMessageInput: 0,
            lastMessageOutput: 0
          };

          ws.send(JSON.stringify({
            type: 'session_cleared',
            chatId,
            message: 'Conversation history cleared. Next message will start a new session.'
          }));
          return;
        }

        // Update last message time
        chat.lastMessageAt = Date.now();

        // Store user message
        chat.messages.push({
          role: 'user',
          content: message.prompt,
          timestamp: Date.now()
        });
        chat.messageCount++;
        chat.preview = message.prompt.substring(0, 100); // Update preview with latest message

        console.log(`🤖 Processing chat message...`);
        console.log(`   Chat: ${chat.title} (${chatId})`);
        console.log(`   Prompt: "${message.prompt.substring(0, 50)}..."`);
        console.log(`   Working directory: ${vaultPath}`);
        console.log(`   Messages in chat: ${chat.messages.length}`);

        // Build conversation history for context
        let conversationContext = '';
        if (chat.messages.length > 1) {
          // Include previous messages for context (limit to last 10 exchanges)
          const recentMessages = chat.messages.slice(-20); // Last 10 exchanges
          for (const msg of recentMessages.slice(0, -1)) { // Exclude the current message we just added
            if (msg.role === 'user') {
              conversationContext += `\n\nUser: ${msg.content}`;
            } else if (msg.role === 'assistant') {
              conversationContext += `\n\nAssistant: ${msg.content}`;
            }
          }
          if (conversationContext) {
            conversationContext = `Previous conversation context:${conversationContext}\n\n---\n\nCurrent question: `;
          }
        }

        // Send immediate acknowledgment
        ws.send(JSON.stringify({
          type: 'chat_start',
          id: message.id,
          chatId,
          isNewSession: chat.messages.length === 1,
          sessionId: null
        }));

        try {
          // Build the full prompt with conversation context
          const fullPrompt = conversationContext ? conversationContext + message.prompt : message.prompt;

          // Build query options - NO resume, each message is independent
          const queryOptions: any = {
            cwd: vaultPath, // Work in the vault directory
            permissionMode: 'bypassPermissions' as const, // Don't ask for permission
            maxTurns: 10, // Allow multiple tool uses
            model: 'claude-sonnet-4-20250514',
            appendSystemPrompt: `You are an expert assistant for managing an Obsidian knowledge base vault. Key Obsidian conventions:

## File Structure
- All notes are markdown files with .md extension
- Files can be organized in folders/subfolders
- Daily notes typically use YYYY-MM-DD format (e.g., 2024-01-15.md)
- Attachments often stored in specific folders (Assets, Attachments, Files)

## Linking & References
- [[wikilinks]] create connections between notes (e.g., [[My Note]] links to "My Note.md")
- Can use aliases: [[My Note|Custom Text]]
- Backlinks show which notes reference the current note
- Tags use # syntax (e.g., #project/active, #idea)

## Frontmatter
- YAML metadata between --- markers at the start of files
- Common fields: title, date, tags, aliases, status
- Example:
  ---
  title: "My Note"
  date: 2024-01-15
  tags: [concept, review]
  ---

## Best Practices
- When creating notes, include relevant [[wikilinks]] to connect with existing notes
- Use descriptive filenames that work well as wikilinks
- Preserve existing frontmatter when editing files
- Create atomic notes focused on single concepts when appropriate
- Consider the existing folder structure and organization patterns
- When searching, remember to check for variations (singular/plural, different cases)

## Special Features
- Code blocks with syntax highlighting using triple backticks
- Callouts using > [!type] syntax (e.g., > [!note], > [!warning])
- Embeds with ![[filename]] to transclude content
- Block references with ^block-id

Remember: The user is working in their personal knowledge management system. Be helpful in organizing, finding, creating, and connecting their notes effectively.`
          };

          // Call Claude Code with the full prompt including context
          const messages = query({
            prompt: fullPrompt,
            options: queryOptions
          });

          let fullResponse = '';
          let toolsUsed = [];
          let currentSessionId: string | undefined;

          // Stream messages as they arrive
          for await (const msg of messages) {
            // Note: We don't track session IDs anymore since each query is independent
            // This avoids the confusion between multiple chat sessions

            if (msg.type === 'assistant') {
              // Extract text content from assistant message
              const content = msg.message.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'text') {
                    fullResponse += block.text;
                    // Stream partial response
                    ws.send(JSON.stringify({
                      type: 'chat_partial',
                      id: message.id,
                      content: block.text
                    }));
                  } else if (block.type === 'tool_use') {
                    toolsUsed.push(block.name);
                    ws.send(JSON.stringify({
                      type: 'chat_tool_use',
                      id: message.id,
                      tool: block.name,
                      input: block.input
                    }));
                  }
                }
              }
            } else if (msg.type === 'result') {
              // Final result message with token usage
              console.log(`✅ Query completed`);
              console.log(`   Tools used: ${toolsUsed.join(', ') || 'none'}`);
              console.log(`   Success: ${msg.subtype === 'success'}`);

              // Extract and track token usage for this specific chat
              if (msg.usage) {
                const usage = msg.usage;
                const tokens = chat.tokenUsage;

                // Update token counts
                tokens.lastMessageInput = usage.input_tokens || 0;
                tokens.lastMessageOutput = usage.output_tokens || 0;
                tokens.totalInputTokens += tokens.lastMessageInput;
                tokens.totalOutputTokens += tokens.lastMessageOutput;

                // Track cache tokens
                if (usage.cache_creation_input_tokens) {
                  tokens.cacheCreationTokens += usage.cache_creation_input_tokens;
                }
                if (usage.cache_read_input_tokens) {
                  tokens.cacheReadTokens += usage.cache_read_input_tokens;
                }

                // Increment turn count
                tokens.currentTurn = msg.num_turns || tokens.currentTurn + 1;

                // Calculate current context usage and percentage
                const totalTokens = tokens.totalInputTokens + tokens.totalOutputTokens;
                const percentage = (totalTokens / tokens.contextLimit) * 100;
                const cacheEfficiency = tokens.cacheReadTokens > 0
                  ? ((tokens.cacheReadTokens / (tokens.totalInputTokens + tokens.cacheReadTokens)) * 100)
                  : 0;

                // Determine warning level
                let warningLevel: 'safe' | 'caution' | 'warning' | 'critical';
                if (percentage < 50) warningLevel = 'safe';
                else if (percentage < 75) warningLevel = 'caution';
                else if (percentage < 90) warningLevel = 'warning';
                else warningLevel = 'critical';

                console.log(`📊 Token usage: ${totalTokens.toLocaleString()}/${tokens.contextLimit.toLocaleString()} (${percentage.toFixed(1)}%)`);
                console.log(`   Input: ${tokens.lastMessageInput} | Output: ${tokens.lastMessageOutput} | Cache saved: ${tokens.cacheReadTokens}`);

                // Send token usage update
                ws.send(JSON.stringify({
                  type: 'token_usage_update',
                  usage: {
                    totalTokens,
                    percentage: parseFloat(percentage.toFixed(1)),
                    inputTokens: tokens.lastMessageInput,
                    outputTokens: tokens.lastMessageOutput,
                    totalInputTokens: tokens.totalInputTokens,
                    totalOutputTokens: tokens.totalOutputTokens,
                    cacheTokens: tokens.cacheReadTokens,
                    cacheEfficiency: parseFloat(cacheEfficiency.toFixed(1)),
                    turnsUsed: tokens.currentTurn,
                    contextLimit: tokens.contextLimit,
                    warningLevel
                  }
                }));
              }

              if (msg.subtype !== 'success') {
                ws.send(JSON.stringify({
                  type: 'chat_error',
                  id: message.id,
                  error: 'Query failed: ' + msg.subtype
                }));
              }
            }
          }

          // Store assistant message
          if (fullResponse) {
            chat.messages.push({
              role: 'assistant',
              content: fullResponse,
              timestamp: Date.now()
            });
            chat.messageCount++;
            chat.preview = fullResponse.substring(0, 100); // Update preview
          }

          // Send final response
          ws.send(JSON.stringify({
            type: 'chat_complete',
            id: message.id,
            chatId,
            content: fullResponse,
            toolsUsed
          }));

        } catch (error: any) {
          console.error('❌ Claude query error:', error.message);

          ws.send(JSON.stringify({
            type: 'chat_error',
            id: message.id,
            error: error.message
          }));
        }

      } else if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }

    } catch (error) {
      console.error('❌ Message handling error:', error);
    }
  });

  ws.on('close', () => {
    connections.delete(connectionId);
    console.log(`👋 Obsidian disconnected (ID: ${connectionId})`);
  });

  ws.on('error', (error) => {
    console.error(`❌ WebSocket error for ${connectionId}:`, error);
  });

  // Send initial connection confirmation
  ws.send(JSON.stringify({
    type: 'connected',
    connectionId,
    message: 'Connected to Claude Code SDK server'
  }));
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  wss.close(() => {
    process.exit(0);
  });
});