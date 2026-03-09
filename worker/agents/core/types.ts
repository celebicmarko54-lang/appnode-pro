
import type { RuntimeError, StaticAnalysisResponse, GitHubPushRequest } from '../../services/sandbox/sandboxTypes';
import type { FileOutputType } from '../schemas';
import type { ConversationMessage } from '../inferutils/common';
import type { InferenceContext } from '../inferutils/config.types';
import type { TemplateDetails } from '../../services/sandbox/sandboxTypes';
import { TemplateSelection } from '../schemas';
import { ProcessedImageAttachment } from 'worker/types/image-attachment';

export type BehaviorType = 'agentic';

export type ProjectType = 'app' | 'workflow' | 'presentation' | 'general';

/**
 * Runtime type - WHERE it runs during dev
 * - sandbox: Cloudflare Containers (full apps with UI)
 * - worker: Dynamic Worker Loaders (backend only)  
 * - none: No runtime (static export only)
 */
export type RuntimeType = 'sandbox' | 'worker' | 'none';

/** Agent initialization arguments */
export interface AgentInitArgs {
    query: string;
    hostname: string;
    inferenceContext: InferenceContext;
    language?: string;
    frameworks?: string[];
    images?: ProcessedImageAttachment[];
    onBlueprintChunk: (chunk: string) => void;
    sandboxSessionId?: string;
    templateInfo?: {
        templateDetails: TemplateDetails;
        selection: TemplateSelection;
    };
}

export type Plan = string;

export interface AllIssues {
    runtimeErrors: RuntimeError[];
    staticAnalysis: StaticAnalysisResponse;
}

/**
 * Agent state definition for code generation
 */
export interface ScreenshotData {
    url: string;
    timestamp: number;
    viewport: { width: number; height: number };
    userAgent?: string;
    screenshot?: string; // Base64 data URL from Cloudflare Browser Rendering REST API
}

export interface AgentSummary {
    query: string;
    generatedCode: FileOutputType[];
    conversation?: ConversationMessage[];
}

export interface UserContext {
    suggestions?: string[];
    images?: ProcessedImageAttachment[];  // Image URLs
}

export type DeploymentTarget = 'platform' | 'user';

export interface DeployResult {
    success: boolean;
    target: DeploymentTarget;
    url?: string;
    deploymentId?: string;
    error?: string;
    metadata?: Record<string, unknown>;
}

export interface DeployOptions {
    target?: DeploymentTarget;
    token?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Result of project export/deployment operation
 */
export interface ExportResult {
    success: boolean;
    url?: string;
    error?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Options for project export/deployment
 */
export interface ExportOptions {
    kind: 'github' | 'pdf' | 'pptx' | 'googleslides' | 'workflow';
    format?: string;
    token?: string;
    github?: GitHubPushRequest;
    metadata?: Record<string, unknown>;
}
