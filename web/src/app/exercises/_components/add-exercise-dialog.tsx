"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ExerciseForm } from "./exercise-form";

export function AddExerciseDialog() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(buttonVariants({ variant: "default", size: "sm" }))}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Plus />
        <span>Добавить упражнение</span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-20 grid place-items-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-exercise-title"
          onClick={() => setOpen(false)}
        >
          <div
            className="h-full max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="add-exercise-title" className="mb-3 text-sm font-semibold">
              Новое упражнение
            </h2>
            <ExerciseForm onDone={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}