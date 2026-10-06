import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { beginAnnotation, checkPush, contextFor, listJobs } from '../../dist/packages/core/src/index.js';
import { replaceJob } from '../../dist/packages/core/src/repository.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../../dist/packages/cli/src/main.js', import.meta.url));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const zero = '0'.repeat(40);

async function setup(t) {
	const root = await mkdtemp(join(tmpdir(), 'acs-cli-'));
	const repo = join(root, "repo with spaces and 'quote");
	const remote = join(root, 'remote.git');
	const fake = join(root, 'git-ai');
	const stats = await readFile(new URL('../fixtures/git-ai-1.7.5/mixed-partial.json', import.meta.url), 'utf8');
	const operations = [];
	const env = {
		...process.env,
		GIT_CONFIG_GLOBAL: '/dev/null',
		GIT_CONFIG_NOSYSTEM: '1',
		GIT_TRACE2_EVENT: '0',
		GIT_TRACE2: '0',
		GIT_TRACE2_PERF: '0',
		ACS_FIXTURE_STATS: stats
	};
	await mkdir(repo);
	await writeFile(fake, `#!${process.execPath}
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
const [command, commit] = process.argv.slice(2);
if (command === '--version') console.log('1.7.5');
else if (command === 'config') console.log(JSON.stringify({notes_backend:{kind:'git_notes'}}));
else if (command === 'show') {
 const note = execFileSync('git',['notes','--ref=ai','show',commit],{encoding:'utf8'});
 console.log(note.includes('corrupt') ? 'No authorship data found for this revision' : '---\\n{}');
} else if (command === 'stats') {
 if (process.env.ACS_GATE_COMMIT === commit) {
  writeFileSync(process.env.ACS_GATE_READY, 'ready');
  while (!existsSync(process.env.ACS_GATE_RELEASE)) await pause(10);
 }
 console.log(process.env.ACS_INVALID_STATS ? 'not JSON' : process.env.ACS_FIXTURE_STATS);
} else process.exitCode = 1;
`, {
		mode: 0o755
	});
	t.after(async () => {
		for (const { child } of operations) {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill('SIGTERM');
			}
		}

		const results = await Promise.allSettled(operations.map(operation => operation.done));
		await rm(root, {
			recursive: true,
			force: true
		});
		const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);

		if (failures.length > 0) {
			throw new AggregateError(failures, 'CLI subprocess completion failed');
		}
	});

	const git = async (args, cwd = repo, allowFailure = false) => {
		try {
			return (await exec('git', args, {
				cwd,
				env,
				timeout: 10000
			})).stdout.trim();
		} catch (error) {
			if (!allowFailure) {
				throw error;
			}

			return error;
		}
	};

	await git(['init', '-b', 'main']);
	await git(['config', 'user.name', 'ACS Example']);
	await git(['config', 'user.email', 'example@example.invalid']);
	await git(['config', 'commit.gpgsign', 'false']);
	await git(['init', '--bare', remote], root);
	await writeFile(join(repo, 'source.txt'), 'baseline\n');
	await git(['add', '.']);
	await git(['commit', '-m', 'feat: example\n\nPreserve body.\n\nSigned-off-by: Example <example@example.invalid>']);
	const sha = await git(['rev-parse', 'HEAD']);
	const note = async (commit = sha, cwd = repo, text = 'fixture attribution') => git(['notes', '--ref=ai', 'add', '-m', text, commit], cwd);

	const fresh = async (cwd = repo) => {
		const context = await contextFor(cwd, fake);
		context.env = env;

		return context;
	};

	const start = args => {
		const child = spawn(process.execPath, [cli, ...args, '--repo', repo, '--git-ai', fake, '--json'], {
			env,
			stdio: ['pipe', 'pipe', 'pipe']
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', chunk => {
			stdout += chunk;
		});
		child.stderr.on('data', chunk => {
			stderr += chunk;
		});
		const done = new Promise((resolve, reject) => {
			child.once('error', reject);
			child.once('close', code => {
				try {
					resolve({
						code,
						stdout,
						stderr,
						json: JSON.parse(stdout)
					});
				} catch (error) {
					reject(error);
				}
			});
		});
		child.stdin.end();
		operations.push({
			child,
			done
		});

		return {
			child,
			done
		};
	};

	const invoke = async args => start(args).done;
	const snapshot = async () => ({
		commit: await git(['show', '-s', '--format=%T%n%P%n%an%n%ae%n%aI', 'HEAD']),
		index: await git(['ls-files', '--stage']),
		staged: await git(['diff', '--cached', '--binary']),
		unstaged: await git(['diff', '--binary']),
		source: await readFile(join(repo, 'source.txt'), 'utf8')
	});
	const input = (commit = sha) => `refs/heads/main ${commit} refs/heads/main ${zero}\n`;

	const guardHook = async () => {
		await writeFile(join(repo, '.git/hooks/pre-push'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cli)} check-push --repo ${quote(repo)}\n`, {
			mode: 0o755
		});
	};

	return {
		root,
		repo,
		remote,
		fake,
		env,
		git,
		sha,
		note,
		fresh,
		invoke,
		start,
		snapshot,
		input,
		guardHook
	};
}

test('CLI inspects explicit attribution and atomically annotates without changing staged or working files', async t => {
	const s = await setup(t);
	await s.note();
	await writeFile(join(s.repo, 'source.txt'), 'baseline\nunstaged addition\n');
	await writeFile(join(s.repo, 'staged.txt'), 'unrelated staging\n');
	await s.git(['add', 'staged.txt']);
	const before = await s.snapshot();
	const inspected = await s.invoke(['inspect', '--commit', s.sha]);
	assert.equal(inspected.code, 0, inspected.stderr);
	assert.equal(inspected.json.data.shareAdded, '66.67%');
	const result = await s.invoke(['annotate', '--expected-head', s.sha]);
	assert.equal(result.code, 0, result.stderr);
	assert.notEqual(result.json.data.updated, s.sha);
	assert.deepEqual(await s.snapshot(), before);
	assert.match(await s.git(['show', '-s', '--format=%B', 'HEAD']), /Signed-off-by: Example/);
	assert.equal(await s.git(['notes', '--ref=ai', 'show', result.json.data.updated]), 'fixture attribution');
	const repeated = await s.invoke(['annotate', '--expected-head', result.json.data.updated]);
	assert.equal(repeated.code, 0, repeated.stderr);
	assert.equal(repeated.json.data.updated, result.json.data.updated);
	assert.equal((await s.git(['show', '-s', '--format=%B', 'HEAD'])).match(/AI-Stats-Version:/g).length, 1);
});

test('missing attribution persists a failure and permits an actual push with warning and quoted retry', async t => {
	const s = await setup(t);
	const before = await s.snapshot();
	const result = await s.invoke(['annotate', '--expected-head', s.sha, '--timeout-ms', '500']);
	assert.equal(result.code, 1);
	assert.match(result.json.error.retry, /--expected-head/);
	assert(result.json.error.retry.includes("'\\''"));
	assert.equal(await s.git(['rev-parse', 'HEAD']), s.sha);
	assert.deepEqual(await s.snapshot(), before);
	await s.guardHook();
	const push = await exec('git', ['push', s.remote, 'HEAD:refs/heads/main'], {
		cwd: s.repo,
		env: s.env,
		timeout: 10000
	});
	assert.match(push.stderr, /AI statistics attempt failed/);
	assert.match(push.stderr, /No new statistics were added/);
	assert.match(push.stderr, /acs annotate/);
	assert.equal(await s.git(['--git-dir', s.remote, 'rev-parse', 'main'], s.root), s.sha);
	const decision = await checkPush(await s.fresh(), s.input());
	assert.equal(decision.allowed, true);
	assert.match(decision.warnings[0], /You may push without statistics/);
	assert.match(decision.warnings[0], /acs annotate/);
});

test('pending work blocks actual publication while --no-verify is outside protection', async t => {
	const s = await setup(t);
	await beginAnnotation(await s.fresh(), s.sha);
	const duplicate = await s.invoke(['annotate', '--expected-head', s.sha]);
	assert.equal(duplicate.json.error.code, 'ANNOTATION_PENDING');
	assert.equal((await listJobs(await s.fresh()))[0].job.status, 'pending');
	await s.guardHook();
	const blocked = await s.git(['push', s.remote, 'HEAD:refs/heads/main'], s.repo, true);
	assert.notEqual(blocked.code, 0);
	assert.match(blocked.stderr, /being prepared/);
	const missing = await s.git(['--git-dir', s.remote, 'rev-parse', '--verify', 'main'], s.root, true);
	assert.equal(missing.code, 128);
	await s.git(['push', '--no-verify', s.remote, 'HEAD:refs/heads/bypass']);
	assert.equal(await s.git(['--git-dir', s.remote, 'rev-parse', 'bypass'], s.root), s.sha);
});

test('stale selected and explicit original SHA are blocked; the replacement SHA is allowed', async t => {
	const s = await setup(t);
	await s.note();
	const result = await s.invoke(['annotate', '--expected-head', s.sha]);
	assert.equal(result.code, 0, result.stderr);
	const old = await checkPush(await s.fresh(), s.input());
	assert.equal(old.allowed, false);
	assert.match(old.blockers[0], /was replaced/);
	assert.equal((await checkPush(await s.fresh(), s.input(result.json.data.updated))).allowed, true);
	await s.guardHook();
	const blocked = await s.git(['push', s.remote, `${s.sha}:refs/heads/stale`], s.repo, true);
	assert.notEqual(blocked.code, 0);
	await s.git(['push', s.remote, 'HEAD:refs/heads/main']);
	assert.equal(await s.git(['--git-dir', s.remote, 'rev-parse', 'main'], s.root), result.json.data.updated);
});

test('multiple pending commits retain separate state and terminal failures only warn', async t => {
	const s = await setup(t);
	const first = await beginAnnotation(await s.fresh(), s.sha);
	await s.git(['commit', '--allow-empty', '-m', 'second commit']);
	const secondSha = await s.git(['rev-parse', 'HEAD']);
	const second = await beginAnnotation(await s.fresh(), secondSha);
	assert.equal((await listJobs(await s.fresh())).length, 2);
	assert.equal((await checkPush(await s.fresh(), s.input(secondSha))).blockers.length, 2);
	const incremental = await checkPush(await s.fresh(), `refs/heads/main ${secondSha} refs/heads/main ${s.sha}\n`);
	assert.equal(incremental.blockers.length, 1);
	assert.equal((await checkPush(await s.fresh(), `refs/heads/main ${zero} refs/heads/main ${s.sha}\n`)).allowed, true);

	for (const entry of [first, second]) {
		await replaceJob(await s.fresh(), {
			...entry.job,
			status: 'failed',
			reason: 'test engine failure'
		}, entry.object);
	}

	const decision = await checkPush(await s.fresh(), s.input(secondSha));
	assert.equal(decision.allowed, true);
	assert.equal(decision.warnings.length, 2);
});

test('expired worker is changed to failed so abandoned pending work does not block indefinitely', async t => {
	const s = await setup(t);
	const pending = await beginAnnotation(await s.fresh(), s.sha);
	await replaceJob(await s.fresh(), {
		...pending.job,
		expiresAt: 0
	}, pending.object);
	const decision = await checkPush(await s.fresh(), s.input());
	assert.equal(decision.allowed, true);
	assert.match(decision.warnings[0], /deadline expired/);
	assert.equal((await listJobs(await s.fresh()))[0].job.status, 'failed');
});

test('linked worktree shares operation state and annotation leaves the main worktree unchanged', async t => {
	const s = await setup(t);
	const linked = join(s.root, 'linked worktree');
	await s.git(['worktree', 'add', '-b', 'linked', linked, 'HEAD']);
	await s.git(['commit', '--allow-empty', '-m', 'linked commit'], linked);
	const linkedSha = await s.git(['rev-parse', 'HEAD'], linked);
	await s.note(linkedSha, linked);
	const before = await s.snapshot();
	const result = await exec(process.execPath, [cli, 'annotate', '--repo', linked, '--expected-head', linkedSha, '--git-ai', s.fake, '--json'], {
		env: s.env,
		timeout: 10000
	});
	assert.equal(JSON.parse(result.stdout).ok, true);
	assert.deepEqual(await s.snapshot(), before);
	assert.equal((await listJobs(await s.fresh()))[0].job.commit, linkedSha);
});

async function gated(t) {
	const s = await setup(t);
	await s.note();
	const ready = join(s.root, 'ready');
	const release = join(s.root, 'release');
	s.env.ACS_GATE_COMMIT = s.sha;
	s.env.ACS_GATE_READY = ready;
	s.env.ACS_GATE_RELEASE = release;
	const operation = s.start(['annotate', '--expected-head', s.sha]);
	const deadline = Date.now() + 5000;

	while (!existsSync(ready)) {
		assert(Date.now() < deadline, 'Statistics stub never reached gate');
		await pause(10);
	}

	return {
		...s,
		operation,
		release
	};
}

test('a concurrent commit makes CAS fail without amending the new HEAD', async t => {
	const s = await gated(t);
	await s.git(['commit', '--allow-empty', '-m', 'concurrent commit']);
	const concurrent = await s.git(['rev-parse', 'HEAD']);
	const before = await s.snapshot();
	await writeFile(s.release, 'release');
	const result = await s.operation.done;
	assert.equal(result.code, 1);
	assert.equal(await s.git(['rev-parse', 'HEAD']), concurrent);
	assert.deepEqual(await s.snapshot(), before);
	assert.equal(await s.git(['show', '-s', '--format=%s', 'HEAD']), 'concurrent commit');
	assert.equal((await listJobs(await s.fresh()))[0].job.status, 'failed');
});

test('checkout during annotation cannot redirect the update to the newly selected branch', async t => {
	const s = await gated(t);
	await s.git(['checkout', '-b', 'other']);
	await writeFile(s.release, 'release');
	const result = await s.operation.done;
	assert.equal(result.code, 0, result.stderr);
	assert.equal(await s.git(['symbolic-ref', 'HEAD']), 'refs/heads/other');
	assert.equal(await s.git(['rev-parse', 'HEAD']), s.sha);
	assert.equal(await s.git(['rev-parse', 'main']), result.json.data.updated);
});

test('expiration invalidates a running worker before it can publish a replacement', async t => {
	const s = await gated(t);
	const [pending] = await listJobs(await s.fresh());
	await replaceJob(await s.fresh(), {
		...pending.job,
		expiresAt: 0
	}, pending.object);
	assert.equal((await checkPush(await s.fresh(), s.input())).allowed, true);
	await writeFile(s.release, 'release');
	const result = await s.operation.done;
	assert.equal(result.code, 1);
	assert.equal(await s.git(['rev-parse', 'HEAD']), s.sha);
	assert.equal((await listJobs(await s.fresh()))[0].job.status, 'failed');
});

test('invalid statistics and corrupt attribution never alter HEAD', async t => {
	const s = await setup(t);
	await s.note();
	s.env.ACS_INVALID_STATS = '1';
	const invalid = await s.invoke(['annotate', '--expected-head', s.sha]);
	assert.equal(invalid.code, 1);
	assert.equal(invalid.json.error.code, 'INVALID_STATISTICS');
	assert.equal(await s.git(['rev-parse', 'HEAD']), s.sha);
	delete s.env.ACS_INVALID_STATS;
	await s.git(['notes', '--ref=ai', 'remove', s.sha]);
	await s.note(s.sha, s.repo, 'corrupt attribution');
	const corrupt = await s.invoke(['inspect', '--commit', s.sha]);
	assert.equal(corrupt.code, 1);
	assert.equal(corrupt.json.error.code, 'ATTRIBUTION_UNAVAILABLE');
});

test('expected HEAD mismatch is read-only and does not fail an unrelated operation', async t => {
	const s = await setup(t);
	await s.git(['commit', '--allow-empty', '-m', 'new HEAD']);
	const newHead = await s.git(['rev-parse', 'HEAD']);
	const result = await s.invoke(['annotate', '--expected-head', s.sha]);
	assert.equal(result.code, 1);
	assert.equal(result.json.error.code, 'HEAD_MOVED');
	assert.equal(await s.git(['rev-parse', 'HEAD']), newHead);
	assert.deepEqual(await listJobs(await s.fresh()), []);
});

test('timeout after the atomic ref commit is reconciled as success rather than a false calculation failure', async t => {
	const s = await setup(t);
	await s.note();
	await writeFile(join(s.repo, '.git/hooks/reference-transaction'), `#!${process.execPath}
import { setTimeout as pause } from 'node:timers/promises';
let input = '';
for await (const chunk of process.stdin) input += chunk;
if (process.argv[2] === 'committed' && input.includes('refs/heads/main')) await pause(5000);
`, {
		mode: 0o755
	});
	const result = await s.invoke(['annotate', '--expected-head', s.sha, '--timeout-ms', '2000']);
	assert.equal(result.code, 0, result.stderr);
	assert.equal(await s.git(['rev-parse', 'HEAD']), result.json.data.updated);
	assert.equal((await listJobs(await s.fresh()))[0].job.status, 'ready');
});

test('explicit --repo cannot be redirected by inherited Git hook repository variables', async t => {
	const s = await setup(t);
	await s.note();
	const other = join(s.root, 'other clone');
	await s.git(['clone', '--local', s.repo, other], s.root);
	await s.note(s.sha, other);
	const cleanEnv = {
		...s.env
	};
	s.env.GIT_DIR = join(other, '.git');
	s.env.GIT_WORK_TREE = other;
	const result = await s.invoke(['annotate', '--expected-head', s.sha]);
	assert.equal(result.code, 0, result.stderr);
	const readHead = async cwd => (await exec('git', ['rev-parse', 'HEAD'], {
		cwd,
		env: cleanEnv
	})).stdout.trim();
	assert.equal(await readHead(other), s.sha);
	assert.equal(await readHead(s.repo), result.json.data.updated);
});
