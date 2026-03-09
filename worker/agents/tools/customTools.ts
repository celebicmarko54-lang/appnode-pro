import type { ToolDefinition } from './types';
import { StructuredLogger } from '../../logger';
import { RenderToolCall } from '../operations/UserConversationProcessor';
import { toolWebSearchDefinition } from './toolkit/web-search';
import { toolFeedbackDefinition } from './toolkit/feedback';
import { createQueueRequestTool } from './toolkit/queue-request';
import { createGetLogsTool } from './toolkit/get-logs';
import { createDeployPreviewTool } from './toolkit/deploy-preview';
import { createRenameProjectTool } from './toolkit/rename-project';
import { createAlterBlueprintTool } from './toolkit/alter-blueprint';
import { createReadFilesTool } from './toolkit/read-files';
import { createExecCommandsTool } from './toolkit/exec-commands';
import { createRunAnalysisTool } from './toolkit/run-analysis';
import { createRegenerateFileTool } from './toolkit/regenerate-file';
import { createGenerateFilesTool } from './toolkit/generate-files';
// wait tool removed
import { createGetRuntimeErrorsTool } from './toolkit/get-runtime-errors';
import { createWaitForGenerationTool } from './toolkit/wait-for-generation';
import { createGitTool } from './toolkit/git';
import { createEditFileTool } from './toolkit/edit-file';
import { createMultiEditFilesTool } from './toolkit/multi-edit-files';
import { createCreateFileTool } from './toolkit/create-file';
import { ICodingAgent } from '../services/interfaces/ICodingAgent';
import { Message } from '../inferutils/common';
import { ChatCompletionMessageFunctionToolCall } from 'openai/resources';

export async function executeToolWithDefinition<TArgs, TResult>(
    toolCall: ChatCompletionMessageFunctionToolCall,
    toolDef: ToolDefinition<TArgs, TResult>,
    args: TArgs
): Promise<TResult> {
    await toolDef.onStart?.(toolCall, args);
    const result = await toolDef.implementation(args);
    await toolDef.onComplete?.(toolCall, args, result);
    return result;
}

/**
 * Build all available tools for user conversation
 */
export function buildTools(
    agent: ICodingAgent,
    logger: StructuredLogger,
    _toolRenderer: RenderToolCall,
    _streamCb: (chunk: string) => void,
): ToolDefinition<any, any>[] {
    return [
        toolWebSearchDefinition,
        toolFeedbackDefinition,
        createQueueRequestTool(agent, logger),
        createGetLogsTool(agent, logger),
        createDeployPreviewTool(agent, logger),
        createWaitForGenerationTool(agent, logger),
        createRenameProjectTool(agent, logger),
        createAlterBlueprintTool(agent, logger),
        // Git tool (safe version - no reset for user conversations)
        createGitTool(agent, logger, { excludeCommands: ['reset'] }),
        // Debugging tools merged into main agent
        createReadFilesTool(agent, logger),
        createGetRuntimeErrorsTool(agent, logger),
        createRunAnalysisTool(agent, logger),
        createExecCommandsTool(agent, logger),
        createRegenerateFileTool(agent, logger),
        createGenerateFilesTool(agent, logger),
        // Surgical editing tools
        createEditFileTool(agent, logger),
        createMultiEditFilesTool(agent, logger),
        createCreateFileTool(agent, logger),
    ];
}

/**
 * Decorate tools with renderer for UI visualization and conversation sync
 */
export function withRenderer(
    tools: ToolDefinition<any, any>[],
    toolRenderer?: RenderToolCall,
    onComplete?: (message: Message) => Promise<void>
): ToolDefinition<any, any>[] {
    if (!toolRenderer) return tools;

    return tools.map(td => {
        const originalOnStart = td.onStart;
        const originalOnComplete = td.onComplete;

        return {
            ...td,
            onStart: async (tc: ChatCompletionMessageFunctionToolCall, args: Record<string, unknown>) => {
                await originalOnStart?.(tc, args);
                if (toolRenderer) {
                    toolRenderer({ name: td.name, status: 'start', args });
                }
            },
            onComplete: async (tc: ChatCompletionMessageFunctionToolCall, args: Record<string, unknown>, result: unknown) => {
                await originalOnComplete?.(tc, args, result);
                if (toolRenderer) {
                    toolRenderer({
                        name: td.name,
                        status: 'success',
                        args,
                        result: typeof result === 'string' ? result : JSON.stringify(result)
                    });
                }
                if (onComplete) {
                    const toolMessage: Message = {
                        role: 'tool',
                        content: typeof result === 'string' ? result : JSON.stringify(result),
                        name: td.name,
                        tool_call_id: tc.id,
                    };
                    await onComplete(toolMessage);
                }
            }
        };
    });
}
