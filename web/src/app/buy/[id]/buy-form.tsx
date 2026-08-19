"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, ShoppingCart, Sparkles } from "lucide-react";
import { createPurchaseRequest, createCoachRequest } from "./actions";
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
  const [tgId, setTgId] = useState(
    telegramId !== null ? String(telegramId) : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [coachConsent, setCoachConsent] = useState(false);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachSubmitted, setCoachSubmitted] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);

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

  const handleCoachSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setCoachLoading(true);
    setCoachError(null);

    try {
      const result = await createCoachRequest({
        name,
        contact,
        consentGiven: coachConsent,
        telegramId: tgId.trim() !== "" ? tgId.trim() : null,
        telegramUsername,
      });
      if (result.error && result.error !== DEDUP_ERROR_MESSAGE) {
        setCoachError(result.error);
      } else {
        setCoachSubmitted(true);
      }
    } catch {
      setCoachError("Произошла ошибка. Попробуйте позже.");
    } finally {
      setCoachLoading(false);
    }
  };

  if (submitted) {
    return (
      <Card>
        <CardContent className="py-10 text-center" aria-live="polite">
          <Check className="mx-auto mb-3 h-10 w-10 text-green-600" />
          <p className="text-lg font-semibold">Заявка отправлена!</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Тренер свяжется с вами для оплаты и активации программы «
            {program.title}».
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="w-full">
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
              <p className="text-sm text-muted-foreground">
                {program.description}
              </p>
            )}

            <p className="text-sm">
              Оставьте заявку — тренер пришлёт реквизиты для оплаты и активирует
              программу после подтверждения.
            </p>

            <div className="space-y-2">
              <label
                htmlFor="buy-name"
                className="text-xs text-muted-foreground"
              >
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
              <label
                htmlFor="buy-contact"
                className="text-xs text-muted-foreground"
              >
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
              <label
                htmlFor="buy-tgid"
                className="text-xs text-muted-foreground"
              >
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
                Заполняется автоматически при переходе из бота. Можно узнать
                через @userinfobot.
              </p>
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="w-full"
              size="lg"
            >
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

      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <span>или</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {coachSubmitted ? (
        <Card aria-live="polite">
          <CardContent className="py-8 text-center">
            <Check className="mx-auto mb-3 h-8 w-8 text-green-600" />
            <p className="font-semibold">Заявка отправлена!</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Тренер свяжется с вами для обсуждения индивидуального ведения.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-lg">
          <CardHeader className="space-y-3 pb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <CardTitle className="text-xl">Индивидуальное ведение</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCoachSubmit} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Хотите персональную программу, питание и сопровождение 1-на-1?
                Оставьте заявку — тренер свяжется с вами.
              </p>

              <div className="space-y-2">
                <label
                  htmlFor="coach-name"
                  className="text-xs text-muted-foreground"
                >
                  Ваше имя
                </label>
                <Input
                  id="coach-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Иван"
                  maxLength={200}
                  className="h-10"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="coach-contact"
                  className="text-xs text-muted-foreground"
                >
                  Telegram для связи
                </label>
                <Input
                  id="coach-contact"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="@username"
                  maxLength={120}
                  className="h-10"
                />
              </div>

              <label
                htmlFor="coach-consent"
                className="flex items-start gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  id="coach-consent"
                  checked={coachConsent}
                  onChange={(e) => setCoachConsent(e.target.checked)}
                  disabled={coachLoading}
                  className="mt-0.5"
                />
                <span>
                  Я ознакомлен(а) с{" "}
                  <Link
                    href="/privacy"
                    target="_blank"
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    Политикой конфиденциальности
                  </Link>{" "}
                  и даю согласие на обработку моих персональных данных
                </span>
              </label>

              {coachError && (
                <p className="text-sm text-destructive" role="alert">
                  {coachError}
                </p>
              )}

              <Button
                type="submit"
                disabled={coachLoading}
                className="w-full"
                size="lg"
                variant="secondary"
              >
                {coachLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Отправка...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Хочу индивидуальное ведение
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
