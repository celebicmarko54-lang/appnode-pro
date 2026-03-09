import { tool, type as typeFn, ErrorResult } from '../types';
import { z } from 'zod';
import { StructuredLogger } from '../../../logger';
import { ICodingAgent } from 'worker/agents/services/interfaces/ICodingAgent';
import { FileOutputType } from 'worker/agents/schemas';

interface EditOperation {
	filePath: string;
	oldString: string;
	newString: string;
}

interface SingleEditResult {
	filePath: string;
	status: 'ok' | 'error';
	message?: string;
}

export type MultiEditFilesResult =
	| { results: SingleEditResult[]; totalEdits: number; appliedEdits: number; filesModified: string[] }
	| ErrorResult;

function countOccurrences(content: string, search: string): number {
	let count = 0;
	let pos = 0;
	while ((pos = content.indexOf(search, pos)) !== -1) {
		count++;
		pos += 1;
	}
	return count;
}

const editsSchema = z.array(z.object({
	filePath: z.string().describe('Relative path to the file to edit'),
	oldString: z.string().describe('Exact text to find — include 3+ context lines'),
	newString: z.string().describe('Replacement text'),
})).describe('Array of edit operations across files');

export function createMultiEditFilesTool(
	agent: ICodingAgent,
	logger: StructuredLogger,
) {
	return tool({
		name: 'multi_edit_files',
		description:
			`Apply multiple edits across multiple files in one call. More efficient than calling edit_file multiple times.
Each edit has the same uniqueness safety check as edit_file. Edits within the same file are applied sequentially.`,
		args: {
			edits: typeFn(editsSchema, (edits) => ({
				files: { mode: 'write' as const, paths: [...new Set(edits.map((e: EditOperation) => e.filePath))] },
			})),
		},
		run: async ({ edits }: { edits: EditOperation[] }) => {
			try {
				logger.info('Multi-editing files', { editsCount: edits.length });

				const uniquePaths = [...new Set(edits.map(e => e.filePath))];

				const readResult = await agent.readFiles(uniquePaths);
				const fileContents = new Map<string, string>();
				for (const f of readResult.files) {
					fileContents.set(f.path, f.content);
				}

				const results: SingleEditResult[] = [];
				let appliedEdits = 0;

				for (const edit of edits) {
					const content = fileContents.get(edit.filePath);
					if (content === undefined) {
						results.push({
							filePath: edit.filePath,
							status: 'error',
							message: `File not found: ${edit.filePath}`,
						});
						continue;
					}

					const occurrences = countOccurrences(content, edit.oldString);

					if (occurrences === 0) {
						results.push({
							filePath: edit.filePath,
							status: 'error',
							message: `oldString not found in ${edit.filePath}`,
						});
						continue;
					}

					if (occurrences > 1) {
						results.push({
							filePath: edit.filePath,
							status: 'error',
							message: `oldString matches ${occurrences} locations in ${edit.filePath}. Add more context.`,
						});
						continue;
					}

					fileContents.set(edit.filePath, content.replace(edit.oldString, edit.newString));
					results.push({ filePath: edit.filePath, status: 'ok' });
					appliedEdits++;
				}

				const modifiedPaths = new Set<string>();
				for (const r of results) {
					if (r.status === 'ok') modifiedPaths.add(r.filePath);
				}

				if (modifiedPaths.size > 0) {
					const filesToDeploy: FileOutputType[] = [...modifiedPaths].map(p => ({
						filePath: p,
						fileContents: fileContents.get(p)!,
						filePurpose: 'Edited file',
					}));

					await agent.deployToSandbox(
						filesToDeploy,
						false,
						`multi-edit: ${[...modifiedPaths].join(', ')}`,
					);
				}

				return {
					results,
					totalEdits: edits.length,
					appliedEdits,
					filesModified: [...modifiedPaths],
				};
			} catch (error) {
				return {
					error:
						error instanceof Error
							? `Failed to multi-edit files: ${error.message}`
							: 'Unknown error occurred',
				};
			}
		},
	});
}
