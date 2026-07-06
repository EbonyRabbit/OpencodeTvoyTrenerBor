"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { PHOTO_TYPE_LABELS, PHOTO_TYPE_ORDER } from "@/lib/photos";
import type { Database } from "@/types/supabase";

type PhotoRow = Database["public"]["Tables"]["photos"]["Row"] & { resolvedUrl: string | null };

function formatDate(date: string | null): string {
  if (!date) return "—";
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function groupPhotosByDate(photos: PhotoRow[]): Map<string, PhotoRow[]> {
  const sorted = [...photos].sort(
    (a, b) => (PHOTO_TYPE_ORDER[a.type] ?? 99) - (PHOTO_TYPE_ORDER[b.type] ?? 99),
  );
  const groups = new Map<string, PhotoRow[]>();
  for (const photo of sorted) {
    const existing = groups.get(photo.date) ?? [];
    existing.push(photo);
    groups.set(photo.date, existing);
  }
  return groups;
}

function focusTrap(el: HTMLElement, e: KeyboardEvent) {
  if (e.key !== "Tab") return;
  const focusable = el.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

const CloseIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80709 2.99385 3.44302 2.99385 3.21847 3.2184C2.99392 3.44295 2.99392 3.80702 3.21847 4.03157L6.68688 7.49999L3.21847 10.9684C2.99392 11.1929 2.99392 11.557 3.21847 11.7816C3.44302 12.0061 3.80709 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.1929 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
  </svg>
);

const ChevronLeftIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8.84182 3.13514C9.04327 3.32401 9.05348 3.64042 8.86462 3.84188L5.43521 7.49991L8.86462 11.1579C9.05348 11.3594 9.04327 11.6758 8.84182 11.8647C8.64036 12.0535 8.32394 12.0433 8.13508 11.8419L4.38508 7.84188C4.20477 7.64945 4.20477 7.35036 4.38508 7.15793L8.13508 3.15793C8.32394 2.95647 8.64036 2.94626 8.84182 3.13514Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6.1584 3.13508C6.35985 2.94621 6.67627 2.95642 6.86514 3.15788L10.6151 7.15788C10.7954 7.35031 10.7954 7.6494 10.6151 7.84183L6.86514 11.8418C6.67627 12.0433 6.35985 12.0535 6.1584 11.8646C5.95694 11.6758 5.94673 11.3593 6.1356 11.1579L9.565 7.49985L6.1356 3.84183C5.94673 3.64038 5.95694 3.32396 6.1584 3.13508Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
  </svg>
);

export function PhotoGallery({
  clientId,
  clientName,
  photos,
  currentPage,
  totalPages,
}: {
  clientId: string;
  clientName: string;
  photos: PhotoRow[];
  currentPage: number;
  totalPages: number;
}) {
  const [lightboxPhoto, setLightboxPhoto] = useState<PhotoRow | null>(null);
  const [lightboxGroup, setLightboxGroup] = useState<PhotoRow[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const lightboxRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  const openLightbox = useCallback(
    (photo: PhotoRow, group: PhotoRow[]) => {
      if (!photo.resolvedUrl || failedImages.has(photo.id)) return;
      const idx = group.findIndex((p) => p.id === photo.id);
      setLightboxPhoto(photo);
      setLightboxGroup(group);
      setCurrentIndex(idx);
    },
    [failedImages],
  );

  const closeLightbox = useCallback(() => {
    setLightboxPhoto(null);
    setLightboxGroup([]);
  }, []);

  const navigateLightbox = useCallback(
    (direction: "prev" | "next") => {
      const offset = direction === "next" ? 1 : -1;
      const nextIndex =
        (currentIndex + offset + lightboxGroup.length) % lightboxGroup.length;
      setCurrentIndex(nextIndex);
      setLightboxPhoto(lightboxGroup[nextIndex]);
    },
    [currentIndex, lightboxGroup],
  );

  useEffect(() => {
    if (!lightboxPhoto) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [lightboxPhoto]);

  useEffect(() => {
    if (!lightboxPhoto) return;
    const el = lightboxRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => focusTrap(el, e);
    el.addEventListener("keydown", handler);
    const timeoutId = setTimeout(() => {
      const first = el?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      first?.focus();
    }, 50);
    return () => {
      el.removeEventListener("keydown", handler);
      clearTimeout(timeoutId);
    };
  }, [lightboxPhoto]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!lightboxPhoto) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") navigateLightbox("prev");
      if (e.key === "ArrowRight") navigateLightbox("next");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxPhoto, closeLightbox, navigateLightbox]);

  const groups = useMemo(() => groupPhotosByDate(photos), [photos]);
  const pages = getPageNumbers(currentPage, totalPages);

  if (photos.length === 0) {
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
            <CardTitle>Прогресс-фото — {clientName}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              У клиента нет прогресс-фото.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div ref={mainRef} aria-hidden={!!lightboxPhoto}>
        <div className="space-y-6">
          <Link
            href={`/clients/${clientId}`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Назад к клиенту
          </Link>

          <Card>
            <CardHeader>
              <CardTitle>Прогресс-фото — {clientName}</CardTitle>
            </CardHeader>
            <CardContent>
              {Array.from(groups.entries()).map(([date, group]) => (
                <div key={date} className="mb-8 last:mb-0">
                  <h3 className="mb-3 text-sm font-medium text-muted-foreground">
                    {formatDate(date)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({group.length} фото)
                    </span>
                  </h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                    {group.map((photo) => (
                      <button
                        key={photo.id}
                        type="button"
                        className="group relative aspect-[3/4] w-full overflow-hidden rounded-lg border bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => openLightbox(photo, group)}
                        aria-label={`${PHOTO_TYPE_LABELS[photo.type] ?? "Фото"} от ${formatDate(photo.date)}`}
                      >
                        {photo.resolvedUrl && !failedImages.has(photo.id) ? (
                          <Image
                            src={photo.resolvedUrl}
                            alt={PHOTO_TYPE_LABELS[photo.type] ?? "Фото"}
                            fill
                            className="object-cover transition-transform group-hover:scale-105"
                            sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, 33vw"
                            onError={() => setFailedImages((prev) => new Set(prev).add(photo.id))}
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <span className="text-sm text-muted-foreground">
                              Нет фото
                            </span>
                          </div>
                        )}
                        <Badge
                          className="absolute left-2 top-2"
                          variant="secondary"
                        >
                          {PHOTO_TYPE_LABELS[photo.type] ?? photo.type}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {totalPages > 1 && (
            <Pagination role="navigation" aria-label="Пагинация">
              <PaginationContent>
                {currentPage > 1 && (
                  <PaginationItem>
                    <PaginationPrevious
                      href={buildPageUrl(`/clients/${clientId}/photos`, currentPage - 1)}
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
                        href={buildPageUrl(`/clients/${clientId}/photos`, page)}
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
                      href={buildPageUrl(`/clients/${clientId}/photos`, currentPage + 1)}
                      text="Вперёд"
                      aria-label="Следующая страница"
                    />
                  </PaginationItem>
                )}
              </PaginationContent>
            </Pagination>
          )}
        </div>
      </div>

      {lightboxPhoto && (
        <div
          ref={lightboxRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${PHOTO_TYPE_LABELS[lightboxPhoto.type] ?? "Фото"} от ${formatDate(lightboxPhoto.date)}`}
          onClick={closeLightbox}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {lightboxPhoto.resolvedUrl && !failedImages.has(lightboxPhoto.id) ? (
              <Image
                src={lightboxPhoto.resolvedUrl}
                alt={PHOTO_TYPE_LABELS[lightboxPhoto.type] ?? "Фото"}
                width={800}
                height={1067}
                className="h-auto max-h-[85vh] w-auto rounded-lg object-contain"
                priority
                onError={() => setFailedImages((prev) => new Set(prev).add(lightboxPhoto.id))}
              />
            ) : (
              <div className="flex h-64 w-80 items-center justify-center rounded-lg bg-muted">
                <span className="text-sm text-muted-foreground">
                  Фото недоступно
                </span>
              </div>
            )}
            <div className="absolute left-4 top-4 flex gap-2">
              <Badge variant="secondary">
                {PHOTO_TYPE_LABELS[lightboxPhoto.type] ?? lightboxPhoto.type}
              </Badge>
              <Badge variant="outline" className="bg-background/80">
                {formatDate(lightboxPhoto.date)}
              </Badge>
            </div>
            <div className="absolute right-4 top-4">
              <Button
                variant="secondary"
                size="icon"
                onClick={closeLightbox}
                aria-label="Закрыть"
                type="button"
              >
                <CloseIcon />
              </Button>
            </div>
            {lightboxGroup.length > 1 && (
              <>
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute left-4 top-1/2 -translate-y-1/2"
                  onClick={() => navigateLightbox("prev")}
                  aria-label="Предыдущее фото"
                  type="button"
                >
                  <ChevronLeftIcon />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute right-4 top-1/2 -translate-y-1/2"
                  onClick={() => navigateLightbox("next")}
                  aria-label="Следующее фото"
                  type="button"
                >
                  <ChevronRightIcon />
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
