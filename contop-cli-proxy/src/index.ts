#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { getProvider, getSupportedProviders } from './providers/index.js';
import { SessionManager } from './session-manager.js';
import { CodexDirectSession } from './codex-direct-session.js';
import { createServer } from './server.js';
import type { ISession } from './types.js';

// ── Default ports per provider ──────────────────────────────────────

const DEFAULT_PORTS: Record<string, number> = {
  claude: 3456,
  gemini: 3457,
  codex: 3458,
};

// ── CLI Entry Point ─────────────────────────────────────────────────

const program = new Command();

program
  .name('contop-cli-proxy')
  .description(
    'Unified persistent session proxy for Claude, Gemini & Codex CLIs.\n' +
    'Exposes an OpenAI-compatible API backed by the official CLI binary.',
  )
  .version('0.1.0')
  .requiredOption(
    '--provider <name>',
    `LLM provider CLI to proxy (${getSupportedProviders().join(', ')})`,
  )
  .option(
    '-p, --port <number>',
    'HTTP port (default: 3456/claude, 3457/gemini, 3458/codex)',
  )
  .option(
    '-w, --workspace <dir>',
    'Workspace directory for CLI context',
    process.cwd(),
  )
  .option(
    '-m, --model <model>',
    'Model override (default: provider\'s default model)',
  )
  .action(async (opts) => {
    const providerName = opts.provider as string;
    const workspace = resolve(opts.workspace as string);
    const model = opts.model as string | undefined;

    // ── Validate provider ─────────────────────────────────────────
    let provider;
    try {
      provider = getProvider(providerName);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }

    // ── Validate workspace ────────────────────────────────────────
    if (!existsSync(workspace)) {
      console.error(`❌ Workspace directory does not exist: ${workspace}`);
      process.exit(1);
    }

    // ── Check CLI binary is installed (skip for codex/openai — uses direct API) ──
    const isCodex = providerName === 'codex' || providerName === 'openai';
    if (!isCodex) {
      try {
        execSync(`${provider.binary} --version`, {
          stdio: 'pipe',
          timeout: 3000,
        });
      } catch {
        console.error(
          `❌ CLI binary "${provider.binary}" not found.\n` +
          `   Install it first — see README.md for setup instructions.`,
        );
        process.exit(1);
      }
    }

    // ── Resolve port ──────────────────────────────────────────────
    const port = opts.port
      ? parseInt(opts.port as string, 10)
      : DEFAULT_PORTS[providerName] || 3456;

    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(`❌ Invalid port: ${opts.port}`);
      process.exit(1);
    }

    // ── Start session ─────────────────────────────────────────────
    const session: ISession = isCodex
      ? new CodexDirectSession(model)
      : new SessionManager(provider, workspace, undefined, model);

    console.log('');
    console.log('┌──────────────────────────────────────────────┐');
    console.log('│          contop-cli-proxy                    │');
    console.log('└──────────────────────────────────────────────┘');
    console.log('');
    console.log(`  Provider:   ${provider.displayName}`);
    console.log(`  Model:      ${model || provider.defaultModel}`);
    console.log(`  Port:       ${port}`);
    console.log(`  Workspace:  ${workspace}`);
    console.log('');
    console.log('  Starting CLI session...');

    try {
      await session.start();
    } catch (err) {
      console.error(`\n❌ Failed to start ${session.getProvider().displayName} session:`);
      console.error(`   ${(err as Error).message}`);
      console.error(
        `\n   Make sure ${session.getProvider().binary} is authenticated.` +
        `\n   Run "${session.getProvider().binary}" interactively first to complete auth.`,
      );
      process.exit(1);
    }

    console.log(`  Session ID: ${session.getSessionId()}`);
    console.log('');

    // ── Start HTTP server ─────────────────────────────────────────
    const app = createServer(session, workspace);

    const server = app.listen(port, () => {
      console.log(`  ✅ Proxy ready at http://localhost:${port}`);
      console.log('');
      console.log('  Endpoints:');
      console.log(`    POST http://localhost:${port}/v1/chat/completions`);
      console.log(`    GET  http://localhost:${port}/v1/models`);
      console.log(`    GET  http://localhost:${port}/health`);
      console.log('');
      console.log('  Press Ctrl+C to stop.');
      console.log('');
    });

    // ── Graceful shutdown (guarded against double-fire) ──────────
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log('\n  Shutting down...');
      session.destroy();
      server.close(() => {
        console.log('  ✅ Shutdown complete.');
        process.exit(0);
      });
      // Force exit after 5s
      setTimeout(() => process.exit(0), 5000);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program.parse();
