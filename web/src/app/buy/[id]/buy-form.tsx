"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, ShoppingCart } from "lucide-react";
import { createPurchaseRequest } from "./actions";
import { formatPrice } from "@/lib/format-price";
import { DEDUP_ERROR_MESSAGE } from "@/lib/purchase";
import type { Database } from "@/types/supabase";

export type BuyProgram = Pick<
  Database["public"]["Tables"]["programs"]["Row"],
  "id" | "title" | "type" | "description" | "duration_weeks" | "price"
>;

export function BuyForm({
  program,
  initialContact,
  telegramId,
  telegramUsername,
}: {
  program: BuyProgram;
  initialContact: string;
  telegramId: number | null;
  telegramUsername: string | null;
}) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState(initialContact);
  const [tgId, setTgId] = useState(telegramId !== null ? String(telegramId) : "");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await createPurchaseRequest({
        programId: program.id,
        name,
        contact,
        telegramId: tgId.trim() !== "" ? tgId.trim() : null,
        telegramUsername,
      });
      if (result.error && result.error !== DEDUP_ERROR_MESSAGE) {
        setError(result.error);
      } else {
        setSubmitted(true);
      }
    } catch {
      setError("Произошла ошибка. Попробуйте позже.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <Card>
        <CardContent className="py-10 text-center" aria-live="polite">
          <Check className="mx-auto mb-3 h-10 w-10 text-green-600" />
          <p className="text-lg font-semibold">Заявка отправлена!</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Тренер свяжется с вами для оплаты и активации программы
            «{program.title}».
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-lg">
      <CardHeader className="space-y-3 pb-4">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-primary" />
          <CardTitle className="text-xl">{program.title}</CardTitle>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{program.type ?? "Программа"}</Badge>
          <Badge variant="outline">
            {program.duration_weeks ?? "—"} нед.
          </Badge>
          {program.price !== null && program.price > 0 && (
            <Badge variant="outline">{formatPrice(program.price)} ₽</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {program.description && (
            <p className="text-sm text-muted-foreground">{program.description}</p>
          )}

          <p className="text-sm">
            Оставьте заявку — тренер пришлёт реквизиты для оплаты и активирует
            программу после подтверждения.
          </p>

          <div className="space-y-2">
            <label htmlFor="buy-name" className="text-xs text-muted-foreground">
              Ваше имя
            </label>
            <Input
              id="buy-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Иван"
              maxLength={200}
              className="h-10"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="buy-contact" className="text-xs text-muted-foreground">
              Telegram для связи
            </label>
            <Input
              id="buy-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="@username"
              maxLength={120}
              className="h-10"
            />
            <p className="text-xs text-muted-foreground">
              Напишите @username или номер телефона — тренер свяжется с вами.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="buy-tgid" className="text-xs text-muted-foreground">
              Telegram ID (для карточки клиента)
            </label>
            <Input
              id="buy-tgid"
              value={tgId}
              onChange={(e) => setTgId(e.target.value)}
              placeholder="123456789"
              maxLength={15}
              inputMode="numeric"
              className="h-10"
            />
            <p className="text-xs text-muted-foreground">
              Заполняется автоматически при переходе из бота. Можно узнать через @userinfobot.
            </p>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" disabled={submitting} className="w-full" size="lg">
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Отправка...
              </>
            ) : (
              <>
                <ShoppingCart className="mr-2 h-4 w-4" />
                Оставить заявку
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
