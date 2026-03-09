import type { VibeClientOptions } from './types';
import { VibeClient } from './client';

/** @deprecated Phasic behavior removed — PhasicClient now routes to agentic internally */
export class PhasicClient extends VibeClient {
	constructor(options: VibeClientOptions) {
		super(options);
	}

	override async build(prompt: string, options: Parameters<VibeClient['build']>[1] = {}) {
		return super.build(prompt, { ...options, behaviorType: 'agentic' });
	}
}
