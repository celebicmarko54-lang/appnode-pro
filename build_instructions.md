# Build Instructions — All Changes Made (Sessions 1-6)

This document records every change made during the VibeSdk refactor to remove phasic generation, deep debugger, and legacy editing systems, replacing them with Claude Opus 4.6 running autonomously with VS Code-like tools.

Use this as the single source of truth for understanding what was changed and why.

---

## Table of Contents

1. [Files Deleted (9 files)](#1-files-deleted-9-files)
2. [Files Created (3 new tools)](#2-files-created-3-new-tools)
3. [Inference Engine Changes](#3-inference-engine-changes)
4. [Agent Core Changes](#4-agent-core-changes)
5. [Operations Changes](#5-operations-changes)
6. [Tool System Changes](#6-tool-system-changes)
7. [Planning / Blueprint Changes](#7-planning--blueprint-changes)
8. [Frontend Changes](#8-frontend-changes)
9. [SDK Changes](#9-sdk-changes)
10. [Package / Build Changes](#10-package--build-changes)
11. [Intentionally Kept (Backward Compat)](#11-intentionally-kept-backward-compat)
12. [Critical Gotchas for Future Edits](#12-critical-gotchas-for-future-edits)

---

## 1. Files Deleted (9 files)

### 1.1 `worker/agents/core/behaviors/phasic.ts`
**What we changed:** Deleted the entire file.
**Why we changed it:** This was the `PhasicCodingBehavior` class that implemented the multi-phase state machine (`PHASE_GENERATING -> PHASE_IMPLEMENTING -> REVIEWING`). The phasic approach generated code in predefined phases with a rigid pipeline. With Opus 4.6 running autonomously in a tool-calling loop, the agentic behavior handles everything the phasic flow did, but with more flexibility. The `AgenticCodingBehavior` in `agentic.ts` is now the sole coding behavior. Removing this file eliminates the conditional behavior selection and simplifies the agent architecture to a single path.

### 1.2 `worker/agents/operations/PhaseGeneration.ts`
**What we changed:** Deleted the entire file.
**Why we changed it:** This operation generated the phase plan (a list of phases with file assignments). In the agentic model, there are no predefined phases — the agent decides what to build next dynamically through its tool-calling loop. The `AgenticProjectBuilder` now handles all generation logic. Removing this eliminates dead code that would confuse future developers into thinking phases still exist.

### 1.3 `worker/agents/operations/PhaseImplementation.ts`
**What we changed:** Deleted the entire file.
**Why we changed it:** This operation implemented a single phase by generating code for the files assigned to that phase. It was tightly coupled to the phasic state machine, relying on phase metadata (phase number, file list per phase, phase completion tracking). The agentic builder generates files directly through tools (`generate_files`, `edit_file`, `create_file`) without phase boundaries, making this operation unnecessary.

### 1.4 `worker/agents/operations/DeepDebugger.ts`
**What we changed:** Deleted the entire file.
**Why we changed it:** The deep debugger was a separate sub-agent that the main agent could invoke via the `deep_debug` tool. It had its own tool suite, its own LLM calls, and its own conversation loop. With Opus 4.6, debugging capabilities are merged into the main agent loop — the agent already has `read_files`, `run_analysis`, `get_runtime_errors`, `get_logs`, `exec_commands`, `edit_file`, and `regenerate_file`. A separate debugging sub-agent is redundant when the main agent can do all of this directly. This simplifies the architecture from "agent + sub-agent" to just "agent."

### 1.5 `worker/agents/operations/PostPhaseCodeFixer.ts`
**What we changed:** Deleted the entire file.
**Why we changed it:** This operation ran after each phasic phase to fix TypeScript errors deterministically. Since phases no longer exist, there is no "post-phase" step. The deterministic code fixers in `worker/services/code-fixer/` still exist and are used by the real-time code fixer (`realtimeCodeFixer.ts`), so that capability is preserved. The `PostPhaseCodeFixer` was purely a phasic orchestration wrapper around those fixers.

### 1.6 `worker/agents/tools/toolkit/deep-debugger.ts`
**What we changed:** Deleted the entire file.
**Why we changed it:** This was the tool definition that let the agent invoke the deep debugger sub-agent. Since `DeepDebugger.ts` (the operation) was deleted, this tool has nothing to call. The agent now debugs directly using its existing tools rather than delegating to a sub-agent.

### 1.7 `worker/agents/tools/toolkit/wait-for-debug.ts`
**What we changed:** Deleted the entire file.
**Why we changed it:** This tool allowed the agent to wait for a deep debug session to complete. With no deep debugger sub-agent, there is nothing to wait for. The agent handles debugging inline in its own loop.

### 1.8 `worker/agents/operations/prompts/deepDebuggerPrompts.ts`
**What we changed:** Deleted the entire file.
**Why we changed it:** System prompts for the deep debugger sub-agent. No deep debugger means no prompts needed. The main agent's prompts in `agenticBuilderPrompts.ts` already cover debugging guidance.

### 1.9 `worker/agents/operations/prompts/phaseImplementationPrompts.ts`
**What we changed:** Deleted the entire file.
**Why we changed it:** System prompts for phase implementation. No phases means no phase implementation prompts. The agentic builder prompts in `agenticBuilderPrompts.ts` cover the full generation flow.

---

## 2. Files Created (3 new tools)

### 2.1 `worker/agents/tools/toolkit/edit-file.ts`
**What we changed:** Created a new tool that performs surgical single-file edits with a uniqueness safety check.
**Why we changed it:** The agent previously could only rewrite entire files via `regenerate_file`, which is wasteful and risky for small changes. This tool mimics VS Code Copilot's `replace_string_in_file` behavior: the agent provides an exact `oldString` (with 3+ lines of context) and a `newString`. Before replacing, the tool counts how many times `oldString` appears in the file. If it matches 0 times, the edit fails with "not found." If it matches more than 1 time, the edit fails with "matches N locations — add more context." Only if it matches exactly once does the replacement happen. This prevents the agent from silently editing the wrong code location.

**Key implementation details:**
- Uses flat args (`path`, `oldString`, `newString`) because the tool type system's `t.` helpers only support flat primitives — `t.object()` does not exist.
- The `countOccurrences` helper scans the file content using `indexOf` in a loop.
- After editing, the file is deployed to the sandbox via `agent.deployToSandbox()`.
- Reads the file via `agent.readFiles()` to get current content before editing.

### 2.2 `worker/agents/tools/toolkit/multi-edit-files.ts`
**What we changed:** Created a new tool for batch edits across multiple files in one call.
**Why we changed it:** When the agent needs to make coordinated changes across several files (e.g., renaming a component requires updating imports in multiple files), calling `edit_file` one at a time is slow and doesn't guarantee atomicity. This tool accepts an array of `{ filePath, oldString, newString }` edits. It reads all unique files upfront, applies edits sequentially within each file (so later edits see earlier changes), and deploys all modified files in one batch.

**Key implementation details:**
- Uses `type()` with raw Zod schema (`z.array(z.object({...}))`) instead of `t.` helpers because the `edits` parameter is an array of objects, which `t.` cannot express.
- The same `countOccurrences` uniqueness check applies to each individual edit.
- Edits that fail (0 or >1 matches) are reported individually; successful edits in the same batch still apply.
- Files are deployed in a single `agent.deployToSandbox()` call for efficiency.

### 2.3 `worker/agents/tools/toolkit/create-file.ts`
**What we changed:** Created a new tool for creating brand new files.
**Why we changed it:** The `generate_files` tool generates files through an LLM call (it sends a prompt to the model and parses the output). For simple file creation where the agent already knows the exact content, this is overkill. `create_file` takes a `path` and `content` directly and writes the file to the sandbox. It is the equivalent of VS Code Copilot's `create_file` tool — direct, no LLM intermediary.

**Key implementation details:**
- Uses flat args (`path`, `content`) matching the `t.` helper pattern.
- Deploys via `agent.deployToSandbox()` with a single file entry.
- Simple and lightweight — no content parsing, no validation beyond basic error handling.

---

## 3. Inference Engine Changes

### 3.1 `worker/agents/inferutils/config.ts`
**What we changed:** Replaced the multi-model configuration with a single `OPUS_AGENT_CONFIG` where all agent actions use `AIModels.CLAUDE_OPUS_4_6`. Different actions have different `reasoning_effort` levels and `max_tokens` appropriate to their complexity.

**Why we changed it:** Previously, different operations used different models (Gemini for generation, Grok for debugging, etc.). With a single-model strategy, all operations use Opus 4.6. The `reasoning_effort` field (`low`, `medium`, `high`) controls how much the model thinks for each operation:
- `templateSelection`, `conversationalResponse`, `realtimeCodeFixer`, `fileRegeneration` use `low` — fast, minimal thinking.
- `projectSetup`, `screenshotAnalysis` use `medium` — balanced.
- `blueprint`, `agenticProjectBuilder` use `high` — deep reasoning for architecture and code generation.
- `agenticProjectBuilder` specifically gets `max_tokens: 128000` (Opus 4.6's full output capacity) to handle large multi-file generation.

**What it looks like now:**
```typescript
const OPUS_AGENT_CONFIG: AgentConfig = {
    screenshotAnalysis:     { name: AIModels.DISABLED, reasoning_effort: 'medium', max_tokens: 8000, ... },
    realtimeCodeFixer:      { name: AIModels.CLAUDE_OPUS_4_6, reasoning_effort: 'low', max_tokens: 32000, ... },
    templateSelection:      { name: AIModels.CLAUDE_OPUS_4_6, reasoning_effort: 'low', max_tokens: 2000, ... },
    blueprint:              { name: AIModels.CLAUDE_OPUS_4_6, reasoning_effort: 'high', max_tokens: 20000, ... },
    projectSetup:           { name: AIModels.CLAUDE_OPUS_4_6, reasoning_effort: 'medium', max_tokens: 8000, ... },
    conversationalResponse: { name: AIModels.CLAUDE_OPUS_4_6, reasoning_effort: 'low', max_tokens: 4000, ... },
    fileRegeneration:       { name: AIModels.CLAUDE_OPUS_4_6, reasoning_effort: 'low', max_tokens: 32000, ... },
    agenticProjectBuilder:  { name: AIModels.CLAUDE_OPUS_4_6, reasoning_effort: 'high', max_tokens: 128000, ... },
};
export const AGENT_CONFIG: AgentConfig = OPUS_AGENT_CONFIG;
```

### 3.2 `worker/agents/inferutils/core.ts`
**What we changed:** Modified the `buildClaudeThinkingBody()` function to use adaptive thinking for Opus 4.6 and explicit budget tokens for older Claude models.

**Why we changed it:** Opus 4.6 uses `thinking: {type: 'adaptive'}` which lets the model decide how much to think based on the problem complexity. Older Claude models (Sonnet, etc.) use `thinking: {type: 'enabled', budget_tokens: N}` with explicit token budgets. The function detects Opus 4.6 by checking if the model name includes `'claude-opus-4'` and returns the appropriate thinking configuration.

**What it looks like now:**
```typescript
function buildClaudeThinkingBody(modelName: string, reasoning_effort?: ReasoningEffort) {
    const isOpus46 = modelName.includes('claude-opus-4');
    if (isOpus46) {
        return { extra_body: { thinking: { type: 'adaptive' } } };
    }
    return {
        extra_body: {
            thinking: { type: 'enabled', budget_tokens: claude_thinking_budget_tokens[reasoning_effort ?? 'medium'] },
        },
    };
}
```

The budget token map for non-Opus models: `medium=8000, high=16000, low=4000, minimal=1000`.

Also ensured that `safeTemperature` returns `undefined` for Claude models with thinking enabled (Anthropic API rejects temperature when thinking is on).

### 3.3 `worker/agents/inferutils/config.types.ts`
**What we changed:** Added the `CLAUDE_OPUS_4_6` model entry to the `AIModels` enum/registry.

**Why we changed it:** The model registry is how the system knows about available models — their IDs, context sizes, pricing, and provider. Without this entry, no config could reference Opus 4.6.

**What it looks like now:**
```typescript
CLAUDE_OPUS_4_6: {
    id: 'anthropic/claude-opus-4-6',
    config: {
        name: 'Claude Opus 4.6',
        size: ModelSize.LARGE,
        provider: 'anthropic',
        creditCost: 30,
        contextSize: 200000,  // 200K context window
    }
},
```

---

## 4. Agent Core Changes

### 4.1 `worker/agents/core/state.ts`
**What we changed:** Unified all state interfaces into a single `AgentState`. Added deprecated type aliases (`AgenticState`, `BaseProjectState`, `PhasicState`) that all resolve to `AgentState`.

**Why we changed it:** Previously there were separate state interfaces for phasic and agentic behaviors with complex inheritance. Now there is one state type because there is one behavior. The deprecated aliases prevent import errors in any code that still references the old type names (including SDK consumers and migration code). The state interface contains only agentic-relevant fields: `blueprint: AgenticBlueprint`, `currentPlan: Plan`, `mvpGenerated`, `reviewingInitiated`, etc.

### 4.2 `worker/agents/core/types.ts`
**What we changed:** Changed `BehaviorType` from a union type `'phasic' | 'agentic'` to a literal type `'agentic'`.

**Why we changed it:** Since phasic behavior no longer exists, the type system should reflect that. Any code that tries to assign `'phasic'` to a `BehaviorType` variable will now get a compile error, catching stale references at build time.

### 4.3 `worker/agents/core/codingAgent.ts`
**What we changed:** Removed the conditional behavior selection. The code now always creates `new AgenticCodingBehavior(...)` without checking the behavior type.

**Why we changed it:** Previously this file had a switch/conditional: if phasic, create `PhasicCodingBehavior`; if agentic, create `AgenticCodingBehavior`. Since the phasic class was deleted and `BehaviorType` is always `'agentic'`, the conditional is dead code. Removing it makes the entry point straightforward: one agent, one behavior.

### 4.4 `worker/agents/core/behaviors/agentic.ts`
**What we changed:** Updated the class to use `AgentState` (instead of `AgenticState`) and `BaseCodingOperations`. Ensured it works as the sole coding behavior.

**Why we changed it:** With the state type unification, the class signature needed to reference the canonical `AgentState`. The operations are the same — `regenerateFile`, `processUserMessage`, `simpleGenerateFiles` — but they no longer compete with a parallel phasic path.

### 4.5 `worker/agents/core/behaviors/base.ts`
**What we changed:** 
1. Added three no-op stub methods: `isDeepDebugging()` returns `false`, `getDeepDebugSessionState()` returns `null`, `waitForDeepDebug()` is a no-op.
2. Fixed an extra `}` character that was left over from the deletion of a code block (this single character caused 182+ typecheck errors).
3. Removed dead comments referencing deep debugger.
4. Removed unused imports.

**Why we changed it:** The `ICodingAgent` interface requires these methods because other parts of the codebase (websocket handler, etc.) call them. Rather than removing the interface methods and updating every caller, we keep them as safe no-ops. The extra `}` was a syntax error introduced during file editing that broke the entire class definition — every method after the error was outside the class body, causing cascading "not a function" errors. This was the single biggest source of typecheck failures (182 errors from one character).

### 4.6 `worker/agents/core/websocket.ts`
**What we changed:** Removed the code that sent `deepDebugSession` state to the frontend during WebSocket state sync.

**Why we changed it:** The `agent_connected` message includes the agent's current state for the frontend to restore. It was sending `deepDebugSession: behavior.getDeepDebugSessionState()`, which always returns `null` now. Removing it from the sent state avoids confusing the frontend with a field that is always null. The `deepDebugSession` field in the WebSocket types is kept as optional for backward compat with old frontends.

### 4.7 `worker/agents/core/features/types.ts`
**What we changed:** Set `behaviorType` to `'agentic'` for all project types (app, workflow, presentation, general).

**Why we changed it:** Previously, different project types could map to different behaviors. Now all project types use agentic behavior. A comment says "phasic vs agentic" which is now benign since the type only allows `'agentic'`.

### 4.8 `worker/agents/core/stateMigration.ts`
**What we changed:** The migration code that runs on existing Durable Object state now always migrates `behaviorType` to `'agentic'`.

**Why we changed it:** Existing users who created projects with the phasic behavior have `behaviorType: 'phasic'` in their saved state. When their Durable Object wakes up, the migration code rewrites this to `'agentic'` so the agent uses the correct (and only) behavior. Without this, old sessions would try to instantiate `PhasicCodingBehavior` which no longer exists.

### 4.9 `worker/agents/constants.ts`
**What we changed:** Removed the `deepDebugger` case from any constants/enums.

**Why we changed it:** No deep debugger exists, so no constants should reference it. Stale enum values could lead to dead code paths that never execute.

### 4.10 `worker/agents/index.ts`
**What we changed:** Removed phasic-specific `cloneAgent` code that handled cloning for phasic agents.

**Why we changed it:** The clone logic had a branch for phasic agents that set up phase-specific state during cloning. Since all agents are agentic, only the agentic clone path is needed.

---

## 5. Operations Changes

### 5.1 `worker/agents/operations/UserConversationProcessor.ts` (CRITICAL)
**What we changed:** Complete rewrite of the `SYSTEM_PROMPT` constant. Removed all references to `deep_debug` and `wait_for_debug` tools (15+ occurrences in the original prompt). Removed all phasic state machine descriptions. Updated the tool listing to reflect actual available tools. Rewrote the examples and user guidance.

**Why we changed it:** This was the most critical bug found during the audit. The system prompt is what the LLM reads to understand its capabilities. The old prompt told the LLM it could use `deep_debug` to invoke a debugging sub-agent and `wait_for_debug` to wait for it — but both tools were deleted. If the LLM tried to call these tools based on the prompt's instructions, the calls would fail at runtime. It also described the phasic state machine flow (phases, phase generation, phase implementation) which no longer exists. The rewritten prompt describes the current reality: the agent is "Orange," the conversational interface, with tools like `queue_request`, `get_logs`, `git`, `wait_for_generation`, `deploy_preview`, etc.

### 5.2 `worker/agents/operations/AgenticProjectBuilder.ts`
**What we changed:** Imported and registered the three new tools (`createEditFileTool`, `createMultiEditFilesTool`, `createCreateFileTool`) in the builder's tool suite.

**Why we changed it:** The agentic project builder is the operation that runs the main code generation loop. For the agent to use the new editing tools, they must be available in its tool suite. Without registration here, the agent would only have `generate_files` and `regenerate_file` — no surgical editing capability.

### 5.3 `worker/agents/operations/prompts/agenticBuilderPrompts.ts`
**What we changed:** Added documentation for `edit_file`, `multi_edit_files`, and `create_file` in the `<tools>` section of the system prompt.

**Why we changed it:** The LLM needs to know what tools are available and how to use them. The `<tools>` section in the system prompt describes each tool's purpose and parameters. Without this documentation, the LLM would only see the tool's schema (which has parameter names but lacks usage guidance like "include 3+ context lines" or "use this instead of regenerate_file for small changes").

### 5.4 `worker/agents/services/interfaces/ICodingAgent.ts`
**What we changed:** Removed the `executeDeepDebug()` method from the interface. Cleaned unused imports. Kept `isDeepDebugging()` and `waitForDeepDebug()` because they have no-op implementations in `base.ts` and are called by other code paths.

**Why we changed it:** The interface defines what operations the agent can perform. Since `DeepDebugger.ts` was deleted, the method that invoked it should be removed from the contract. Keeping a dead method in the interface would force implementors to provide a stub for something that will never be called. The remaining two methods (`isDeepDebugging`, `waitForDeepDebug`) are safe stubs that return `false` and no-op respectively — callers still exist so the interface contract must be preserved.

---

## 6. Tool System Changes

### 6.1 `worker/agents/tools/customTools.ts`
**What we changed:**
1. Removed imports for `deep-debugger.ts` and `wait-for-debug.ts`.
2. Added imports for `edit-file.ts`, `multi-edit-files.ts`, and `create-file.ts`.
3. Updated the `buildTools()` function to include the three new tools and exclude the two deleted tools.
4. Removed unused imports that were only needed for the deleted tools.

**Why we changed it:** This file is the tool registry for user conversations. The `buildTools()` function returns the list of tools the LLM can call. Deleted tools must be removed (otherwise the import would fail), and new tools must be added (otherwise the LLM cannot use them).

### 6.2 `worker/agents/tools/toolkit/alter-blueprint.ts`
**What we changed:** Removed the dead `phasicPatchSchema` that defined phasic-specific blueprint fields (e.g., `phases`, `type`, `dataFlow`, `userFlow`). Simplified to agentic-only schema.

**Why we changed it:** The tool used to have two schemas and would pick one based on whether the agent was phasic or agentic. Since there is only agentic now, the phasic schema is dead code. The agentic schema allows patching: `title`, `description`, `colorPalette`, `frameworks`, `plan`.

### 6.3 `worker/agents/tools/toolkit/generate-blueprint.ts`
**What we changed:** Removed the dead `isAgentic` check and the phasic description branch.

**Why we changed it:** The tool description used to vary depending on behavior type — phasic got a description mentioning phases, agentic got one mentioning plans. Since only agentic exists, the conditional is unnecessary. The tool now always uses the agentic description.

### 6.4 `worker/agents/tools/toolkit/wait-for-generation.ts`
**What we changed:** Updated the tool description to remove the reference to `deep_debug`.

**Why we changed it:** The description mentioned that this tool should be used while `deep_debug` is running. Since `deep_debug` no longer exists, this guidance is misleading. The description now simply says to use it when code generation is in progress.

---

## 7. Planning / Blueprint Changes

### 7.1 `worker/agents/planning/blueprint.ts`
**What we changed:**
1. Removed `PHASIC_SYSTEM_PROMPT` and `LITE_PHASIC_SYSTEM_PROMPT` constants.
2. Removed unused imports that were only referenced by the phasic prompts.
3. The `generateBlueprint()` function now always returns `AgenticBlueprint`.
4. Kept `PhasicBlueprintGenerationArgs` as a deprecated interface (for SDK compatibility).

**Why we changed it:** The blueprint generation had separate prompts for phasic blueprints (which included phase breakdown, data flow diagrams, user flow) and agentic blueprints (which include a flat `plan: string[]`). Since phasic is removed, only the agentic prompt is needed. The function was already capable of generating agentic blueprints; removing the phasic branches simplifies the code path.

### 7.2 `worker/agents/schemas.ts`
**What we changed:** The `BlueprintType` now resolves only to `AgenticBlueprint`. Kept `PhasicBlueprintSchema` as a deprecated export.

**Why we changed it:** The schemas define the Zod validation shapes. Blueprint validation now only accepts agentic blueprint structure (title, description, projectName, frameworks, colorPalette, plan[]). The phasic schema is kept because SDK consumers may import it — removing it would be a breaking change to the public API.

### 7.3 `worker/agents/prompts.ts`
**What we changed:** Updated to always use `AgenticBlueprint` in any blueprint type references.

**Why we changed it:** Consistency with the rest of the system. Any prompt that references a "blueprint" should mean the agentic blueprint structure.

### 7.4 `worker/agents/domain/values/GenerationContext.ts`
**What we changed:**
1. `isPhasic()` now always returns `false` and is marked `@deprecated`.
2. `isAgentic()` now always returns `true`.
3. `getCompletedPhases()` now always returns `[]` and is marked `@deprecated`.

**Why we changed it:** `GenerationContext` is a value object that tells the system what kind of generation is happening. Code throughout the system calls `isPhasic()` and `isAgentic()` to decide behavior. Rather than finding and updating every callsite, these methods now always return the correct answer. The `@deprecated` annotations tell future developers not to use these methods — the answer is always agentic.

---

## 8. Frontend Changes

### 8.1 `src/routes/chat/chat.tsx`
**What we changed:**
1. Removed the `PhaseTimeline` component import and render block.
2. Removed the `DeploymentControls` component import and render block.
3. Removed the dead `isPhase1Complete` variable.
4. Removed the phasic `showMainView` fallback logic.
5. Removed the progress/total phase calculation (`progress` and `total` variables).
6. Removed unused destructured variables (`isDeploying`, `cloudflareDeploymentUrl`, etc.).

**Why we changed it:** `PhaseTimeline` showed a progress bar during phasic generation (Phase 1 of 3, Phase 2 of 3, etc.). `DeploymentControls` showed deployment buttons that were part of the phasic flow. Neither component renders in agentic mode. `isPhase1Complete` tracked whether the first phase was done (to show the preview). `showMainView` had a phasic fallback that checked phase state. All of this is dead UI that adds confusion and bundle size.

### 8.2 `src/routes/chat/components/blueprint.tsx`
**What we changed:** Complete rewrite. The component now renders only agentic blueprint fields: `title`, `description`, `colorPalette`, `frameworks`, and `plan[]` (as a numbered list).

**Why we changed it:** The old component had two render paths: one for phasic blueprints (showing views, user flows, data flows, roadmap sections) and one for agentic blueprints (showing plan list). The phasic render path was large and complex. Now only the agentic render path exists, making the component smaller and clearer.

### 8.3 `src/routes/chat/components/main-content-panel.tsx`
**What we changed:** Changed the fallback behavior type from `'phasic'` to `'agentic'`.

**Why we changed it:** When the behavior type is unknown or unset, the panel defaults to a behavior. It was defaulting to phasic, which would render phasic UI. Now it defaults to agentic.

### 8.4 `src/routes/chat/hooks/use-chat.ts`
**What we changed:**
1. Changed the `behaviorType` default from `'phasic'` to `'agentic'`.
2. Changed all comparisons `=== 'phasic'` to `=== 'agentic'` where appropriate.
3. Removed the `useEffect` that tracked `deep_debug` tool calls in the message stream.

**Why we changed it:** The hook manages chat state including which behavior is active. The default and comparisons needed to reflect the only behavior. The `deep_debug` tracking `useEffect` watched for deep debug tool calls in messages to update UI state — since deep debug no longer exists, the effect was dead code that ran on every message render for no purpose.

### 8.5 `src/routes/chat/utils/handle-websocket-message.ts`
**What we changed:**
1. Removed the `isPhasicState()` helper function (checked if state had phasic-specific fields).
2. Removed the `deepDebugSession` restoration block (~50 lines) from the `agent_connected` handler.
3. Changed the default behavior type in state restoration from `'phasic'` to `'agentic'`.
4. Removed unused imports.

**Why we changed it:** `isPhasicState()` was used to detect whether the backend sent phasic or agentic state, and the handler would set the frontend behavior accordingly. Since state is always agentic now, the detection is unnecessary. The `deepDebugSession` restoration block restored the debug session UI state when reconnecting to a WebSocket — since deep debug state is always null, this block was dead code. The default behavior ensures that if the backend doesn't send a behavior type (e.g., old state), the frontend falls back to agentic.

### 8.6 `src/routes/chat/utils/message-helpers.ts`
**What we changed:** Removed the `isDeepDebug` variable and the conditional branch that special-cased deep debug tool messages.

**Why we changed it:** The message helpers processed tool call messages for display. When a tool call was for `deep_debug`, it had special rendering logic. Since the tool no longer exists, no messages will ever have `deep_debug` tool calls, making this branch dead code.

### 8.7 `src/utils/model-helpers.ts`
**What we changed:**
1. Removed mappings for phasic agent keys (`phaseGeneration`, `phaseImplementation`, `firstPhaseImplementation`).
2. Added mapping for `agenticProjectBuilder` under the 'coding' category.

**Why we changed it:** The model helpers map agent action keys to UI categories (quickstart, coding, debugging, advanced). The phasic keys no longer exist in the config, so their mappings are dead. The `agenticProjectBuilder` key was added to `config.ts` and needs a UI category for the settings/workflow pages.

### 8.8 `src/routes/settings/index.tsx`
**What we changed:** Removed descriptions for `phaseGeneration`, `phaseImplementation`, and `firstPhaseImplementation` from the agent settings display.

**Why we changed it:** The settings page shows available agents with descriptions. These three phasic agents no longer exist in the config. Showing them would confuse users and display agents that can never be selected.

### 8.9 `src/components/config-modal.tsx`
**What we changed:** Removed model recommendations for `phaseGeneration`, `phaseImplementation`, and `firstPhaseImplementation`.

**Why we changed it:** The config modal shows recommended models per agent. Removed recommendations for agents that no longer exist in the config.

---

## 9. SDK Changes

### 9.1 `sdk/src/phasic.ts`
**What we changed:** The phasic client now routes everything to the agentic path and is marked `@deprecated`.

**Why we changed it:** External SDK consumers import `PhasicClient`. Deleting this file would break the public API. Instead, it's a thin wrapper that internally uses the agentic behavior. SDK users can migrate to the agentic client at their own pace.

### 9.2 `sdk/src/state.ts`
**What we changed:** `isPhasicState()` now always returns `false`.

**Why we changed it:** SDK consumers may call this function to check state type. It should always return `false` since no state is phasic anymore. This is a safe behavioral change — callers that check `if (isPhasicState(state))` will correctly skip phasic-specific code paths.

### 9.3 `sdk/src/session.ts`
**What we changed:** Removed the phasic `waitForDeployable` branch.

**Why we changed it:** Session management had a branch for phasic sessions that waited for a specific phase completion event before considering the app "deployable." Since all sessions are agentic, only the agentic completion detection is needed.

---

## 10. Package / Build Changes

### 10.1 `package.json`
**What we changed:** Fixed the `rolldown-vite` override from `@latest` to a pinned version (`@7.1.13` at time of fix, later updated to `@7.2.11` via npm update).

**Why we changed it:** `npm install` was failing with `EOVERRIDE` error because the `overrides` section specified `rolldown-vite@latest` while `devDependencies` had a pinned version. npm requires the override to be compatible with the direct dependency version. Pinning both to the same version resolved the conflict.

**Important:** Run `npm install --legacy-peer-deps` when installing dependencies. Some packages have peer dependency conflicts that require this flag.

### 10.2 `worker/api/controllers/agent/controller.ts`
**What we changed:** Changed the default behavior type in `resolveBehaviorType()` from `'phasic'` to `'agentic'`.

**Why we changed it:** When a new code generation request comes in without an explicit `behaviorType`, the controller picks a default. It was defaulting to phasic, which would try to instantiate the deleted `PhasicCodingBehavior`. Now it defaults to agentic. The function also returns `'agentic'` for all project types (presentation, workflow, general, app).

---

## 11. Intentionally Kept (Backward Compat)

These items were **not** removed even though they reference phasic/deep debug. Each has a specific reason for staying.

| Item | Location | Why Kept |
|---|---|---|
| No-op stub: `isDeepDebugging()` → `false` | `base.ts` | `ICodingAgent` interface requires it; callers exist |
| No-op stub: `getDeepDebugSessionState()` → `null` | `base.ts` | WebSocket state sync calls it; returns null safely (not in interface — only in base class) |
| No-op stub: `waitForDeepDebug()` → no-op | `base.ts` | `ICodingAgent` interface requires it; called by some code paths; does nothing safely |
| Interface: `isDeepDebugging()` + `waitForDeepDebug()` | `ICodingAgent.ts` | Removing would break the interface contract; implemented as safe no-ops in `base.ts` |
| Interface: `generateFiles(phaseName, ...)` params | `ICodingAgent.ts` | Method signature still has `phaseName`/`phaseDescription` params; callers exist |
| `PhasicBlueprintSchema` + `LitePhasicBlueprintSchema` exports | `schemas.ts` | SDK consumers may import these types |
| `BlueprintSchemaLite`, `PhaseConceptSchema` exports | `schemas.ts` | Used by backward-compat code and exports |
| Phase-related WebSocket message types | `constants.ts` | `PHASE_GENERATING`, `PHASE_GENERATED`, `PHASE_IMPLEMENTING`, `PHASE_IMPLEMENTED`, `PHASE_VALIDATING`, `PHASE_VALIDATED` — used by message type system and old frontends |
| Deprecated type aliases | `state.ts` | `AgenticState`, `BaseProjectState`, `PhasicState` all = `AgentState` |
| Migration code: phasic → agentic | `stateMigration.ts` | Existing users' DO state has `behaviorType: 'phasic'` |
| `deepDebugSession` optional field | `websocketTypes.ts` | Old frontends may expect this field |
| `PhasicClient` deprecated class | `sdk/src/phasic.ts` | Public SDK API; must not break |
| `isPhasicState()` → `false` | `sdk/src/state.ts` | SDK consumers may call it; returns `false` safely |
| Dead UI components (phase-timeline, debug-session-bubble, etc.) | `src/routes/chat/components/` | Never rendered; no functional impact; can be cleaned later |

---

## 12. Critical Gotchas for Future Edits

### 12.1 Tool Type System Limitation
The tool framework's `t.` helpers (`t.string()`, `t.number()`, `t.file.write()`) only support **flat primitive parameters**. There is no `t.object()` or `t.array()`. If a tool needs a complex parameter (like an array of objects), use `type()` with a raw Zod schema:
```typescript
import { type as typeFn } from '../types';
import { z } from 'zod';

// DO THIS for complex params:
args: {
    edits: typeFn(z.array(z.object({ filePath: z.string(), ... })), ...)
}

// DO NOT try this — it does not exist:
args: {
    edits: t.object({ ... })  // t.object() DOES NOT EXIST
}
```
This was the cause of 18+ typecheck errors during development.

### 12.2 Extra Closing Brace = 182 Errors
When editing `base.ts`, an extra `}` character outside any code block caused every method below it to be parsed as top-level functions instead of class methods. This single character produced 182+ typecheck errors across the file. Always verify brace matching after edits to `base.ts`.

### 12.3 npm Install Requires `--legacy-peer-deps`
Some packages have peer dependency conflicts. Always run:
```bash
npm install --legacy-peer-deps
```

### 12.4 Override Pinning in package.json
The `overrides` section in `package.json` must match the version in `devDependencies` for `rolldown-vite`. If you update the dependency version, update the override too, or npm will refuse to install.

### 12.5 Adaptive Thinking Detection
The `buildClaudeThinkingBody()` function in `core.ts` detects Opus 4.6 via `modelName.includes('claude-opus-4')`. If a new Opus model is released (e.g., Opus 5), this check will also match it. This is intentional — future Opus models should also use adaptive thinking. If a model needs explicit budget tokens instead, the check would need refinement.

### 12.6 No Temperature with Claude Thinking
Anthropic's API rejects `temperature` when `thinking` is enabled. The `safeTemperature()` function in `core.ts` returns `undefined` for Claude models with thinking. If you add a new model that uses thinking, ensure it goes through this path.

### 12.7 UserConversationProcessor Prompt is Critical
The system prompt in `UserConversationProcessor.ts` is what the LLM reads to understand its capabilities during user conversations. If you add or remove a tool, **update this prompt**. The Session 5 audit found 15+ references to deleted tools in this prompt — the LLM was being told to use tools that didn't exist. Always keep the prompt in sync with the actual tool registry.

### 12.8 Tool Registration Has Two Locations
New tools must be registered in **both** places:
1. `worker/agents/tools/customTools.ts` → `buildTools()` function (for user conversations)
2. `worker/agents/operations/AgenticProjectBuilder.ts` → tool suite (for code generation)

Missing either one means the tool is available in one context but not the other.

### 12.9 State Migration is Required for Schema Changes
If you add a new field to `AgentState` in `state.ts`, you must add a migration in `stateMigration.ts` that sets a default value. Existing Durable Objects will have state saved without the new field. The migration runs when the DO wakes up and ensures all state fields have valid values.

### 12.10 Frontend Dead Components Can Be Cleaned Later
The following frontend files are dead code (never rendered/imported by active paths) but were not deleted to minimize risk. They can be safely removed in a future cleanup:
- `src/routes/chat/components/phase-timeline.tsx`
- `src/routes/chat/components/deployment-controls.tsx`
- `src/routes/chat/components/debug-session-bubble.tsx`
- `src/routes/chat/hooks/use-debug-session.ts`
- `DeepDebugTranscript` section in `messages.tsx`

### 12.11 Typecheck Command
Always run typecheck after making changes:
```bash
npm run typecheck
```
The project currently has **0 typecheck errors**. Any new error is a regression.
