"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Photos page error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">Ошибка загрузки</h1>
      <p className="text-muted-foreground">
        Не удалось загрузить прогресс-фото клиента. Попробуйте снова.
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
