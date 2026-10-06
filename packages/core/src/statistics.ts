import { AcsError } from './process.js';

export interface Statistics {
	ai_additions: number;
	human_additions: number;
	unknown_additions: number;
	git_diff_added_lines: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseStatistics(value: unknown): Statistics {
	if (!isRecord(value)) {
		throw new AcsError('INVALID_STATISTICS', 'Git AI statistics must be a JSON object');
	}

	const count = (key: string): number => {
		const result = value[key];

		if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0) {
			throw new AcsError('INVALID_STATISTICS', `Invalid Git AI count: ${key}`);
		}

		return result;
	};

	const stats = {
		ai_additions: count('ai_additions'),
		human_additions: count('human_additions'),
		unknown_additions: count('unknown_additions'),
		git_diff_added_lines: count('git_diff_added_lines')
	};

	if (stats.ai_additions + stats.human_additions + stats.unknown_additions !== stats.git_diff_added_lines) {
		throw new AcsError('INVALID_STATISTICS', 'Git AI additions do not reconcile with the filtered total');
	}

	return stats;
}

export function shareAdded(stats: Statistics): string {
	return stats.git_diff_added_lines === 0 ? 'N/A' : `${(100 * stats.ai_additions / stats.git_diff_added_lines).toFixed(2)}%`;
}

const trailerKeys = new Set(['AI-Stats-Version', 'AI-Lines-Added', 'Human-Lines-Added', 'Unknown-Lines-Added', 'AI-Share-Added']);

export function annotateMessage(message: string, stats: Statistics): string {
	const text = message.replace(/\n+$/, '');
	const boundary = text.lastIndexOf('\n\n');
	const lastParagraph = text.slice(boundary + 2);
	const lines = lastParagraph.split('\n');
	const groups: { key: string; lines: string[] }[] = [];
	let trailerBlock = boundary >= 0;
	let prefix = text;

	for (const line of lines) {
		const match = /^([A-Za-z0-9-]+):\s*[^\n]*$/.exec(line);

		if (match?.[1]) {
			groups.push({
				key: match[1],
				lines: [line]
			});
		} else if (/^[ \t]+\S/.test(line) && groups.length > 0) {
			groups[groups.length - 1]?.lines.push(line);
		} else {
			trailerBlock = false;
		}
	}

	if (trailerBlock) {
		const versions = groups.filter(group => group.key === 'AI-Stats-Version');

		if (versions.some(group => group.lines.length !== 1 || group.lines[0]?.trim() !== 'AI-Stats-Version: 1')) {
			throw new AcsError('UNSUPPORTED_TRAILERS', 'Unsupported AI-Stats-Version; commit message was not changed');
		}

		const unrelated = groups.filter(group => !trailerKeys.has(group.key)).flatMap(group => group.lines);
		prefix = text.slice(0, boundary);

		if (unrelated.length > 0) {
			prefix += `\n\n${unrelated.join('\n')}`;
		}
	}

	const footer = [
		'AI-Stats-Version: 1',
		`AI-Lines-Added: ${stats.ai_additions}`,
		`Human-Lines-Added: ${stats.human_additions}`,
		`Unknown-Lines-Added: ${stats.unknown_additions}`,
		`AI-Share-Added: ${shareAdded(stats)}`
	].join('\n');
	const separator = trailerBlock && prefix !== text.slice(0, boundary) ? '\n' : '\n\n';

	return `${prefix}${separator}${footer}\n`;
}
