import { verifySession } from "@/lib/dal";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, UserCheck, CreditCard, UserX } from "lucide-react";

interface StatCard {
  title: string;
  value: number;
  icon: React.ReactNode;
  description: string;
}

export default async function DashboardPage() {
  const { profile, supabase } = await verifySession();

  if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
    redirect("/login");
  }

  const [totalResult, activeResult, paidResult, expiredResult] = await Promise.all([
    supabase.from("clients").select("*", { count: "exact", head: true }),
    supabase.from("clients").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("clients").select("*", { count: "exact", head: true }).eq("payment_status", "paid"),
    supabase.from("clients").select("*", { count: "exact", head: true }).eq("status", "access_expired"),
  ]);

  if (totalResult.error || activeResult.error || paidResult.error || expiredResult.error) {
    return (
      <main className="flex-1 p-6">
        <h2 className="text-2xl font-bold">Дашборд</h2>
        <p className="mt-4 text-destructive">Ошибка загрузки данных. Попробуйте позже.</p>
      </main>
    );
  }

  const cards: StatCard[] = [
    {
      title: "Всего клиентов",
      value: totalResult.count ?? 0,
      icon: <Users className="h-5 w-5" />,
      description: "Общее количество клиентов",
    },
    {
      title: "Активные",
      value: activeResult.count ?? 0,
      icon: <UserCheck className="h-5 w-5" />,
      description: "Клиенты со статусом active",
    },
    {
      title: "Оплатили",
      value: paidResult.count ?? 0,
      icon: <CreditCard className="h-5 w-5" />,
      description: "Клиенты с оплаченным доступом",
    },
    {
      title: "Просрочен доступ",
      value: expiredResult.count ?? 0,
      icon: <UserX className="h-5 w-5" />,
      description: "Клиенты с истекшим доступом",
    },
  ];

  return (
    <main className="flex-1 p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Дашборд</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Сводка по клиентам и активности
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{card.title}</CardTitle>
              <span className="text-muted-foreground">{card.icon}</span>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{card.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{card.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
