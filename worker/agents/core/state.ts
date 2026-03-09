import type { AgenticBlueprint,
    FileOutputType,
} from '../schemas';
import type { InferenceMetadata } from '../inferutils/config.types';
import { BehaviorType, Plan, ProjectType } from './types';

export interface FileState extends FileOutputType {
    lastDiff: string;
}

export interface FileServingToken {
    token: string;
    createdAt: number;
}

/** Agent state — agentic only (phasic removed) */
export interface AgentState {
    behaviorType: BehaviorType;
    projectType: ProjectType;
    
    // Identity
    projectName: string;
    query: string;
    sessionId: string;
    hostname: string;

    blueprint: AgenticBlueprint;

    templateName: string | 'custom';
    
    // Inference context
    readonly metadata: InferenceMetadata;
    
    // Generation control
    shouldBeGenerating: boolean;
    
    // Common file storage
    generatedFilesMap: Record<string, FileState>;
    
    // Common infrastructure
    sandboxInstanceId?: string;
    fileServingToken?: FileServingToken;
    commandsHistory?: string[];
    lastPackageJson?: string;
    pendingUserInputs: string[];
    projectUpdatesAccumulator: string[];

    mvpGenerated: boolean;
    reviewingInitiated: boolean;

    // Agentic-specific
    currentPlan: Plan;
}

/** @deprecated Alias kept for backward compatibility during migration */
export type AgenticState = AgentState;

/** @deprecated Alias kept for backward compatibility during migration */
export type BaseProjectState = AgentState;

/** @deprecated Phasic state removed — maps to AgentState for backward compat */
export type PhasicState = AgentState;

export interface WorkflowMetadata {
    name: string;
    description: string;
    params: Record<string, {
        type: 'string' | 'number' | 'boolean' | 'object';
        description: string;
        example?: unknown;
        required: boolean;
    }>;
    bindings?: {
        envVars?: Record<string, {
            type: 'string';
            description: string;
            default?: string;
            required?: boolean;
        }>;
        secrets?: Record<string, {
            type: 'secret';
            description: string;
            required?: boolean;
        }>;
        resources?: Record<string, {
            type: 'kv' | 'r2' | 'd1' | 'queue' | 'ai';
            description: string;
            required?: boolean;
        }>;
    };
}
