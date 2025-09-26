import { query } from '@anthropic-ai/claude-code';
import { WebSocketServer } from 'ws';

// WebSocket server for Obsidian plugin communication
const wss = new WebSocketServer({ port: 7860 });

// Connection state for maintaining conversation context
interface ConnectionState {
  ws: any;
  vaultPath?: string;
  hasActiveSession: boolean;  // Track if we have an ongoing conversation
  sessionId?: string;          // Store the session ID for debugging/display
  lastMessageTime?: number;    // Track last message for timeout handling
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
    hasActiveSession: false,  // Start with no active session
    lastMessageTime: Date.now()
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

      } else if (message.type === 'chat') {
        const connection = connections.get(connectionId);
        if (!connection) {
          console.error('❌ Connection not found');
          return;
        }

        const vaultPath = connection.vaultPath || process.cwd();

        // Handle clear history request
        if (message.clearHistory) {
          console.log(`🔄 Clearing conversation history for connection ${connectionId}`);
          connection.hasActiveSession = false;
          connection.sessionId = undefined;

          ws.send(JSON.stringify({
            type: 'session_cleared',
            message: 'Conversation history cleared. Next message will start a new session.'
          }));
          return;
        }

        // Update last message time
        connection.lastMessageTime = Date.now();

        console.log(`🤖 Processing chat message...`);
        console.log(`   Prompt: "${message.prompt.substring(0, 50)}..."`);
        console.log(`   Working directory: ${vaultPath}`);
        console.log(`   Session state: ${connection.hasActiveSession ? `Active (ID: ${connection.sessionId})` : 'New conversation'}`);
        console.log(`   Using continue: ${connection.hasActiveSession}`);

        // Send immediate acknowledgment
        ws.send(JSON.stringify({
          type: 'chat_start',
          id: message.id,
          isNewSession: !connection.hasActiveSession,
          sessionId: connection.sessionId
        }));

        try {
          // Build query options with continue flag if we have an active session
          const queryOptions: any = {
            cwd: vaultPath, // Work in the vault directory
            permissionMode: 'bypassPermissions' as const, // Don't ask for permission
            maxTurns: 10, // Allow multiple tool uses
            model: 'claude-sonnet-4-20250514',
            continue: connection.hasActiveSession, // KEY: Continue conversation if we have active session
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

          // Call Claude Code with the user's prompt
          const messages = query({
            prompt: message.prompt,
            options: queryOptions
          });

          let fullResponse = '';
          let toolsUsed = [];
          let currentSessionId: string | undefined;

          // Stream messages as they arrive
          for await (const msg of messages) {
            // Extract session ID from any message that has it
            if ('session_id' in msg && msg.session_id) {
              currentSessionId = msg.session_id;

              // Update connection state if this is a new session
              if (!connection.hasActiveSession) {
                connection.hasActiveSession = true;
                connection.sessionId = currentSessionId;
                console.log(`📝 New session established: ${currentSessionId}`);

                // Notify Obsidian about the new session
                ws.send(JSON.stringify({
                  type: 'session_established',
                  sessionId: currentSessionId,
                  message: 'Conversation context is now active'
                }));
              }
            }

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
              // Final result message
              console.log(`✅ Query completed`);
              console.log(`   Tools used: ${toolsUsed.join(', ') || 'none'}`);
              console.log(`   Success: ${msg.subtype === 'success'}`);

              if (msg.subtype !== 'success') {
                ws.send(JSON.stringify({
                  type: 'chat_error',
                  id: message.id,
                  error: 'Query failed: ' + msg.subtype
                }));
              }
            }
          }

          // Send final response
          ws.send(JSON.stringify({
            type: 'chat_complete',
            id: message.id,
            content: fullResponse,
            toolsUsed
          }));

        } catch (error: any) {
          console.error('❌ Claude query error:', error.message);

          // If continuation failed and we were trying to continue a session, retry without continue
          if (connection.hasActiveSession && error.message.includes('continue')) {
            console.log('⚠️ Continue failed, starting new session...');
            connection.hasActiveSession = false;
            connection.sessionId = undefined;

            try {
              // Retry without continue flag (rebuild options since queryOptions is out of scope)
              const retryOptions = {
                cwd: vaultPath,
                permissionMode: 'bypassPermissions' as const,
                maxTurns: 10,
                model: 'claude-sonnet-4-20250514',
                continue: false, // Force new session
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
              const retryMessages = query({
                prompt: message.prompt,
                options: retryOptions
              });

              // Process retry (simplified - same logic as above)
              let fullResponse = '';
              let toolsUsed = [];

              for await (const msg of retryMessages) {
                if ('session_id' in msg && msg.session_id) {
                  connection.hasActiveSession = true;
                  connection.sessionId = msg.session_id;
                  console.log(`📝 New session after retry: ${msg.session_id}`);
                }

                if (msg.type === 'assistant') {
                  const content = msg.message.content;
                  if (Array.isArray(content)) {
                    for (const block of content) {
                      if (block.type === 'text') {
                        fullResponse += block.text;
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
                }
              }

              // Send retry success
              ws.send(JSON.stringify({
                type: 'chat_complete',
                id: message.id,
                content: fullResponse,
                toolsUsed,
                wasRetry: true
              }));
              return;
            } catch (retryError: any) {
              console.error('❌ Retry also failed:', retryError.message);
              error = retryError; // Use retry error for final error message
            }
          }

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