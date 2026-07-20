// DISABLED: photo storage removed — clients save photos on their own devices
// Original component preserved in git history

/*
"use client";

import Image from "next/image";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PHOTO_TYPE_LABELS, PHOTO_TYPE_ORDER } from "@/lib/photos";
import type { Database } from "@/types/supabase";

type PhotoRow = Database["public"]["Tables"]["photos"]["Row"] & {
  resolvedUrl: string | null;
};

function formatDate(date: string | null): string {
  if (!date) return "—";
  try {
    const d = new Date(date + "T00:00:00");
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

// ... rest of the component code omitted for brevity ...
*/
