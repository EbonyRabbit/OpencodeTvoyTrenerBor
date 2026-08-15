"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  VALID_CLIENT_STATUSES,
  VALID_PAYMENT_FILTERS,
  FILTER_LABELS,
  PAYMENT_FILTER_LABELS,
  type ClientFilter,
  type PaymentFilter,
} from "@/lib/clients";

export function ClientFilters({
  currentStatus,
  currentPayment,
  currentSearch,
}: {
  currentStatus: ClientFilter;
  currentPayment: PaymentFilter;
  currentSearch: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchValue, setSearchValue] = useState(currentSearch);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const navigate = useCallback(
    (updates: Record<string, string>) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setSearchValue(currentSearch);
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value && value !== "all") {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      params.set("page", "1");
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams, currentSearch],
  );

  function handleSearchChange(value: string) {
    setSearchValue(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) {
        params.set("q", value.trim());
      } else {
        params.delete("q");
      }
      params.set("page", "1");
      router.push(`${pathname}?${params.toString()}`);
    }, 300);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Input
        placeholder="Поиск по имени..."
        value={searchValue}
        onChange={(e) => handleSearchChange(e.target.value)}
        className="w-[220px]"
        aria-label="Поиск клиентов"
      />
      <Select
        value={currentPayment}
        onValueChange={(value) => { if (value) navigate({ payment: value }); }}
      >
        <SelectTrigger className="w-[160px]" aria-label="Статус оплаты">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VALID_PAYMENT_FILTERS.map((s) => (
            <SelectItem key={s} value={s}>
              {PAYMENT_FILTER_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={currentStatus}
        onValueChange={(value) => { if (value) navigate({ status: value }); }}
      >
        <SelectTrigger className="w-[160px]" aria-label="Статус клиента">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VALID_CLIENT_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {FILTER_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
