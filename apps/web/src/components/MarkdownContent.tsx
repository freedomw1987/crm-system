/**
 * MarkdownContent — renders an assistant message body as Markdown,
 * with first-class support for chart.js code fences.
 *
 * Why: previous version (2026-06-08) rendered message.content as
 * plain text via `{message.content}` + `whitespace-pre-wrap`. That
 * dropped all formatting (headings, lists, tables, links) and made
 * data-dense answers (top-customers, revenue trend) unreadable.
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
import { ChartBlock } from './ChartBlock';

interface MarkdownContentProps {
  source: string;
  className?: string;
}

/**
 * Split source into a list of segments. Non-chart text segments are
 * rendered with react-markdown; chart segments are rendered with
 * <ChartBlock />. Order is preserved.
 *
 * Fence detection: standard Markdown ``` fences with language tag
 * "chart" (case-insensitive). We accept the JSON on a single line
 * or pretty-printed across multiple lines.
 */
type Segment =
  | { kind: 'markdown'; text: string }
  | { kind: 'chart'; json: string };

function splitOnChartFences(source: string): Segment[] {
  const out: Segment[] = [];
  const re = /```chart\s*\n([\s\S]*?)\n```/gi;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m.index > lastIdx) {
      out.push({ kind: 'markdown', text: source.slice(lastIdx, m.index) });
    }
    out.push({ kind: 'chart', json: m[1].trim() });
    lastIdx = re.lastIndex;
  }
  if (lastIdx < source.length) {
    out.push({ kind: 'markdown', text: source.slice(lastIdx) });
  }
  return out;
}

export function MarkdownContent({ source, className }: MarkdownContentProps) {
  const segments = useMemo(() => splitOnChartFences(source), [source]);
  return (
    <div className={className}>
      {segments.map((seg, i) =>
        seg.kind === 'markdown' ? (
          <MarkdownSegment key={i} text={seg.text} />
        ) : (
          <ChartBlock key={i} json={seg.json} />
        ),
      )}
    </div>
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
 * appended token-by-token, so a partial ```chart fence may arrive
 * one character at a time. We only render the Markdown if the
 * current text doesn't end mid-fence, otherwise we leave the
 * unfinished fence in the raw reply string and let the next
 * token arrive.
 */
export function StreamingMarkdown({ source }: { source: string }) {
  // If the source ends with an unclosed ```chart or any ``` fence,
  // don't try to render Markdown yet — return plain text and a
  // cursor.
  const lastTripleBacktick = source.lastIndexOf('```');
  if (lastTripleBacktick !== -1) {
    const after = source.slice(lastTripleBacktick + 3);
    // Unclosed fence if there's no closing ``` after the opening one.
    if (!after.includes('```')) {
      return (
        <>
          {source}
          <span className="inline-block w-1.5 h-4 bg-primary ml-0.5 align-middle animate-pulse" />
        </>
      );
    }
  }
  return (
    <>
      <MarkdownContent source={source} />
      <span className="inline-block w-1.5 h-4 bg-primary ml-0.5 align-middle animate-pulse" />
    </>
  );
}
