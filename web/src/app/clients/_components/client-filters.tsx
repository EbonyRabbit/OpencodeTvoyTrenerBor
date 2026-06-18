"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VALID_CLIENT_STATUSES, FILTER_LABELS, type ClientFilter } from "@/lib/clients";

export function ClientFilters({
  currentStatus,
}: {
  currentStatus: ClientFilter;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleStatusChange(value: string | null) {
    if (!value) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("status", value);
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="mb-4 flex items-center gap-2" role="group" aria-label="Фильтр статуса">
      <Select value={currentStatus} onValueChange={handleStatusChange}>
        <SelectTrigger className="w-[180px]" aria-label="Статус клиента">
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
