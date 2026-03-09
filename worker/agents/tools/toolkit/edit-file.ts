import { tool, t, ErrorResult } from '../types';
import { StructuredLogger } from '../../../logger';
import { ICodingAgent } from 'worker/agents/services/interfaces/ICodingAgent';

export type EditFileResult =
	| { path: string; status: 'ok' | 'error'; message?: string }
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

export function createEditFileTool(
	agent: ICodingAgent,
	logger: StructuredLogger,
) {
	return tool({
		name: 'edit_file',
		description:
			`Make a precise surgical edit to an existing file. Replaces an exact string match with new content.

CRITICAL RULES:
- oldString MUST include at least 3 lines of surrounding context to match exactly ONE location
- If oldString matches zero locations, the edit fails (read the file first)
- If oldString matches multiple locations, the edit fails (add more context lines)
- For multiple edits in the same or different files, use multi_edit_files instead
- Prefer this over regenerate_file for changes affecting less than 80% of the file`,
		args: {
			path: t.file.write().describe('Relative path to the file to edit'),
			oldString: t.string().describe('Exact text to find — include 3+ context lines for uniqueness'),
			newString: t.string().describe('Replacement text'),
		},
		run: async ({ path, oldString, newString }) => {
			try {
				logger.info('Editing file', { path });

				const readResult = await agent.readFiles([path]);
				const file = readResult.files.find(f => f.path === path);
				if (!file) {
					return { error: `File not found: ${path}. Use read_files to verify the path exists.` };
				}

				const content = file.content;
				const occurrences = countOccurrences(content, oldString);

				if (occurrences === 0) {
					return {
						path,
						status: 'error' as const,
						message: `oldString not found in ${path}. The content may have changed — read the file first.`,
					};
				}

				if (occurrences > 1) {
					return {
						path,
						status: 'error' as const,
						message: `oldString matches ${occurrences} locations in ${path}. Include more surrounding context to make it unique.`,
					};
				}

				const updated = content.replace(oldString, newString);
				await agent.deployToSandbox(
					[{ filePath: path, fileContents: updated, filePurpose: 'Edited file' }],
					false,
					`edit: ${path}`
				);

				return { path, status: 'ok' as const };
			} catch (error) {
				return {
					error:
						error instanceof Error
							? `Failed to edit file: ${error.message}`
							: 'Unknown error occurred while editing file',
				};
			}
		},
	});
}
