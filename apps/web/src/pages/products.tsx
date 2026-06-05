import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Package, Plus, Trash2, Loader2, Edit2, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { Select, Label } from '@/components/ui/select';
import { productsApi, type Product } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

const STATUS_VARIANT: Record<Product['status'], 'success' | 'secondary' | 'warning' | 'destructive'> = {
  ACTIVE: 'success',
  ARCHIVED: 'secondary',
  OUT_OF_STOCK: 'destructive',
};

export function ProductsPage() {
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
          <h1 className="text-2xl md:text-3xl font-bold">Products</h1>
          <p className="text-muted-foreground">產品目錄 — 管理產品名稱、描述、售價、庫存</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          新增產品
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="search">搜尋</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="產品名 / SKU..."
              className="pl-9"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cat">分類</Label>
          <Select id="cat" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">全部分類</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="status">狀態</Label>
          <Select id="status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">全部狀態</option>
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
            <option value="OUT_OF_STOCK">Out of Stock</option>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">載入中...</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
            尚未建立任何產品
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
                  <span className="text-muted-foreground">售價</span>
                  <span className="font-semibold text-lg">
                    {formatCurrency(Number(p.unitPrice), p.currency)}
                  </span>
                </div>

                {p.trackInventory && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">庫存: </span>
                    <span className={
                      (p.lowStockThreshold != null && p.stockQuantity != null && p.stockQuantity <= p.lowStockThreshold)
                        ? 'text-amber-600 font-semibold'
                        : 'font-medium'
                    }>
                      {p.stockQuantity ?? 0}
                    </span>
                    {p.lowStockThreshold != null && (
                      <span className="text-muted-foreground"> (低於 {p.lowStockThreshold} 警示)</span>
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
                    編輯
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm(`確定刪除「${p.name}」?`)) removeProduct.mutate(p.id);
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

      {createOpen && (
        <ProductDialog
          onClose={() => setCreateOpen(false)}
          onSuccess={() => {
            setCreateOpen(false);
            queryClient.invalidateQueries({ queryKey: ['products'] });
          }}
        />
      )}
      {editing && (
        <ProductDialog
          product={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ['products'] });
          }}
        />
      )}
    </div>
  );
}

interface ProductDialogProps {
  product?: Product;
  onClose: () => void;
  onSuccess: () => void;
}
function ProductDialog({ product, onClose, onSuccess }: ProductDialogProps) {
  const [sku, setSku] = useState(product?.sku ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [unitPrice, setUnitPrice] = useState<number>(Number(product?.unitPrice) || 0);
  const [costPrice, setCostPrice] = useState<number>(Number(product?.costPrice) || 0);
  const [currency, setCurrency] = useState(product?.currency ?? 'HKD');
  const [status, setStatus] = useState<Product['status']>(product?.status ?? 'ACTIVE');
  const [trackInventory, setTrackInventory] = useState(product?.trackInventory ?? true);
  const [stockQuantity, setStockQuantity] = useState<number>(Number(product?.stockQuantity) || 0);
  const [lowStockThreshold, setLowStockThreshold] = useState<number>(Number(product?.lowStockThreshold) || 0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!product;

  async function submit() {
    setError(null);
    if (!sku.trim() || !name.trim()) {
      setError('請填 SKU 同產品名稱');
      return;
    }
    if (unitPrice < 0) {
      setError('售價不可為負');
      return;
    }
    setSubmitting(true);
    try {
      const data = {
        sku: sku.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        unitPrice,
        costPrice: costPrice || undefined,
        currency,
        status,
        trackInventory,
        stockQuantity: trackInventory ? stockQuantity : undefined,
        lowStockThreshold: trackInventory && lowStockThreshold > 0 ? lowStockThreshold : undefined,
      };
      if (isEdit && product) {
        await productsApi.update(product.id, data);
      } else {
        await productsApi.create(data);
      }
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
      <Card className="w-full max-w-2xl my-8">
        <CardContent className="p-6 space-y-4">
          <h2 className="text-lg font-bold">{isEdit ? '編輯產品' : '新增產品'}</h2>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sku">SKU *</Label>
              <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. HW-MON-001" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">產品名稱 *</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. 27" 4K Monitor' />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="desc">產品描述</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="產品規格、特點、用途..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cat">分類</Label>
              <Input id="cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Hardware" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">狀態</Label>
              <Select id="status" value={status} onChange={(e) => setStatus(e.target.value as Product['status'])}>
                <option value="ACTIVE">Active</option>
                <option value="ARCHIVED">Archived</option>
                <option value="OUT_OF_STOCK">Out of Stock</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="price">售價 *</Label>
              <Input id="price" type="number" value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cost">成本</Label>
              <Input id="cost" type="number" value={costPrice} onChange={(e) => setCostPrice(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cur">貨幣</Label>
              <Select id="cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option>HKD</option>
                <option>USD</option>
                <option>CNY</option>
                <option>EUR</option>
                <option>GBP</option>
              </Select>
            </div>
          </div>

          <div className="space-y-2 border-t pt-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={trackInventory}
                onChange={(e) => setTrackInventory(e.target.checked)}
                className="rounded"
              />
              追蹤庫存
            </label>
            {trackInventory && (
              <div className="grid grid-cols-2 gap-3 pl-6">
                <div className="space-y-1.5">
                  <Label htmlFor="stock">現有庫存</Label>
                  <Input id="stock" type="number" value={stockQuantity} onChange={(e) => setStockQuantity(Number(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="low">低庫存警示</Label>
                  <Input id="low" type="number" value={lowStockThreshold} onChange={(e) => setLowStockThreshold(Number(e.target.value))} placeholder="0 = 不警示" />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={onClose} disabled={submitting}>取消</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {isEdit ? '儲存' : '建立'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
