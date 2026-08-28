"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  VALID_STATUSES,
  FILTER_LABELS,
  VALID_SPORTS,
  SPORT_LABELS,
  type ProgramFilter,
  type SportFilter,
} from "@/lib/programs";

export function ProgramFilters({
  currentStatus,
  currentSport,
}: {
  currentStatus: ProgramFilter;
  currentSport: SportFilter;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function pushParams(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      params.set(key, value);
    }
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleStatusChange(value: string | null) {
    if (!value) return;
    pushParams({ status: value });
  }

  function handleSportChange(value: string | null) {
    if (!value) return;
    pushParams({ sport: value });
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Фильтры программ">
      <Select value={currentStatus} onValueChange={handleStatusChange}>
        <SelectTrigger className="w-[180px]" aria-label="Статус программы">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VALID_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {FILTER_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={currentSport} onValueChange={handleSportChange}>
        <SelectTrigger className="w-[180px]" aria-label="Вид спорта">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VALID_SPORTS.map((s) => (
            <SelectItem key={s} value={s}>
              {SPORT_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
