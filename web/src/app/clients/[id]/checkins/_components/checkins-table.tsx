"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import type { Database } from "@/types/supabase";

type CheckinRow = Database["public"]["Tables"]["checkins"]["Row"];

function formatDate(date: string | null): string {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleDateString("ru-RU");
  } catch {
    return "—";
  }
}

function ScoreValue({ value }: { value: number | null }) {
  if (value === null)
    return <span className="text-muted-foreground">—</span>;
  const color =
    value >= 7
      ? "text-green-600"
      : value >= 4
        ? "text-yellow-600"
        : "text-red-600";
  return <span className={`font-medium ${color}`}>{value}/10</span>;
}

function buildPageUrl(clientId: string, page: number): string {
  return `/clients/${clientId}/checkins?page=${page}`;
}

export function CheckinsTable({
  clientId,
  clientName,
  checkins,
  currentPage,
  totalPages,
}: {
  clientId: string;
  clientName: string;
  checkins: CheckinRow[];
  currentPage: number;
  totalPages: number;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (checkins.length === 0) {
    return (
      <div className="space-y-6" role="status">
        <Link
          href={`/clients/${clientId}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Назад к клиенту
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Чек-ины — {clientName}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              У клиента нет чек-инов.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pages = getPageNumbers(currentPage, totalPages);

  return (
    <div className="space-y-6">
      <Link
        href={`/clients/${clientId}`}
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Назад к клиенту
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Чек-ины — {clientName}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table aria-label="Чек-ины клиента">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Дата</TableHead>
                <TableHead scope="col">Нед.</TableHead>
                <TableHead scope="col">Самочувствие</TableHead>
                <TableHead scope="col">Сон</TableHead>
                <TableHead scope="col">Стресс</TableHead>
                <TableHead scope="col">Питание</TableHead>
                <TableHead scope="col">Пропуски</TableHead>
                <TableHead scope="col" className="max-w-[150px]">
                  Жалобы
                </TableHead>
                <TableHead scope="col" className="max-w-[200px]">
                  Комментарий
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checkins.flatMap((checkin) => {
                const isExpanded = expandedId === checkin.id;
                const hasExpandable =
                  !!checkin.complaints || !!checkin.comment;
                const rows: React.ReactElement[] = [
                  <TableRow
                    key={checkin.id}
                    className={hasExpandable ? "cursor-pointer" : ""}
                    tabIndex={hasExpandable ? 0 : undefined}
                    role={hasExpandable ? "button" : undefined}
                    aria-expanded={hasExpandable ? isExpanded : undefined}
                    onClick={
                      hasExpandable
                        ? () =>
                            setExpandedId(isExpanded ? null : checkin.id)
                        : undefined
                    }
                    onKeyDown={
                      hasExpandable
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setExpandedId(
                                isExpanded ? null : checkin.id,
                              );
                            }
                          }
                        : undefined
                    }
                  >
                    <TableCell>{formatDate(checkin.date)}</TableCell>
                    <TableCell>
                      {checkin.week != null ? String(checkin.week) : "—"}
                    </TableCell>
                    <TableCell>
                      <ScoreValue value={checkin.wellbeing} />
                    </TableCell>
                    <TableCell>
                      <ScoreValue value={checkin.sleep} />
                    </TableCell>
                    <TableCell>
                      <ScoreValue value={checkin.stress} />
                    </TableCell>
                    <TableCell>
                      {checkin.nutrition_adherence != null ? (
                        <span className="font-medium">
                          {checkin.nutrition_adherence}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {checkin.missed_workouts != null ? (
                        String(checkin.missed_workouts)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[150px] truncate">
                      {checkin.complaints || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {checkin.comment || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>,
                ];
                if (isExpanded && hasExpandable) {
                  rows.push(
                    <TableRow key={`${checkin.id}-detail`}>
                      <TableCell
                        colSpan={9}
                        className="bg-muted/30 p-4"
                      >
                        <div className="space-y-2 text-sm">
                          {checkin.complaints && (
                            <div>
                              <span className="font-medium text-muted-foreground">
                                Жалобы:
                              </span>
                              <p className="mt-0.5 whitespace-pre-wrap">
                                {checkin.complaints}
                              </p>
                            </div>
                          )}
                          {checkin.comment && (
                            <div>
                              <span className="font-medium text-muted-foreground">
                                Комментарий:
                              </span>
                              <p className="mt-0.5 whitespace-pre-wrap">
                                {checkin.comment}
                              </p>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>,
                  );
                }
                return rows;
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <Pagination role="navigation" aria-label="Пагинация">
          <PaginationContent>
            {currentPage > 1 && (
              <PaginationItem>
                <PaginationPrevious
                  href={buildPageUrl(clientId, currentPage - 1)}
                  text="Назад"
                  aria-label="Предыдущая страница"
                />
              </PaginationItem>
            )}
            {pages.map((page, i) =>
              page === "ellipsis" ? (
                <PaginationItem key={`ellipsis-${i}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={page}>
                  <PaginationLink
                    href={buildPageUrl(clientId, page)}
                    isActive={page === currentPage}
                    aria-label={`Страница ${page}`}
                    aria-current={page === currentPage ? "page" : undefined}
                  >
                    {page}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}
            {currentPage < totalPages && (
              <PaginationItem>
                <PaginationNext
                  href={buildPageUrl(clientId, currentPage + 1)}
                  text="Вперёд"
                  aria-label="Следующая страница"
                />
              </PaginationItem>
            )}
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}

function getPageNumbers(
  current: number,
  total: number,
): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "ellipsis")[] = [1];

  if (current > 3) {
    pages.push("ellipsis");
  }

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) {
    pages.push("ellipsis");
  }

  pages.push(total);

  return pages;
}
