import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { createClient } from "@/lib/supabase-server";
import { getPauseHistory } from "@/lib/plan-adjustment";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("name")
    .eq("id", id)
    .maybeSingle<{ name: string }>();
  return {
    title: data?.name ? `Паузы — ${data.name}` : "Паузы",
  };
}

const REASON_LABELS: Record<string, string> = {
  sick: "Болезнь",
  vacation: "Отпуск",
  injury: "Травма",
  personal: "Личное",
  other: "Другое",
};

const STRATEGY_LABELS: Record<string, string> = {
  skip: "Пропуск",
  shift: "Сдвиг",
  deload: "Разгрузка",
  rollback: "Откат",
};

function formatDate(date: string | null): string {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleDateString("ru-RU");
  } catch {
    return "—";
  }
}

export default async function PauseHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [session, { id }] = await Promise.all([verifySession(), params]);
  const { profile, supabase } = session;

  if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
    redirect("/dashboard");
  }

  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", id)
    .maybeSingle<{ id: string; name: string }>();

  if (!client) notFound();

  const pauses = await getPauseHistory(id);

  return (
    <div className="p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <Link
          href={`/clients/${client.id}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Назад к клиенту
        </Link>

        <h1 className="text-2xl font-bold">Паузы — {client.name}</h1>

        {pauses.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                История пауз
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                У клиента не было пауз в тренировках.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                История пауз
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-4 py-3 text-left font-medium">Начало</th>
                    <th className="px-4 py-3 text-left font-medium">Конец</th>
                    <th className="px-4 py-3 text-left font-medium">Причина</th>
                    <th className="px-4 py-3 text-left font-medium">Стратегия</th>
                    <th className="px-4 py-3 text-left font-medium">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {pauses.map((p) => (
                    <tr key={p.id} className="border-b last:border-b-0">
                      <td className="px-4 py-3">{formatDate(p.pause_start)}</td>
                      <td className="px-4 py-3">{formatDate(p.pause_end)}</td>
                      <td className="px-4 py-3">
                        {REASON_LABELS[p.reason] ?? p.reason}
                      </td>
                      <td className="px-4 py-3">
                        {p.strategy ? STRATEGY_LABELS[p.strategy] ?? p.strategy : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {p.status === "active" ? "Активна" : "Завершена"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
