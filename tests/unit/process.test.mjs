import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { run } from '../../dist/packages/core/src/process.js';

test('subprocess arguments are literal and nonzero exit is observable', async () => {
	const value = '`touch unexpected` $(touch unexpected) spaces';
	const result = await run(process.execPath, ['-e', 'console.log(process.argv[1]); process.exitCode = 7;', value], {
		cwd: process.cwd()
	});
	assert.equal(result.code, 7);
	assert.equal(result.stdout.trim(), value);
});

test('spawn failure settles with an actionable error', async () => {
	await assert.rejects(run('/nonexistent/acs-executable', [], {
		cwd: process.cwd()
	}), /Cannot start/);
});

test('timeout stops the subprocess and closes its streams', async () => {
	await assert.rejects(run(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
		cwd: process.cwd(),
		timeoutMs: 100
	}), /timed out/);
});

test('interruption stops the active subprocess and lets its owner finish cleanup', async () => {
	const module = new URL('../../dist/packages/core/src/process.js', import.meta.url).href;
	const source = `
const { run } = await import(${JSON.stringify(module)});
const operation = run(process.execPath, ['-e', 'setTimeout(() => {}, 1000);'], { cwd: process.cwd() });
console.log('ready');
try { await operation; } catch (error) { console.log(error.code); }
`;
	const worker = spawn(process.execPath, ['--input-type=module', '-e', source], {
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let stdout = '';
	let stderr = '';
	let interrupted = false;
	worker.stdout.on('data', chunk => {
		stdout += chunk;

		if (stdout.includes('ready') && !interrupted) {
			interrupted = true;
			worker.kill('SIGTERM');
		}
	});
	worker.stderr.on('data', chunk => {
		stderr += chunk;
	});
	const code = await new Promise((resolve, reject) => {
		worker.once('error', reject);
		worker.once('close', resolve);
	});
	assert.equal(code, 0, stderr);
	assert.match(stdout, /INTERRUPTED/);
});
