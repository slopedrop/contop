import { randomUUID } from 'node:crypto';
import type {
  NdjsonEvent,
  CliResponse,
  OpenAIMessage,
  OpenAIChatCompletion,
  OpenAIChunk,
  OpenAITool,
  OpenAIToolCall,
} from './types.js';
import type { ProviderConfig } from './providers/base.js';

// ── OpenAI-compatible Format Adapter ────────────────────────────────

/**
 * Converts between OpenAI chat completion format and CLI NDJSON events.
 * This is the translation layer that makes the proxy compatible with
 * any tool expecting OpenAI's API format.
 */

/**
 * Collapse OpenAI messages into a single prompt string for the CLI.
 * System messages are prepended, then user/assistant messages in order.
 *
 * When `tools` are provided the caller has set --tools "" on the CLI
 * process so Claude Code cannot run any tools itself.  We inject a brief
 * response-format instruction so Claude returns structured JSON for tool
 * calls, which the proxy parses back into OpenAI tool_calls format.
 */
export function toCliMessage(messages: OpenAIMessage[], tools?: OpenAITool[]): string {
  const parts: string[] = [];

  if (tools && tools.length > 0) {
    // Skip <available_functions> for execution agent (28+ tools) — its system
    // prompt already describes every tool in detail. Listing them again wastes
    // ~500 tokens per iteration (4-8 iterations per turn = 2-4K wasted tokens).
    // Conversation agent (4 classification tools) still gets the listing since
    // those tools aren't described elsewhere in the prompt.
    const includeToolList = tools.length <= 10;

    let instructionBlock =
      '<instructions>\n' +
      'I am building a desktop automation script. I need you to generate the next JSON function call based on the conversation history below.\n\n';

    if (includeToolList) {
      const toolList = tools
        .map((t) => `  - ${t.function.name}${t.function.description ? ': ' + t.function.description : ''}`)
        .join('\n');
      instructionBlock +=
        '<available_functions>\n' +
        toolList + '\n' +
        '</available_functions>\n\n';
    }

    instructionBlock +=
      '<json_format>\n' +
      'When a function call is needed:\n' +
      '{"tool_call":{"name":"<function_name>","arguments":<args_object>}}\n\n' +
      'When NO function call is needed (task complete, greeting, question, or conversation):\n' +
      '{"tool_call":null,"response":"<your natural language reply>"}\n' +
      '</json_format>\n\n' +
      '<rules>\n' +
      '1. Your ENTIRE response must be a single JSON object on one line. No text before or after.\n' +
      '2. Return ONE function call per response. I will run it and give you the result, then you decide the next step.\n' +
      '3. NEVER simulate, fabricate, or predict function results. NEVER narrate what you "would" do.\n' +
      '4. NEVER output multiple function calls or chain steps in one response.\n' +
      '</rules>\n' +
      '</instructions>';

    parts.push(instructionBlock);
  }

  // Build conversation history with numbered turns, clear role tags,
  // and XML-style separators so the model can parse context reliably.
  const history: string[] = [];
  let turnNum = 0;
  for (const msg of messages) {
    switch (msg.role) {
      case 'system':
        parts.push(`<system_context>\n${msg.content}\n</system_context>`);
        break;
      case 'user':
        turnNum++;
        history.push(`<turn n="${turnNum}" role="user">\n${msg.content || ''}\n</turn>`);
        break;
      case 'assistant':
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            turnNum++;
            history.push(`<turn n="${turnNum}" role="assistant_tool_call">\n${tc.function.name}(${tc.function.arguments})\n</turn>`);
          }
        } else if (msg.content) {
          turnNum++;
          history.push(`<turn n="${turnNum}" role="assistant">\n${msg.content}\n</turn>`);
        }
        break;
      case 'tool':
        turnNum++;
        history.push(`<turn n="${turnNum}" role="tool_result" tool="${msg.name || msg.tool_call_id}">\n${msg.content}\n</turn>`);
        break;
    }
  }

  if (history.length > 0) {
    parts.push('<conversation_history>\n' + history.join('\n') + '\n</conversation_history>');
  }

  return parts.filter(Boolean).join('\n\n');
}

/**
 * Convert a completed CLI response into an OpenAI chat completion response.
 *
 * When the CLI proxy is running in tool-calling mode (--tools "" + response
 * format instruction), Claude returns {"tool_call":{...}} JSON instead of
 * native tool_use events.  Scan the response text for that pattern and
 * convert it to a proper OpenAI tool_calls entry for the ADK agent loop.
 */
export function toOpenAIResponse(
  response: CliResponse,
  model: string,
): OpenAIChatCompletion {
  // Parse injected-format tool_call JSON anywhere in the response text.
  // The model responds in one of two formats:
  //   {"tool_call":{"name":"...","arguments":{...}}}  — action needed
  //   {"tool_call":null,"response":"..."}              — plain text reply
  // Claude may wrap it in explanation text, so scan all lines.
  if (response.toolCalls.length === 0) {
    // DEBUG: log raw response so we can diagnose parse failures
    console.log(`[adapter] toOpenAIResponse raw text (${response.text.length} chars, ${response.text.split('\n').length} lines):\n${response.text.slice(0, 500)}${response.text.length > 500 ? '...[truncated]' : ''}`);
    const lines = response.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      // Strip markdown code fences the model may wrap around the JSON
      const trimmed = lines[i].trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      // Find {"tool_call": anywhere in the line — the model may prepend
      // reasoning text before the JSON (e.g. "I'll check... {"tool_call":...}")
      const jsonIdx = trimmed.indexOf('{"tool_call":');
      if (jsonIdx === -1) continue;
      // Extract just the first complete JSON object using brace counting.
      // The model may duplicate output (e.g. {"tool_call":...}{"tool_call":...})
      // and JSON.parse fails on concatenated objects.
      const fullRemainder = trimmed.slice(jsonIdx);
      let jsonPart = fullRemainder;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let c = 0; c < fullRemainder.length; c++) {
        const ch = fullRemainder[c];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            jsonPart = fullRemainder.slice(0, c + 1);
            break;
          }
        }
      }

      // Build parse candidates: the substring from {"tool_call": onwards,
      // plus multi-line join if the JSON spans multiple lines.
      const candidates = [
        jsonPart,
        // Multi-line JSON: join remaining lines until we find valid JSON
        ...(() => {
          const remaining = [jsonPart];
          for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
            const cleaned = lines[j].trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
            remaining.push(cleaned);
            const joined = remaining.join(' ');
            // If the accumulated string ends with } and balances, it's a candidate
            if (joined.endsWith('}')) remaining.push(joined);
          }
          const joined = [jsonPart, ...lines.slice(i + 1, Math.min(i + 20, lines.length))
            .map(l => l.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim())]
            .join(' ');
          return [joined];
        })(),
      ];

      for (const candidate of candidates) {
        // Two-pass parse: try raw first, then apply repair for doubled-quote issues.
        // Repair MUST NOT run first — it corrupts valid JSON that contains escaped
        // quotes before terminators, e.g. -name \".env\""}}  (Issue #cli-proxy-parser)
        const attempts = [
          candidate,
          // Repair pass: fix doubled-quote issues from models that double-escape
          // e.g. echo 'done'""}}} → echo 'done'"}}}
          // Only fix "" that is NOT preceded by \ (which would be valid \" escape)
          candidate
            .replace(/(?<!\\)""{/g, '"{')
            .replace(/(?<!\\)""}/g, '"}')
            .replace(/(?<!\\)""(\s*[},\]])/g, '"$1'),
        ];

        for (const jsonStr of attempts) {
          try {
            const parsed = JSON.parse(jsonStr) as {
              tool_call: { name: string; arguments: Record<string, unknown> } | null;
              response?: string;
            };
            if (parsed.tool_call === null) {
              // No tool needed — extract the natural language response
              response.text = parsed.response || lines.slice(0, i).join('\n').trim() || '';
              return buildCompletion(response, model);
            }
            response.toolCalls.push({
              id: `call_${randomUUID().slice(0, 8)}`,
              name: parsed.tool_call.name,
              arguments: parsed.tool_call.arguments,
            });
            // Keep only text BEFORE the tool call JSON — discard everything after
            // (fabricated results, subsequent fake tool calls) so they don't
            // corrupt the ADK conversation history on the next turn.
            response.text = lines.slice(0, i).join('\n').trim();
            return buildCompletion(response, model);
          } catch { /* try next attempt/candidate */ }
        }
      }
      // All parse candidates failed — log for debugging
      console.warn(`[adapter] Found {"tool_call":... on line ${i} but all ${candidates.length} parse candidates failed. Line: ${lines[i].slice(0, 200)}`);
    }
    // No tool_call JSON found at all (or parse failed) — passing raw text through
    console.log(`[adapter] No tool_call JSON parsed — returning raw text as content`);
  }

  return buildCompletion(response, model);
}

function buildCompletion(response: CliResponse, model: string): OpenAIChatCompletion {
  const hasToolCalls = response.toolCalls.length > 0;

  const message: OpenAIMessage = {
    role: 'assistant',
    content: response.text || null,
  };

  if (hasToolCalls) {
    message.tool_calls = toOpenAIToolCalls(response.toolCalls);
  }

  return {
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: hasToolCalls ? 'tool_calls' : 'stop',
      },
    ],
    usage: {
      prompt_tokens: response.usage?.prompt_tokens ?? 0,
      completion_tokens: response.usage?.completion_tokens ?? 0,
      total_tokens: response.usage?.total_tokens ?? 0,
    },
  };
}

/**
 * Convert a text_delta NDJSON event into an SSE-compatible OpenAI chunk.
 */
export function toOpenAIStreamChunk(
  event: NdjsonEvent,
  model: string,
  provider: ProviderConfig,
  chunkId: string,
): OpenAIChunk | null {
  const normalizedType = provider.normalizeEventType(event.type);

  if (normalizedType === 'text_delta') {
    const content = provider.extractTextContent(event);
    if (!content) return null;

    return {
      id: chunkId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          delta: { content },
          finish_reason: null,
        },
      ],
    };
  }

  if (normalizedType === 'result') {
    return {
      id: chunkId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop',
        },
      ],
    };
  }

  return null;
}

/**
 * Convert tool call events to OpenAI format.
 */
export function toOpenAIToolCalls(
  toolEvents: { id: string; name: string; arguments: Record<string, unknown> }[],
): OpenAIToolCall[] {
  return toolEvents.map((tc) => ({
    id: tc.id,
    type: 'function' as const,
    function: {
      name: tc.name,
      arguments: JSON.stringify(tc.arguments),
    },
  }));
}
