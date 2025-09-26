import { query } from '@anthropic-ai/claude-code';
import { WebSocketServer } from 'ws';

// WebSocket server for Obsidian plugin communication
const wss = new WebSocketServer({ port: 7860 });

// Store active connections with their vault paths
const connections = new Map<string, { ws: any; vaultPath?: string }>();

console.log('🚀 Claude Code SDK Server for Obsidian');
console.log('📡 WebSocket server listening on port 7860');
console.log('⏳ Waiting for Obsidian to connect...\n');

wss.on('connection', (ws) => {
  const connectionId = Math.random().toString(36).substring(7);
  connections.set(connectionId, { ws });

  console.log(`✅ Obsidian connected (ID: ${connectionId})`);

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
        const vaultPath = connection?.vaultPath || process.cwd();

        console.log(`🤖 Processing chat message...`);
        console.log(`   Prompt: "${message.prompt.substring(0, 50)}..."`);
        console.log(`   Working directory: ${vaultPath}`);

        // Send immediate acknowledgment
        ws.send(JSON.stringify({
          type: 'chat_start',
          id: message.id
        }));

        try {
          // Call Claude Code with the user's prompt
          const messages = query({
            prompt: message.prompt,
            options: {
              cwd: vaultPath, // Work in the vault directory
              permissionMode: 'bypassPermissions', // Don't ask for permission
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
            }
          });

          let fullResponse = '';
          let toolsUsed = [];

          // Stream messages as they arrive
          for await (const msg of messages) {
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