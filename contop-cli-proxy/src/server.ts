import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { RequestPacer } from './request-pacer.js';
import {
  toOpenAIResponse,
  toOpenAIStreamChunk,
} from './openai-adapter.js';
import type { ISession, OpenAIMessage, OpenAITool } from './types.js';
import { logParsedResult } from './llm-logger.js';

// ── Proxy Server ────────────────────────────────────────────────────

/**
 * Creates and returns an Express server that serves an OpenAI-compatible
 * API backed by a CLI session manager.
 *
 * Endpoints:
 * - POST /v1/chat/completions — chat completion (streaming + non-streaming)
 * - GET  /v1/models           — list available models
 * - GET  /health              — session health check
 */
export function createServer(
  session: ISession,
  workspace: string,
): express.Application {
  const app = express();
  const pacer = new RequestPacer();

  // Middleware
  app.use(express.json({ limit: '10mb' }));

  // CORS
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Request logging
  app.use((req, _res, next) => {
    console.log(`[http] ${req.method} ${req.path}`);
    next();
  });

  // ── POST /v1/chat/completions ───────────────────────────────────

  app.post('/v1/chat/completions', async (req: Request, res: Response) => {
    try {
      const { messages, stream, model: requestedModel, tools, effort } = req.body as {
        messages?: OpenAIMessage[];
        stream?: boolean;
        model?: string;
        tools?: OpenAITool[];
        effort?: string;
      };

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({
          error: {
            message: 'messages array is required and must not be empty',
            type: 'invalid_request_error',
            code: 'invalid_messages',
          },
        });
        return;
      }

      // F7: Per-message content size guard (500KB max per message)
      const MAX_MESSAGE_BYTES = 512_000;
      for (const msg of messages) {
        if (msg.content && msg.content.length > MAX_MESSAGE_BYTES) {
          res.status(400).json({
            error: {
              message: `Message content exceeds maximum size (${MAX_MESSAGE_BYTES} bytes)`,
              type: 'invalid_request_error',
              code: 'content_too_large',
            },
          });
          return;
        }
      }

      if (!session.isAlive()) {
        res.status(503).json({
          error: {
            message: `${session.getProvider().displayName} session is not active. Check /health for details.`,
            type: 'server_error',
            code: 'session_unavailable',
          },
        });
        return;
      }

      // Pace the request
      await pacer.pace();

      const model = requestedModel || session.getModel();

      if (stream) {
        // ── SSE Streaming ─────────────────────────────────────────
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        const chunkId = `chatcmpl-${randomUUID()}`;
        const hasTools = !!(tools && tools.length > 0);

        try {
          if (hasTools) {
            // ── Tool-call mode: buffer full response, emit proper tool_calls chunk ──
            // The CLI returns {"tool_call":...} JSON as text — toOpenAIResponse parses
            // it into tool_calls.  We can't do that inline per text_delta, so we let
            // sendMessageStreaming accumulate everything, then emit a single SSE turn.
            const cliResponse = await session.sendMessageStreaming(
              messages, () => { /* buffering — no per-event SSE */ }, tools, effort, requestedModel,
            );
            const openaiResponse = toOpenAIResponse(cliResponse, model);
            const choice = openaiResponse.choices[0];

            // ── LLM Logger: log parsed result ──
            logParsedResult({
              finishReason: choice.finish_reason,
              content: choice.message.content,
              toolCalls: choice.message.tool_calls,
            });

            if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
              // Emit one chunk declaring the tool call(s) with complete arguments
              const toolCallsChunk = {
                id: chunkId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{
                  index: 0,
                  delta: {
                    role: 'assistant',
                    content: null,
                    tool_calls: choice.message.tool_calls.map((tc, i) => ({
                      index: i,
                      id: tc.id,
                      type: tc.type,
                      function: tc.function,
                    })),
                  },
                  finish_reason: 'tool_calls',
                }],
              };
              res.write(`data: ${JSON.stringify(toolCallsChunk)}\n\n`);
            } else if (choice.message.content) {
              // No tool call — stream as a regular text chunk
              res.write(`data: ${JSON.stringify({
                id: chunkId, object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000), model,
                choices: [{ index: 0, delta: { content: choice.message.content }, finish_reason: 'stop' }],
              })}\n\n`);
            }
          } else {
            // ── Normal streaming ────────────────────────────────────────────────
            await session.sendMessageStreaming(messages, (event) => {
              const chunk = toOpenAIStreamChunk(
                event, model, session.getProvider(), chunkId,
              );
              if (chunk) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }, tools, effort, requestedModel);
          }
        } catch (err) {
          // Write error as SSE event
          const errorChunk = {
            id: chunkId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{
              index: 0,
              delta: { content: `\n\n[Error: ${(err as Error).message}]` },
              finish_reason: 'stop',
            }],
          };
          res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
        }

        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        // ── Non-streaming ─────────────────────────────────────────
        const response = await session.sendMessage(messages, tools, effort, requestedModel);
        const openaiResponse = toOpenAIResponse(response, model);
        // ── LLM Logger: log parsed result ──
        const nsc = openaiResponse.choices[0];
        if (nsc) {
          logParsedResult({
            finishReason: nsc.finish_reason,
            content: nsc.message.content,
            toolCalls: nsc.message.tool_calls,
          });
        }
        res.json(openaiResponse);
      }
    } catch (err) {
      console.error('[http] Chat completion error:', (err as Error).message);
      res.status(500).json({
        error: {
          message: (err as Error).message,
          type: 'server_error',
          code: 'internal_error',
        },
      });
    }
  });

  // ── GET /v1/models ──────────────────────────────────────────────

  app.get('/v1/models', (_req: Request, res: Response) => {
    const provider = session.getProvider();
    const models = provider.models.map((id) => ({
      id,
      object: 'model' as const,
      created: Math.floor(Date.now() / 1000),
      owned_by: provider.displayName.toLowerCase().replace(/\s+/g, '-'),
    }));

    res.json({
      object: 'list',
      data: models,
    });
  });

  // ── GET /health ─────────────────────────────────────────────────

  app.get('/health', (_req: Request, res: Response) => {
    const provider = session.getProvider();
    res.json({
      status: session.isAlive() ? 'ok' : 'degraded',
      provider: provider.displayName,
      provider_key: provider.binary,
      session_active: session.isAlive(),
      session_id: session.getSessionId(),
      resume_session_id: session.getResumeSessionId() || null,
      model: session.getModel(),
      workspace,
    });
  });

  // ── 404 catch-all ───────────────────────────────────────────────

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        message: `Unknown endpoint: ${_req.method} ${_req.path}`,
        type: 'invalid_request_error',
        code: 'unknown_endpoint',
      },
    });
  });

  return app;
}
