import type { BlueprintType } from '@/api-types';
import clsx from 'clsx';
import { Markdown } from './messages';

export function Blueprint({
	blueprint,
	className,
	...props
}: React.ComponentProps<'div'> & {
	blueprint: BlueprintType;
}) {
	if (!blueprint) return null;

	return (
		<div className={clsx('w-full flex flex-col', className)} {...props}>
			<div className="bg-accent p-6 rounded-t-xl flex items-center bg-graph-paper">
				<div className="flex flex-col gap-1">
					<div className="uppercase text-xs tracking-wider text-text-on-brand/90">
						Blueprint
					</div>
					<div className="text-2xl font-medium text-text-on-brand">
						{blueprint.title}
					</div>
				</div>
			</div>
			<div className="flex flex-col px-6 py-4 bg-bg-2 rounded-b-xl space-y-8">
				{/* Basic Info */}
				<div className="grid grid-cols-[120px_1fr] gap-4 text-sm">
					<div className="text-text-50/70 font-mono">Description</div>
					<Markdown className="text-text-50">{blueprint.description}</Markdown>

					{Array.isArray(blueprint.colorPalette) &&
						blueprint.colorPalette.length > 0 && (
							<>
								<div className="text-text-50/70 font-mono">Color Palette</div>
								<div className="flex items-center gap-2">
									{blueprint.colorPalette.map((color, index) => (
										<div
											key={`color-${index}`}
											className="size-6 rounded-md border border-text/10 flex items-center justify-center"
											style={{ backgroundColor: color }}
											title={color}
										>
											<span className="sr-only">{color}</span>
										</div>
									))}
								</div>{' '}
							</>
						)}

					<div className="text-text-50/70 font-mono">Dependencies</div>
					<div className="flex flex-wrap gap-2 items-center">
						{Array.isArray(blueprint.frameworks) &&
							blueprint.frameworks.map((framework, index) => {
								let name: string, version: string | undefined;

								if (framework.startsWith('@')) {
									const secondAt = framework.lastIndexOf('@');
									if (secondAt === 0) {
										name = framework;
									} else {
										name = framework.slice(0, secondAt);
										version = framework.slice(secondAt + 1);
									}
								} else {
									[name, version] = framework.split('@');
								}

								return (
									<span
										key={`framework-${framework}-${index}`}
										className="flex items-center text-xs border border-text/20 rounded-full px-2 py-0.5 text-text-primary/90 hover:border-white/40 transition-colors"
									>
										<span className="font-medium">{name}</span>
										{version && (
											<span className="text-text-primary/50">@{version}</span>
										)}
									</span>
								);
							})}
					</div>
				</div>

				{/* Implementation Plan */}
				{Array.isArray(blueprint.plan) && blueprint.plan.length > 0 && (
					<div>
						<h3 className="text-sm font-medium mb-2 text-text-50/70 uppercase tracking-wider">
							Implementation Plan
						</h3>
						<div className="space-y-2">
							{blueprint.plan.map((step, index) => (
								<div key={`plan-${index}`} className="flex gap-3 items-start">
									<span className="text-xs font-mono text-text-50/50 mt-0.5 shrink-0">
										{index + 1}.
									</span>
									<Markdown className="text-sm text-text-50">{step}</Markdown>
								</div>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
