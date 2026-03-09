import { tool, type } from '../types';
import { StructuredLogger } from '../../../logger';
import { ICodingAgent } from 'worker/agents/services/interfaces/ICodingAgent';
import { Blueprint } from 'worker/agents/schemas';
import { z } from 'zod';

export function createAlterBlueprintTool(
	agent: ICodingAgent,
	logger: StructuredLogger
) {
	const patchSchema = z.object({
		title: z.string().optional(),
		projectName: z.string().min(3).max(50).regex(/^[a-z0-9-_]+$/).optional(),
		description: z.string().optional(),
		detailedDescription: z.string().optional(),
		colorPalette: z.array(z.string()).optional(),
		frameworks: z.array(z.string()).optional(),
		plan: z.array(z.string()).optional(),
	});

	const patchType = type(
		patchSchema,
		() => ({ blueprint: true })
	);

	return tool({
		name: 'alter_blueprint',
		description: 'Apply a patch to the blueprint (title, description, colorPalette, frameworks, plan, projectName).',
		args: {
			patch: patchType,
		},
		run: async ({ patch }) => {
			logger.info('Altering blueprint', { keys: Object.keys(patch || {}) });
			const updated = await agent.updateBlueprint(patch as Partial<Blueprint>);
			return updated;
		},
	});
}
