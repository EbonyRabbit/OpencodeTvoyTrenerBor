"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
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
import {
  CLIENT_STATUS_LABELS,
  CLIENT_STATUS_VARIANTS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_VARIANTS,
  FILTER_LABELS,
  type ClientWithProgram,
  type ClientFilter,
} from "@/lib/clients";

function formatDate(dateStr: string) {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("ru-RU");
  } catch {
    return "—";
  }
}

function EmptyState({
  hasFilter,
  currentStatus,
}: {
  hasFilter: boolean;
  currentStatus: ClientFilter;
}) {
  if (!hasFilter) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16"
        role="status"
      >
        <p className="text-lg font-medium">Нет ни одного клиента</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Клиенты появятся после подключения через Telegram
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16"
      role="status"
    >
      <p className="text-lg font-medium">
        Нет клиентов со статусом «{FILTER_LABELS[currentStatus]}»
      </p>
      <Link
        href="/clients"
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
}: {
  page: number;
  totalPages: number;
  currentStatus: ClientFilter;
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
    return `/clients?page=${p}&status=${currentStatus}`;
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

export function ClientsTable({
  clients,
  totalCount,
  page,
  totalPages,
  currentStatus,
}: {
  clients: ClientWithProgram[];
  totalCount: number;
  page: number;
  totalPages: number;
  currentStatus: ClientFilter;
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Имя</TableHead>
            <TableHead>Telegram ID</TableHead>
            <TableHead>Статус</TableHead>
            <TableHead>Оплата</TableHead>
            <TableHead>Программа</TableHead>
            <TableHead>Язык</TableHead>
            <TableHead>Создан</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((client) => (
            <TableRow key={client.id}>
              <TableCell className="max-w-48 truncate font-medium">
                <Link
                  href={`/clients/${client.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {client.name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {client.telegram_id ?? "—"}
              </TableCell>
              <TableCell>
                <Badge variant={CLIENT_STATUS_VARIANTS[client.status] ?? "secondary"}>
                  {CLIENT_STATUS_LABELS[client.status] ?? client.status}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={PAYMENT_STATUS_VARIANTS[client.payment_status] ?? "secondary"}>
                  {PAYMENT_STATUS_LABELS[client.payment_status] ?? client.payment_status}
                </Badge>
              </TableCell>
              <TableCell className="max-w-32 truncate text-muted-foreground">
                {client.program?.title ?? "—"}
              </TableCell>
              <TableCell>{client.language.toUpperCase()}</TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(client.created_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <Paginator
          page={page}
          totalPages={totalPages}
          currentStatus={currentStatus}
        />
      )}
    </div>
  );
}
