import { AgenticBlueprint } from '../../schemas';
import { FileTreeNode, TemplateDetails } from '../../../services/sandbox/sandboxTypes';
import { FileState, AgentState } from '../../core/state';
import { DependencyManagement } from '../pure/DependencyManagement';
import type { StructuredLogger } from '../../../logger';
import { FileProcessing } from '../pure/FileProcessing';
import { Plan } from '../../core/types';

/** Common fields shared by all generation contexts */
interface BaseGenerationContext {
    readonly query: string;
    readonly allFiles: FileState[];
    readonly templateDetails: TemplateDetails;
    readonly dependencies: Record<string, string>;
    readonly commandsHistory: string[];
}

/** Plan-based generation context with simple blueprint */
export interface AgenticGenerationContext extends BaseGenerationContext {
    readonly blueprint: AgenticBlueprint;
    readonly currentPlan: Plan;
}

/** @deprecated Alias for backward compatibility */
export type PhasicGenerationContext = AgenticGenerationContext;

/**
 * Generation context — always agentic
 */
export type GenerationContext = AgenticGenerationContext;

/** Generation context utility functions */
export const GenerationContext = {
    /** Create immutable context from agent state */
    from(
        state: AgentState,
        templateDetails: TemplateDetails,
        logger?: Pick<StructuredLogger, 'info' | 'warn'>
    ): GenerationContext {
        const dependencies = DependencyManagement.mergeDependencies(
            templateDetails.deps || {},
            state.lastPackageJson,
            logger
        );

        const allFiles = FileProcessing.getAllRelevantFiles(
            templateDetails,
            state.generatedFilesMap
        );

        return Object.freeze({
            query: state.query,
            allFiles,
            templateDetails,
            dependencies,
            commandsHistory: state.commandsHistory || [],
            blueprint: state.blueprint,
            currentPlan: state.currentPlan,
        });
    },

    /** @deprecated Always returns false — phasic removed */
    isPhasic(_context: GenerationContext): boolean {
        return false;
    },

    /** Type guard for agentic context — always true */
    isAgentic(_context: GenerationContext): _context is AgenticGenerationContext {
        return true;
    },

    /** @deprecated Returns empty — phases removed */
    getCompletedPhases(_context: GenerationContext): never[] {
        return [];
    },

    /** Build file tree from context files */
    getFileTree(context: GenerationContext): FileTreeNode {
        const builder = new FileTreeBuilder(context.templateDetails?.fileTree);

        for (const { filePath } of context.allFiles) {
            const normalized = FileTreeBuilder.normalizePath(filePath);
            if (normalized) {
                builder.addFile(normalized);
            }
        }

        return builder.build();
    },

    /** Get agentic blueprint */
    getAgenticBlueprint(context: GenerationContext): AgenticBlueprint {
        return context.blueprint;
    },

    /** Get common blueprint data */
    getCommonBlueprintData(context: GenerationContext) {
        return {
            title: context.blueprint.title,
            projectName: context.blueprint.projectName,
            description: context.blueprint.description,
            frameworks: context.blueprint.frameworks,
            colorPalette: context.blueprint.colorPalette,
        };
    },
} as const;

class FileTreeBuilder {
    private readonly directoryIndex = new Map<string, FileTreeNode>();
    private readonly fileIndex = new Set<string>();
    private root: FileTreeNode;

    constructor(templateTree?: FileTreeNode) {
        this.root = this.createRoot();

        if (templateTree) {
            const clonedRoot = this.cloneNode(templateTree);
            if (clonedRoot?.type === 'directory') {
                this.root = clonedRoot;
            }
        }

        if (!this.directoryIndex.has(this.root.path)) {
            this.directoryIndex.set(this.root.path, this.root);
        }
    }

    static normalizePath(rawPath: string | undefined | null): string | null {
        if (!rawPath) {
            return '';
        }

        let cleaned = rawPath.trim().replace(/\\/g, '/');

        while (cleaned.startsWith('./')) {
            cleaned = cleaned.slice(2);
        }

        cleaned = cleaned.replace(/^\/+/g, '');

        if (!cleaned) {
            return '';
        }

        const segments: string[] = [];

        for (const segment of cleaned.split('/')) {
            if (!segment || segment === '.') {
                continue;
            }

            if (segment === '..') {
                if (segments.length === 0) {
                    return null;
                }
                segments.pop();
                continue;
            }

            segments.push(segment);
        }

        return segments.join('/');
    }

    addFile(path: string): void {
        if (this.fileIndex.has(path)) {
            return;
        }

        const directoryPath = this.parentPath(path);
        const directory = this.ensureDirectory(directoryPath);

        const existing = directory.children?.find(child => child.path === path);
        if (existing) {
            if (existing.type === 'file') {
                this.fileIndex.add(path);
            }
            return;
        }

        const fileNode: FileTreeNode = { path, type: 'file' };
        directory.children = directory.children || [];
        directory.children.push(fileNode);
        this.fileIndex.add(path);
    }

    build(): FileTreeNode {
        this.sortNode(this.root);
        return this.root;
    }

    private cloneNode(node: FileTreeNode): FileTreeNode | null {
        const normalizedPath = FileTreeBuilder.normalizePath(node.path);
        if (normalizedPath === null) {
            return null;
        }

        if (node.type === 'directory') {
            const cloned: FileTreeNode = {
                path: normalizedPath,
                type: 'directory',
                children: []
            };

            this.directoryIndex.set(normalizedPath, cloned);

            node.children?.forEach(child => {
                const clonedChild = this.cloneNode(child);
                if (clonedChild) {
                    cloned.children!.push(clonedChild);
                }
            });

            return cloned;
        }

        if (!normalizedPath) {
            return null;
        }

        this.fileIndex.add(normalizedPath);
        return { path: normalizedPath, type: 'file' };
    }

    private ensureDirectory(path: string): FileTreeNode {
        if (!path) {
            return this.root;
        }

        const existing = this.directoryIndex.get(path);
        if (existing) {
            return existing;
        }

        const parent = this.ensureDirectory(this.parentPath(path));
        const directory: FileTreeNode = {
            path,
            type: 'directory',
            children: []
        };

        parent.children = parent.children || [];
        parent.children.push(directory);
        this.directoryIndex.set(path, directory);

        return directory;
    }

    private sortNode(node: FileTreeNode): void {
        if (!node.children || node.children.length === 0) {
            if (node.type === 'directory') {
                node.children = [];
            } else {
                delete node.children;
            }
            return;
        }

        node.children.sort((left, right) => {
            if (left.type !== right.type) {
                return left.type === 'directory' ? -1 : 1;
            }

            const leftName = this.basename(left.path);
            const rightName = this.basename(right.path);
            return leftName.localeCompare(rightName);
        });

        node.children.forEach(child => this.sortNode(child));
    }

    private createRoot(): FileTreeNode {
        return { path: '', type: 'directory', children: [] };
    }

    private parentPath(path: string): string {
        if (!path.includes('/')) {
            return '';
        }
        return path.slice(0, path.lastIndexOf('/'));
    }

    private basename(path: string): string {
        const segments = path.split('/');
        return segments[segments.length - 1] || path;
    }
}
