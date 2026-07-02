import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Package, Plus, Trash2, Edit2, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, Label } from '@/components/ui/select';
import { productsApi, type Product } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { ProductDialog } from '@/components/product-dialog';

const STATUS_VARIANT: Record<Product['status'], 'success' | 'secondary' | 'warning' | 'destructive'> = {
  ACTIVE: 'success',
  ARCHIVED: 'secondary',
  OUT_OF_STOCK: 'destructive',
};

export function ProductsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['products', { search, categoryFilter, statusFilter }],
    queryFn: () => productsApi.list({
      query: search || undefined,
      category: categoryFilter || undefined,
      status: statusFilter || undefined,
      limit: 200,
    }),
  });
  // Backend may return { items, total } OR a bare array — normalise
  const items: Product[] = Array.isArray(data)
    ? (data as Product[])
    : ((data as { items?: Product[] } | undefined)?.items ?? []);

  // Distinct categories for the filter dropdown
  const categories = Array.from(new Set(items.map((p) => p.category).filter(Boolean))) as string[];

  const removeProduct = useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">{t('product.title')}</h1>
          <p className="text-muted-foreground">{t('product.subtitle')}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          {t('product.newProduct')}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="search">{t('product.search')}</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('product.searchPlaceholder')}
              className="pl-9"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cat">{t('product.filter.category')}</Label>
          <Select id="cat" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">{t('product.filter.allCategories')}</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="status">{t('product.filter.status')}</Label>
          <Select id="status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{t('product.filter.allStatuses')}</option>
            <option value="ACTIVE">{t('product.status.ACTIVE')}</option>
            <option value="ARCHIVED">{t('product.status.ARCHIVED')}</option>
            <option value="OUT_OF_STOCK">{t('product.status.OUT_OF_STOCK')}</option>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('product.loading')}</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
            {t('product.empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <Card key={p.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{p.name}</h3>
                    <p className="text-xs font-mono text-muted-foreground">{p.sku}</p>
                    {p.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                        {p.description}
                      </p>
                    )}
                  </div>
                  <Badge variant={STATUS_VARIANT[p.status]}>{p.status}</Badge>
                </div>

                {p.category && (
                  <Badge variant="outline" className="text-xs">{p.category}</Badge>
                )}

                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">{t('product.card.price')}</span>
                  <span className="font-semibold text-lg">
                    {formatCurrency(Number(p.unitPrice), p.currency)}
                  </span>
                </div>

                {p.trackInventory && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">{t('product.card.stock')}</span>
                    <span className={
                      (p.lowStockThreshold != null && p.stockQuantity != null && p.stockQuantity <= p.lowStockThreshold)
                        ? 'text-amber-600 font-semibold'
                        : 'font-medium'
                    }>
                      {p.stockQuantity ?? 0}
                    </span>
                    {p.lowStockThreshold != null && (
                      <span className="text-muted-foreground"> {t('product.card.lowStockWarning', { threshold: p.lowStockThreshold })}</span>
                    )}
                  </div>
                )}

                <div className="flex gap-2 pt-2 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setEditing(p)}
                  >
                    <Edit2 className="h-3 w-3 mr-1" />
                    {t('product.card.edit')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm(t('product.deleteConfirm', { name: p.name }))) removeProduct.mutate(p.id);
                    }}
                    disabled={removeProduct.isPending}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ProductDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['products'] });
        }}
      />
      <ProductDialog
        product={editing ?? undefined}
        open={editing !== null}
        onOpenChange={(v) => { if (!v) setEditing(null); }}
        onSaved={() => {
          setEditing(null);
          queryClient.invalidateQueries({ queryKey: ['products'] });
        }}
      />
    </div>
  );
}
