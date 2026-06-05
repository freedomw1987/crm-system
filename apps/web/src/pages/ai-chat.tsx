import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Sparkles, Trash2, Plus, Loader2, User, Bot, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { chatApi, type ConversationSummary, type ChatMessage, type AgentRunResult } from '@/lib/api';
import { cn, formatDateTime } from '@/lib/utils';

export function AiChatPage() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
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

  // Auto-scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [activeConv?.messages.length, input]);

  const sendMutation = useMutation({
    mutationFn: (message: string) => chatApi.send(message, activeId ?? undefined),
    onSuccess: (result: AgentRunResult) => {
      setActiveId(result.conversationId);
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['conversation', result.conversationId] });
      qc.invalidateQueries({ queryKey: ['quotations'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => chatApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      setActiveId(null);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || sendMutation.isPending) return;
    sendMutation.mutate(input);
    setInput('');
  }

  function startNewChat() {
    setActiveId(null);
    setInput('');
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 h-[calc(100vh-8rem)]">
      {/* Conversation list */}
      <Card className="flex flex-col overflow-hidden">
        <CardHeader className="border-b">
          <Button onClick={startNewChat} className="w-full" size="sm">
            <Plus className="h-4 w-4 mr-2" />
            新對話
          </Button>
        </CardHeader>
        <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin">
          {conversations.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              仲未有對話
            </p>
          ) : (
            conversations.map((c) => (
              <ConversationItem
                key={c.id}
                conv={c}
                active={c.id === activeId}
                onClick={() => setActiveId(c.id)}
                onDelete={() => deleteMutation.mutate(c.id)}
              />
            ))
          )}
        </div>
      </Card>

      {/* Active conversation */}
      <Card className="flex flex-col overflow-hidden">
        {!activeId ? (
          <EmptyState onPrompt={(p) => sendMutation.mutate(p)} disabled={sendMutation.isPending} />
        ) : (
          <>
            <CardHeader className="border-b flex flex-row items-center justify-between">
              <CardTitle className="text-base truncate">
                {activeConv?.title ?? '對話'}
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
              {sendMutation.isPending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  AI 諗緊...
                </div>
              )}
              {sendMutation.error && (
                <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
                  {(sendMutation.error as Error).message}
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
                placeholder="問 AI 有關 CRM 嘅嘢..."
                rows={2}
                className="flex-1"
              />
              <Button type="submit" disabled={!input.trim() || sendMutation.isPending}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}

function EmptyState({ onPrompt, disabled }: { onPrompt: (p: string) => void; disabled: boolean }) {
  const examples = [
    '邊 5 個客戶最大貢獻 revenue?',
    '搵下 "ABC" 呢間公司',
    '幫我開個 AC01 x 10 嘅報價俾第一個 customer',
    'Log 一個 call 俾 ABC Company,傾咗佢哋嘅 Q4 計劃',
  ];
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
        <Sparkles className="h-8 w-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold mb-2">CRM AI Assistant</h2>
      <p className="text-muted-foreground mb-6 max-w-md">
        用自然語言操作 CRM — 查客戶、生報價、log activity、睇 analytics。
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-2xl">
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onPrompt(ex)}
            disabled={disabled}
            className="text-left p-3 rounded border bg-card hover:border-primary text-sm transition-colors disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConversationItem({
  conv,
  active,
  onClick,
  onDelete,
}: {
  conv: ConversationSummary;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 p-2 rounded cursor-pointer text-sm',
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
      )}
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{conv.title}</div>
        <div className={cn('text-xs', active ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
          {conv._count.messages} messages · {formatDateTime(conv.updatedAt)}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (confirm('刪除呢個對話?')) onDelete();
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

  if (isTool) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%]">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground mb-1"
          >
            <Wrench className="h-3 w-3" />
            {message.toolName} {expanded ? '▾' : '▸'}
          </button>
          {expanded && (
            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto scrollbar-thin max-w-full">
              {JSON.stringify(message.toolResult, null, 2)}
            </pre>
          )}
        </div>
      </div>
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
          'max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted'
        )}
      >
        {message.content}
      </div>
      {isUser && (
        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}
