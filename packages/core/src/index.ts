import { setTimeout as pause } from 'node:timers/promises';
import { AcsError, checked, run } from './process.js';
import { annotateMessage, isRecord, parseStatistics, shareAdded, type Statistics } from './statistics.js';
import { contextFor, git, jobObject, jobPrefix, listJobs, noteObject, oidPattern, processOptions, replaceJob, resolveCommit, retryCommand, type Context, type Job, type StoredJob } from './repository.js';

export { AcsError, contextFor, listJobs, retryCommand };
export type { Context, Job, Statistics };

async function engineStatistics(context: Context, commit: string): Promise<Statistics> {
	const version = (await checked(context.gitAi, ['--version'], processOptions(context))).trim();

	if (!/^1\.7\.5(?:\s|$)/.test(version)) {
		throw new AcsError('UNSUPPORTED_GIT_AI', `Supported Git AI version is 1.7.5; found ${version}`);
	}

	const config: unknown = JSON.parse(await checked(context.gitAi, ['config'], processOptions(context)));

	if (!isRecord(config) || !isRecord(config.notes_backend) || config.notes_backend.kind !== 'git_notes') {
		throw new AcsError('UNSUPPORTED_NOTES_BACKEND', 'This version requires Git AI local git_notes storage; shared configuration was not changed');
	}

	// Let the attribution engine parse its note; existence alone is not readiness.
	const authorship = await checked(context.gitAi, ['show', commit], processOptions(context));

	if (!/^---$/m.test(authorship)) {
		throw new AcsError('ATTRIBUTION_UNAVAILABLE', `Git AI could not read attribution for ${commit}`);
	}

	let value: unknown;

	try {
		value = JSON.parse(await checked(context.gitAi, ['stats', commit, '--json'], processOptions(context)));
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new AcsError('INVALID_STATISTICS', 'Git AI returned invalid statistics JSON', undefined, {
				cause: error
			});
		}

		throw error;
	}

	return parseStatistics(value);
}

async function inspectCommit(context: Context, commit: string) {
	if (!await noteObject(context, commit)) {
		throw new AcsError('ATTRIBUTION_UNAVAILABLE', `Attribution is unavailable for ${commit}; no zero-AI conclusion can be made`);
	}

	const stats = await engineStatistics(context, commit);

	return {
		commit,
		gitAiVersion: '1.7.5',
		stats,
		shareAdded: shareAdded(stats)
	};
}

export async function inspect(context: Context, revision: string) {
	return inspectCommit(context, await resolveCommit(context, revision));
}

export async function beginAnnotation(context: Context, commit: string): Promise<StoredJob> {
	if (!oidPattern.test(commit)) {
		throw new AcsError('INVALID_ARGUMENT', 'expected-head must be a full commit SHA');
	}

	if (await resolveCommit(context, 'HEAD') !== commit) {
		throw new AcsError('HEAD_MOVED', `HEAD differs from ${commit}; no other commit was annotated`, retryCommand(context.repo, commit, context.gitAi));
	}

	const ref = (await git(context, ['symbolic-ref', '--quiet', '--no-recurse', 'HEAD'])).trim();

	if (!ref.startsWith('refs/heads/') || await resolveCommit(context, ref) !== commit) {
		throw new AcsError('HEAD_MOVED', 'A local branch at expected-head is required for annotation');
	}

	const existing = (await listJobs(context)).find(entry => entry.job.commit === commit);

	if (existing?.job.status === 'pending' && existing.job.expiresAt > Date.now()) {
		throw new AcsError('ANNOTATION_PENDING', `Statistics are already being prepared for ${commit}`);
	}

	const job: Job = {
		version: 1,
		status: 'pending',
		commit,
		repo: context.repo,
		ref,
		retry: retryCommand(context.repo, commit, context.gitAi),
		expiresAt: context.deadline
	};
	const object = await replaceJob(context, job, existing?.object);

	return {
		object,
		job
	};
}

interface CommitData {
	tree: string;
	parents: string[];
	author: string;
	message: string;
	signed: boolean;
}

async function commitData(context: Context, commit: string): Promise<CommitData> {
	const content = await git(context, ['cat-file', 'commit', commit]);
	const boundary = content.indexOf('\n\n');
	const headers = content.slice(0, boundary).split('\n');
	const tree = headers.find(line => line.startsWith('tree '))?.slice(5);
	const author = headers.find(line => line.startsWith('author '))?.slice(7);
	const parents = headers.filter(line => line.startsWith('parent ')).map(line => line.slice(7));

	if (boundary < 0 || !tree || !oidPattern.test(tree) || !author || parents.some(parent => !oidPattern.test(parent))) {
		throw new AcsError('INVALID_COMMIT', 'Cannot safely read the expected commit');
	}

	if (headers.some(line => !/^(?:tree |parent |author |committer |gpgsig(?:-sha256)? |encoding UTF-8$| )/.test(line))) {
		throw new AcsError('UNSUPPORTED_COMMIT', 'Commit has unsupported headers; it was preserved unchanged');
	}

	return {
		tree,
		parents,
		author,
		message: content.slice(boundary + 2),
		signed: headers.some(line => /^gpgsig(?:-sha256)? /.test(line))
	};
}

async function prepareCommit(context: Context, original: CommitData, message: string): Promise<string> {
	const author = /^(.*) <([^<>]*)> ([0-9]+) ([+-][0-9]{4})$/.exec(original.author);

	if (!author) {
		throw new AcsError('UNSUPPORTED_COMMIT', 'Cannot preserve the commit author exactly');
	}

	const signing = await run('git', ['config', '--type=bool', '--get', 'commit.gpgsign'], processOptions(context));

	if (signing.code !== 0 && signing.code !== 1) {
		throw new AcsError('SIGNING_FAILED', 'Cannot read commit signing configuration');
	}

	const sign = original.signed || signing.stdout.trim() === 'true';
	const args = ['commit-tree', original.tree];

	for (const parent of original.parents) {
		args.push('-p', parent);
	}

	if (sign) {
		args.push('-S');
	}

	const options = processOptions(context, message);
	const commit = (await checked('git', args, {
		...options,
		env: {
			...context.env,
			GIT_AUTHOR_NAME: author[1],
			GIT_AUTHOR_EMAIL: author[2],
			GIT_AUTHOR_DATE: `${author[3]} ${author[4]}`
		}
	})).trim();
	const prepared = await commitData(context, commit);

	if (prepared.tree !== original.tree || prepared.author !== original.author ||
		JSON.stringify(prepared.parents) !== JSON.stringify(original.parents) ||
		prepared.message !== message || (sign && !prepared.signed)) {
		throw new AcsError('COMMIT_CHANGED', 'Prepared commit did not preserve tree, parents, author, message or signing');
	}

	return commit;
}

export async function annotate(context: Context, commit: string) {
	if (process.platform === 'win32') {
		throw new AcsError('UNSUPPORTED_PLATFORM', 'Annotation is currently supported on Unix only');
	}

	const pending = await beginAnnotation(context, commit);
	let completed: {
		object: string;
		result: {
			original: string;
			updated: string;
			ref: string;
			stats: Statistics;
			shareAdded: string;
		};
	} | undefined;

	try {
		while (!await noteObject(context, commit)) {
			if (Date.now() + 25 >= context.deadline) {
				throw new AcsError('ATTRIBUTION_UNAVAILABLE', `Attribution did not become available for ${commit}`);
			}

			await pause(25);
		}

		const result = await inspectCommit(context, commit);
		const original = await commitData(context, commit);
		const message = annotateMessage(original.message, result.stats);
		const updated = message === original.message ? commit : await prepareCommit(context, original, message);

		if (updated !== commit) {
			const existingNote = await noteObject(context, updated);

			if (existingNote && existingNote !== await noteObject(context, commit)) {
				throw new AcsError('ATTRIBUTION_CHANGED', 'The prepared commit already has different attribution; it was not overwritten');
			}

			if (!existingNote) {
				await git(context, ['notes', '--ref=ai', 'copy', commit, updated]);
			}

			const copied = await inspectCommit(context, updated);

			if (JSON.stringify(copied.stats) !== JSON.stringify(result.stats)) {
				throw new AcsError('ATTRIBUTION_CHANGED', 'Attribution differs on the prepared replacement commit');
			}
		}

		const ready: Job = {
			...pending.job,
			status: 'ready',
			replacement: updated,
			stats: result.stats
		};
		const stateObject = await jobObject(context, ready);
		completed = {
			object: stateObject,
			result: {
				original: commit,
				updated,
				ref: pending.job.ref,
				stats: result.stats,
				shareAdded: result.shareAdded
			}
		};
		const transaction = [
			'start',
			`update ${pending.job.ref} ${updated} ${commit}`,
			`update ${jobPrefix}${commit} ${stateObject} ${pending.object}`,
			'prepare',
			'commit',
			''
		].join('\n');
		// Capture the branch explicitly: a checkout cannot redirect this to another HEAD.
		// Both old branch OID and operation lease are verified under Git's ref locks.
		await git(context, ['update-ref', '--no-deref', '-m', 'acs: annotate commit statistics', '--stdin'], transaction);

		return completed.result;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		const recovery = await contextFor(context.repo, context.gitAi);
		const current = (await listJobs(recovery)).find(entry => entry.job.commit === commit);

		// A timeout after ref commit does not mean the transaction failed.
		if (completed && current?.object === completed.object) {
			return completed.result;
		}

		// An expired worker must not overwrite a newer retry's state.
		if (current?.object === pending.object) {
			await replaceJob(recovery, {
				...pending.job,
				status: 'failed',
				reason
			}, pending.object);
		}

		throw new AcsError(error instanceof AcsError ? error.code : 'ANNOTATION_FAILED',
			`The AI statistics attempt failed for ${commit}: ${reason}. No new statistics were added. You may push without statistics, or retry before pushing. If HEAD moved, the retry refuses to change another commit.`,
			pending.job.retry, {
				cause: error
			});
	}
}

export async function status(context: Context) {
	return {
		repo: context.repo,
		head: await resolveCommit(context, 'HEAD'),
		jobs: (await listJobs(context)).map(entry => entry.job)
	};
}

export interface PushDecision {
	allowed: boolean;
	blockers: string[];
	warnings: string[];
}

export async function checkPush(context: Context, input: string): Promise<PushDecision> {
	const updates = input.trim().split('\n').filter(Boolean).map(line => {
		const fields = line.trim().split(/\s+/);
		const local = fields[1];
		const remote = fields[3];

		if (fields.length !== 4 || !local || !remote || !oidPattern.test(local) || !oidPattern.test(remote)) {
			throw new AcsError('INVALID_PUSH_INPUT', 'Expected pre-push records: local-ref local-SHA remote-ref remote-SHA');
		}

		return {
			local,
			remote
		};
	});
	const selected = new Set<string>();

	for (const { local, remote } of updates) {
		if (/^0+$/.test(local)) {
			continue;
		}

		const args = ['rev-list', local];

		if (!/^0+$/.test(remote)) {
			const known = await run('git', ['cat-file', '-e', `${remote}^{commit}`], processOptions(context));

			if (known.code === 0) {
				args.push(`^${remote}`);
			}
		}

		for (const commit of (await git(context, args)).trim().split('\n').filter(Boolean)) {
			selected.add(commit);
		}
	}

	const blockers: string[] = [];
	const warnings: string[] = [];

	for (const entry of await listJobs(context)) {
		if (!selected.has(entry.job.commit)) {
			continue;
		}

		let job = entry.job;

		if (job.status === 'pending' && job.expiresAt <= Date.now()) {
			job = {
				...job,
				status: 'failed',
				reason: 'Annotation worker deadline expired'
			};
			await replaceJob(context, job, entry.object);
		}

		if (job.status === 'pending') {
			blockers.push(`Statistics are being prepared for ${job.commit}. Retry git push when they finish.`);
		} else if (job.status === 'ready' && job.replacement !== job.commit) {
			blockers.push(`Selected SHA ${job.commit} was replaced by ${job.replacement}. Retry git push with the updated reference; an explicit old SHA must be replaced.`);
		} else if (job.status === 'failed') {
			warnings.push(`The AI statistics attempt failed for ${job.commit}: ${job.reason ?? 'unknown error'}. No new statistics were added. You may push without statistics, or retry before pushing:\n${job.retry}`);
		}
	}

	return {
		allowed: blockers.length === 0,
		blockers,
		warnings
	};
}
