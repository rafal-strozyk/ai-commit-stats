import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AcsError, checked, run } from './process.js';
import { isRecord, parseStatistics, type Statistics } from './statistics.js';

export const jobPrefix = 'refs/ai-commit-stats/jobs/';
export const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export interface Context {
	repo: string;
	gitAi: string;
	env: NodeJS.ProcessEnv;
	deadline: number;
}

export function processOptions(context: Context, input?: string) {
	const timeoutMs = context.deadline - Date.now();

	if (timeoutMs <= 0) {
		throw new AcsError('TIMEOUT', 'The operation deadline expired');
	}

	return {
		cwd: context.repo,
		env: context.env,
		timeoutMs,
		...(input === undefined ? {} : {
			input
		})
	};
}

export async function git(context: Context, args: string[], input?: string): Promise<string> {
	return checked('git', args, processOptions(context, input));
}

export async function contextFor(repo: string, gitAi = 'git-ai', timeoutMs = 10000): Promise<Context> {
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000) {
		throw new AcsError('INVALID_ARGUMENT', 'timeout-ms must be an integer between 100 and 300000');
	}

	const context: Context = {
		repo: await realpath(repo),
		gitAi: gitAi.includes('/') ? resolve(gitAi) : gitAi,
		env: {
			...process.env,
			// Our prepared object and copied note must not race daemon rewrite handling.
			GIT_TRACE2_EVENT: '0',
			GIT_TRACE2: '0',
			GIT_TRACE2_PERF: '0'
		},
		deadline: Date.now() + timeoutMs
	};

	// --repo selects the checkout even when invoked from a Git hook in another one.
	for (const key of ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_PREFIX']) {
		delete context.env[key];
	}

	const root = (await git(context, ['rev-parse', '--show-toplevel'])).trim();
	context.repo = await realpath(root);

	return context;
}

export async function resolveCommit(context: Context, revision: string): Promise<string> {
	const commit = (await git(context, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`])).trim();

	if (!oidPattern.test(commit)) {
		throw new AcsError('INVALID_COMMIT', 'Git did not return a full commit object ID');
	}

	return commit;
}

export type JobStatus = 'pending' | 'failed' | 'ready';

export interface Job {
	version: 1;
	status: JobStatus;
	commit: string;
	repo: string;
	ref: string;
	retry: string;
	expiresAt: number;
	replacement?: string;
	reason?: string;
	stats?: Statistics;
}

export interface StoredJob {
	object: string;
	job: Job;
}

export function retryCommand(repo: string, commit: string, gitAi = 'git-ai'): string {
	const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
	const binary = gitAi === 'git-ai' ? '' : ` --git-ai ${quote(gitAi)}`;

	return `acs annotate --repo ${quote(repo)} --expected-head ${commit}${binary}`;
}

function parseJob(value: unknown, commit: string): Job {
	if (!isRecord(value) || value.version !== 1 || value.commit !== commit ||
		!['pending', 'failed', 'ready'].includes(String(value.status)) ||
		typeof value.repo !== 'string' || typeof value.ref !== 'string' ||
		typeof value.retry !== 'string' || typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt)) {
		throw new AcsError('INVALID_STATE', `Invalid ACS operation state for ${commit}`);
	}

	const status = value.status;

	if (status !== 'pending' && status !== 'failed' && status !== 'ready') {
		throw new AcsError('INVALID_STATE', `Unknown ACS status for ${commit}`);
	}

	const job: Job = {
		version: 1,
		status,
		commit,
		repo: value.repo,
		ref: value.ref,
		retry: value.retry,
		expiresAt: value.expiresAt
	};

	if (status === 'ready') {
		if (typeof value.replacement !== 'string' || !oidPattern.test(value.replacement)) {
			throw new AcsError('INVALID_STATE', `Invalid replacement SHA for ${commit}`);
		}

		job.replacement = value.replacement;
		job.stats = parseStatistics(value.stats);
	}

	if (status === 'failed') {
		if (typeof value.reason !== 'string') {
			throw new AcsError('INVALID_STATE', `Missing failure reason for ${commit}`);
		}

		job.reason = value.reason;
	}

	return job;
}

export async function listJobs(context: Context): Promise<StoredJob[]> {
	const refs = await git(context, ['for-each-ref', '--format=%(refname) %(objectname)', jobPrefix]);
	const jobs: StoredJob[] = [];

	for (const line of refs.trim().split('\n').filter(Boolean)) {
		const [ref, object] = line.split(' ');
		const commit = ref?.slice(jobPrefix.length);

		if (!object || !commit || !oidPattern.test(commit) || !oidPattern.test(object)) {
			throw new AcsError('INVALID_STATE', 'Invalid ACS operation reference');
		}

		const content = await git(context, ['cat-file', 'blob', object]);
		const value: unknown = JSON.parse(content);
		jobs.push({
			object,
			job: parseJob(value, commit)
		});
	}

	return jobs;
}

export async function jobObject(context: Context, job: Job): Promise<string> {
	return (await git(context, ['hash-object', '-w', '--stdin'], `${JSON.stringify(job)}\n`)).trim();
}

export async function replaceJob(context: Context, job: Job, previous?: string): Promise<string> {
	const object = await jobObject(context, job);
	await git(context, ['update-ref', `${jobPrefix}${job.commit}`, object, previous ?? '0'.repeat(job.commit.length)]);

	return object;
}

export async function noteObject(context: Context, commit: string): Promise<string | undefined> {
	const result = await run('git', ['notes', '--ref=ai', 'list', commit], processOptions(context));

	if (result.code === 1 && /no note found/.test(result.stderr)) {
		return undefined;
	}

	if (result.code !== 0 || !oidPattern.test(result.stdout.trim())) {
		throw new AcsError('ATTRIBUTION_FAILED', `Cannot read attribution for ${commit}: ${result.stderr.trim()}`);
	}

	return result.stdout.trim();
}
