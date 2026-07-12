import type { Database } from "@/types/supabase";

export type ProgramRow = Database["public"]["Tables"]["programs"]["Row"];
export type ProgramStatus = "draft" | "active" | "archived";

export const VALID_STATUSES = ["all", "draft", "active", "archived"] as const;
export type ProgramFilter = (typeof VALID_STATUSES)[number];

export function getProgramStatus(
  program: Pick<ProgramRow, "active" | "parsed_content">,
): ProgramStatus {
  if (program.active) return "active";
  if (program.parsed_content !== null) return "archived";
  return "draft";
}

export const STATUS_LABELS: Record<ProgramStatus, string> = {
  draft: "Черновик",
  active: "Активна",
  archived: "Архивирована",
};

export const STATUS_VARIANTS: Record<
  ProgramStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "secondary",
  active: "default",
  archived: "outline",
};

export const FILTER_LABELS: Record<ProgramFilter, string> = {
  all: "Все",
  draft: "Черновики",
  active: "Активные",
  archived: "Архив",
};
