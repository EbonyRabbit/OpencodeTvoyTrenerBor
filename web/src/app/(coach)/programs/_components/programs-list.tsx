"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import {
  getProgramStatus,
  STATUS_LABELS,
  STATUS_VARIANTS,
  SPORT_LABELS,
  FILTER_LABELS,
  type ProgramRow,
  type ProgramFilter,
  type SportFilter,
} from "@/lib/programs";
import { CreateProgramDialog } from "./create-program-dialog";

function formatPrice(price: number | null): string {
  if (price === null) return "По запросу";
  return `${price.toLocaleString("ru-RU")} ₽`;
}

function EmptyState({
  hasFilter,
  currentStatus,
}: {
  hasFilter: boolean;
  currentStatus: ProgramFilter;
}) {
  if (!hasFilter) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16"
        role="status"
      >
        <p className="text-lg font-medium">Нет ни одной программы</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Создайте первую программу, чтобы начать работу
        </p>
        <div className="mt-4">
          <CreateProgramDialog />
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16"
      role="status"
    >
      <p className="text-lg font-medium">
        Нет программ со статусом «{FILTER_LABELS[currentStatus]}»
      </p>
      <Link
        href="/programs"
        className="mt-2 text-sm text-primary underline-offset-4 hover:underline"
      >
        Сбросить фильтр
      </Link>
    </div>
  );
}

function Paginator({
  page,
  totalPages,
  currentStatus,
  currentSport,
}: {
  page: number;
  totalPages: number;
  currentStatus: ProgramFilter;
  currentSport: SportFilter;
}) {
  const pages: (number | "ellipsis")[] = [];
  const delta = 1;

  const rangeStart = Math.max(2, page - delta);
  const rangeEnd = Math.min(totalPages - 1, page + delta);

  pages.push(1);

  if (rangeStart > 2) {
    pages.push("ellipsis");
  }

  for (let i = rangeStart; i <= rangeEnd; i++) {
    pages.push(i);
  }

  if (rangeEnd < totalPages - 1) {
    pages.push("ellipsis");
  }

  if (totalPages > 1) {
    pages.push(totalPages);
  }

  function href(p: number) {
    const sportParam = currentSport !== "all" ? `&sport=${currentSport}` : "";
    return `/programs?page=${p}&status=${currentStatus}${sportParam}`;
  }

  return (
    <Pagination className="mt-6" role="navigation" aria-label="Пагинация">
      <PaginationContent>
        {page > 1 && (
          <PaginationItem>
            <PaginationPrevious href={href(page - 1)} />
          </PaginationItem>
        )}
        {pages.map((p, i) =>
          p === "ellipsis" ? (
            <PaginationItem key={`e-${i}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={p}>
              <PaginationLink
                href={href(p)}
                isActive={p === page}
                aria-label={`Страница ${p}`}
                aria-current={p === page ? "page" : undefined}
              >
                {p}
              </PaginationLink>
            </PaginationItem>
          ),
        )}
        {page < totalPages && (
          <PaginationItem>
            <PaginationNext href={href(page + 1)} />
          </PaginationItem>
        )}
      </PaginationContent>
    </Pagination>
  );
}

export function ProgramsList({
  programs,
  totalCount,
  page,
  totalPages,
  currentStatus,
  currentSport,
}: {
  programs: ProgramRow[];
  totalCount: number;
  page: number;
  totalPages: number;
  currentStatus: ProgramFilter;
  currentSport: SportFilter;
}) {
  if (totalCount === 0) {
    return (
      <EmptyState
        hasFilter={currentStatus !== "all"}
        currentStatus={currentStatus}
      />
    );
  }

  return (
    <div>
      <div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        role="list"
        aria-label="Список программ"
      >
        {programs.map((program) => {
          const status = getProgramStatus(program);
          return (
            <Link
              key={program.id}
              href={`/programs/${program.id}`}
              role="listitem"
            >
              <Card className="h-full transition-colors hover:bg-accent/50">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold leading-tight">
                      {program.title}
                    </h3>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {program.sport && (
                        <Badge variant="outline">
                          {SPORT_LABELS[program.sport as SportFilter]}
                        </Badge>
                      )}
                      {program.type === "personal" && (
                        <Badge variant="secondary">Персональная</Badge>
                      )}
                      <Badge variant={STATUS_VARIANTS[status]}>
                        {STATUS_LABELS[status]}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pb-3">
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {program.description ?? "Нет описания"}
                  </p>
                </CardContent>
                <CardFooter className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>{program.duration_weeks} нед.</span>
                  <span>{formatPrice(program.price)}</span>
                  {program.language && (
                    <span>{program.language === "ru" ? "RU" : "EN"}</span>
                  )}
                </CardFooter>
              </Card>
            </Link>
          );
        })}
      </div>

      {totalPages > 1 && (
        <Paginator
          page={page}
          totalPages={totalPages}
          currentStatus={currentStatus}
          currentSport={currentSport}
        />
      )}
    </div>
  );
}
