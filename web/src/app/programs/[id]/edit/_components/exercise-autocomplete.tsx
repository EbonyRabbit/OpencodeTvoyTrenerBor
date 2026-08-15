"use client";

import { useState, useRef, useEffect, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase-browser";
import { escapeSearch } from "@/lib/clients";
import type { Database } from "@/types/supabase";

type ExerciseRow = Database["public"]["Tables"]["exercises"]["Row"];

const DEBOUNCE_MS = 300;
const MAX_RESULTS = 10;

export function ExerciseAutocomplete({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [supabase] = useState(() => createClient());
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<ExerciseRow[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const showManualInput = !isLoading && query.trim().length > 0;
  const totalOptions = results.length + (showManualInput ? 1 : 0);

  const updatePosition = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const scrollParents: Element[] = [];
    let el: Element | null = containerRef.current;
    while (el) {
      const style = getComputedStyle(el);
      if (
        style.overflow === "auto" ||
        style.overflow === "scroll" ||
        style.overflowX === "auto" ||
        style.overflowX === "scroll" ||
        style.overflowY === "auto" ||
        style.overflowY === "scroll"
      ) {
        scrollParents.push(el);
      }
      el = el.parentElement;
    }

    const onScroll = () => {
      updatePosition();
    };
    scrollParents.forEach((p) => p.addEventListener("scroll", onScroll, { passive: true }));
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", updatePosition);

    return () => {
      scrollParents.forEach((p) => p.removeEventListener("scroll", onScroll));
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen, updatePosition]);

  const searchExercises = useCallback(
    async (searchQuery: string, requestId: number) => {
      if (!searchQuery.trim()) {
        setResults([]);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const escaped = escapeSearch(searchQuery.trim());
      const { data, error } = await supabase
        .from("exercises")
        .select("*")
        .ilike("name", `%${escaped}%`)
        .limit(MAX_RESULTS)
        .abortSignal(controller.signal);

      if (requestId !== requestIdRef.current) return;

      setIsLoading(false);

      if (error) {
        setResults([]);
        setHighlightedIndex(-1);
        return;
      }

      if (data) {
        setResults(data);
        setHighlightedIndex(-1);
      }
    },
    [supabase]
  );

  function handleChange(newValue: string) {
    setQuery(newValue);
    onChange(newValue);
    setHighlightedIndex(-1);

    if (timerRef.current) clearTimeout(timerRef.current);
    abortRef.current?.abort();

    if (!newValue.trim()) {
      setResults([]);
      setIsOpen(false);
      setIsLoading(false);
      return;
    }

    setIsOpen(true);
    setResults([]);
    setIsLoading(true);
    requestIdRef.current++;
    const currentRequestId = requestIdRef.current;
    timerRef.current = setTimeout(() => {
      searchExercises(newValue, currentRequestId).catch(() => {
        if (currentRequestId === requestIdRef.current) {
          setIsLoading(false);
        }
      });
    }, DEBOUNCE_MS);
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const item = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`);
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  function handleSelect(exercise: ExerciseRow) {
    setQuery(exercise.name);
    onChange(exercise.name);
    setIsOpen(false);
    setHighlightedIndex(-1);
    inputRef.current?.blur();
  }

  function handleManualInput() {
    const trimmed = query.trim();
    if (!trimmed) return;
    onChange(trimmed);
    setIsOpen(false);
    setHighlightedIndex(-1);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen || totalOptions === 0) {
      if (e.key === "Escape") {
        inputRef.current?.blur();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % totalOptions);
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev <= 0 ? totalOptions - 1 : prev - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < results.length) {
          handleSelect(results[highlightedIndex]);
        } else if (highlightedIndex === results.length) {
          handleManualInput();
        } else if (results.length > 0) {
          handleSelect(results[0]);
        } else if (query.trim()) {
          handleManualInput();
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
    }
  }

  function handleFocus() {
    if (query.trim().length > 0) {
      setIsOpen(true);
    }
  }

  const showDropdown = isOpen && totalOptions > 0;
  const listboxId = `exercise-listbox-${useId().replace(/:/g, "")}`;
  const activeId =
    highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined;

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-label="Упражнение"
      />
      {showDropdown &&
        createPortal(
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            className="fixed z-50 max-h-60 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md"
            style={{
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
              minWidth: 200,
            }}
          >
            {results.map((exercise, idx) => (
              <li
                key={exercise.id}
                id={`${listboxId}-option-${idx}`}
                data-index={idx}
                role="option"
                aria-selected={idx === highlightedIndex}
                className={`flex cursor-pointer flex-col px-3 py-2 text-xs transition-colors hover:bg-accent hover:text-accent-foreground ${
                  idx === highlightedIndex ? "bg-accent text-accent-foreground" : ""
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(exercise);
                }}
                onMouseEnter={() => setHighlightedIndex(idx)}
              >
                <span className="font-medium">{exercise.name}</span>
                <span className="flex flex-wrap items-center gap-1">
                  {(exercise.muscle_group || exercise.equipment) && (
                    <span className="text-muted-foreground">
                      {[exercise.muscle_group, exercise.equipment].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  {(exercise.technique_ru || exercise.technique_en) && (
                    <span className="rounded-sm bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
                      📚 техника
                    </span>
                  )}
                  {exercise.video_url && (
                    <span className="rounded-sm bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
                      📺 видео
                    </span>
                  )}
                </span>
              </li>
            ))}
            {isLoading && (
              <li className="px-3 py-2 text-xs text-muted-foreground">Поиск…</li>
            )}
            {!isLoading && query.trim().length > 0 && results.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">
                Ничего не найдено
              </li>
            )}
            {!isLoading && query.trim().length > 0 && (
              <li
                role="option"
                data-index={results.length}
                aria-selected={highlightedIndex === results.length}
                className={`flex cursor-pointer items-center gap-2 border-t px-3 py-2 text-xs italic text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground ${
                  highlightedIndex === results.length ? "bg-accent text-accent-foreground" : ""
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleManualInput();
                }}
                onMouseEnter={() => setHighlightedIndex(results.length)}
              >
                Использовать &ldquo;{query.trim()}&rdquo; как название
              </li>
            )}
          </ul>,
          document.body
        )}
    </div>
  );
}
