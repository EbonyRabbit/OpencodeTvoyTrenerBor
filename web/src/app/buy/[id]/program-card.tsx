"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, Send, Sparkles } from "lucide-react";
import { createCoachRequest } from "./actions";
import {
  DEDUP_ERROR_MESSAGE,
  COACH_REQUEST_ALREADY_SENT_MESSAGE,
} from "@/lib/purchase";
import type { Database } from "@/types/supabase";

export type BuyProgram = Pick<
  Database["public"]["Tables"]["programs"]["Row"],
  "id" | "title" | "type" | "description" | "duration_weeks" | "price"
>;

function ProgramCard({
  program,
  botDeepLink,
}: {
  program: BuyProgram;
  botDeepLink: string;
}) {
  return (
    <Card className="border-0 shadow-lg">
      <CardHeader className="space-y-3 pb-4">
        <CardTitle className="text-xl">{program.title}</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{program.duration_weeks ?? "-"} нед.</Badge>
          <Badge variant="outline">Ведение в Telegram-боте</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {program.description && (
          <p className="text-sm text-muted-foreground">{program.description}</p>
        )}
        <p className="text-sm">
          Программа открывается в Telegram-боте: расписание, логирование
          тренировок и статистика. Подписка оформляется у тренера.
        </p>
        {botDeepLink ? (
          <a
            href={botDeepLink}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "default", size: "lg" }) + " w-full"}
          >
            <Send className="mr-2 h-4 w-4" />
            Открыть в боте
          </a>
        ) : (
          <p className="text-xs text-muted-foreground">
            Бот временно недоступен по ссылке. Найдите его в Telegram по ссылке
            из профиля тренера.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function ProgramCardPage({
  program,
  botDeepLink,
}: {
  program: BuyProgram;
  botDeepLink: string;
}) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [coachConsent, setCoachConsent] = useState(false);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachSubmitted, setCoachSubmitted] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);

  const handleCoachSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setCoachLoading(true);
    setCoachError(null);

    try {
      const result = await createCoachRequest({
        name,
        contact,
        consentGiven: coachConsent,
      });
      if (
        result.error &&
        result.error !== DEDUP_ERROR_MESSAGE &&
        result.error !== COACH_REQUEST_ALREADY_SENT_MESSAGE
      ) {
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

  return (
    <div className="w-full">
      <ProgramCard program={program} botDeepLink={botDeepLink} />

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
                Оставьте заявку - тренер свяжется с вами.
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
                  required
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
