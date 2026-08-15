"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Send,
  CheckCheck,
  AlertCircle,
  Loader2,
  ChevronUp,
} from "lucide-react";
import Link from "next/link";
import type { Database } from "@/types/supabase";

type Message = Database["public"]["Tables"]["messages"]["Row"];

const POLL_INTERVAL = 5000;
const POLL_LIMIT = 50;

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function formatDateLabel(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "—";
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return "Сегодня";
    if (d.toDateString() === yesterday.toDateString()) return "Вчера";

    return d.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
    });
  } catch {
    return "—";
  }
}

function groupByDate(messages: Message[]): [string, Message[]][] {
  const groups = new Map<string, Message[]>();
  for (const msg of messages) {
    const dateKey = msg.sent_at?.split("T")[0] ?? msg.created_at?.split("T")[0] ?? "unknown";
    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey)!.push(msg);
  }
  return Array.from(groups.entries());
}

function MessageBubble({ msg }: { msg: Message }) {
  const isFromCoach = msg.direction === "to_client";

  return (
    <div className={`flex ${isFromCoach ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          isFromCoach ? "bg-primary text-primary-foreground" : "bg-muted"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{msg.text}</p>
        <div
          className={`mt-1 flex items-center gap-1 text-[10px] ${
            isFromCoach
              ? "justify-end text-primary-foreground/70"
              : "text-muted-foreground"
          }`}
        >
          <span>{formatTime(msg.sent_at)}</span>
          {isFromCoach && <CheckCheck className="h-3 w-3" />}
        </div>
      </div>
    </div>
  );
}

export function ChatInterface({
  clientId,
  clientName,
  initialMessages,
  initialHasMore,
  coachId,
}: {
  clientId: string;
  clientName: string;
  initialMessages: Message[];
  initialHasMore: boolean;
  coachId: string;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendWarning, setSendWarning] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const supabaseRef = useRef(createClient());
  const lastSentAtRef = useRef<string | null>(
    initialMessages.length > 0
      ? initialMessages[initialMessages.length - 1].sent_at
      : null,
  );

  const isNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }, []);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    if (isNearBottom()) {
      scrollToBottom();
    }
  }, [messages, isNearBottom, scrollToBottom]);

  useEffect(() => {
    const interval = setInterval(async () => {
      const query = supabaseRef.current
        .from("messages")
        .select("*")
        .eq("client_id", clientId)
        .order("sent_at", { ascending: true })
        .limit(POLL_LIMIT);

      const lastSentAt = lastSentAtRef.current;
      const finalQuery = lastSentAt ? query.gt("sent_at", lastSentAt) : query;

      const { data, error } = await finalQuery;

      if (!error && data && data.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newMsgs = (data as Message[]).filter((m) => !existingIds.has(m.id));
          if (newMsgs.length === 0) return prev;

          const hasClientMessages = newMsgs.some((m) => m.direction === "to_coach");
          if (hasClientMessages) {
            fetch("/clients/" + clientId + "/chat/api/mark-read", {
              method: "POST",
            }).catch(() => {});
          }

          return [...prev, ...newMsgs];
        });
        lastSentAtRef.current = data[data.length - 1].sent_at;
      }
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [clientId]);

  // mark messages as read on initial load
  useEffect(() => {
    fetch("/clients/" + clientId + "/chat/api/mark-read", {
      method: "POST",
    }).catch(() => {});
  }, [clientId]);

  async function loadMore() {
    if (loadingMore || messages.length === 0) return;
    setLoadingMore(true);

    try {
      const oldestSentAt = messages[0].sent_at;
      const resp = await fetch(
        `/clients/${clientId}/chat/api/messages?before=${encodeURIComponent(oldestSentAt)}`,
      );
      const result = await resp.json();

      if (result.messages && result.messages.length > 0) {
        const scrollHeightBefore = scrollRef.current?.scrollHeight ?? 0;
        setMessages((prev) => [...(result.messages as Message[]), ...prev]);
        setHasMore(result.hasMore ?? false);

        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight - scrollHeightBefore;
          }
        });
      } else {
        setHasMore(false);
      }
    } catch {
      // silently fail on network errors during pagination
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newMessage.trim();
    if (!trimmed || sending) return;

    const tempId = "optimistic-" + Date.now();

    const optimisticMsg: Message = {
      id: tempId,
      client_id: clientId,
      coach_id: coachId,
      direction: "to_client",
      text: trimmed,
      sent_at: new Date().toISOString(),
      read_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setNewMessage("");
    setSending(true);
    setSendError(null);
    setSendWarning(null);

    requestAnimationFrame(scrollToBottom);

    try {
      const resp = await fetch("/clients/" + clientId + "/chat/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, idempotency_key: tempId }),
      });

      const result = await resp.json();

      if (result.error) {
        setSendError(result.error);
        setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
        setNewMessage(trimmed);
        return;
      }

      if (result.warning) {
        setSendWarning(result.warning);
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId
            ? { ...m, id: result.messageId ?? m.id, coach_id: result.coachId ?? coachId }
            : m,
        ),
      );
      lastSentAtRef.current = optimisticMsg.sent_at;
    } catch {
      setSendError("Не удалось отправить сообщение. Попробуйте снова.");
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
      setNewMessage(trimmed);
    } finally {
      setSending(false);
    }
  }

  const grouped = useMemo(() => groupByDate(messages), [messages]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href={`/clients/${clientId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {clientName}
        </Link>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-medium">{clientName}</h2>
        </div>

        <div
          ref={scrollRef}
          className="flex h-[60vh] flex-col gap-4 overflow-y-auto p-4"
        >
          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ChevronUp className="h-3 w-3" />
                )}
                Загрузить ранее
              </Button>
            </div>
          )}

          {messages.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-muted-foreground">
                Напишите первое сообщение
              </p>
            </div>
          ) : (
            grouped.map(([dateKey, groupMsgs]) => (
              <div key={dateKey}>
                <div className="relative mb-4 flex items-center gap-2">
                  <Separator className="flex-1" />
                  <span className="shrink-0 text-xs text-muted-foreground" suppressHydrationWarning>
                    {formatDateLabel(dateKey)}
                  </span>
                  <Separator className="flex-1" />
                </div>

                <div className="space-y-2">
                  {groupMsgs.map((msg) => (
                    <MessageBubble key={msg.id} msg={msg} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="border-t p-4">
          {sendError && (
            <div className="mb-2 flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{sendError}</span>
            </div>
          )}
          {sendWarning && (
            <div className="mb-2 flex items-center gap-2 text-sm text-amber-600">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{sendWarning}</span>
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              value={newMessage}
              onChange={(e) => {
                setNewMessage(e.target.value);
                if (sendError) setSendError(null);
                if (sendWarning) setSendWarning(null);
              }}
              placeholder="Напишите сообщение..."
              disabled={sending}
              maxLength={4000}
              className="flex-1"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!newMessage.trim() || sending}
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
