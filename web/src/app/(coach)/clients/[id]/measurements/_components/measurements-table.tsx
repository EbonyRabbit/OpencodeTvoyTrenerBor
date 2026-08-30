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
import { buildPageUrl, getPageNumbers } from "@/lib/pagination";
import type { Database } from "@/types/supabase";

type MeasurementRow = Database["public"]["Tables"]["measurements"]["Row"];

function formatDate(date: string | null): string {
  if (!date) return "-";
  try {
    return new Date(date).toLocaleDateString("ru-RU");
  } catch {
    return "-";
  }
}

function MeasureValue({ value, suffix = "" }: { value: number | null; suffix?: string }) {
  if (value === null) {
    return <span className="text-muted-foreground">-</span>;
  }
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return <span className="font-medium tabular-nums">{formatted}{suffix}</span>;
}

export function MeasurementsTable({
  clientId,
  clientName,
  measurements,
  currentPage,
  totalPages,
}: {
  clientId: string;
  clientName: string;
  measurements: MeasurementRow[];
  currentPage: number;
  totalPages: number;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (measurements.length === 0) {
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
            <CardTitle>Замеры тела - {clientName}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              У клиента нет замеров тела.
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
          <CardTitle>Замеры тела - {clientName}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table aria-label="Замеры тела клиента">
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="whitespace-nowrap">Дата</TableHead>
                <TableHead scope="col" className="whitespace-nowrap">Вес, кг</TableHead>
                <TableHead scope="col" className="whitespace-nowrap">Талия, см</TableHead>
                <TableHead scope="col" className="whitespace-nowrap">Живот, см</TableHead>
                <TableHead scope="col" className="whitespace-nowrap">Грудь, см</TableHead>
                <TableHead scope="col" className="whitespace-nowrap">Бёдра, см</TableHead>
                <TableHead scope="col" className="whitespace-nowrap">Ягодицы, см</TableHead>
                <TableHead scope="col" className="whitespace-nowrap">Лев. бедро, см</TableHead>
                <TableHead scope="col" className="whitespace-nowrap">Пр. бедро, см</TableHead>
                <TableHead scope="col" className="whitespace-nowrap">Лев. рука, см</TableHead>
                <TableHead scope="col" className="whitespace-nowrap">Пр. рука, см</TableHead>
                <TableHead scope="col" className="whitespace-nowrap">Жир, %</TableHead>
                <TableHead scope="col" className="whitespace-nowrap">Мышеч. масса, кг</TableHead>
                <TableHead scope="col" className="whitespace-nowrap">Висц. жир</TableHead>
                <TableHead scope="col" className="max-w-[150px]">Комментарий</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {measurements.flatMap((m) => {
                const isExpanded = expandedId === m.id;
                const hasComment = !!m.comment;
                const rows: React.ReactElement[] = [
                  <TableRow
                    key={m.id}
                    className={hasComment ? "cursor-pointer" : ""}
                    tabIndex={hasComment ? 0 : undefined}
                    role={hasComment ? "button" : undefined}
                    aria-expanded={hasComment ? isExpanded : undefined}
                    onClick={
                      hasComment
                        ? () => setExpandedId(isExpanded ? null : m.id)
                        : undefined
                    }
                    onKeyDown={
                      hasComment
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setExpandedId(isExpanded ? null : m.id);
                            }
                          }
                        : undefined
                    }
                  >
                    <TableCell className="whitespace-nowrap">{formatDate(m.date)}</TableCell>
                    <TableCell><MeasureValue value={m.weight} /></TableCell>
                    <TableCell><MeasureValue value={m.waist} /></TableCell>
                    <TableCell><MeasureValue value={m.abdomen} /></TableCell>
                    <TableCell><MeasureValue value={m.chest} /></TableCell>
                    <TableCell><MeasureValue value={m.hips} /></TableCell>
                    <TableCell><MeasureValue value={m.glutes} /></TableCell>
                    <TableCell><MeasureValue value={m.left_thigh} /></TableCell>
                    <TableCell><MeasureValue value={m.right_thigh} /></TableCell>
                    <TableCell><MeasureValue value={m.left_arm} /></TableCell>
                    <TableCell><MeasureValue value={m.right_arm} /></TableCell>
                    <TableCell><MeasureValue value={m.body_fat} /></TableCell>
                    <TableCell><MeasureValue value={m.muscle_mass} /></TableCell>
                    <TableCell><MeasureValue value={m.visceral_fat} /></TableCell>
                    <TableCell className="max-w-[150px] truncate">
                      {m.comment ? (
                        <span className="text-muted-foreground">{m.comment}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>,
                ];
                if (isExpanded && hasComment) {
                  rows.push(
                    <TableRow key={`${m.id}-detail`}>
                      <TableCell colSpan={15} className="bg-muted/30 p-4">
                        <div className="space-y-2 text-sm">
                          <div>
                            <span className="font-medium text-muted-foreground">
                              Комментарий:
                            </span>
                            <p className="mt-0.5 whitespace-pre-wrap">
                              {m.comment}
                            </p>
                          </div>
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
                  href={buildPageUrl(`/clients/${clientId}/measurements`, currentPage - 1)}
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
                    href={buildPageUrl(`/clients/${clientId}/measurements`, page)}
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
                  href={buildPageUrl(`/clients/${clientId}/measurements`, currentPage + 1)}
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

