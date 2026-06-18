"use client";

/* eslint-disable @typescript-eslint/no-unused-vars */

export default function DashboardError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="flex-1 p-6">
      <h2 className="text-2xl font-bold">Дашборд</h2>
      <p className="mt-4 text-destructive">Не удалось загрузить дашборд. Попробуйте позже.</p>
    </main>
  );
}
