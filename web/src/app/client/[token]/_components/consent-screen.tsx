"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { acceptConsent } from "../actions";

interface ConsentScreenProps {
  token: string;
  clientName: string;
  privacyPolicyVersion: string;
}

export function ConsentScreen({
  token,
  clientName,
  privacyPolicyVersion,
}: ConsentScreenProps) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = useCallback(async () => {
    if (!checked) return;
    setLoading(true);
    setError(null);
    try {
      const result = await acceptConsent();
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    } catch {
      setError("Произошла ошибка. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  }, [checked, router]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Добро пожаловать!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Привет, {clientName}
          </p>
        </div>

        <div className="rounded-lg border p-6">
          <h2 className="mb-4 text-base font-semibold">
            Согласие на обработку персональных данных
          </h2>

          <div className="mb-4 max-h-64 overflow-y-auto rounded-md bg-muted/50 p-4 text-sm leading-relaxed text-muted-foreground">
            <p className="mb-3">
              Для использования сервиса &laquo;ТвойТренерБот&raquo; необходимо
              дать согласие на обработку ваших персональных данных в
              соответствии с Федеральным законом от 27.07.2006 &laquo;О
              персональных данных&raquo; №152-ФЗ.
            </p>
            <p className="mb-3">Мы собираем и обрабатываем:</p>
            <ul className="mb-3 ml-4 list-inside list-disc space-y-1">
              <li>Параметры тела (вес, объёмы, процент жира)</li>
              <li>Фотографии прогресса</li>
              <li>Данные о тренировках</li>
              <li>Данные о самочувствии (сон, стресс, настроение)</li>
            </ul>
            <p className="mb-3">
              Подробности в{" "}
              <Link
                href="/privacy"
                target="_blank"
                className="underline underline-offset-4 hover:text-foreground"
              >
                Политике конфиденциальности
              </Link>
              .
            </p>
            <p>
              Вы можете отозвать согласие и запросить удаление своих данных в
              любой момент.
            </p>
          </div>

          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="client-consent"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              disabled={loading}
              className="mt-0.5"
            />
            <label htmlFor="client-consent" className="text-sm">
              Я ознакомлен(а) с Политикой конфиденциальности и даю согласие
              на обработку моих персональных данных
            </label>
          </div>

          {error && (
            <p className="mt-3 text-sm text-destructive">{error}</p>
          )}
        </div>

        <Button
          onClick={handleAccept}
          disabled={!checked || loading}
          className="w-full"
        >
          {loading ? "Сохранение..." : "Продолжить"}
        </Button>
      </div>
    </div>
  );
}
