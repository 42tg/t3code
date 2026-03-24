#!/bin/bash
# PreToolUse hook: Block npm, npx, yarn, and pnpm commands — this project uses bun exclusively.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Check for npm commands (including npx)
if echo "$COMMAND" | grep -qE '(^|[;&|][[:space:]]*)npm([[:space:]]|$)'; then
  echo "This project uses bun, not npm. Use the equivalent bun command instead." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE '(^|[;&|][[:space:]]*)npx([[:space:]]|$)'; then
  echo "This project uses bun, not npx. Use 'bunx' instead of 'npx'." >&2
  exit 2
fi

# Check for yarn commands
if echo "$COMMAND" | grep -qE '(^|[;&|][[:space:]]*)yarn([[:space:]]|$)'; then
  echo "This project uses bun, not yarn. Use the equivalent bun command instead." >&2
  exit 2
fi

# Check for pnpm commands
if echo "$COMMAND" | grep -qE '(^|[;&|][[:space:]]*)pnpm([[:space:]]|$)'; then
  echo "This project uses bun, not pnpm. Use the equivalent bun command instead." >&2
  exit 2
fi

exit 0
