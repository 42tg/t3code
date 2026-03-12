# Chat View: Tool Call & Agent Execution Design Specification

**Status:** Design specification (no implementation)
**Scope:** Timeline rendering of tool calls, agent (subagent) executions, and their visual hierarchy

---

## 1. Component Hierarchy

```
ChatTimeline
  TimelineRow (virtual list item)
    UserMessageBubble
    AssistantMessageBlock
    ProposedPlanCard
    ToolCallGroup                     ← NEW: replaces current work-log card
      ToolCallRow                     ← NEW: individual tool call
        ToolCallHeader (collapsed)
        ToolCallDetail (expanded)
    AgentExecutionContainer           ← NEW: wraps subagent work
      AgentExecutionHeader
      AgentExecutionBody
        ToolCallRow (nested)          ← same component, indented
      AgentExecutionFooter
    WorkingIndicator
```

### Key Structural Change

The current flat `WorkLogEntry[]` grouped into a single card is replaced by a **typed tool call model** that distinguishes between:

1. **ToolCallRow** -- a single tool invocation with lifecycle (pending/running/completed/failed)
2. **AgentExecutionContainer** -- a container for a subagent's entire execution, which itself contains nested ToolCallRows

The current `WorkLogEntry` interface is extended to carry:

- `itemType` (from `CanonicalItemType`: `command_execution`, `file_change`, `collab_agent_tool_call`, etc.)
- `status` (`inProgress | completed | failed | declined`)
- `parentTaskId?` (links child tool calls to their parent Agent execution)
- `taskId?` (for `task.started` / `task.completed` events, the agent's task ID)

---

## 2. Data Model Changes

### 2.1 Extended WorkLogEntry

```
WorkLogEntry {
  id: string
  createdAt: string
  label: string
  detail?: string
  command?: string
  changedFiles?: string[]
  tone: "thinking" | "tool" | "info" | "error"

  // NEW fields
  itemType?: CanonicalItemType       // "command_execution" | "file_change" | "collab_agent_tool_call" | ...
  status?: "inProgress" | "completed" | "failed" | "declined"
  toolName?: string                  // e.g. "Read", "Bash", "Grep" (extracted from title/detail)
  filePath?: string                  // primary file path for file operations
  elapsedMs?: number                 // computed client-side from start/complete timestamps
  parentTaskId?: string              // if this tool call belongs to an Agent subagent
  taskId?: string                    // if this is a task.started/completed entry
}
```

### 2.2 Timeline Grouping Model

Current grouping: consecutive `kind === "work"` entries merge into one card.

New grouping strategy:

```
TimelineRow =
  | MessageRow
  | ProposedPlanRow
  | ToolCallGroupRow  {            // consecutive tool calls NOT belonging to an agent
      entries: ToolCallRow[]
    }
  | AgentExecutionRow  {           // agent execution container
      taskId: string
      description?: string
      status: "running" | "completed" | "failed"
      startedAt: string
      completedAt?: string
      childEntries: ToolCallRow[]
    }
  | WorkingRow
```

Grouping rules:

1. Consecutive tool-tone entries with no `parentTaskId` group into a `ToolCallGroupRow`.
2. A `task.started` entry with `taskType` indicating an agent spawns an `AgentExecutionRow`. All subsequent entries whose `parentTaskId` matches are collected as `childEntries` until a matching `task.completed` is encountered.
3. Non-tool entries (messages, plans, info-tone events) break grouping and render as their own rows.
4. Reasoning updates (`task.progress`) with no `parentTaskId` remain inline as before.

---

## 3. Tool Call Row Design

### 3.1 Icon Mapping

| `itemType` / tool name           | Icon (lucide-react) | Color accent |
| -------------------------------- | ------------------- | ------------ |
| `command_execution` / Bash       | `Terminal`          | --           |
| `file_change` / Edit/Write       | `FilePen`           | --           |
| file_change / Read               | `FileText`          | --           |
| `web_search` / WebSearch         | `Globe`             | --           |
| `web_search` / WebFetch          | `Globe`             | --           |
| Grep                             | `Search`            | --           |
| Glob                             | `FolderSearch`      | --           |
| `collab_agent_tool_call` / Agent | `Bot`               | --           |
| `mcp_tool_call`                  | `Plug`              | --           |
| `dynamic_tool_call`              | `Wrench`            | --           |
| NotebookEdit                     | `BookOpen`          | --           |
| Skill                            | `Zap`               | --           |
| Unknown/fallback                 | `Circle`            | --           |

### 3.2 Status States

```
State Machine: ToolCallRow

  [pending] ──▶ [running] ──▶ [completed]
                    │
                    └──▶ [failed]
                    │
                    └──▶ [declined]
```

Visual mapping:

| State     | Icon color                 | Status indicator          | Background       |
| --------- | -------------------------- | ------------------------- | ---------------- |
| pending   | `text-muted-foreground/40` | Dim dot                   | `bg-card/30`     |
| running   | `text-blue-400`            | Pulsing ring animation    | `bg-card/45`     |
| completed | `text-muted-foreground/50` | Static checkmark (hidden) | `bg-card/30`     |
| failed    | `text-rose-400`            | `X` icon in red           | `bg-rose-500/5`  |
| declined  | `text-amber-400`           | `Ban` icon in amber       | `bg-amber-500/5` |

### 3.3 Collapsed View (Default)

```
┌─────────────────────────────────────────────────────────────────┐
│ [icon]  Label text                          detail    elapsed   │
│         src/components/ChatView.tsx                     1.2s    │
└─────────────────────────────────────────────────────────────────┘
```

ASCII layout:

```
┌────────────────────────────────────────────────────────────┐
│ ▸ ⊞ Read complete                              0.3s       │
│     src/components/ChatView.tsx                            │
├────────────────────────────────────────────────────────────┤
│ ▸ ◉ Bash running...                            2.1s       │
│     bun run test                                          │
├────────────────────────────────────────────────────────────┤
│ ▸ ⊞ Edit complete                              0.8s       │
│     src/session-logic.ts                                  │
├────────────────────────────────────────────────────────────┤
│ ▸ ✕ Bash failed                                4.2s       │
│     bun typecheck                                         │
└────────────────────────────────────────────────────────────┘
```

Tailwind specification for collapsed row:

```
Container:
  "flex items-start gap-2 py-1 px-2 rounded-md
   cursor-pointer transition-colors duration-100
   hover:bg-muted/30"

Chevron (expand toggle):
  "h-3.5 w-3.5 shrink-0 mt-[3px] text-muted-foreground/40
   transition-transform duration-150"
  When expanded: "rotate-90"

Tool icon:
  "h-3.5 w-3.5 shrink-0 mt-[3px]"
  Color: per status table above

Label text:
  "text-[12px] leading-snug font-medium"
  Color: per tone (tool → text-foreground/75, error → text-rose-300/60)

Elapsed time:
  "text-[10px] tabular-nums text-muted-foreground/45 ml-auto shrink-0"

File path / command (second line, collapsed):
  "text-[11px] font-mono text-muted-foreground/50 truncate"
```

### 3.4 Expanded View

Clicking a collapsed row expands it to show full input/output:

```
┌────────────────────────────────────────────────────────────┐
│ ▾ ⊞ Read complete                              0.3s   [⎘]│
│     src/components/ChatView.tsx                            │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ Input                                                │   │
│ │  file_path: /Users/.../ChatView.tsx                  │   │
│ │  offset: 5295                                        │   │
│ │  limit: 200                                          │   │
│ ├──────────────────────────────────────────────────────┤   │
│ │ Output                                     234 lines │   │
│ │  5295: const timelineEntry = timelineEntries[inde... │   │
│ │  5296: if (!timelineEntry) {                         │   │
│ │  5297:   continue;                                   │   │
│ │  ...                                                 │   │
│ │  (click to expand full output)                       │   │
│ └──────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

Expanded Bash (streaming):

```
┌────────────────────────────────────────────────────────────┐
│ ▾ ◉ Bash running...                            3.4s   [⎘]│
│     bun run test                                          │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ $ bun run test                                       │   │
│ │ ┌────────────────────────────────────────────────┐   │   │
│ │ │ PASS src/session-logic.test.ts (42 tests)      │   │   │
│ │ │ PASS src/chat-scroll.test.ts (8 tests)         │   │   │
│ │ │ FAIL src/types.test.ts                         │   │   │
│ │ │   Expected: 42                                 │   │   │
│ │ │   Received: 41                                 │▒▒▒│   │
│ │ │                                                │   │   │
│ │ └────────────────────────────────────────────────┘   │   │
│ └──────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

Tailwind for expanded detail panel:

```
Detail container:
  "mt-1.5 ml-7 rounded-md border border-border/60 bg-background/60
   overflow-hidden text-[11px]"

Section header (Input / Output):
  "px-2.5 py-1 text-[10px] uppercase tracking-wider
   text-muted-foreground/50 bg-muted/20 border-b border-border/40"

Content area:
  "px-2.5 py-2 font-mono text-[11px] leading-relaxed
   text-foreground/70 whitespace-pre-wrap overflow-x-auto
   max-h-[300px] overflow-y-auto"

Copy button [top-right of detail]:
  "absolute top-1 right-1 h-6 w-6 rounded-md
   text-muted-foreground/40 hover:text-muted-foreground/70
   hover:bg-muted/40 transition-colors duration-100"
```

### 3.5 Error State

Failed tool calls get a red left border and red-tinted background:

```
Container override:
  "border-l-2 border-l-rose-400/60 bg-rose-500/[0.03]"

Error output section:
  "text-rose-300/70 font-mono"
```

---

## 4. Agent Execution Container Design

### 4.1 State Machine

```
State Machine: AgentExecutionContainer

  [starting] ──▶ [running] ──▶ [completed]
                     │
                     └──▶ [failed]
```

### 4.2 Visual Structure

The Agent container uses a **card-with-left-accent** approach rather than indentation, because deeply nested indentation wastes horizontal space in narrow viewports.

**Collapsed Agent Execution:**

```
┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐
│ ▸ 🤖 Agent: "Review code for type safety"                │
│      ✓ 4 tool calls completed                    12.3s    │
└─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘
```

**Expanded Agent Execution:**

```
┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐
│ ▾ 🤖 Agent: "Review code for type safety"                │
│      ◉ running · 3/4 tool calls                  12.3s   │
│ ┃                                                         │
│ ┃  ▸ ⊞ Read complete                             0.3s    │
│ ┃      src/session-logic.ts                               │
│ ┃                                                         │
│ ┃  ▸ ⊞ Grep complete                             0.5s    │
│ ┃      WorkLogEntry                                       │
│ ┃                                                         │
│ ┃  ▸ ⊞ Read complete                             0.2s    │
│ ┃      src/components/ChatView.tsx                        │
│ ┃                                                         │
│ ┃  ▸ ◉ Bash running...                           2.1s    │
│ ┃      bun typecheck                                      │
│ ┃                                                         │
│ ┃ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄   │
│ ┃  Result: Found 3 type-safety issues in...              │
└─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘
```

### 4.3 Tailwind Specification

```
Outer container:
  "rounded-lg border border-border/60 bg-card/30 overflow-hidden"

Left accent bar (via border-left):
  Running:   "border-l-2 border-l-blue-400/60"
  Completed: "border-l-2 border-l-muted-foreground/20"
  Failed:    "border-l-2 border-l-rose-400/60"

Header:
  "flex items-start gap-2 px-3 py-2 cursor-pointer
   hover:bg-muted/20 transition-colors duration-100"

Bot icon:
  "h-4 w-4 shrink-0 mt-0.5"
  Running:   "text-blue-400"
  Completed: "text-muted-foreground/50"
  Failed:    "text-rose-400"

Agent description (title text):
  "text-[12px] font-medium text-foreground/80 leading-snug"

Status line:
  "text-[10px] text-muted-foreground/50 mt-0.5"

Nested tool list container (the body with left rail):
  "ml-3 border-l-2 border-l-border/40 pl-3 py-1"

Result footer:
  "mx-3 mb-2 mt-1 border-t border-border/30 pt-2
   text-[11px] text-muted-foreground/60 leading-relaxed"
```

### 4.4 Nested Tool Calls

Tool calls inside an agent container use the same `ToolCallRow` component. They are **not further indented** beyond the left-rail visual -- the rail itself provides the containment cue. This keeps the design functional at narrow widths.

If an Agent spawns a sub-Agent (double nesting), the inner agent gets a **slightly lighter left rail** (`border-l-border/25`) and an additional 8px of left margin. Maximum visual nesting depth: 2. Any deeper nesting collapses to the 2nd level visually.

---

## 5. Tool Call Group Design

### 5.1 Consecutive Non-Agent Tool Calls

When multiple tool calls occur consecutively without an agent container, they group into a `ToolCallGroup`:

```
┌────────────────────────────────────────────────────────────┐
│ TOOL CALLS (3)                                             │
│                                                            │
│   ▸ ⊞ Read complete                            0.3s       │
│       src/session-logic.ts                                 │
│                                                            │
│   ▸ ⊞ Edit complete                            0.8s       │
│       src/session-logic.ts                                 │
│                                                            │
│   ▸ ⊞ Bash complete                            2.1s       │
│       bun fmt                                              │
└────────────────────────────────────────────────────────────┘
```

Tailwind:

```
Group container:
  "rounded-lg border border-border/60 bg-card/30 px-3 py-2"

Group header:
  "mb-1.5 flex items-center justify-between gap-3"

Group label:
  "text-[10px] uppercase tracking-[0.12em] text-muted-foreground/50"

Show more button:
  "text-[10px] uppercase tracking-[0.12em] text-muted-foreground/40
   hover:text-muted-foreground/70 transition-colors duration-150"
```

### 5.2 Overflow Handling

When a group has more than 8 entries, collapse with "Show N more" (same as current behavior but threshold raised from current value to 8 for denser display).

---

## 6. Timeline Layout & Interleaving

### 6.1 Row Ordering

The timeline is **strictly chronological** by `createdAt`. The row types interleave naturally:

```
┌── User message ──────────────────────────────────────────┐
│ "Fix the TypeScript errors in session-logic.ts"          │
└──────────────────────────────────────────────────────────┘

┌── Assistant message (streaming) ─────────────────────────┐
│ I'll analyze the TypeScript errors. Let me start by...   │
└──────────────────────────────────────────────────────────┘

┌── Tool Call Group ───────────────────────────────────────┐
│ TOOL CALLS (2)                                           │
│   ▸ ⊞ Read complete   src/session-logic.ts      0.3s    │
│   ▸ ⊞ Grep complete   TypeScript.*error         0.5s    │
└──────────────────────────────────────────────────────────┘

┌── Assistant message (streaming) ─────────────────────────┐
│ I found several issues. Let me also check the test file  │
│ to understand the expected behavior...                   │
└──────────────────────────────────────────────────────────┘

┌── Agent Execution ───────────────────────────────────────┐
│ ▾ 🤖 Agent: "Analyze test expectations"                  │
│ ┃  ▸ ⊞ Read complete   session-logic.test.ts    0.4s    │
│ ┃  ▸ ⊞ Grep complete   describe.*WorkLog        0.2s    │
│ ┃  Result: The test expects entries to be sorted...      │
└──────────────────────────────────────────────────────────┘

┌── Tool Call Group ───────────────────────────────────────┐
│ TOOL CALLS (2)                                           │
│   ▸ ⊞ Edit complete    src/session-logic.ts     0.8s    │
│   ▸ ⊞ Bash complete    bun fmt && bun typecheck 3.2s    │
└──────────────────────────────────────────────────────────┘

┌── Assistant message ─────────────────────────────────────┐
│ I've fixed the TypeScript errors. The issue was...       │
└──────────────────────────────────────────────────────────┘
```

### 6.2 Grouping Rules (Precise)

Building rows from the flat `TimelineEntry[]`:

1. Walk entries in chronological order.
2. If entry is `kind: "message"` or `kind: "proposed-plan"`, emit it as its own row. This **breaks** any in-progress tool call group.
3. If entry is `kind: "work"` with `itemType: "collab_agent_tool_call"` and has a `taskId`, begin an `AgentExecutionRow`. Collect all subsequent work entries whose `parentTaskId` matches until a `task.completed` entry with matching `taskId` is found.
4. If entry is `kind: "work"` with tone `"tool"` and no `parentTaskId`, accumulate into the current `ToolCallGroupRow`. If no group is active, start one.
5. If entry is `kind: "work"` with tone `"info"` or `"thinking"` (e.g., reasoning update), it **does not break** the current tool call group -- it renders inline within the group as a subtle info line.
6. If entry is `kind: "work"` with tone `"error"`, it renders inline in the current group with error styling.

### 6.3 Visual Rhythm

Between rows, use consistent `pb-4` (16px) spacing. Within a tool call group, use `py-1` (4px) between entries for density.

Between an assistant message and a tool call group that immediately follows, reduce spacing to `pb-2` (8px) since they represent continuous thought.

---

## 7. Interaction Patterns

### 7.1 Expand/Collapse

| Target                  | Click area           | Default state                              |
| ----------------------- | -------------------- | ------------------------------------------ |
| Individual ToolCallRow  | Entire row           | Collapsed                                  |
| AgentExecutionContainer | Header area          | Collapsed when done; expanded when running |
| ToolCallGroup overflow  | "Show N more" button | Last 8 visible                             |

State management: `Record<string, boolean>` keyed by entry ID, stored in component state (not persisted).

### 7.2 Auto-Expand/Collapse Behavior

- The **most recent running** tool call is always expanded.
- When a tool call completes, it auto-collapses after 800ms (unless the user manually expanded it during that time, tracked by a `userExpanded: Set<string>` flag).
- Agent containers auto-expand when running, auto-collapse 1200ms after completion.
- When a new turn starts, all previous turn's tool calls reset to collapsed (the `userExpanded` set clears for the previous turn).

### 7.3 Copy Tool Output

A copy button appears on hover (top-right corner of the expanded detail panel). Copies the raw text output to clipboard.

### 7.4 Jump to File

For file operations (Read, Edit, Write, Glob results), the file path is rendered as a **clickable link**:

```
File path link:
  "text-[11px] font-mono text-blue-400/70 hover:text-blue-400
   hover:underline cursor-pointer transition-colors duration-100"
```

Clicking opens the file in the configured editor (VS Code by default, via the existing `EditorId` / `EDITORS` infrastructure).

### 7.5 Keyboard Navigation

Within the timeline:

- `j` / `k` -- move focus between rows (optional, lower priority)
- `Enter` or `Space` on a focused tool call -- toggle expand/collapse
- `Escape` -- collapse currently expanded item

---

## 8. Animation Specifications

### 8.1 Expand/Collapse

```css
/* Expand/collapse uses height transition with overflow hidden */
.tool-call-detail-enter {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transition:
    max-height 200ms ease-out,
    opacity 150ms ease-out;
}
.tool-call-detail-enter-active {
  max-height: 400px; /* larger than needed; content determines actual */
  opacity: 1;
}
```

Tailwind approach: Use `data-[state=open]` / `data-[state=closed]` with `grid-rows-[0fr]` / `grid-rows-[1fr]` pattern:

```
Wrapper:
  "grid transition-[grid-template-rows] duration-200 ease-out"
  Open:   "grid-rows-[1fr]"
  Closed: "grid-rows-[0fr]"

Inner:
  "overflow-hidden"
```

### 8.2 Running Pulse

```
Running indicator (replaces current dot):
  "relative h-3.5 w-3.5"

Inner ring:
  "absolute inset-0 rounded-full border-2 border-blue-400/60
   animate-ping"
  (using Tailwind's built-in animate-ping, scaled down)

Core dot:
  "absolute inset-[3px] rounded-full bg-blue-400"
```

### 8.3 Status Transitions

When a tool call transitions from running to completed:

1. The pulsing ring stops (removed from DOM).
2. The icon color fades from `text-blue-400` to `text-muted-foreground/50` over 300ms.
3. The row background fades from `bg-card/45` to `bg-card/30` over 300ms.

Tailwind: use `transition-colors duration-300` on the row container.

### 8.4 Agent Container Appearance

When an AgentExecutionContainer first appears:

- Slide in from the left with 12px translation over 200ms.
- Opacity 0 to 1 over 200ms.

```
"animate-in slide-in-from-left-3 fade-in duration-200"
```

(Using tailwindcss-animate or equivalent utility classes already present in the project.)

---

## 9. Responsive Considerations

### 9.1 Breakpoints

| Viewport width | Behavior                                                                          |
| -------------- | --------------------------------------------------------------------------------- |
| >= 768px       | Full layout: icon + label + detail + elapsed on one line                          |
| 480-767px      | Elapsed time moves to second line; detail truncates                               |
| < 480px        | Icon hidden; label only; detail on second line; elapsed hidden in collapsed state |

### 9.2 Narrow Viewport Adjustments

- Agent container left-rail width reduces from `border-l-2` to `border-l` at < 480px.
- Nested tool calls lose their left padding beyond the rail (rail itself is the only visual nesting cue).
- Expanded detail panels use `max-h-[200px]` instead of `max-h-[300px]`.
- File path chips truncate with ellipsis instead of showing full path.
- Tool call group containers lose their outer border and use only a subtle top-border separator between entries.

### 9.3 Horizontal Scrolling

Expanded output panels (Bash output, code blocks) allow horizontal scrolling rather than wrapping:

```
"overflow-x-auto overflow-y-auto whitespace-pre font-mono"
```

---

## 10. Streaming Bash Output

### 10.1 Live Output Panel

When a Bash tool call is running, its expanded view shows a **live terminal-like output** fed by `tool.progress` events:

```
┌──────────────────────────────────────────────────────────┐
│ $ bun run test                                           │
│ ┌──────────────────────────────────────────────────────┐ │
│ │                                                      │ │
│ │ PASS src/session-logic.test.ts                       │ │
│ │   deriveWorkLogEntries                               │ │
│ │     ✓ filters tool.started events (3ms)              │ │
│ │     ✓ extracts command from payload (1ms)            │ │
│ │                                                      │ │
│ │ Test Files  1 passed                                 │ │
│ │ Tests       12 passed                                │ │
│ │ Duration    1.42s                                    │ │
│ │ █                                               ← cursor │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

Tailwind for live output:

```
Terminal container:
  "mt-1.5 rounded-md border border-border/50
   bg-[#0d1117] text-[11px] font-mono
   max-h-[250px] overflow-y-auto overflow-x-auto"

Terminal content:
  "px-3 py-2 whitespace-pre text-foreground/70 leading-relaxed"

Blinking cursor (when running):
  "inline-block w-[6px] h-[14px] bg-foreground/60
   animate-[blink_1s_step-end_infinite]"
```

### 10.2 Auto-Scroll

The terminal output panel auto-scrolls to the bottom while the tool is running. If the user manually scrolls up, auto-scroll pauses until they scroll back to within 20px of the bottom.

---

## 11. Special Tool Type Rendering

### 11.1 File Operations (Read/Edit/Write/MultiEdit)

Collapsed summary format:

- Read: `Read complete` + file basename as detail
- Edit: `Edit complete` + file basename + line range if available
- Write: `Write complete` + file basename
- MultiEdit: `MultiEdit complete` + count of files

Expanded view for Edit shows a mini diff if the data payload contains old/new text.

### 11.2 Search Operations (Grep/Glob)

Collapsed: `Grep complete` + search pattern as detail
Expanded: List of matching files (up to 20), each clickable

### 11.3 Web Operations (WebSearch/WebFetch)

Collapsed: `Web search complete` + query as detail
Expanded: List of result URLs/titles

### 11.4 Agent (collab_agent_tool_call)

Does not render as a ToolCallRow. Instead spawns an `AgentExecutionContainer` (see section 4).

### 11.5 MCP Tools

Collapsed: `MCP: <tool-name> complete`
Expanded: Shows the tool's input parameters and JSON output.

---

## 12. Changed Files Display

### 12.1 File Chips (Within Tool Calls)

Current implementation shows file paths as small chips. New design refines this:

```
File chip:
  "inline-flex items-center gap-1 rounded-md
   border border-border/50 bg-background/50
   px-1.5 py-0.5 font-mono text-[10px]
   text-muted-foreground/70 hover:text-blue-400/70
   hover:border-blue-400/30 cursor-pointer
   transition-colors duration-100"
```

Each chip shows:

- VS Code file icon (from existing `getVscodeIconUrlForEntry`) at 12x12px
- File basename (not full path)
- Full path in `title` attribute (tooltip)

### 12.2 Changed Files Summary (Agent Execution Footer)

After an agent execution completes, show a summary of all files touched:

```
┌─────────────────────────────────────────────────────────┐
│ Files changed: session-logic.ts  ChatView.tsx  +1 more  │
└─────────────────────────────────────────────────────────┘
```

---

## 13. Reasoning Updates Integration

### 13.1 Within Tool Call Groups

Reasoning updates (`task.progress` entries) that arrive between tool calls render as **subtle inline text** within the group, not as separate tool call rows:

```
┌────────────────────────────────────────────────────────────┐
│ TOOL CALLS (3)                                             │
│                                                            │
│   ▸ ⊞ Read complete    session-logic.ts          0.3s     │
│                                                            │
│   Analyzing the WorkLogEntry interface...                  │
│                                                            │
│   ▸ ⊞ Grep complete    deriveWorkLogEntries      0.5s     │
│   ▸ ⊞ Edit complete    session-logic.ts          0.8s     │
└────────────────────────────────────────────────────────────┘
```

Reasoning text styling:

```
"text-[11px] leading-relaxed text-muted-foreground/50 italic
 py-0.5 pl-7"
```

---

## 14. Performance Considerations

### 14.1 Virtualization Compatibility

All new row types must work with the existing `useVirtualizer` setup. Estimated heights:

| Row type                    | Estimated height (px)               |
| --------------------------- | ----------------------------------- |
| ToolCallGroup (1-3 entries) | 80 + 28 \* count                    |
| ToolCallGroup (4-8 entries) | 80 + 28 \* 8                        |
| AgentExecution (collapsed)  | 56                                  |
| AgentExecution (expanded)   | 56 + 28 \* childCount + 40 (footer) |
| Working indicator           | 40                                  |

### 14.2 Expand/Collapse and Virtualizer

When a row expands/collapses, call `rowVirtualizer.measure()` to recalculate layout. Use `useAnimationFrameWithResizeObserver: true` (already configured) to handle smooth transitions.

### 14.3 Large Output Capping

Bash output panels cap at 500 lines in the DOM. Older lines are truncated with a "Show earlier output" button that loads from a buffer. This prevents DOM bloat during long-running commands.

---

## 15. Accessibility

- All interactive elements (expand/collapse, copy, jump-to-file) are keyboard accessible.
- Tool call status is conveyed via `aria-label` (e.g., "Bash command, running, 2.1 seconds elapsed").
- Expanded/collapsed state uses `aria-expanded`.
- The pulsing animation respects `prefers-reduced-motion` -- when enabled, replace pulse with a static blue ring.
- Color alone is never the sole indicator of status; icons (check, X, circle) reinforce the state.
