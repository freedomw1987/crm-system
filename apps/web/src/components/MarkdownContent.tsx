/**
 * MarkdownContent — renders an assistant message body as Markdown,
 * with first-class support for chart.js code fences and the
 * `<think>...</think>` reasoning blocks that reasoning models
 * (DeepSeek R1, Qwen QwQ, etc.) emit around their chain-of-thought.
 *
 * Why: previous version (2026-06-08) rendered message.content as
 * plain text via `{message.content}` + `whitespace-pre-wrap`. That
 * dropped all formatting (headings, lists, tables, links) and made
 * data-dense answers (top-customers, revenue trend) unreadable.
 *
 * 2026-06-29: when the configured LLM is a reasoning model the
 * `content` arrives with `<think>...</think>` wrappers around the
 * chain-of-thought. Rendering the raw text showed the literal
 * `<think>` / `</think>` markers to the user, which looked like a
 * bug. The fix is a pre-pass that splits the source into three
 * segment kinds (markdown / chart / think) and renders `think`
 * segments inside a collapsed <details>; the body markdown and any
 * chart fences are unaffected.
 *
 * Chart trigger contract — the LLM is taught (in packages/ai/src/
 * prompts.ts) to emit a fenced code block of the form:
 *
 *     ```chart
 *     {"type":"bar","data":{"labels":["Jan","Feb"],"datasets":[{"label":"Revenue","data":[10,20]}]}}
 *     ```
 *
 * We pre-process the source string and replace each ```chart fence
 * with a placeholder token. react-markdown then renders the
 * remaining Markdown normally. After react-markdown finishes, we
 * walk the React children and swap the placeholder nodes for real
 * <ChartBlock /> components.
 *
 * If the JSON inside the fence is malformed, we fall back to
 * rendering the raw JSON inside a <pre> (better than crashing the
 * whole bubble).
 */
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Brain } from 'lucide-react';
import { ChartBlock } from './ChartBlock';
import { cn } from '@/lib/utils';

interface MarkdownContentProps {
  source: string;
  className?: string;
}

type Segment =
  | { kind: 'markdown'; text: string }
  | { kind: 'chart'; json: string }
  | { kind: 'think'; content: string };

/**
 * Split the source into an ordered list of segments. We do a single
 * pass with a combined alternation regex so a think-block and a
 * chart fence can't accidentally nest.
 *
 * Note: think-blocks can contain a chart fence (the LLM can decide
 * to "think about" a chart before emitting it), so the regex uses
 * alternation and consumes whichever comes first from the current
 * cursor.
 */
function splitOnMarkers(source: string): Segment[] {
  const out: Segment[] = [];
  // Match in this order of priority at any cursor position:
  //   1. ```chart ... ```   (a complete chart fence)
  //   2. <think> ... </think>   (a complete reasoning block)
  // The `g` flag iterates through all matches in the string.
  const re = /```chart\s*\n([\s\S]*?)\n```|<think>([\s\S]*?)<\/think>/gi;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m.index > lastIdx) {
      out.push({ kind: 'markdown', text: source.slice(lastIdx, m.index) });
    }
    if (m[1] !== undefined) {
      // Chart fence
      out.push({ kind: 'chart', json: m[1].trim() });
    } else {
      // Think block
      out.push({ kind: 'think', content: (m[2] ?? '').trim() });
    }
    lastIdx = re.lastIndex;
  }
  if (lastIdx < source.length) {
    out.push({ kind: 'markdown', text: source.slice(lastIdx) });
  }
  return out;
}

export function MarkdownContent({ source, className }: MarkdownContentProps) {
  const segments = useMemo(() => splitOnMarkers(source), [source]);
  return (
    <div className={className}>
      {segments.map((seg, i) => {
        if (seg.kind === 'chart') return <ChartBlock key={i} json={seg.json} />;
        if (seg.kind === 'think') return <ThinkBlock key={i} content={seg.content} />;
        return <MarkdownSegment key={i} text={seg.text} />;
      })}
    </div>
  );
}

/**
 * Reasoning / chain-of-thought block from a thinking model.
 * Rendered as a collapsible disclosure — hidden by default because
 * sales reps want the final answer, not the LLM's scratch work, but
 * available if they want to verify why the assistant said what it
 * said. Inner content is rendered as markdown so reasoning that
 * mentions lists, code, etc. still reads cleanly.
 *
 * 2026-06-29: polish the visual treatment. The previous version used
 * a dashed border with a tiny monochrome Brain icon and a tight
 * 8/6px padding, which read as "unfinished placeholder" rather
 * than "deliberately hidden reasoning". Updated to:
 *   - left border accent in primary tint (blockquote-style cue that
 *     this is a meta-section, not body text)
 *   - solid muted border on the other three sides (less noisy than
 *     dashed; the left accent carries the visual weight)
 *   - Brain icon bumped to 14px with a primary tint so it scans as
 *     a label, not a glyph
 *   - chevron pushed to the far right with `ml-auto` so the eye
 *     reads the label as the primary affordance
 *   - summary hover state gets a subtle bg fill so clickability is
 *     obvious
 */
function ThinkBlock({ content }: { content: string }) {
  if (!content) return null;
  return (
    <details
      className={cn(
        'group my-3 rounded-md overflow-hidden',
        'border border-border bg-muted/20',
        'border-l-4 border-l-primary/50',
        'open:bg-muted/40 open:border-l-primary',
        'transition-colors'
      )}
    >
      <summary
        className={cn(
          'flex items-center gap-2 cursor-pointer select-none',
          'px-3 py-2 text-xs text-muted-foreground',
          'hover:text-foreground hover:bg-muted/40',
          'list-none [&::-webkit-details-marker]:hidden',
          'transition-colors'
        )}
      >
        <Brain className="h-3.5 w-3.5 text-primary/70 group-hover:text-primary transition-colors shrink-0" />
        <span className="font-medium">推理過程</span>
        <span aria-hidden="true" className="text-[10px] group-open:rotate-90 transition-transform ml-auto opacity-60 group-hover:opacity-100">
          ▸
        </span>
      </summary>
      <div className="px-3 pb-3 pt-2 border-t border-border/50 text-foreground/80">
        <MarkdownSegment text={content} />
      </div>
    </details>
  );
}

function MarkdownSegment({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h4]:text-sm [&_table]:text-xs [&_code]:text-xs [&_pre]:text-xs">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Tighten the streaming cursor so it sits inside the prose
        // without breaking the block layout.
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Helper for the streaming reply path — the reply text is being
 * appended token-by-token, so a partial ```chart fence (or
 * unclosed <think>) may arrive one character at a time. We only
 * render the Markdown if the current text doesn't end mid-marker;
 * otherwise we leave the unfinished portion in the raw reply string
 * and let the next token arrive.
 */
export function StreamingMarkdown({ source }: { source: string }) {
  // Detect an unclosed chart fence (the legacy behavior).
  const lastTripleBacktick = source.lastIndexOf('```');
  if (lastTripleBacktick !== -1) {
    const after = source.slice(lastTripleBacktick + 3);
    if (!after.includes('```')) {
      return (
        <>
          {source}
          <span className="inline-block w-1.5 h-4 bg-primary ml-0.5 align-middle animate-pulse" />
        </>
      );
    }
  }
  // Detect an unclosed <think> block. If the last occurrence of
  // `<think>` is later than the last occurrence of `</think>`, the
  // reasoning block is still being streamed — show the source as
  // plain text until the close tag arrives, so we don't render a
  // half-open details element.
  const lastOpen = source.lastIndexOf('<think>');
  const lastClose = source.lastIndexOf('</think>');
  if (lastOpen !== -1 && lastOpen > lastClose) {
    return (
      <>
        {source}
        <span className="inline-block w-1.5 h-4 bg-primary ml-0.5 align-middle animate-pulse" />
      </>
    );
  }
  return (
    <>
      <MarkdownContent source={source} />
      <span className="inline-block w-1.5 h-4 bg-primary ml-0.5 align-middle animate-pulse" />
    </>
  );
}
