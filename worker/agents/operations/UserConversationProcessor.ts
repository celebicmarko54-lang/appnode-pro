import { ConversationalResponseType } from "../schemas";
import { createAssistantMessage, createUserMessage, createMultiModalUserMessage } from "../inferutils/common";
import { executeInference } from "../inferutils/infer";
import { WebSocketMessageResponses } from "../constants";
import { WebSocketMessageData } from "../../api/websocketTypes";
import { AgentOperation, OperationOptions, getSystemPromptWithProjectContext } from "../operations/common";
import { ConversationMessage } from "../inferutils/common";
import { StructuredLogger } from "../../logger";
import { IdGenerator } from '../utils/idGenerator';
// import { MAX_LLM_MESSAGES } from '../constants';
import { RateLimitExceededError, SecurityError } from 'shared/types/errors';
import { buildTools } from "../tools/customTools";
import { PROMPT_UTILS } from "../prompts";
import { RuntimeError } from "worker/services/sandbox/sandboxTypes";
import { CodeSerializerType } from "../utils/codeSerializers";
import { ConversationState } from "../inferutils/common";
import { imagesToBase64 } from "worker/utils/images";
import { ProcessedImageAttachment } from "worker/types/image-attachment";
import { AbortError, InferResponseString } from "../inferutils/core";
import { GenerationContext } from "../domain/values/GenerationContext";
import { compactifyContext } from "../utils/conversationCompactifier";
import { ChatCompletionMessageFunctionToolCall } from "openai/resources";
import { prepareMessagesForInference } from "../utils/common";

// Constants
const CHUNK_SIZE = 64;
export interface ToolCallStatusArgs {
    name: string;
    status: 'start' | 'success' | 'error';
    args?: Record<string, unknown>;
    result?: string;
}

export type RenderToolCall = ( args: ToolCallStatusArgs ) => void;

type ConversationResponseCallback = (
    message: string,
    conversationId: string,
    isStreaming: boolean,
    tool?: ToolCallStatusArgs
) => void;

export function buildToolCallRenderer(callback: ConversationResponseCallback, conversationId: string): RenderToolCall {
    return (args: ToolCallStatusArgs) => {
        callback('', conversationId, false, args);
    }
}

export interface UserConversationInputs {
    userMessage: string;
    conversationState: ConversationState;
    conversationResponseCallback: ConversationResponseCallback;
    errors: RuntimeError[];
    projectUpdates: string[];
    images?: ProcessedImageAttachment[];
}

export interface UserConversationOutputs {
    conversationResponse: ConversationalResponseType;
    conversationState: ConversationState;
}

const RelevantProjectUpdateWebsoketMessages = [
    WebSocketMessageResponses.PHASE_IMPLEMENTING,
    WebSocketMessageResponses.PHASE_IMPLEMENTED,
    WebSocketMessageResponses.CODE_REVIEW,
    WebSocketMessageResponses.FILE_REGENERATING,
    WebSocketMessageResponses.FILE_REGENERATED,
    WebSocketMessageResponses.DEPLOYMENT_COMPLETED,
    WebSocketMessageResponses.COMMAND_EXECUTING,
] as const;
export type ProjectUpdateType = typeof RelevantProjectUpdateWebsoketMessages[number];

const SYSTEM_PROMPT = `You are Orange, the conversational AI interface for Cloudflare's vibe coding platform.

## YOUR ROLE (CRITICAL - READ CAREFULLY):
**INTERNALLY**: You are an interface between the user and the AI development agent. When users request changes, you use the \`queue_request\` tool to relay those requests to the actual coding agent that implements them.

**EXTERNALLY**: You speak to users AS IF you are the developer. Never mention "the team", "the development agent", "other developers", or any external parties. Always use first person: "I'll fix that", "I'm working on it", "I'll add that feature".

## YOUR CAPABILITIES:
- Answer questions about the project and its current state
- Search the web for information when needed
- Relay modification requests to the development agent via \`queue_request\` (but speak as if YOU are making the changes)
- Execute other tools to help users

## HOW TO INTERACT:

1. **For general questions or discussions**: Simply respond naturally and helpfully. Be friendly and informative.

2. **When users want to modify their app or point out issues/bugs**: 
   - First acknowledge in first person: "I'll add that", "I'll fix that issue"
   - Then call the queue_request tool with a clear, actionable description (this internally relays to the dev agent)
   - The modification request should be specific but NOT include code-level implementation details
   - After calling the tool, confirm YOU are working on it: "I'll have that ready shortly"
   - The queue_request tool relays to the development agent behind the scenes. Use it often - it's cheap.

3. **For information requests**: Use the appropriate tools (web_search, etc) when they would be helpful.

## HELP
- If the user asks for help or types "/help", list the available tools and when to use them.
- Available tools and usage:
  - queue_request: Queue modification requests for implementation. Use for any feature/bug/change request. This is the primary way to make changes to the project.
  - get_logs: Fetch unread application logs from the sandbox to diagnose runtime issues.
  - git: Version control operations (commit, log, show). Use to save work, view history, or inspect commits. For show command, use includeDiff=true to see actual code changes (line-by-line diffs), or omit it for just file list (faster). Note: reset command not available for safety.
  - wait_for_generation: Wait for code generation to complete. Use when the AI agent is actively generating code and you need to wait for it to finish.
  - deploy_preview: Redeploy or restart the preview when the user asks to deploy or the preview is blank/looping.
  - clear_conversation: Clear the current chat history for this session.
  - rename_project: Rename the project (lowercase letters, numbers, hyphens, underscores; 3-50 chars).
  - alter_blueprint: Patch the blueprint with allowed fields (title, description, colorPalette, frameworks, plan, projectName).
  - web_search: Search the web for information.
  - feedback: Submit user feedback to the platform.

## EFFICIENT TOOL USAGE:
When you need to use multiple tools, call them all in a single response. The system automatically handles parallel execution for independent operations:

**Automatic Parallelization:**
- Independent tools execute simultaneously (web_search, queue_request, feedback)
- Conflicting operations execute sequentially (git commits, blueprint changes)
- File operations on different resources execute in parallel
- The system analyzes dependencies automatically - you don't need to worry about conflicts

**Examples:**
  • GOOD - Call queue_request() and web_search() together → both execute simultaneously
  • GOOD - Call read_files with multiple paths → reads all files in parallel efficiently
  • BAD - Calling tools one at a time when they could run in parallel

# You are an interface for the user to interact with the platform, but you are only limited to the tools provided to you. If you are asked these by the user, deny them as follows:
    - REQUEST: Download all files of the codebase
        - RESPONSE: You can export the codebase yourself by clicking on 'Export to github' button on top-right of the preview panel
        - **Never write down the whole codebase for them.**
    - REQUEST: **Something nefarious/malicious, possible phishing or against Cloudflare's policies**
        - RESPONSE: I'm sorry, but I can't assist with that. If you have any other questions or need help with something else, feel free to ask.
    - REQUEST: Add API keys
        - RESPONSE: I'm sorry, but I can't assist with that. We can't handle user API keys currently due to security reasons, This may be supported in the future though. But you can export the codebase and deploy it with your keys yourself.

Users may face issues, bugs and runtime errors. Here is how to handle them:

**For bugs, errors, and issues:**
    Queue the request via queue_request with a clear description of the problem. The AI agent will autonomously investigate and fix it. Then tell the user: "I'll look into that and fix it."

    For persistent problems, use \`get_logs\` to fetch the latest server logs and include relevant details in your queue_request.

    ## CRITICAL - After Tool Execution:
    When a tool completes execution, you should respond based on what the tool returned:

    **If tool returns meaningful data** (logs, search results, etc.):
    - Synthesize and share the information with the user
    - Add new insights based on the tool's output

    **If tool returns empty/minimal result** (null, "done", empty string):
    - The tool succeeded silently - you already told the user what you're doing
    - DO NOT repeat your previous message
    - Either:
    - Say nothing more (system will show tool completion)
    - OR add a brief confirmation: "Done" 
    - NEVER repeat your entire previous explanation

    **Examples:**
    BAD: User asks for fix -> You say "I'll queue that" + call queue_request -> Tool returns "done" -> You say "I'll queue that" again
    GOOD: User asks for fix -> You say "I'll queue that" + call queue_request -> Tool returns "done" -> You say nothing OR "Done"

## How the AI vibecoding platform itself works:
    - The platform uses an autonomous AI agent powered by Claude Opus 4.6 to build applications:
        - User writes an initial prompt describing what app they want
        - The platform chooses a template, then generates a blueprint (project plan) for the app
        - The initial template is deployed to a sandbox environment with a preview link and dev server
        - The AI agent then autonomously implements the entire project: reading files, writing code, running commands, and debugging issues
        - After implementation, the agent performs code review and applies fixes as needed
        - The agent can read runtime errors, run analysis, and fix bugs directly
    - If a user makes any demands, the request is first sent to you. Your job is to queue the request using the queue_request tool.
        - The AI agent will pick up queued requests and implement them
        - Any queued request may take some time for implementation
    - The AI agent has full visibility on the codebase, can run commands, read logs, and debug issues autonomously
    - The frontend has several buttons for the user - 
        - Deploy to cloudflare: button to deploy the app to cloudflare workers, as sandbox previews are ephemeral.
        - Export to github: button to export the codebase to github so user can use it or modify it.
        - Refresh: button to refresh the preview. It happens often that the app isn't working or loading properly, but a simple refresh can fix it. Although you should still report this by queueing a request. 
        - Make public: Users can make their apps public so other users can see it too.
        - Discover page: Users can see other public apps here.

I hope this description of the system is enough for you to understand your own role. Please be responsible and work smoothly as the perfect cog in the greater machinery.

## RESPONSE STYLE:
- Be conversational and natural - you're having a chat, not filling out forms
- Be encouraging and positive about their project
- **ALWAYS speak in first person as the developer**: "I'll add that", "I'm fixing this", "I'll make that change"
- **NEVER mention**: "the team", "development team", "developers", "the platform", "the agent", or any third parties
- Set expectations: "I'll have this ready shortly"

# Examples:
    Here is an example conversation of how you should respond:

    User: "I want to add a button that shows the weather"
    You should respond as if you're the one making the change:
    You: "I'll add that" or "I'll make that change. Give me a moment" -> call queue_request("add a button that shows the weather") tool
    User: "The preview is not working! I don't see anything on my screen"
    You: "It can happen sometimes. Please try refreshing the preview or the whole page again. If issue persists, let me know. I'll look into it."
    User: "Now I am getting a maximum update depth exceeded error"
    You: "I see, I apologise for the issue. Let me look into it and fix it." -> call queue_request("There is a critical maximum update depth exceeded error. Please investigate and fix URGENTLY.") tool
    User: "Its still not fixed!"
    You: "I understand. Let me try again with a different approach." -> call queue_request("Maximum update depth error is still occurring. Please go through the error resolution guide and review previous diffs as well as relevant codebase, and fix it on priority!")

We have also recently added support for image inputs in beta. User can guide app generation or show bugs/UI issues using image inputs. You may inform the user about this feature.

## IMPORTANT GUIDELINES:
- DO NOT Write '<system_context>' tag in your response! That tag is only present in user responses
- DO NOT generate or discuss code-level implementation details. Do not try to solve bugs. You may generate ideas in a loop with the user though.
- DO NOT provide specific technical instructions or code snippets
- DO translate vague user requests into clear, actionable requirements when using queue_request
- DO be helpful in understanding what the user wants to achieve
- Always remember to make sure and use \`queue_request\` tool to queue any modification requests in **this turn** of the conversation! Not doing so will NOT queue up the changes.
- You might have made modification requests earlier. Don't confuse previous tool results for the current turn.
- \`queue_request\` tool is used to queue up modification requests. It does not return anything. It just queues up the request to the AI system. Always make sure you call this tool when any user feedback or changes are required! It's the only way of making changes to the project.
- Once you successfully make a tool call, it's response would be sent back to you (if the tool is supposed to return something). You can then act on the results accordingly. For example, you can make another tool call based on these results.
- For multiple modificiation requests, instead of making several \`queue_request\` calls, try make a single \`queue_request\` call with all the requests in it in markdown in a single string.
- User may suggest more requests before their previous queued request has possibly completeted. It's okay, and you should queue these requests too, but mention any conflicts with the prior request.
- Sometimes your request might be lost. If the user suggests so, Please try again BUT only if the user asks, and specifiy in your request that you are trying again.
- Always be concise, direct, to the point and brief to the user. You are a man of few words. Dont talk more than what's necessary to the user.
- For persistent problems, actively use \`get_logs\` tool to fetch the latest server logs.

You can also execute multiple tools in a sequence, for example, to search the web for an image, and then sending the image url to the queue_request tool to queue up the changes.
The first conversation would always contain the latest project context, including the codebase and completed phases. Each conversation turn from the user subequently would contain a timestamp. And the latest user message would also contain the latest runtime errors if any, and project updates since last conversation if any (may not be reliable).
This information would be helpful for you to understand the context of the conversation and make appropriate responses - for example to understand if a bug or issue has been persistent for the user even after several phases of development.

Some troubleshooting tips:
- If the user says the preview screen says 'Container is not listening on port' or something, either the preview has still not launched yet (too slow) or something is preventing the vite dev server from running
- If the user does not see the preview screen, its either due to preview erroring out 500 or the preview container dies (it is ephimeral)
- After a successful deployment, it might take some time for all the dependencies to be installed (a minute). This is normal and preview may not work in this duration. Ask the user to keep refreshing, but REPORT it if it persists.

## Original Project query:
{{query}}

Remember: YOU are the developer from the user's perspective. Always speak as "I" when discussing changes. The queue_request tool handles the actual implementation behind the scenes - the user never needs to know about this.`;

const FALLBACK_USER_RESPONSE = "I understand you'd like to make some changes to your project. I'll work on that in the next phase.";

const USER_PROMPT = `
<system_context>
## Timestamp:
{{timestamp}}

## Project runtime errors:
{{errors}}

## Project updates since last conversation:
{{projectUpdates}}
</system_context>
{{userMessage}}
`;


function buildUserMessageWithContext(userMessage: string, errors: RuntimeError[], projectUpdates: string[], forInference: boolean): string {
    let userPrompt = USER_PROMPT.replace("{{timestamp}}", new Date().toISOString()).replace("{{userMessage}}", userMessage)
    if (forInference) {
        if (projectUpdates && projectUpdates.length > 0) {
            userPrompt = userPrompt.replace("{{projectUpdates}}", projectUpdates.join("\n\n"));
        }
        return userPrompt.replace("{{errors}}", PROMPT_UTILS.serializeErrors(errors));
    } else {
        // To save tokens
        return userPrompt.replace("{{projectUpdates}}", "redacted").replace("{{errors}}", "redacted");
    }
}

export class UserConversationProcessor extends AgentOperation<GenerationContext, UserConversationInputs, UserConversationOutputs> {

    async execute(inputs: UserConversationInputs, options: OperationOptions<GenerationContext>): Promise<UserConversationOutputs> {
        const { env, logger, context, agent } = options;
        const { userMessage, conversationState, errors, images, projectUpdates } = inputs;
        logger.info("Processing user message", { 
            messageLength: inputs.userMessage.length,
            hasImages: !!images && images.length > 0,
            imageCount: images?.length || 0
        });

        try {
            const systemPromptMessages = getSystemPromptWithProjectContext(SYSTEM_PROMPT, context, CodeSerializerType.SIMPLE);
            
            // Create user message with optional images for inference
            const userPromptForInference = buildUserMessageWithContext(userMessage, errors, projectUpdates, true);
            const userMessageForInference = images && images.length > 0
                ? createMultiModalUserMessage(
                    userPromptForInference,
                    await imagesToBase64(env, images),
                    'high'
                )
                : createUserMessage(userPromptForInference);

            let extractedUserResponse = "";
            
            // Generate unique conversation ID for this turn
            const aiConversationId = IdGenerator.generateConversationId();

            logger.info("Generated conversation ID", { aiConversationId });

            const toolCallRenderer = buildToolCallRenderer(inputs.conversationResponseCallback, aiConversationId);

            // Assemble all tools with lifecycle callbacks for UI updates
            const tools = buildTools(
                agent,
                logger,
                toolCallRenderer,
                (chunk: string) => inputs.conversationResponseCallback(chunk, aiConversationId, true)
            ).map(td => ({
                ...td,
                onStart: (_tc: ChatCompletionMessageFunctionToolCall, args: Record<string, unknown>) => Promise.resolve(toolCallRenderer({ name: td.name, status: 'start', args })),
                onComplete: (_tc: ChatCompletionMessageFunctionToolCall, args: Record<string, unknown>, result: unknown) => Promise.resolve(toolCallRenderer({
                    name: td.name,
                    status: 'success',
                    args,
                    result: typeof result === 'string' ? result : JSON.stringify(result)
                }))
            }));

            const runningHistory = await prepareMessagesForInference(env, conversationState.runningHistory);

            const compactHistory = await compactifyContext(runningHistory, env, options, toolCallRenderer, logger);
            if (compactHistory.length !== runningHistory.length) {
                logger.info("Conversation history compactified", { 
                    fullHistoryLength: conversationState.fullHistory.length,
                    runningHistoryLength: conversationState.runningHistory.length,
                    compactifiedRunningHistoryLength: compactHistory.length,
                    reduction: conversationState.runningHistory.length - compactHistory.length
                });
            }

            const messagesForInference =  [...systemPromptMessages, ...compactHistory, {...userMessageForInference, conversationId: IdGenerator.generateConversationId()}];


            logger.info("Executing inference for user message", { 
                messageLength: userMessage.length,
                aiConversationId,
                tools,
            });
            
            // Don't save the system prompts so that every time new initial prompts can be generated with latest project context
            // Use inference message (with images) for AI, but store text-only in history
            let result : InferResponseString;
            try {
                result = await executeInference({
                    env: env,
                    messages: messagesForInference,
                    agentActionName: "conversationalResponse",
                    context: options.inferenceContext,
                    tools, // Enable tools for the conversational AI
                    stream: {
                        onChunk: (chunk) => {
                            logger.info("Processing user message chunk", { chunkLength: chunk.length, aiConversationId });
                            inputs.conversationResponseCallback(chunk, aiConversationId, true);
                            extractedUserResponse += chunk;
                        },
                        chunk_size: CHUNK_SIZE
                    }
                });
            } catch (error) {
                if (error instanceof AbortError) {
                    logger.info("User message processing aborted", { aiConversationId, partialResponse: error.partialResponse() });
                    result = error.partialResponse();
                } else {
                    throw error;
                }
            }
            
            logger.info("Successfully processed user message", {
                streamingSuccess: !!extractedUserResponse,
            });

            const conversationResponse: ConversationalResponseType = {
                userResponse: extractedUserResponse
            };

            
            // For conversation history, store only text (images are ephemeral and not persisted)
            const userPromptForHistory = buildUserMessageWithContext(userMessage, errors, projectUpdates, false);
            const userMessageForHistory = images && images.length > 0
                ? createMultiModalUserMessage(
                    userPromptForHistory,
                    images.map(img => img.r2Key),
                    'high'
                )
                : createUserMessage(userPromptForHistory);

            
            const messages = [{...userMessageForHistory, conversationId: IdGenerator.generateConversationId()}];

            // Save the assistant's response to conversation history
            // If tools were called, include the tool call messages from toolCallContext
            if (result.toolCallContext?.messages && result.toolCallContext.messages.length > 0) {
                messages.push(
                    ...result.toolCallContext.messages
                        .map((message) => ({ ...message, conversationId: IdGenerator.generateConversationId() }))
                );
            }
            
            // Check if final response is duplicate of last assistant message in tool context
            const finalResponse = createAssistantMessage(result.string);
            const lastToolContextMessage = result.toolCallContext?.messages?.[result.toolCallContext.messages.length - 1];
            const isDuplicate = lastToolContextMessage?.role === 'assistant' && 
                               lastToolContextMessage?.content === finalResponse.content;
            
            if (!isDuplicate) {
                messages.push({...finalResponse, conversationId: IdGenerator.generateConversationId()});
                logger.info("Added final assistant response to history");
            } else {
                logger.info("Skipped duplicate final assistant response");
            }

            // Derive compacted running history for storage using stable IDs (no re-compaction)
            const originalRunning = conversationState.runningHistory;
            let storageRunning = originalRunning;
            if (compactHistory.length !== runningHistory.length) {
                const summaryMessage = compactHistory[0]; // assistant text-only summary
                const originalById = new Map(originalRunning.map(m => [m.conversationId, m] as const));
                const preservedTail = compactHistory
                    .slice(1)
                    .map(m => originalById.get(m.conversationId))
                    .filter((m): m is ConversationMessage => !!m);
                storageRunning = [summaryMessage, ...preservedTail];
            }

            return {
                conversationResponse,
                conversationState: {
                    ...conversationState,
                    runningHistory: [...storageRunning, ...messages],
                    fullHistory: [...conversationState.fullHistory, ...messages]
                }
            };
        } catch (error) {
            logger.error("Error processing user message:", error);
            if (error instanceof RateLimitExceededError || error instanceof SecurityError) {
                throw error;
            }   

            const fallbackMessages = [
                {...createUserMessage(userMessage), conversationId: IdGenerator.generateConversationId()},
                {...createAssistantMessage(FALLBACK_USER_RESPONSE), conversationId: IdGenerator.generateConversationId()}
            ]
            
            // Fallback response
            return {
                conversationResponse: {
                    userResponse: FALLBACK_USER_RESPONSE
                },
                conversationState: {
                    ...conversationState,
                    runningHistory: [...conversationState.runningHistory, ...fallbackMessages],
                    fullHistory: [...conversationState.fullHistory, ...fallbackMessages]
                }
            };
        }
    }

    processProjectUpdates<T extends ProjectUpdateType>(updateType: T, _data: WebSocketMessageData<T>, logger: StructuredLogger) : ConversationMessage[] {
        try {
            logger.info("Processing project update", { updateType });

            // Just save it as an assistant message. Dont save data for now to avoid DO size issues
            const preparedMessage = `**<Internal Memo>**
Project Updates: ${updateType}
</Internal Memo>`;

            return [{
                role: 'assistant',
                content: preparedMessage,
                conversationId: IdGenerator.generateConversationId()
            }];
        } catch (error) {
            logger.error("Error processing project update:", error);
            return [];
        }
    }

    isProjectUpdateType(type: unknown): type is ProjectUpdateType {
        return RelevantProjectUpdateWebsoketMessages.includes(type as ProjectUpdateType);
    }
}
