import { spawn } from 'node:child_process';

export class AcsError extends Error {
	constructor(public readonly code: string, message: string, public readonly retry?: string, options?: ErrorOptions) {
		super(message, options);
	}
}

export interface ProcessResult {
	stdout: string;
	stdoutBytes: Buffer;
	stderr: string;
	code: number | null;
	signal: NodeJS.Signals | null;
}

export interface ProcessOptions {
	cwd: string;
	env?: NodeJS.ProcessEnv;
	input?: string;
	timeoutMs?: number;
}

export function run(binary: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(binary, args, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			shell: false,
			detached: process.platform !== 'win32',
			stdio: ['pipe', 'pipe', 'pipe']
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let size = 0;
		let failure: Error | undefined;

		const stop = (reason: Error) => {
			if (failure) {
				return;
			}

			failure = reason;

			if (child.pid) {
				try {
					// Signing helpers share this group; stop them along with Git on timeout.
					if (process.platform === 'win32') {
						child.kill('SIGKILL');
					} else {
						process.kill(-child.pid, 'SIGKILL');
					}
				} catch (error) {
					if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
						failure = new AggregateError([reason, error], 'Subprocess termination failed');
					}
				}
			}
		};

		const collect = (chunks: Buffer[], chunk: Buffer) => {
			size += chunk.length;

			if (size > 2 ** 20) {
				stop(new AcsError('OUTPUT_LIMIT', `${binary} exceeded the 1 MiB output limit`));
			} else {
				chunks.push(chunk);
			}
		};

		const timer = setTimeout(() => stop(new AcsError('TIMEOUT', `${binary} timed out`)), options.timeoutMs ?? 10000);
		const interrupt = () => stop(new AcsError('INTERRUPTED', `${binary} was interrupted`));
		process.on('SIGINT', interrupt);
		process.on('SIGTERM', interrupt);
		child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
		child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
		child.once('error', error => {
			failure = new AcsError('SPAWN_FAILED', `Cannot start ${binary}: ${error.message}`, undefined, {
				cause: error
			});
		});
		child.stdin.on('error', error => {
			if (!('code' in error && error.code === 'EPIPE')) {
				stop(error);
			}
		});
		child.once('close', (code, signal) => {
			clearTimeout(timer);
			process.off('SIGINT', interrupt);
			process.off('SIGTERM', interrupt);

			if (failure) {
				reject(failure);
			} else {
				const stdoutBytes = Buffer.concat(stdout);

				resolve({
					stdout: stdoutBytes.toString('utf8'),
					stdoutBytes,
					stderr: Buffer.concat(stderr).toString('utf8'),
					code,
					signal
				});
			}
		});
		child.stdin.end(options.input);
	});
}

export async function checked(binary: string, args: string[], options: ProcessOptions): Promise<string> {
	const result = await run(binary, args, options);

	if (result.code !== 0) {
		throw new AcsError('SUBPROCESS_FAILED', `${binary} ${args[0] ?? ''} failed (${result.code ?? result.signal}): ${result.stderr.trim()}`);
	}

	return new TextDecoder('utf-8', {
		fatal: true
	}).decode(result.stdoutBytes);
}
