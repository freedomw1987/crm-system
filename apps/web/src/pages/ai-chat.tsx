import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient, useIsFetching } from '@tanstack/react-query';
import { Send, Sparkles, Trash2, Plus, Loader2, User, Bot, Wrench, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { chatApi, type ConversationSummary, type ChatMessage, type StreamEvent } from '@/lib/api';
import { cn, formatDateTime } from '@/lib/utils';
import { MarkdownContent, StreamingMarkdown } from '@/components/MarkdownContent';
import { isToolMarker } from '@/lib/chat-helpers';

/**
 * Tools invoked by the agent during the current run. We keep these in
 * local state so the user can see what the agent did inline with the
 * streaming reply, without waiting for the conversation to be
 * persisted and re-fetched.
 *
 * Lifecycle:
 *   tool_start → { name, args } pushed (status: 'running')
 *   tool_end   → matching entry updated with { result, error }
 *
 * The display order matches the order the agent invoked the tools.
 */
interface InFlightToolCall {
  name: string;
  args: unknown;
  result?: unknown;
  error?: string;
}

export function AiChatPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  /**
   * While a stream is in flight, we keep the assistant's reply-in-
   * progress here so it can be rendered token-by-token. The
   * React-Query-cached `Conversation` is only updated when the
   * stream ends with a `done` event.
   */
  const [streamingReply, setStreamingReply] = useState('');
  /**
   * Tools invoked by the agent during the in-flight run. Reset to []
   * on submit. Grew as tool_start / tool_end events arrive.
   */
  const [inFlightTools, setInFlightTools] = useState<InFlightToolCall[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => chatApi.list(),
  });

  const { data: activeConv } = useQuery({
    queryKey: ['conversation', activeId],
    queryFn: () => chatApi.get(activeId!),
    enabled: !!activeId,
  });

  /**
   * Auto-scroll: jump to the bottom on every keystroke (so the
   * composer stays visible) and on every new streaming token / tool
   * event.
   */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [activeConv?.messages.length, streamingReply, inFlightTools.length, input]);

  /**
   * submitInFlight is `true` from the moment we call `chatApi.send`
   * until the `done` event arrives. We use a ref + state pair so the
   * button can disable while a request is in flight, and so the
   * streaming UI can show a "thinking" indicator before the first
   * token arrives.
   */
  const [submitInFlight, setSubmitInFlight] = useState(false);
  /**
   * 2026-06-29: id of the conversation we just created (or just
   * received the first reply for). Set on the `done` event; the
   * sidebar shows a small spinner next to this row while the
   * canonical refetch is in flight (the placeholder we
   * `setQueryData`'d in has title="新對話" / messages=0; the
   * refetch swaps that for the real title + count).
   */
  const [pendingConvId, setPendingConvId] = useState<string | null>(null);
  // `useIsFetching` is the reactive signal — when it returns 0 the
  // refetch is done and the spinner should hide. We also clear
  // `pendingConvId` defensively on the same effect so the state
  // doesn't dangle if the user navigates away mid-refetch.
  const isFetchingConvs = useIsFetching({ queryKey: ['conversations'] }) > 0;

  // Mobile sidebar drawer (RG-033): on phones we want the user focused
  // on the active conversation / EmptyState composer, with the
  // conversation list hidden behind a hamburger icon. On md+ the
  // sidebar is always visible in the grid, so `drawerOpen` is a no-op
  // for desktop layouts.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Close the drawer when the viewport grows past the md breakpoint
  // (so resizing from phone → desktop doesn't leave a stale open state).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setDrawerOpen(false);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  useEffect(() => {
    if (pendingConvId && !isFetchingConvs) {
      // Give the cache a tick to settle before clearing so the
      // placeholder row doesn't briefly lose the spinner while the
      // new query data is being written.
      const t = setTimeout(() => setPendingConvId(null), 250);
      return () => clearTimeout(t);
    }
  }, [pendingConvId, isFetchingConvs]);

  async function handleSend(messageText: string, conversationId: string | null) {
    if (!messageText.trim() || submitInFlight) return;
    setStreamError(null);
    setStreamingReply('');
    setInFlightTools([]);
    setSubmitInFlight(true);
    try {
      await chatApi.send(messageText, conversationId ?? undefined, (ev: StreamEvent) => {
        switch (ev.type) {
          case 'token':
            setStreamingReply((prev) => prev + ev.delta);
            break;
          case 'tool_start':
            setInFlightTools((prev) => [...prev, { name: ev.name, args: ev.args }]);
            break;
          case 'tool_end':
            setInFlightTools((prev) =>
              prev.map((t) =>
                t.name === ev.name && t.result === undefined
                  ? { ...t, result: ev.result, error: ev.error }
                  : t,
              ),
            );
            break;
          case 'done':
            // 2026-06-29: optimistically prepend the new conversation
            // to the sidebar list, then invalidate to refetch the
            // canonical row (real title from the first message, real
            // message count). Without the optimistic update the
            // sidebar waited for the refetch round-trip and the user
            // reported "no new conversation in the sidebar until I
            // refresh the page" — even though the data was committed
            // server-side well before the `done` event was sent.
            setActiveId(ev.conversationId);
            setPendingConvId(ev.conversationId);
            qc.setQueryData<ConversationSummary[]>(['conversations'], (prev) => {
              if (!prev) return prev;
              if (prev.some((c) => c.id === ev.conversationId)) return prev;
              // Placeholder values — the refetch below will overwrite
              // with the real title (from the first user message) and
              // a real message count.
              const now = new Date().toISOString();
              const placeholder: ConversationSummary = {
                id: ev.conversationId,
                title: t('ai.chat.newConversation'),
                createdAt: now,
                updatedAt: now,
                _count: { messages: 0 },
              };
              return [placeholder, ...prev];
            });
            // refetchType: 'all' forces a refetch even if React Query
            // thinks the conversations query is still fresh (the
            // default staleTime is 30s in App.tsx). The optimistic
            // entry above means the user sees the new conversation
            // instantly regardless.
            qc.invalidateQueries({ queryKey: ['conversations'], refetchType: 'all' });
            qc.invalidateQueries({ queryKey: ['conversation', ev.conversationId] });
            qc.invalidateQueries({ queryKey: ['quotations'] });
            break;
          case 'error':
            setStreamError(ev.message);
            break;
        }
      });
    } catch (err) {
      setStreamError((err as Error).message);
    } finally {
      setStreamingReply('');
      setInFlightTools([]);
      setSubmitInFlight(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || submitInFlight) return;
    const msg = input;
    setInput('');
    handleSend(msg, activeId);
  }

  function startNewChat() {
    setActiveId(null);
    setInput('');
    setStreamingReply('');
    setInFlightTools([]);
    setStreamError(null);
    // Close the mobile drawer if it was open (user just tapped
    // "+ New chat" inside the drawer).
    setDrawerOpen(false);
  }

  function selectConversation(id: string) {
    setActiveId(id);
    setDrawerOpen(false);
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => chatApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      setActiveId(null);
    },
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 h-[calc(100vh-8rem)] relative">
      {/* Desktop sidebar (RG-033): visible on md+ as the left grid
          column. On mobile this is replaced by the drawer below. */}
      <Card className="hidden md:flex md:flex-col overflow-hidden">
        <SidebarContents
          conversations={conversations}
          activeId={activeId}
          pendingConvId={pendingConvId}
          isFetchingConvs={isFetchingConvs}
          onSelect={selectConversation}
          onNewChat={startNewChat}
          onDelete={(id) => deleteMutation.mutate(id)}
          t={t}
        />
      </Card>

      {/* Mobile drawer (RG-033): only mounts when open AND on mobile.
          Click backdrop or tap a conversation to dismiss. ESC also
          closes (handled by the dialog div below — we listen for it
          inline since this isn't a real <dialog> element). */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <Card
            role="dialog"
            aria-modal="true"
            aria-label={t('ai.chat.conversationHistory')}
            className="relative w-72 max-w-[85vw] h-full flex flex-col animate-in slide-in-from-left"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDrawerOpen(false);
            }}
          >
            <div className="flex items-center justify-between border-b p-2">
              <span className="text-sm font-medium px-2">
                {t('ai.chat.conversationHistory')}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setDrawerOpen(false)}
                aria-label={t('common.close')}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <SidebarContents
              conversations={conversations}
              activeId={activeId}
              pendingConvId={pendingConvId}
              isFetchingConvs={isFetchingConvs}
              onSelect={selectConversation}
              onNewChat={startNewChat}
              onDelete={(id) => deleteMutation.mutate(id)}
              t={t}
            />
          </Card>
        </div>
      )}

      {/* Active conversation — full width on mobile (drawer overlays
          the rest of the screen), right column on desktop. The
          hamburger icon in the header opens the drawer on mobile. */}
      <Card className="flex flex-col overflow-hidden">
        {!activeId ? (
          <EmptyState
            onSend={(p) => handleSend(p, null)}
            disabled={submitInFlight}
            onOpenDrawer={() => setDrawerOpen(true)}
          />
        ) : (
          <>
            <CardHeader className="border-b flex flex-row items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setDrawerOpen(true)}
                aria-label={t('ai.chat.openHistory')}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <CardTitle className="text-base truncate flex-1">
                {activeConv?.title ?? t('ai.chat.untitled')}
              </CardTitle>
            </CardHeader>
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin"
            >
              {activeConv?.messages.map((m, i) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  index={i}
                  expanded={expandedToolCalls.has(i)}
                  onToggle={() => {
                    setExpandedToolCalls((prev) => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    });
                  }}
                />
              ))}

              {/* In-flight streaming reply: the assistant bubble grows
                  as `token` events arrive, with tool calls rendered as
                  inline pills above the text (not as separate
                  message bubbles — see MessageBubble for the same
                  treatment of persisted tool messages). */}
              {(streamingReply || inFlightTools.length > 0) && (
                <StreamingBotMessage
                  reply={streamingReply}
                  tools={inFlightTools}
                />
              )}

              {submitInFlight && streamingReply === '' && inFlightTools.length === 0 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('ai.chat.thinking')}
                </div>
              )}

              {streamError && (
                <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
                  {streamError}
                </div>
              )}
            </div>
            <form
              onSubmit={handleSubmit}
              className="border-t p-3 flex items-end gap-2 bg-card"
            >
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e as unknown as FormEvent);
                  }
                }}
                placeholder={t('ai.chat.placeholder')}
                rows={2}
                className="flex-1"
              />
              <Button type="submit" disabled={!input.trim() || submitInFlight}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}

function EmptyState({ onSend, disabled, onOpenDrawer }: { onSend: (msg: string) => void; disabled: boolean; onOpenDrawer: () => void }) {
  const { t } = useTranslation();
  const examples = [
    t('ai.chat.examplePrompts.topCustomers'),
    t('ai.chat.examplePrompts.findCompany'),
    t('ai.chat.examplePrompts.createQuotation'),
    t('ai.chat.examplePrompts.logCall'),
  ];
  // 2026-06-29: a free-text composer so the user can type their own
  // prompt on a new conversation, not just pick from the example
  // chips. Mirrors the active-conversation composer (Enter to send,
  // Shift+Enter for newline) and submits with `activeId = null`,
  // so the `done` event from the backend will swap this view out
  // for the freshly-created conversation.
  //
  // 2026-07-02 (RG-031): when `disabled` flips to true (i.e. a
  // submit is in flight from this EmptyState), show the same
  // "thinking" indicator the active-conversation view uses, so the
  // user isn't staring at a disabled empty page for several seconds
  // before the first SSE token lands. The disabled buttons stay
  // (no double-send), but the spinner + bot-anchored bubble give
  // the user visual confirmation that the request is being
  // processed and the active-conversation view is about to swap in.
  //
  // 2026-07-03 (RG-033): mobile drawer trigger in the header. The
  // Menu icon is `md:hidden` — on desktop the conversation list is
  // already visible in the grid, so the icon would be redundant.
  const [input, setInput] = useState('');
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    setInput('');
    onSend(trimmed);
  }
  return (
    <div className="flex-1 flex flex-col">
      <div className="md:hidden flex items-center justify-between border-b px-2 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onOpenDrawer}
          aria-label={t('ai.chat.openHistory')}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <span className="text-sm font-medium">{t('ai.chat.title')}</span>
        <div className="w-9" />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center overflow-y-auto">
        <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Sparkles className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold mb-2">{t('ai.chat.welcomeTitle')}</h2>
        <p className="text-muted-foreground mb-6 max-w-md">
          {t('ai.chat.welcomeMessage')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-2xl">
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => onSend(ex)}
              disabled={disabled}
              className="text-left p-3 rounded border bg-card hover:border-primary text-sm transition-colors disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>
        {disabled && (
          <div
            className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"
            data-testid="empty-state-thinking"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('ai.chat.thinking')}
          </div>
        )}
      </div>
      <form
        onSubmit={handleSubmit}
        className="border-t p-3 flex items-end gap-2 bg-card"
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e as unknown as FormEvent);
            }
          }}
          placeholder={t('ai.chat.placeholder')}
          rows={2}
          className="flex-1"
          autoFocus
          data-testid="empty-state-input"
        />
        <Button type="submit" disabled={!input.trim() || disabled}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

// SidebarContents (RG-033) — extracted from the inline JSX so it can
// be reused by BOTH the desktop left-column Card AND the mobile
// drawer body. The "New conversation" button + scrollable conversation
// list live here; the wrapping chrome (Card, close button, backdrop)
// is the caller's responsibility.
function SidebarContents({
  conversations,
  activeId,
  pendingConvId,
  isFetchingConvs,
  onSelect,
  onNewChat,
  onDelete,
  t,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  pendingConvId: string | null;
  isFetchingConvs: boolean;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <>
      <CardHeader className="border-b">
        <Button onClick={onNewChat} className="w-full" size="sm">
          <Plus className="h-4 w-4 mr-2" />
          {t('ai.chat.newConversation')}
        </Button>
      </CardHeader>
      <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin">
        {conversations.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            {t('ai.chat.emptyConversations')}
          </p>
        ) : (
          conversations.map((c) => (
            <ConversationItem
              key={c.id}
              conv={c}
              active={c.id === activeId}
              pending={c.id === pendingConvId && isFetchingConvs}
              onClick={() => onSelect(c.id)}
              onDelete={() => onDelete(c.id)}
            />
          ))
        )}
      </div>
    </>
  );
}

function ConversationItem({
  conv,
  active,
  pending,
  onClick,
  onDelete,
}: {
  conv: ConversationSummary;
  active: boolean;
  /** 2026-06-29: this row is the freshly-created conversation and
   *  the canonical refetch is still in flight. Show a small spinner
   *  next to the title so the user knows the placeholder is being
   *  upgraded to the real (title + message count) row. */
  pending?: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'group flex items-center gap-2 p-2 rounded cursor-pointer text-sm',
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
      )}
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate flex items-center gap-1.5">
          <span className="truncate">{conv.title}</span>
          {pending && (
            <Loader2
              className={cn(
                'h-3 w-3 animate-spin shrink-0',
                active ? 'text-primary-foreground/80' : 'text-muted-foreground'
              )}
              aria-label={t('common.loading')}
            />
          )}
        </div>
        <div className={cn('text-xs', active ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
          {t('ai.chat.messageCount', { count: conv._count.messages })}
          {t('ai.chat.messageCountSeparator')}
          {formatDateTime(conv.updatedAt)}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (confirm(t('ai.chat.deleteConfirm'))) onDelete();
        }}
        className={cn(
          'opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded',
          active ? 'hover:bg-white/20' : 'hover:bg-muted'
        )}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

/**
 * Persisted messages from the backend. Tool calls (role: 'tool') are
 * rendered as inline pills (no bubble, no max-w container) — the
 * feedback we got on Day 10 was that tool calls should not look like
 * a message; they're metadata about what the agent is doing.
 *
 * Empty-bubble guard (RG-CHAT-001, 2026-06-08): the backend persists
 * a sentinel row (role: 'assistant' + content: '🔧 {toolName}' +
 * toolName) for every tool invocation as the LLM history marker.
 * `isToolMarker` (lib/chat-helpers.ts) detects this and we render
 * the row as a metadata pill instead of an empty assistant bubble.
 */

function MessageBubble({
  message,
  index,
  expanded,
  onToggle,
}: {
  message: ChatMessage;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const isToolMarkerRow = isToolMarker(message);

  if (isTool || isToolMarkerRow) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Wrench className="h-3 w-3" />
        <span className="font-mono">{message.toolName}</span>
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        {expanded && (
          <pre className="ml-2 text-xs bg-muted p-2 rounded overflow-x-auto scrollbar-thin max-w-full text-left">
            {JSON.stringify(
              isToolMarkerRow
                ? { args: message.toolArgs }
                : { args: message.toolArgs, result: message.toolResult },
              null,
              2,
            )}
          </pre>
        )}
      </button>
    );
  }

  return (
    <div className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-4 py-2 text-sm',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        )}
      >
        {isUser ? (
          // User messages: keep plain text + preserve line breaks. No
          // Markdown — the user types into a textarea and we want a
          // faithful echo of what they sent, not interpreted HTML.
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        ) : (
          // Assistant messages: render as Markdown with chart.js
          // support (see MarkdownContent.tsx for the fence contract).
          <MarkdownContent source={message.content} />
        )}
      </div>
      {isUser && (
        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

/**
 * In-flight streaming assistant message. Rendered as a single
 * bot-anchored bubble (with avatar) so it visually matches the
 * persisted assistant messages — but with tool calls shown as
 * inline pills above the text rather than as separate message
 * bubbles. The text portion grows as `token` events append
 * characters.
 */
function StreamingBotMessage({
  reply,
  tools,
}: {
  reply: string;
  tools: InFlightToolCall[];
}) {
  return (
    <div className="flex gap-3 justify-start">
      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="max-w-[80%] space-y-2">
        {tools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tools.map((t, i) => (
              <ToolPill key={`${t.name}-${i}`} tool={t} />
            ))}
          </div>
        )}
        {reply && (
          <div className="rounded-lg px-4 py-2 text-sm bg-muted">
            <StreamingMarkdown source={reply} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Inline pill showing a single tool invocation. Same visual language
 * as the persisted tool messages in MessageBubble. The pill expands
 * to show the tool's arguments while running and its result on
 * completion.
 */
function ToolPill({ tool }: { tool: InFlightToolCall }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const status = tool.result === undefined ? 'running' : tool.error ? 'error' : 'ok';
  return (
    <button
      type="button"
      onClick={() => setExpanded((e) => !e)}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors',
        status === 'running' && 'border-primary/30 text-primary bg-primary/5 animate-pulse',
        status === 'ok' && 'border-muted-foreground/30 text-muted-foreground bg-muted/30',
        status === 'error' && 'border-destructive/30 text-destructive bg-destructive/5',
      )}
    >
      <Wrench className="h-3 w-3" />
      <span className="font-mono">{tool.name}</span>
      {status === 'running' && <span className="text-[10px]">{t('ai.chat.executing')}</span>}
      {status === 'error' && <span className="text-[10px]">{t('ai.chat.toolFailed')}</span>}
      <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      {expanded && (
        <pre className="text-xs bg-muted p-2 rounded overflow-x-auto scrollbar-thin max-w-full text-left">
          {JSON.stringify({ args: tool.args, result: tool.result, error: tool.error }, null, 2)}
        </pre>
      )}
    </button>
  );
}
