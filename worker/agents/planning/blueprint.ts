import { TemplateDetails, TemplateFileSchema } from '../../services/sandbox/sandboxTypes'; // Import the type
import { PROMPT_UTILS, generalSystemPromptBuilder } from '../prompts';
import { executeInference } from '../inferutils/infer';
import { AgenticBlueprint, AgenticBlueprintSchema, TemplateSelection } from '../schemas';
import { createLogger } from '../../logger';
import { createSystemMessage, createUserMessage, createMultiModalUserMessage } from '../inferutils/common';
import { InferenceContext } from '../inferutils/config.types';
import { TemplateRegistry } from '../inferutils/schemaFormatters';
import z from 'zod';
import { imagesToBase64 } from 'worker/utils/images';
import { ProcessedImageAttachment } from 'worker/types/image-attachment';
import { getTemplateImportantFiles } from 'worker/services/sandbox/utils';
import { ProjectType } from '../core/types';

const logger = createLogger('Blueprint');

const SIMPLE_SYSTEM_PROMPT = `<ROLE>
    You are a Senior Software Architect at Cloudflare with expertise in rapid prototyping and modern web development.
    Your expertise lies in creating concise, actionable blueprints for building web applications quickly and efficiently.
</ROLE>

<TASK>
    Create a high-level blueprint for a web application based on the client's request.
    The project will be built on Cloudflare Workers and will start from a provided template.
    Focus on a clear, concise design that captures the core requirements without over-engineering.
    Enhance the user's request thoughtfully - be creative but practical.
</TASK>

<GOAL>
    Design the product described by the client and provide:
    - A professional, memorable project name
    - A brief but clear description of what the application does
    - A simple color palette (2-3 base colors) for visual identity
    - Essential frameworks and libraries needed (beyond the template)
    - A high-level step-by-step implementation plan
    
    Keep it concise - this is a simplified blueprint focused on rapid development.
    Build upon the provided template's existing structure and components.
</GOAL>

<INSTRUCTIONS>
    ## Core Principles
    • **Simplicity First:** Keep the design straightforward and achievable
    • **Template-Aware:** Leverage existing components and patterns from the template
    • **Essential Only:** Include only the frameworks/libraries that are truly needed
    • **Clear Plan:** Provide a logical step-by-step implementation sequence
    
    ## Color Palette
    • Choose 2-3 base RGB colors that work well together
    • Consider the application's purpose and mood
    • Ensure good contrast for accessibility
    • Only specify base colors, not shades
    
    ## Frameworks & Dependencies
    • Build on the template's existing dependencies
    • Only add libraries that are essential for the requested features
    • Prefer batteries-included libraries that work out-of-the-box
    • No libraries requiring API keys or complex configuration
    
    ## Implementation Plan
    • Break down the work into 5-8 logical steps
    • Each step should be a clear, achievable milestone
    • Order steps by dependency and priority
    • Keep descriptions brief but actionable
</INSTRUCTIONS>

<STARTING TEMPLATE>
{{template}}

<TEMPLATE_CORE_FILES>
**SHADCN COMPONENTS, Error boundary components and use-toast hook ARE PRESENT AND INSTALLED BUT EXCLUDED FROM THESE FILES DUE TO CONTEXT SPAM**
{{filesText}}
</TEMPLATE_CORE_FILES>

<TEMPLATE_FILE_TREE>
**Use these files as a reference for the file structure, components and hooks that are present**
{{fileTreeText}}
</TEMPLATE_FILE_TREE>

Preinstalled dependencies:
{{dependencies}}
</STARTING TEMPLATE>`;

const PROJECT_TYPE_BLUEPRINT_GUIDANCE: Record<ProjectType, string> = {
    app: '',
    workflow: `## Workflow Project Context
- Focus entirely on backend flows running on Cloudflare Workers (no UI/screens)
- Describe REST endpoints, scheduled jobs, queue consumers, Durable Objects, and data storage bindings in detail
- User flow should outline request/response shapes and operational safeguards
- Implementation roadmap must mention testing strategies (unit tests, integration tests) and deployment validation steps.`,
    presentation: `## Presentation Project Context
- Design a beautiful slide deck with a cohesive narrative arc (intro, problem, solution, showcase, CTA)
- Produce visually rich slides with precise layout, typography, imagery, and animation guidance
- User flow should actually be a "story flow" describing slide order, transitions, interactions, and speaker cues
- Implementation roadmap must reference presentation scaffold / template features (themes, deck index, slide components, animations, print/external export mode)
- Prioritize static data and storytelling polish; avoid backend complexity entirely.`,
    general: `## Objective Context
- Start from scratch; choose the most suitable representation for the request.
- If the outcome is documentation/specs/notes, prefer Markdown/MDX and do not assume any runtime.
- If a slide deck is helpful, outline the deck structure and content. Avoid assuming a specific file layout; keep the plan flexible.
- Keep dependencies minimal; introduce runtime only when clearly needed.`,
};

const getProjectTypeGuidance = (projectType: ProjectType): string =>
    PROJECT_TYPE_BLUEPRINT_GUIDANCE[projectType] || '';

interface BaseBlueprintGenerationArgs {
    env: Env;
    inferenceContext: InferenceContext;
    query: string;
    language: string;
    frameworks: string[];
    projectType: ProjectType;
    images?: ProcessedImageAttachment[];
    stream?: {
        chunk_size: number;
        onChunk: (chunk: string) => void;
    };
}

/** @deprecated Use AgenticBlueprintGenerationArgs */
export interface PhasicBlueprintGenerationArgs extends BaseBlueprintGenerationArgs {
    templateDetails: TemplateDetails;
    templateMetaInfo: TemplateSelection;
}

export interface AgenticBlueprintGenerationArgs extends BaseBlueprintGenerationArgs {
    templateDetails?: TemplateDetails;
    templateMetaInfo?: TemplateSelection;
}

/**
 * Generate a blueprint for the application based on user prompt.
 * Always generates an AgenticBlueprint (phasic removed).
 */
export async function generateBlueprint(
    args: PhasicBlueprintGenerationArgs | AgenticBlueprintGenerationArgs
): Promise<AgenticBlueprint> {
    const { env, inferenceContext, query, language, frameworks, templateDetails, templateMetaInfo, images, stream, projectType } = args;
    
    try {
        logger.info('Generating agentic blueprint', { query, queryLength: query.length, imagesCount: images?.length || 0 });
        if (templateDetails) logger.info(`Using template: ${templateDetails.name}`);

        const systemPromptTemplate = SIMPLE_SYSTEM_PROMPT;
        const schema = AgenticBlueprintSchema;
        
        // Build system prompt with template context (if provided)
        let systemPrompt = systemPromptTemplate;
        if (templateDetails) {
            const filesText = TemplateRegistry.markdown.serialize(
                { files: getTemplateImportantFiles(templateDetails).filter(f => !f.filePath.includes('package.json')) },
                z.object({ files: z.array(TemplateFileSchema) })
            );
            const fileTreeText = PROMPT_UTILS.serializeTreeNodes(templateDetails.fileTree);
            systemPrompt = systemPrompt.replace('{{filesText}}', filesText).replace('{{fileTreeText}}', fileTreeText);
        }
        const projectGuidance = getProjectTypeGuidance(projectType);
        if (projectGuidance) {
            systemPrompt = `${systemPrompt}\n\n${projectGuidance}`;
        }
        
        const systemPromptMessage = createSystemMessage(generalSystemPromptBuilder(systemPrompt, {
            query,
            templateDetails,
            frameworks,
            templateMetaInfo,
            blueprint: undefined,
            language,
            dependencies: templateDetails?.deps,
        }));

        const userMessage = images && images.length > 0
            ? createMultiModalUserMessage(
                `CLIENT REQUEST: "${query}"`,
                await imagesToBase64(env, images), 
                'high'
              )
            : createUserMessage(`CLIENT REQUEST: "${query}"`);

        const messages = [
            systemPromptMessage,
            userMessage
        ];

        const { object: results } = await executeInference({
            env,
            messages,
            agentActionName: "blueprint",
            schema,
            context: inferenceContext,
            stream,
        });

        return results as AgenticBlueprint;
    } catch (error) {
        logger.error("Error generating blueprint:", error);
        throw error;
    }
}
