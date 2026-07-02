import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Save, Trash2, AlertTriangle, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { settingsApi, type PipelineWithStages } from '@/lib/api';

// Day 11 Phase 1 — System Settings: Pipeline configuration page.
//
// Admin-only. Reads & writes sales pipeline stages:
//   - list pipelines (default first, then by createdAt)
//   - create a new stage (POST, position auto-assigned to last)
//   - reorder via drag-and-drop (@dnd-kit/sortable — Q1=A in the spec)
//   - inline edit name / probability / color
//   - delete (blocked if stage has active deals — Q2=A in the spec)
//
// **Day 14.7 Step 6 note**: This page is now rendered as a CHILD of
// `<SettingsLayout />` at `/settings/pipelines`. The Layout already provides
// the page header + 7-tab nav, so the inner header + button-style tab strip
// that lived here in Day 11/12 has been removed (would otherwise render
// twice). Step 8 will extract the per-tab pages into their own files
// (settings-pipelines.tsx etc.) and this file can shrink to a re-export.

interface StageDraft {
  name: string;
  probability: number;
  color: string;
}

const DEFAULT_COLOR = '#3b82f6'; // tailwind blue-500

export default function SettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: pipelines, isLoading, error } = useQuery({
    queryKey: ['settings', 'pipelines'],
    queryFn: () => settingsApi.listPipelines(),
  });

  // Default pipeline (Phase 1 — only the default pipeline is editable;
  // multi-pipeline support comes later if David asks for it).
  const defaultPipeline = useMemo(
    () => pipelines?.find((p) => p.isDefault) ?? pipelines?.[0],
    [pipelines]
  );

  // Local edit buffer for stage name/probability/color. We commit
  // each blur (or "Save" click) via PATCH to keep the UI responsive.
  const [drafts, setDrafts] = useState<Record<string, StageDraft>>({});
  useEffect(() => {
    if (!defaultPipeline) return;
    const next: Record<string, StageDraft> = {};
    for (const s of defaultPipeline.stages) {
      next[s.id] = { name: s.name, probability: s.probability, color: s.color ?? DEFAULT_COLOR };
    }
    setDrafts(next);
  }, [defaultPipeline?.id, defaultPipeline?.stages.length]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const stageIds = useMemo(
    () => defaultPipeline?.stages.map((s) => s.id) ?? [],
    [defaultPipeline]
  );

  const reorderMutation = useMutation({
    mutationFn: async ({ id, newPosition }: { id: string; newPosition: number }) =>
      settingsApi.updateStage(id, { position: newPosition }),
    onMutate: async ({ id, newPosition }) => {
      // Optimistic update — flip the order locally so drag feels instant.
      await queryClient.cancelQueries({ queryKey: ['settings', 'pipelines'] });
      const prev = queryClient.getQueryData<PipelineWithStages[]>(['settings', 'pipelines']);
      queryClient.setQueryData<PipelineWithStages[]>(['settings', 'pipelines'], (old) => {
        if (!old) return old;
        return old.map((p) => {
          if (p.id !== defaultPipeline?.id) return p;
          const idx = p.stages.findIndex((s) => s.id === id);
          if (idx === -1) return p;
          const next = [...p.stages];
          const [removed] = next.splice(idx, 1);
          next.splice(newPosition, 0, removed);
          return { ...p, stages: next.map((s, i) => ({ ...s, position: i })) };
        });
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['settings', 'pipelines'], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'pipelines'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<StageDraft> }) =>
      settingsApi.updateStage(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'pipelines'] });
    },
  });

  const createMutation = useMutation({
    mutationFn: () => settingsApi.createStage({ name: 'New Stage', probability: 50, color: DEFAULT_COLOR }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'pipelines'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => settingsApi.deleteStage(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'pipelines'] });
    },
  });

  const [deleteCandidate, setDeleteCandidate] = useState<{ id: string; name: string; dealCount: number } | null>(null);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = stageIds.indexOf(String(active.id));
    const newIndex = stageIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = arrayMove(stageIds, oldIndex, newIndex);
    const movedId = String(active.id);
    reorderMutation.mutate({ id: movedId, newPosition: newIndex });
    // The backend's PATCH will swap with whatever's at the target
    // position, so a single mutation per drag is enough. We don't
    // need to renumber the rest.
    void newOrder; // referenced for clarity; backend handles cascading swap
  }

  function commitDraft(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    updateMutation.mutate({
      id,
      data: { name: draft.name, probability: draft.probability, color: draft.color },
    });
  }

  function requestDelete(id: string, name: string, dealCount: number) {
    if (dealCount > 0) {
      setDeleteCandidate({ id, name, dealCount });
    } else {
      if (confirm(`Delete stage "${name}"?`)) {
        deleteMutation.mutate(id);
      }
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
      </div>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-destructive">
          Failed to load pipelines: {(error as Error).message}
        </CardContent>
      </Card>
    );
  }
  if (!defaultPipeline) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          No pipeline configured yet. Create one in the database seed.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + tab strip are rendered by <SettingsLayout /> (Day 14.7 Step 6).
          Step 8 will extract this page's body into settings-pipelines.tsx; this
          file is kept as a default-export wrapper for backward compat with the
          Step 5 import in App.tsx. */}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>{defaultPipeline.name}</span>
            {defaultPipeline.isDefault && (
              <span className="text-xs font-normal text-muted-foreground border rounded px-1.5 py-0.5">
                default
              </span>
            )}
          </CardTitle>
          <CardDescription>
            {t('settings.pipelineHelp')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={stageIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {defaultPipeline.stages.map((s) => (
                  <SortableStageRow
                    key={s.id}
                    id={s.id}
                    dealCount={s._count?.deals ?? 0}
                    draft={drafts[s.id] ?? { name: s.name, probability: s.probability, color: s.color ?? DEFAULT_COLOR }}
                    onDraftChange={(patch) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [s.id]: { ...(prev[s.id] ?? { name: s.name, probability: s.probability, color: s.color ?? DEFAULT_COLOR }), ...patch },
                      }))
                    }
                    onSave={() => commitDraft(s.id)}
                    onDelete={() => requestDelete(s.id, s.name, s._count?.deals ?? 0)}
                    isSaving={updateMutation.isPending && updateMutation.variables?.id === s.id}
                    isDeleting={deleteMutation.isPending && deleteMutation.variables === s.id}
                  />
                ))}
                {defaultPipeline.stages.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No stages yet. Click "Add stage" to create one.
                  </p>
                )}
              </div>
            </SortableContext>
          </DndContext>

          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add stage
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Delete-blocked dialog (Q2=A — block + show how many active deals) */}
      {deleteCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card rounded-lg shadow-lg max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 text-amber-500 shrink-0" />
              <div>
                <h2 className="font-semibold">Cannot delete stage</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Stage "{deleteCandidate.name}" has {deleteCandidate.dealCount} active deal(s).
                  Reassign them to another stage in the Deals kanban first, then try again.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={() => setDeleteCandidate(null)}>
                <X className="h-4 w-4 mr-1" /> Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SortableStageRow({
  id,
  dealCount,
  draft,
  onDraftChange,
  onSave,
  onDelete,
  isSaving,
  isDeleting,
}: {
  id: string;
  dealCount: number;
  draft: StageDraft;
  onDraftChange: (patch: Partial<StageDraft>) => void;
  onSave: () => void;
  onDelete: () => void;
  isSaving: boolean;
  isDeleting: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border bg-background p-2"
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <input
        type="color"
        value={draft.color}
        onChange={(e) => onDraftChange({ color: e.target.value })}
        className="h-8 w-8 rounded border cursor-pointer"
        aria-label="Stage color"
      />
      <Input
        className="flex-1"
        value={draft.name}
        onChange={(e) => onDraftChange({ name: e.target.value })}
        onBlur={onSave}
        placeholder="Stage name"
      />
      <div className="flex items-center gap-1 text-xs text-muted-foreground w-28">
        <Input
          type="number"
          min={0}
          max={100}
          value={draft.probability}
          onChange={(e) => onDraftChange({ probability: Number(e.target.value) })}
          onBlur={onSave}
          className="w-16"
        />
        <span>%</span>
      </div>
      {dealCount > 0 && (
        <span
          className="text-xs text-muted-foreground border rounded px-1.5 py-0.5 whitespace-nowrap"
          title={`${dealCount} active deal(s) using this stage`}
        >
          {dealCount} deal{dealCount === 1 ? '' : 's'}
        </span>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onSave}
        disabled={isSaving}
        title="Save changes"
      >
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onDelete}
        disabled={isDeleting}
        title={dealCount > 0 ? 'Stage has active deals — delete blocked' : 'Delete stage'}
      >
        {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
      </Button>
    </div>
  );
}
