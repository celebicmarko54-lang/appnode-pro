import { 
    AgentActionKey, 
    AgentConfig, 
    AgentConstraintConfig, 
    AIModels,
    AllModels,
    RegularModels,
} from "./config.types";

// Opus 4.6 as the sole model with effort-level routing
const OPUS_AGENT_CONFIG: AgentConfig = {
    screenshotAnalysis: {
        name: AIModels.DISABLED,
        reasoning_effort: 'medium' as const,
        max_tokens: 8000,
        temperature: 1,
        fallbackModel: AIModels.CLAUDE_OPUS_4_6,
    },
    realtimeCodeFixer: {
        name: AIModels.CLAUDE_OPUS_4_6,
        reasoning_effort: 'low' as const,
        max_tokens: 32000,
        temperature: 0.2,
        fallbackModel: AIModels.CLAUDE_4_5_SONNET,
    },
    templateSelection: {
        name: AIModels.CLAUDE_OPUS_4_6,
        reasoning_effort: 'low' as const,
        max_tokens: 2000,
        fallbackModel: AIModels.CLAUDE_4_5_SONNET,
        temperature: 1,
    },
    blueprint: {
        name: AIModels.CLAUDE_OPUS_4_6,
        reasoning_effort: 'high' as const,
        max_tokens: 20000,
        fallbackModel: AIModels.CLAUDE_4_5_SONNET,
        temperature: 1.0,
    },
    projectSetup: {
        name: AIModels.CLAUDE_OPUS_4_6,
        reasoning_effort: 'medium' as const,
        max_tokens: 8000,
        temperature: 1,
        fallbackModel: AIModels.CLAUDE_4_5_SONNET,
    },
    conversationalResponse: {
        name: AIModels.CLAUDE_OPUS_4_6,
        reasoning_effort: 'low' as const,
        max_tokens: 4000,
        temperature: 1,
        fallbackModel: AIModels.CLAUDE_4_5_SONNET,
    },
    fileRegeneration: {
        name: AIModels.CLAUDE_OPUS_4_6,
        reasoning_effort: 'low' as const,
        max_tokens: 32000,
        temperature: 0.0,
        fallbackModel: AIModels.CLAUDE_4_5_SONNET,
    },
    agenticProjectBuilder: {
        name: AIModels.CLAUDE_OPUS_4_6,
        reasoning_effort: 'high' as const,
        max_tokens: 128000,
        temperature: 1,
        fallbackModel: AIModels.CLAUDE_4_5_SONNET,
    },
};

export const AGENT_CONFIG: AgentConfig = OPUS_AGENT_CONFIG;


export const AGENT_CONSTRAINTS: Map<AgentActionKey, AgentConstraintConfig> = new Map([
	['realtimeCodeFixer', {
		allowedModels: new Set([AIModels.DISABLED]),
		enabled: true,
	}],
	['fileRegeneration', {
		allowedModels: new Set(AllModels),
		enabled: true,
	}],
	['projectSetup', {
		allowedModels: new Set([...RegularModels, AIModels.CLAUDE_OPUS_4_6]),
		enabled: true,
	}],
	['conversationalResponse', {
		allowedModels: new Set(AllModels),
		enabled: true,
	}],
	['templateSelection', {
		allowedModels: new Set(AllModels),
		enabled: true,
	}],
]);