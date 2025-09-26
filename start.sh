#!/bin/bash

echo "🚀 Starting Claude Code SDK Server for Obsidian..."
echo ""

# Check if Claude is authenticated
if ! claude --version > /dev/null 2>&1; then
    echo "❌ Claude Code CLI not found. Please install it first:"
    exit 1
fi

# Start the SDK server
echo "📡 Starting SDK server on port 7860..."
cd sdk-server
pnpm run dev
