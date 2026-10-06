#!/usr/bin/env node
// Research harness, not the ACS CLI or a repository installer.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, platform, arch } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);
const self = fileURLToPath(import.meta.url);
const gitBinary = '/usr/bin/git';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

async function run(binary, args, cwd, env, allowFailure = false, timeout = 15000) {
	try {
		const result = await exec(binary, args, {
			cwd,
			env,
			timeout,
			killSignal: 'SIGKILL',
			maxBuffer: 2 ** 20
		});

		return {
			code: 0,
			...result
		};
	} catch (error) {
		if (!allowFailure) {
			throw error;
		}

		return {
			code: error.code,
			signal: error.signal,
			stdout: error.stdout ?? '',
			stderr: error.stderr ?? ''
		};
	}
}

const git = (args, cwd, env, allowFailure = false) => run(gitBinary, args, cwd, env, allowFailure);
const output = async (args, cwd, env) => (await git(args, cwd, env)).stdout.trim();

async function until(predicate, timeout = 10000) {
	const started = performance.now();

	while (performance.now() - started < timeout) {
		if (await predicate()) {
			return Math.round(performance.now() - started);
		}

		await pause(20);
	}

	throw new Error(`Condition did not become ready within ${timeout}ms`);
}

async function noteExists(sha, repo, env) {
	return (await git(['notes', '--ref=ai', 'show', sha], repo, env, true)).code === 0;
}

async function annotate(repo, sha, binary, env, stateFile, beforeAmend) {
	// This HEAD check is a prototype precondition, not an atomic concurrency guard.
	const fail = async reason => {
		await writeFile(stateFile, JSON.stringify({
			status: 'failed',
			sha,
			reason
		}));
		throw new Error(`Statistics were NOT added: ${reason}. Proposed recovery: acs annotate --repo ${quote(repo)} --expected-head ${sha}`);
	};

	if (await output(['rev-parse', 'HEAD'], repo, env) !== sha) {
		return fail('HEAD changed');
	}

	if (!await noteExists(sha, repo, env)) {
		return fail('attribution is unavailable');
	}

	const result = await run(binary, ['stats', sha, '--json'], repo, env, true);

	if (result.code !== 0) {
		return fail(`Git AI failed (${result.code})`);
	}

	let stats;

	try {
		stats = JSON.parse(result.stdout);
	} catch {
		return fail('invalid statistics JSON');
	}

	const keys = ['ai_additions', 'human_additions', 'unknown_additions', 'git_diff_added_lines'];

	if (!keys.every(key => Number.isSafeInteger(stats[key]) && stats[key] >= 0)) {
		return fail('invalid statistics counts');
	}

	if (stats.ai_additions + stats.human_additions + stats.unknown_additions !== stats.git_diff_added_lines) {
		return fail('statistics counts do not reconcile');
	}

	const original = await output(['show', '-s', '--format=%B', sha], repo, env);
	const percentage = stats.git_diff_added_lines === 0 ? 'N/A' : `${(100 * stats.ai_additions / stats.git_diff_added_lines).toFixed(2)}%`;
	const footer = `AI-Stats-Version: 1\nAI-Lines-Added: ${stats.ai_additions}\nHuman-Lines-Added: ${stats.human_additions}\nUnknown-Lines-Added: ${stats.unknown_additions}\nAI-Share-Added: ${percentage}`;
	// Only fixtures created by this harness use this simple footer layout.
	const message = `${original.replace(/\n\nAI-Stats-Version: 1\n[\s\S]*$/, '')}\n\n${footer}`;

	if (message !== original) {
		const messageFile = `${stateFile}.message`;
		await writeFile(messageFile, `${message}\n`);

		if (await output(['rev-parse', 'HEAD'], repo, env) !== sha) {
			return fail('HEAD changed');
		}

		// A deterministic test interleaving exposes the gap after the last check.
		if (beforeAmend) {
			await beforeAmend();
		}

		const amend = await git(['commit', '--amend', '--only', '--allow-empty', '-F', messageFile], repo, env, true);

		if (amend.code !== 0) {
			return fail(`message amendment failed (${amend.code}): ${amend.stderr.trim()}`);
		}
	}

	const updated = await output(['rev-parse', 'HEAD'], repo, env);
	await until(() => noteExists(updated, repo, env));
	await writeFile(stateFile, JSON.stringify({
		status: 'ready',
		sha,
		updated
	}));

	return {
		original: sha,
		updated,
		stats
	};
}

async function guard(repo, env, stateFile, stdin) {
	const state = JSON.parse(await readFile(stateFile, 'utf8'));

	for (const line of stdin.trim().split('\n').filter(Boolean)) {
		const [, local, , remote] = line.split(' ');

		if (/^0+$/.test(local)) {
			continue;
		}

		// Include all reachable commits on the first push, not only HEAD.
		const args = ['rev-list', local];

		if (!/^0+$/.test(remote) && (await git(['cat-file', '-e', remote], repo, env, true)).code === 0) {
			args.push(`^${remote}`);
		}

		const commits = (await output(args, repo, env)).split('\n');

		if (commits.includes(state.sha) && (state.status === 'pending' || (state.status === 'ready' && state.updated !== state.sha))) {
			throw new Error(`Push blocked: ${state.status} statistics for ${state.sha}. Proposed recovery: acs annotate --repo ${quote(repo)} --expected-head ${state.sha}`);
		}

		if (commits.includes(state.sha) && state.status === 'failed') {
			console.error(`Statistics were NOT calculated for ${state.sha}. You may push without statistics, or retry: acs annotate --repo ${quote(repo)} --expected-head ${state.sha}`);
		}
	}
}

if (process.argv[2] === '--guard') {
	let stdin = '';

	for await (const chunk of process.stdin) {
		stdin += chunk;
	}

	try {
		await guard(process.cwd(), process.env, process.argv[3], stdin);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
} else if (process.argv[2] === '--worker') {
	const [repo, sha, binary, stateFile, gate, timeout = '10000'] = process.argv.slice(3);
	// Worker Git commands must be observable as roots with Trace2 nesting zero.
	const workerEnv = {
		...process.env
	};
	delete workerEnv.GIT_TRACE2_PARENT_SID;

	try {
		if (gate) {
			await until(() => Promise.resolve(existsSync(gate)));
		}

		await until(() => noteExists(sha, repo, workerEnv), Number(timeout));
		console.log(JSON.stringify(await annotate(repo, sha, binary, workerEnv, stateFile)));
	} catch (error) {
		await writeFile(stateFile, JSON.stringify({
			status: 'failed',
			sha,
			reason: error.message
		}));
		console.error(`Statistics were NOT added: ${error.message}. Proposed recovery: acs annotate --repo ${quote(repo)} --expected-head ${sha}`);
		process.exitCode = 1;
	}
} else {
	await experiment();
}

async function experiment() {
	const binary = process.argv[2] && resolve(process.argv[2]);
	assert(binary && existsSync(binary), 'Usage: node tests/integration/commit-workflow-experiment.mjs /absolute/path/to/test-support/git-ai [report.json]');
	assert(platform() !== 'win32', 'This initial experiment supports Unix only.');
	const root = await mkdtemp(join(tmpdir(), 'acs-'));
	const repo = join(root, 'repo with spaces');
	const socket = join(root, 'trace.sock');
	const control = join(root, 'control.sock');
	const stateFile = join(root, 'annotation.json');
	const home = join(root, 'home');

	const env = {
		PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
		HOME: home,
		TMPDIR: root,
		GIT_CONFIG_GLOBAL: '/dev/null',
		GIT_CONFIG_NOSYSTEM: '1',
		GIT_TERMINAL_PROMPT: '0',
		GIT_AI_DAEMON_HOME: root,
		GIT_AI_DAEMON_CONTROL_SOCKET: control,
		GIT_AI_DAEMON_TRACE_SOCKET: socket,
		GIT_AI_TEST_DB_PATH: join(root, 'authorship.db'),
		GIT_AI_TEST_METRICS_DB_PATH: join(root, 'metrics.db'),
		GIT_AI_TEST_NOTES_DB_PATH: join(root, 'notes.db'),
		GIT_AI_API_BASE_URL: 'http://127.0.0.1:1',
		GIT_AI_TEST_CONFIG_PATCH: JSON.stringify({
			git_path: gitBinary,
			disable_auto_updates: true,
			disable_version_checks: true,
			telemetry_oss_disabled: true,
			notes_backend: {
				kind: 'git_notes'
			},
			feature_flags: {
				transcript_streaming: false,
				transcript_sweep: false,
				token_usage_metrics: false,
				daemon_log_upload: false,
				untraced_commit_fixup: false
			},
		}),
		_GITAI_INTERNAL_DISABLE_WRAPPER_DAEMON_AUTOSPAWN: '1',
	};
	let daemon;
	let daemonDone;
	let daemonClosed = false;
	let daemonLog = '';
	const workers = [];
	let failure;

	const report = {
		status: 'running',
		startedAt: new Date().toISOString(),
		versions: {},
		checks: [],
		observations: {}
	};

	const check = (name, detail) => {
		report.checks.push({
			name,
			detail
		});
		console.log(`PASS ${name}`);
	};

	const ai = (args, allowFailure = false, timeout = 15000) => run(binary, args, repo, env, allowFailure, timeout);

	const globalFiles = ['.gitconfig', '.git-ai/config.json', '.git-ai/internal/distinct_id'];
	const beforeGlobals = await Promise.all(globalFiles.map(async file => {
		const path = join(process.env.HOME, file);

		return {
			path,
			content: existsSync(path) ? await readFile(path) : null
		};
	}));

	try {
		await mkdir(repo);
		await mkdir(home);
		const config = JSON.parse((await run(binary, ['config'], root, env)).stdout);
		assert.equal(config.disable_auto_updates, true, 'Binary must enable test-support overrides. Release binary is unsafe for isolated test databases.');
		assert.equal(config.telemetry_oss_disabled, true);
		report.versions = {
			node: process.version,
			git: (await output(['--version'], root, env)),
			gitAi: (await run(binary, ['--version'], root, env)).stdout.trim(),
			build: 'test-support overrides verified; source provenance recorded separately',
			binarySha256: createHash('sha256').update(await readFile(binary)).digest('hex'),
			platform: `${platform()}-${arch()}`
		};
		daemon = spawn(binary, ['bg', 'run'], {
			cwd: root,
			env,
			stdio: ['ignore', 'ignore', 'pipe']
		});
		daemonDone = new Promise(resolve => {
			daemon.once('close', () => {
				daemonClosed = true;
				resolve();
			});
		});
		daemon.stderr.on('data', chunk => {
			daemonLog = (daemonLog + chunk).slice(-12000);
		});
		daemon.on('error', error => {
			daemonLog += error.message;
		});
		await until(() => {
			assert(!daemonClosed, `Daemon exited before readiness: ${daemonLog}`);

			return Promise.resolve(existsSync(control) && existsSync(socket));
		});
		await git(['init', '-b', 'main'], repo, env);
		await git(['config', 'user.name', 'ACS Experiment'], repo, env);
		await git(['config', 'user.email', 'experiment@example.invalid'], repo, env);
		// Repository-local Trace2 configuration is not read by this Git build.
		env.GIT_TRACE2_EVENT = `af_unix:stream:${socket}`;
		env.GIT_TRACE2_EVENT_NESTING = '0';
		await writeFile(join(repo, 'sample.txt'), 'baseline\n');
		await git(['add', '.'], repo, env);
		await git(['commit', '-m', 'test: baseline'], repo, env);
		const baseline = await output(['rev-parse', 'HEAD'], repo, env);
		report.observations.initialNoteReadyMs = await until(() => noteExists(baseline, repo, env));
		check('initial commit attribution becomes available');
		report.observations.initialStats = JSON.parse((await ai(['stats', baseline, '--json'])).stdout);
		assert.equal(report.observations.initialStats.human_additions, 1);
		assert.equal(report.observations.initialStats.unknown_additions, 0);
		check('Git AI records the baseline addition as human in an available note');

		await writeFile(join(repo, 'sample.txt'), 'baseline\nai one\nai two\n');
		await ai(['checkpoint', 'mock_ai', 'sample.txt']);
		await ai(['await', '--timeout', '5']);
		await writeFile(join(repo, 'manual.txt'), 'human one\n');
		await ai(['checkpoint', 'mock_known_human', 'manual.txt']);
		await ai(['await', '--timeout', '5']);
		await git(['add', 'sample.txt', 'manual.txt'], repo, env);
		await writeFile(join(repo, 'sample.txt'), 'baseline\nai one\nai two\nunstaged one\n');
		const started = performance.now();
		await git(['commit', '-m', 'test: mixed partial commit'], repo, env);
		const sha = await output(['rev-parse', 'HEAD'], repo, env);
		report.observations.mixedNoteReadyMsAfterReturn = await until(() => noteExists(sha, repo, env));
		report.observations.commitAndReadinessMs = Math.round(performance.now() - started);
		const stats = JSON.parse((await ai(['stats', sha, '--json'])).stdout);
		assert.equal(stats.ai_additions, 2);
		assert.equal(stats.human_additions, 1);
		assert.equal(stats.git_diff_added_lines, 3);
		report.observations.mixedStats = stats;
		check('mixed attribution matches partial commit, excludes unstaged line');
		const snapshot = async () => ({
			treeAndParentsAuthor: await output(['show', '-s', '--format=%T%n%P%n%an%n%ae%n%aI', 'HEAD'], repo, env),
			index: await output(['ls-files', '--stage'], repo, env),
			staged: await output(['diff', '--cached', '--binary'], repo, env),
			unstaged: await output(['diff', '--binary'], repo, env),
			sample: await readFile(join(repo, 'sample.txt'), 'utf8'),
		});
		await writeFile(join(repo, 'staged.txt'), 'unrelated staging\n');
		await git(['add', 'staged.txt'], repo, env);
		const before = await snapshot();
		await writeFile(stateFile, JSON.stringify({
			status: 'pending',
			sha
		}));
		const annotation = await annotate(repo, sha, binary, env, stateFile);
		assert.deepEqual(await snapshot(), before);
		check('message-only amendment preserves tree, parents, author, index and working files');
		assert.deepEqual(JSON.parse((await ai(['stats', annotation.updated, '--json'])).stdout), stats);
		check('Git AI attribution survives amendment');
		const again = await annotate(repo, annotation.updated, binary, env, stateFile);
		assert.equal(again.updated, annotation.updated);
		check('repeated annotation keeps the same SHA');

		const hooks = join(root, 'custom hooks');
		await mkdir(hooks);
		await git(['config', 'core.hooksPath', hooks], repo, env);
		const hook = async (name, code) => writeFile(join(hooks, name), `#!/bin/sh\n${code}\n`, {
			mode: 0o755
		});
		await hook('post-commit', `"${binary}" await --timeout 1 > ${quote(join(root, 'inside-await.out'))} 2>&1\nprintf '%s' "$?" > ${quote(join(root, 'inside-await.code'))}`);
		await git(['commit', '--only', '--allow-empty', '-m', 'test: bounded synchronous hook'], repo, env);
		const hookSha = await output(['rev-parse', 'HEAD'], repo, env);
		report.observations.awaitInsidePostCommit = {
			code: await readFile(join(root, 'inside-await.code'), 'utf8'),
			output: await readFile(join(root, 'inside-await.out'), 'utf8')
		};
		assert.equal(report.observations.awaitInsidePostCommit.code, '1');
		assert.match(report.observations.awaitInsidePostCommit.output, /timed out/);
		check('bounded post-commit await measured', report.observations.awaitInsidePostCommit);
		await until(() => noteExists(hookSha, repo, env));
		const afterAwait = await ai(['await', '--timeout', '5'], true);
		assert.equal(afterAwait.code, 0);
		check('await succeeds after outer commit returns');
		await rm(join(hooks, 'post-commit'));
		const zero = JSON.parse((await ai(['stats', hookSha, '--json'])).stdout);
		report.observations.zeroStats = zero;
		assert.equal(zero.git_diff_added_lines, 0);
		await annotate(repo, hookSha, binary, env, stateFile);
		assert.match(await output(['show', '-s', '--format=%B', 'HEAD'], repo, env), /AI-Share-Added: N\/A/);
		check('zero-addition commit uses N/A');

		await hook('pre-commit', `printf 'existing-hook\\n' >> ${quote(join(root, 'existing-hook.log'))}`);
		await hook('pre-push', `exec ${quote(process.execPath)} ${quote(self)} --guard ${quote(stateFile)}`);
		await git(['commit', '--only', '--allow-empty', '-m', 'test: pending background annotation'], repo, env);
		const pending = await output(['rev-parse', 'HEAD'], repo, env);
		await writeFile(stateFile, JSON.stringify({
			status: 'pending',
			sha: pending
		}));
		const remote = join(root, 'remote.git');
		await git(['init', '--bare', remote], root, env);
		const gate = join(root, 'release-worker');
		const worker = spawn(process.execPath, [self, '--worker', repo, pending, binary, stateFile, gate], {
			cwd: root,
			env,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let workerError = '';

		worker.stderr.on('data', chunk => {
			workerError += chunk;
		});
		worker.stdout.resume();
		const workerDone = new Promise((resolve, reject) => {
			worker.on('error', reject);
			worker.on('close', code => resolve(code));
		});
		workers.push({
			child: worker,
			done: workerDone
		});
		const blocked = await git(['push', remote, 'HEAD:refs/heads/main'], repo, env, true);
		assert.notEqual(blocked.code, 0);
		assert.match(blocked.stderr, /Push blocked: pending/);
		assert.equal((await git(['--git-dir', remote, 'rev-parse', '--verify', 'refs/heads/main'], root, env, true)).code, 128);
		check('push while background worker is pending publishes nothing');
		await writeFile(gate, 'ready');
		assert.equal(await workerDone, 0, workerError);
		const ready = await output(['rev-parse', 'HEAD'], repo, env);
		await git(['push', remote, 'HEAD:refs/heads/main'], repo, env);
		assert.equal(await output(['--git-dir', remote, 'rev-parse', 'main'], root, env), ready);
		check('retry push publishes annotated SHA');
		const stale = await git(['push', remote, `${pending}:refs/heads/stale`], repo, env, true);
		assert.notEqual(stale.code, 0);
		assert.match(stale.stderr, /Push blocked/);
		assert.equal((await git(['--git-dir', remote, 'rev-parse', '--verify', 'refs/heads/stale'], root, env, true)).code, 128);
		check('explicit push of original SHA is blocked');
		assert((await readFile(join(root, 'existing-hook.log'), 'utf8')).includes('existing-hook'));
		check('existing pre-commit hook runs through commit and amendment');

		await writeFile(stateFile, JSON.stringify({
			status: 'failed',
			sha: ready
		}));
		const failedPush = await git(['push', remote, 'HEAD:refs/heads/failed'], repo, env, true);
		assert.equal(failedPush.code, 0);
		assert.match(failedPush.stderr, /Statistics were NOT calculated.*acs annotate/);
		assert.equal(await output(['--git-dir', remote, 'rev-parse', 'failed'], root, env), ready);
		check('failed annotation state permits publication with warning and retry command');
		const unchanged = await snapshot();
		await assert.rejects(annotate(repo, pending, binary, env, stateFile), /HEAD changed/);
		assert.deepEqual(await snapshot(), unchanged);
		check('stale expected HEAD fails without mutation');
		await annotate(repo, ready, binary, env, stateFile);
		check('explicit annotation retry clears failure');
		await git(['push', remote, 'HEAD:refs/heads/recovered'], repo, env);

		env.GIT_TRACE2_EVENT = '0';
		await writeFile(join(repo, 'missing-attribution.txt'), 'unattested addition\n');
		await git(['add', 'missing-attribution.txt'], repo, env);
		await git(['commit', '--only', '-m', 'test: absent attribution', 'missing-attribution.txt'], repo, env);
		const missing = await output(['rev-parse', 'HEAD'], repo, env);
		assert.equal(await noteExists(missing, repo, env), false);
		report.observations.missingNoteStats = JSON.parse((await ai(['stats', missing, '--json'])).stdout);
		assert.equal(report.observations.missingNoteStats.unknown_additions, 1);
		assert.equal(report.observations.missingNoteStats.human_additions, 0);
		assert.equal(await noteExists(missing, repo, env), false);
		check('successful statistics JSON with unknown additions does not prove attribution readiness');
		const beforeMissing = await snapshot();
		await assert.rejects(annotate(repo, missing, binary, env, stateFile), /attribution is unavailable.*acs annotate/);
		assert.equal(await output(['rev-parse', 'HEAD'], repo, env), missing);
		assert.deepEqual(await snapshot(), beforeMissing);
		check('missing attribution preserves commit and emits proposed recovery command');
		const bypass = await git(['push', '--no-verify', remote, 'HEAD:refs/heads/bypass'], repo, env);
		assert.equal(bypass.code, 0);
		assert.equal(await output(['--git-dir', remote, 'rev-parse', 'bypass'], root, env), missing);
		check('negative control: --no-verify bypasses hook protection');

		const key = join(root, 'signing-key');
		await run('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key], root, env);
		await git(['config', 'gpg.format', 'ssh'], repo, env);
		await git(['config', 'user.signingkey', key], repo, env);
		await git(['config', 'commit.gpgsign', 'true'], repo, env);
		env.GIT_TRACE2_EVENT = `af_unix:stream:${socket}`;
		await git(['commit', '--only', '--allow-empty', '-m', 'test: signing'], repo, env);
		const signed = await output(['rev-parse', 'HEAD'], repo, env);
		await until(() => noteExists(signed, repo, env));
		await annotate(repo, signed, binary, env, stateFile);
		assert.match(await output(['cat-file', 'commit', 'HEAD'], repo, env), /gpgsig -----BEGIN SSH SIGNATURE-----/);
		const allowed = join(root, 'allowed-signers');
		await writeFile(allowed, `experiment@example.invalid ${await readFile(`${key}.pub`, 'utf8')}`);
		await git(['-c', `gpg.ssh.allowedSignersFile=${allowed}`, 'verify-commit', 'HEAD'], repo, env);
		check('SSH signing configuration produces a verifiable amended signature');

		const cli = resolve(dirname(self), '../../dist/packages/cli/src/main.js');
		assert(existsSync(cli), 'Build the CLI first with pnpm build');

		const runCli = async (args, cwd = repo) => {
			const result = await run(process.execPath, [cli, ...args, '--repo', cwd, '--git-ai', binary, '--json'], cwd, env);

			return JSON.parse(result.stdout);
		};

		await git(['commit', '--only', '--allow-empty', '-m', 'test: core atomic signed annotation'], repo, env);
		const coreOriginal = await output(['rev-parse', 'HEAD'], repo, env);
		await until(() => noteExists(coreOriginal, repo, env));
		const beforeCore = await snapshot();
		const coreAnnotation = await runCli(['annotate', '--expected-head', coreOriginal]);
		assert.equal(coreAnnotation.ok, true);
		assert.notEqual(coreAnnotation.data.updated, coreOriginal);
		assert.deepEqual(await snapshot(), beforeCore);
		assert.deepEqual(JSON.parse((await ai(['stats', coreAnnotation.data.updated, '--json'])).stdout), JSON.parse((await ai(['stats', coreOriginal, '--json'])).stdout));
		await git(['-c', `gpg.ssh.allowedSignersFile=${allowed}`, 'verify-commit', coreAnnotation.data.updated], repo, env);
		const coreAgain = await runCli(['annotate', '--expected-head', coreAnnotation.data.updated]);
		assert.equal(coreAgain.data.updated, coreAnnotation.data.updated);
		assert.equal((await runCli(['status'])).data.jobs.length, 2);
		report.observations.coreAnnotation = {
			mechanism: 'commit-tree, copied and validated note, branch/state compare-and-swap transaction',
			preservedSnapshot: true,
			preservedStatistics: true,
			verifiedSshSignature: true,
			idempotent: true
		};
		check('compiled core preserves real Git AI attribution, staged/working files and verifiable signing with atomic annotation');

		const current = await output(['rev-parse', 'HEAD'], repo, env);
		const beforeInvalid = await snapshot();
		const stub = join(root, 'invalid-stats');
		const invalidCases = [
			{
				name: 'invalid JSON',
				body: 'console.log("not JSON");',
				error: /invalid statistics JSON/
			},
			{
				name: 'negative count',
				body: 'console.log(JSON.stringify({ai_additions:-1,human_additions:0,unknown_additions:0,git_diff_added_lines:0}));',
				error: /invalid statistics counts/
			},
			{
				name: 'inconsistent counts',
				body: 'console.log(JSON.stringify({ai_additions:1,human_additions:0,unknown_additions:0,git_diff_added_lines:0}));',
				error: /counts do not reconcile/
			},
			{
				name: 'subprocess failure',
				body: 'process.exitCode = 7;',
				error: /Git AI failed \(7\)/
			}
		];

		for (const scenario of invalidCases) {
			await writeFile(stub, `#!${process.execPath}\n${scenario.body}\n`, {
				mode: 0o755
			});
			await assert.rejects(annotate(repo, current, stub, env, stateFile), scenario.error);
			assert.equal(await output(['rev-parse', 'HEAD'], repo, env), current);
			assert.deepEqual(await snapshot(), beforeInvalid);
			assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).status, 'failed');
			check(`${scenario.name} preserves commit, index and working files`);
		}

		await annotate(repo, current, binary, env, stateFile);

		await git(['commit', '--only', '--allow-empty', '-m', 'test: selected push object'], repo, env);
		const selected = await output(['rev-parse', 'HEAD'], repo, env);
		await until(() => noteExists(selected, repo, env));
		await writeFile(stateFile, JSON.stringify({
			status: 'pending',
			sha: selected
		}));
		// Deliberately unsafe: wait for annotation, then allow the already-selected push.
		await hook('pre-push', `exec ${quote(process.execPath)} ${quote(self)} --worker ${quote(repo)} ${selected} ${quote(binary)} ${quote(stateFile)}`);
		const pushStarted = performance.now();
		const nestedPush = await git(['push', remote, 'HEAD:refs/heads/nested-readiness'], repo, env, true);
		assert.equal(nestedPush.code, 0, nestedPush.stderr);
		assert.notEqual(await output(['rev-parse', 'HEAD'], repo, env), selected);
		const nestedAmend = await output(['rev-parse', 'HEAD'], repo, env);
		await until(() => noteExists(nestedAmend, repo, env));
		assert.equal(await output(['--git-dir', remote, 'rev-parse', 'nested-readiness'], root, env), selected);
		assert.doesNotMatch(await output(['show', '-s', '--format=%B', selected], repo, env), /AI-Stats-Version/);
		report.observations.prePushAnnotation = {
			workerTraceRoot: 'independent; GIT_TRACE2_PARENT_SID removed',
			pushAndAnnotationMs: Math.round(performance.now() - pushStarted),
			publishedOriginalSha: true,
			amendedNoteAvailable: true
		};
		check('negative control: annotation and readiness inside pre-push still publish the previously selected SHA');
		await hook('pre-push', `exec ${quote(process.execPath)} ${quote(self)} --guard ${quote(stateFile)}`);
		await annotate(repo, nestedAmend, binary, env, stateFile);

		const filteredRepo = join(root, 'filtered repo');
		await mkdir(filteredRepo);
		await git(['init', '-b', 'main'], filteredRepo, env);
		await git(['config', 'user.name', 'ACS Experiment'], filteredRepo, env);
		await git(['config', 'user.email', 'experiment@example.invalid'], filteredRepo, env);
		await writeFile(join(filteredRepo, '.git-ai-ignore'), 'custom.txt\n');
		await writeFile(join(filteredRepo, '.gitattributes'), 'attribute.txt linguist-generated=true\n');
		await git(['add', '.'], filteredRepo, env);
		await git(['commit', '-m', 'test: filtering baseline'], filteredRepo, env);
		const filterBaseline = await output(['rev-parse', 'HEAD'], filteredRepo, env);
		await until(() => noteExists(filterBaseline, filteredRepo, env));

		const aiFiles = ['visible.txt', 'explicit.txt', 'package-lock.json', 'custom.txt', 'attribute.txt'];

		for (const file of aiFiles) {
			await writeFile(join(filteredRepo, file), 'ai one\nai two\n');
		}

		await run(binary, ['checkpoint', 'mock_ai', ...aiFiles], filteredRepo, env);
		await run(binary, ['await', '--timeout', '5'], filteredRepo, env);
		await writeFile(join(filteredRepo, 'human.txt'), 'human one\n');
		await run(binary, ['checkpoint', 'mock_known_human', 'human.txt'], filteredRepo, env);
		await run(binary, ['await', '--timeout', '5'], filteredRepo, env);
		await writeFile(join(filteredRepo, 'unknown.txt'), 'unattested one\n');
		await git(['add', '.'], filteredRepo, env);
		await git(['commit', '-m', 'test: effective filters'], filteredRepo, env);
		const filteredSha = await output(['rev-parse', 'HEAD'], filteredRepo, env);
		await until(() => noteExists(filteredSha, filteredRepo, env));
		const filteredStats = JSON.parse((await run(binary, ['stats', filteredSha, '--json'], filteredRepo, env)).stdout);
		assert.equal(filteredStats.ai_additions, 4);
		assert.equal(filteredStats.human_additions, 2);
		assert.equal(filteredStats.unknown_additions, 0);
		assert.equal(filteredStats.git_diff_added_lines, 6);
		const explicitStats = JSON.parse((await run(binary, ['stats', filteredSha, '--json', '--ignore', 'explicit.txt'], filteredRepo, env)).stdout);
		assert.equal(explicitStats.ai_additions, 2);
		assert.equal(explicitStats.git_diff_added_lines, 4);
		report.observations.filteredStats = filteredStats;
		report.observations.explicitIgnoreStats = explicitStats;
		check('default, repository, gitattributes and explicit filters reconcile numerator and denominator');
		const coreFiltered = await runCli(['annotate', '--expected-head', filteredSha], filteredRepo);
		assert.equal(coreFiltered.ok, true);
		assert.equal(coreFiltered.data.stats.ai_additions, 4);
		assert.equal(coreFiltered.data.stats.human_additions, 2);
		assert.equal(coreFiltered.data.stats.git_diff_added_lines, 6);
		assert.equal(coreFiltered.data.shareAdded, '66.67%');
		assert.deepEqual(JSON.parse((await run(binary, ['stats', coreFiltered.data.updated, '--json'], filteredRepo, env)).stdout), filteredStats);
		check('compiled core copies mixed filtered attribution to its replacement without changing statistics');

		const worktree = join(root, 'linked worktree');
		const beforeWorktree = await snapshot();
		await git(['worktree', 'add', '-b', 'linked', worktree, 'HEAD'], repo, env);
		await writeFile(join(worktree, 'linked.txt'), 'worktree addition\n');
		await git(['add', 'linked.txt'], worktree, env);
		await git(['commit', '-m', 'test: linked worktree'], worktree, env);
		const linkedSha = await output(['rev-parse', 'HEAD'], worktree, env);
		await until(() => noteExists(linkedSha, worktree, env));
		await git(['push', remote, 'HEAD:refs/heads/worktree-bypass'], worktree, env);
		assert.equal(await output(['--git-dir', remote, 'rev-parse', 'worktree-bypass'], root, env), linkedSha);
		assert.doesNotMatch(await output(['show', '-s', '--format=%B', linkedSha], worktree, env), /AI-Stats-Version/);
		check('negative control: main-worktree state does not protect an untracked linked-worktree commit');
		const linkedTree = await output(['rev-parse', 'HEAD^{tree}'], worktree, env);
		const linkedState = join(root, 'linked-state.json');
		const linkedAnnotation = await annotate(worktree, linkedSha, binary, env, linkedState);
		assert.equal(await output(['rev-parse', 'HEAD^{tree}'], worktree, env), linkedTree);
		assert.notEqual(linkedAnnotation.updated, linkedSha);
		assert.deepEqual(await snapshot(), beforeWorktree);
		check('linked-worktree annotation preserves its tree and the main worktree');

		await git(['commit', '--only', '--allow-empty', '-m', 'test: race target'], repo, env);
		const raceTarget = await output(['rev-parse', 'HEAD'], repo, env);
		await until(() => noteExists(raceTarget, repo, env));
		let concurrent;
		const race = await annotate(repo, raceTarget, binary, env, stateFile, async () => {
			await writeFile(join(repo, 'concurrent.txt'), 'concurrent addition\n');
			await git(['add', 'concurrent.txt'], repo, env);
			await git(['commit', '--only', '-m', 'test: concurrent commit', 'concurrent.txt'], repo, env);
			concurrent = await output(['rev-parse', 'HEAD'], repo, env);
			await until(() => noteExists(concurrent, repo, env));
		});
		assert.equal(await output(['rev-parse', `${race.updated}^{tree}`], repo, env), await output(['rev-parse', `${concurrent}^{tree}`], repo, env));
		assert.match(await output(['show', '-s', '--format=%B', 'HEAD'], repo, env), /test: race target/);
		assert.equal(race.stats.git_diff_added_lines, 0);
		assert.equal(JSON.parse((await ai(['stats', race.updated, '--json'])).stdout).git_diff_added_lines, 1);
		check('negative control: HEAD movement after final check amends the wrong commit with stale statistics');

		env.GIT_TRACE2_EVENT = '0';
		await git(['commit', '--only', '--allow-empty', '-m', 'test: first unannotated commit'], repo, env);
		const firstPending = await output(['rev-parse', 'HEAD'], repo, env);
		await writeFile(stateFile, JSON.stringify({
			status: 'pending',
			sha: firstPending
		}));
		await git(['commit', '--only', '--allow-empty', '-m', 'test: second unannotated commit'], repo, env);
		const secondPending = await output(['rev-parse', 'HEAD'], repo, env);
		await writeFile(stateFile, JSON.stringify({
			status: 'pending',
			sha: secondPending
		}));
		await git(['push', remote, `${firstPending}:refs/heads/forgotten-pending`], repo, env);
		assert.equal(await output(['--git-dir', remote, 'rev-parse', 'forgotten-pending'], root, env), firstPending);
		assert.doesNotMatch(await output(['show', '-s', '--format=%B', firstPending], repo, env), /AI-Stats-Version/);
		check('negative control: replacing a single state entry allows an earlier pending SHA to be published');
		const multiBlocked = await git(['push', remote, 'HEAD:refs/heads/latest-pending'], repo, env, true);
		assert.notEqual(multiBlocked.code, 0);
		assert.match(multiBlocked.stderr, /Push blocked: pending/);
		check('single-entry guard still blocks the latest pending commit');

		await ai(['bg', 'shutdown']);
		await until(() => Promise.resolve(daemonClosed));
		const unavailable = await ai(['await', '--timeout', '1'], true);
		assert.notEqual(unavailable.code, 0);
		check('daemon unavailability is reported as a failure');
		const beforeTimeout = await snapshot();
		const timeoutWorker = spawn(process.execPath, [self, '--worker', repo, secondPending, binary, stateFile, '', '250'], {
			cwd: root,
			env,
			stdio: ['ignore', 'ignore', 'pipe']
		});
		let timeoutError = '';

		timeoutWorker.stderr.on('data', chunk => {
			timeoutError += chunk;
		});
		const timeoutDone = new Promise((resolve, reject) => {
			timeoutWorker.once('error', reject);
			timeoutWorker.once('close', code => resolve(code));
		});
		workers.push({
			child: timeoutWorker,
			done: timeoutDone
		});
		assert.equal(await timeoutDone, 1);
		assert.match(timeoutError, /within 250ms.*acs annotate/);
		assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).status, 'failed');
		assert.equal(await output(['rev-parse', 'HEAD'], repo, env), secondPending);
		assert.deepEqual(await snapshot(), beforeTimeout);
		check('worker readiness timeout records failure, preserves commit and provides recovery');
		report.observations.limitations = [
			'Negative controls reproduce non-atomic amendment, forgotten earlier pending commits, linked-worktree coverage gaps and --no-verify bypass.',
			'Strict publication protection is not established; this prototype must not be installed as production automation.',
			'Test-support debug build and mock checkpoints do not prove installed release or embedded-agent compatibility.',
			'Workers run under the harness or a synchronous research hook, not as installed detached post-commit workers.',
			'SSH signing with a temporary unencrypted key is tested; GPG, hardware keys and interactive signing are not.'
		];
		report.status = 'passed';
	} catch (error) {
		console.error(daemonLog);
		failure = error;
		report.status = 'failed';
		report.error = error.message.replaceAll(root, '<temporary-root>');
	} finally {
		for (const { child } of workers) {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill('SIGKILL');
			}
		}

		await Promise.all(workers.map(worker => worker.done));

		if (daemon) {
			if (!daemonClosed) {
				await run(binary, ['bg', 'shutdown'], root, env, true, 7000);

				try {
					await until(() => Promise.resolve(daemonClosed), 7000);
				} catch {
					daemon.kill('SIGKILL');
				}
			}

			await daemonDone;
		}

		for (const { path, content } of beforeGlobals) {
			if (content === null) {
				assert.equal(existsSync(path), false, 'Global configuration or identity file was created');
			} else {
				assert.deepEqual(await readFile(path), content, 'Global configuration or identity changed');
			}
		}

		check('owned processes stopped; global Git and Git AI configuration and identity unchanged');
		await rm(root, {
			recursive: true,
			force: true
		});
	}

	report.completedAt = new Date().toISOString();
	// Keep bounded timing evidence without publishing temporary absolute paths.
	report.observations.daemonLogTail = daemonLog
		.replaceAll(`/private${root}`, '<temporary-root>')
		.replaceAll(root, '<temporary-root>');

	if (process.argv[3]) {
		await writeFile(resolve(process.argv[3]), `${JSON.stringify(report, null, 2)}\n`);
	}

	if (failure) {
		throw failure;
	}

	console.log(`${report.checks.length} experiment checks completed.`);
}
