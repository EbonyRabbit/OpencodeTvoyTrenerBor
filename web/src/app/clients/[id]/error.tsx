"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">Ошибка загрузки</h1>
      <p className="text-muted-foreground">
        Не удалось загрузить профиль клиента. Попробуйте снова.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset} type="button">
          Попробовать снова
        </Button>
        <Link href="/clients" className={buttonVariants({ variant: "outline" })}>
          Назад к клиентам
        </Link>
      </div>
    </div>
  );
}
