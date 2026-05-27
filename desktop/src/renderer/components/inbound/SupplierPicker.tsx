import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { supplierApi } from '@renderer/lib/api/supplier';
import type { Supplier } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';

/**
 * Combobox-style picker for selecting an existing supplier or creating a
 * new one inline. v2.0 keeps the UX intentionally simple — a select with
 * an "Add new supplier" affordance underneath the list — instead of a
 * full async-search combobox. The supplier table is small (one row per
 * counterparty we send disclosure to); typical orgs in v2.0 ship with
 * < 50 suppliers, so a flat dropdown is readable.
 *
 * Emits the selected supplier_id via `onChange`. Calling
 * `setSelectedSupplierId` then immediately spawning a "create" via the
 * mutation is supported (the form remembers your text in the input box).
 */
export interface SupplierPickerProps {
  value: string | null;
  onChange: (supplierId: string) => void;
  disabled?: boolean;
}

export function SupplierPicker({ value, onChange, disabled }: SupplierPickerProps): JSX.Element {
  const queryClient = useQueryClient();
  const suppliersQuery = useQuery({
    queryKey: ['supplier:list'],
    queryFn: () => supplierApi.list(),
  });

  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const createMutation = useMutation({
    mutationFn: (name: string) => supplierApi.create({ name }),
    onSuccess: (created: Supplier) => {
      void queryClient.invalidateQueries({ queryKey: ['supplier:list'] });
      onChange(created.id);
      setIsCreating(false);
      setNewName('');
    },
  });

  const suppliers = suppliersQuery.data ?? [];
  const selectDisabled = disabled || suppliersQuery.isLoading;

  return (
    <div className="space-y-2">
      <Label htmlFor="supplier-select">供应商 / Supplier</Label>
      {isCreating ? (
        <div className="space-y-2 rounded-md border border-border bg-card p-3">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="供应商法定名称 / Supplier legal name"
            disabled={createMutation.isPending}
            autoFocus
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => createMutation.mutate(newName.trim())}
              disabled={newName.trim() === '' || createMutation.isPending}
            >
              {createMutation.isPending ? '创建中...' : '创建并选择'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setIsCreating(false);
                setNewName('');
              }}
              disabled={createMutation.isPending}
            >
              取消
            </Button>
          </div>
          {createMutation.error && (
            <p className="text-xs text-destructive">
              {createMutation.error instanceof Error ? createMutation.error.message : '创建失败'}
            </p>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <select
            id="supplier-select"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={selectDisabled}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="" disabled>
              {suppliersQuery.isLoading ? '加载中...' : '选择供应商'}
            </option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setIsCreating(true)}
            disabled={disabled}
          >
            <Plus className="mr-1 h-4 w-4" />
            新建
          </Button>
        </div>
      )}
    </div>
  );
}
