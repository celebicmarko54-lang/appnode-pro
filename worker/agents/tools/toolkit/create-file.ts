import { tool, t, ErrorResult } from '../types';
import { StructuredLogger } from '../../../logger';
import { ICodingAgent } from 'worker/agents/services/interfaces/ICodingAgent';

export type CreateFileResult =
	| { path: string; created: boolean }
	| ErrorResult;

export function createCreateFileTool(
	agent: ICodingAgent,
	logger: StructuredLogger,
) {
	return tool({
		name: 'create_file',
		description:
			`Create a new file with the specified content. Use this for creating brand new files directly.
For editing existing files, use edit_file instead. For batch file generation via LLM, use generate_files.`,
		args: {
			path: t.file.write().describe('Relative path for the new file'),
			content: t.string().describe('Full content of the file to create'),
		},
		run: async ({ path, content }) => {
			try {
				logger.info('Creating file', { path, contentLength: content.length });

				await agent.deployToSandbox(
					[{ filePath: path, fileContents: content, filePurpose: 'New file' }],
					false,
					`create: ${path}`,
				);

				return { path, created: true };
			} catch (error) {
				return {
					error:
						error instanceof Error
							? `Failed to create file: ${error.message}`
							: 'Unknown error occurred while creating file',
				};
			}
		},
	});
}
