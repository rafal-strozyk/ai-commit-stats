#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { AcsError, annotate, checkPush, contextFor, inspect, status } from '../../core/src/index.js';

const usage = `AI Commit Stats (development CLI)
acs inspect --repo <path> --commit <revision> [--json]
acs annotate --repo <path> --expected-head <full-sha> [--json]
acs status --repo <path> [--json]
acs check-push --repo <path> [--json] < pre-push-records

Options: --git-ai <executable>, --timeout-ms <100..300000>
No hooks, dependencies or editor integration are installed by these commands.`;

let json = process.argv.includes('--json');

try {
	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		allowPositionals: true,
		options: {
			repo: {
				type: 'string'
			},
			commit: {
				type: 'string'
			},
			'expected-head': {
				type: 'string'
			},
			'git-ai': {
				type: 'string'
			},
			'timeout-ms': {
				type: 'string'
			},
			json: {
				type: 'boolean',
				default: false
			},
			help: {
				type: 'boolean',
				short: 'h'
			}
		}
	});
	json = values.json;

	if (values.help || positionals.length === 0) {
		console.log(json ? JSON.stringify({
			ok: true,
			data: {
				usage
			}
		}) : usage);
	} else {
		const command = positionals[0];

		if (positionals.length !== 1 || !['inspect', 'annotate', 'status', 'check-push'].includes(command ?? '')) {
			throw new AcsError('INVALID_ARGUMENT', 'Unknown command or unexpected positional arguments');
		}

		if (!values.repo) {
			throw new AcsError('INVALID_ARGUMENT', '--repo is required');
		}

		const context = await contextFor(values.repo, values['git-ai'], values['timeout-ms'] === undefined ? 10000 : Number(values['timeout-ms']));
		let data: unknown;

		if (command === 'inspect') {
			if (!values.commit) {
				throw new AcsError('INVALID_ARGUMENT', '--commit is required');
			}

			data = await inspect(context, values.commit);
		} else if (command === 'annotate') {
			if (!values['expected-head']) {
				throw new AcsError('INVALID_ARGUMENT', '--expected-head is required');
			}

			data = await annotate(context, values['expected-head']);
		} else if (command === 'status') {
			data = await status(context);
		} else {
			let input = '';

			for await (const chunk of process.stdin) {
				input += String(chunk);

				if (input.length > 2 ** 20) {
					throw new AcsError('INVALID_PUSH_INPUT', 'Pre-push input exceeds 1 MiB');
				}
			}

			const decision = await checkPush(context, input);
			data = decision;

			for (const message of [...decision.blockers, ...decision.warnings]) {
				console.error(message);
			}

			process.exitCode = decision.allowed ? 0 : 1;
		}

		console.log(JSON.stringify({
			ok: process.exitCode !== 1,
			data
		}, null, json ? undefined : 2));
	}
} catch (error) {
	const code = error instanceof AcsError ? error.code : 'COMMAND_FAILED';
	const message = error instanceof Error ? error.message : String(error);
	const retry = error instanceof AcsError ? error.retry : undefined;
	console.error(`${message}${retry ? `\n${retry}` : ''}`);

	if (json) {
		console.log(JSON.stringify({
			ok: false,
			error: {
				code,
				message,
				...(retry ? {
					retry
				} : {})
			}
		}));
	}

	process.exitCode = 1;
}
