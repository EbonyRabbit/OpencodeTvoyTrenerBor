import { verifySession } from "@/lib/dal";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  UserCheck,
  CreditCard,
  UserX,
  ClipboardList,
  AlertTriangle,
} from "lucide-react";

interface StatCard {
  title: string;
  value: number;
  icon: React.ReactNode;
  description: string;
}

function formatDate(dateStr: string) {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("ru-RU");
  } catch {
    return "—";
  }
}

function adherenceBadge(value: number | null) {
  if (value === null) return { variant: "secondary" as const, label: "—" };
  const label = `${value}%`;
  if (value >= 80) return { variant: "default" as const, label };
  if (value >= 50) return { variant: "secondary" as const, label };
  return { variant: "destructive" as const, label };
}

function scoreBadge(value: number | null) {
  if (value === null) return { variant: "secondary" as const, label: "—" };
  const label = `${value}/10`;
  if (value >= 7) return { variant: "default" as const, label };
  if (value >= 4) return { variant: "secondary" as const, label };
  return { variant: "destructive" as const, label };
}

function stressBadge(value: number | null) {
  if (value === null) return { variant: "secondary" as const, label: "—" };
  const label = `${value}/10`;
  if (value <= 3) return { variant: "default" as const, label };
  if (value <= 6) return { variant: "secondary" as const, label };
  return { variant: "destructive" as const, label };
}

const ALERT_THRESHOLDS = {
  LOW_ADHERENCE: 50,
  HIGH_STRESS: 8,
} as const;

type AlertType = "low_adherence" | "high_stress" | "missed_workouts" | "complaints";

const ALERT_LABELS: Record<AlertType, string> = {
  low_adherence: "Низкий адгеренс",
  high_stress: "Высокий стресс",
  missed_workouts: "Пропуски тренировок",
  complaints: "Жалобы",
};

type AlertEntry = {
  clientName: string;
  date: string;
  types: AlertType[];
};

type AlertRow = {
  client_id: string;
  date: string;
  stress: number | null;
  nutrition_adherence: number | null;
  missed_workouts: number | null;
  complaints: string | null;
  clients: { name: string };
};

const ALERT_VARIANTS: Record<AlertType, "default" | "secondary" | "destructive"> = {
  low_adherence: "destructive",
  high_stress: "destructive",
  missed_workouts: "secondary",
  complaints: "destructive",
};

function buildAlertEntries(data: AlertRow[]): AlertEntry[] {
  const latestByClient = new Map<string, AlertRow>();
  for (const row of data) {
    if (!latestByClient.has(row.client_id)) {
      latestByClient.set(row.client_id, row);
    }
  }

  const entries: AlertEntry[] = [];
  for (const checkin of latestByClient.values()) {
    const types: AlertType[] = [];
    if (checkin.nutrition_adherence !== null && checkin.nutrition_adherence < ALERT_THRESHOLDS.LOW_ADHERENCE) {
      types.push("low_adherence");
    }
    if (checkin.stress !== null && checkin.stress >= ALERT_THRESHOLDS.HIGH_STRESS) {
      types.push("high_stress");
    }
    if (checkin.missed_workouts !== null && checkin.missed_workouts > 0) {
      types.push("missed_workouts");
    }
    if (checkin.complaints !== null && checkin.complaints.trim() !== "") {
      types.push("complaints");
    }
    if (types.length > 0) {
      entries.push({
        clientName: checkin.clients?.name ?? "—",
        date: checkin.date,
        types,
      });
    }
  }

  return entries.sort((a, b) => b.types.length - a.types.length);
}

export default async function DashboardPage() {
  const { profile, supabase } = await verifySession();

  if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
    redirect("/login");
  }

  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const dateThreshold = twoWeeksAgo.toISOString().split("T")[0];

  const [
    totalResult,
    activeResult,
    paidResult,
    expiredResult,
    checkinsResult,
    alertsResult,
  ] = await Promise.all([
    supabase.from("clients").select("*", { count: "exact", head: true }),
    supabase.from("clients").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("clients").select("*", { count: "exact", head: true }).eq("payment_status", "paid"),
    supabase.from("clients").select("*", { count: "exact", head: true }).eq("status", "access_expired"),
    supabase
      .from("checkins")
      .select("id, client_id, date, wellbeing, sleep, stress, nutrition_adherence, complaints, clients!inner(name)")
      .order("date", { ascending: false })
      .limit(5),
    supabase
      .from("checkins")
      .select("client_id, date, stress, nutrition_adherence, missed_workouts, complaints, clients!inner(name)")
      .gte("date", dateThreshold)
      .order("date", { ascending: false })
      .limit(500),
  ]);

  if (totalResult.error || activeResult.error || paidResult.error || expiredResult.error || checkinsResult.error || alertsResult.error) {
    return (
      <main className="flex-1 p-6">
        <h2 className="text-2xl font-bold">Дашборд</h2>
        <p className="mt-4 text-destructive">Ошибка загрузки данных. Попробуйте позже.</p>
      </main>
    );
  }

  type CheckinRow = {
    id: string;
    client_id: string;
    date: string;
    wellbeing: number | null;
    sleep: number | null;
    stress: number | null;
    nutrition_adherence: number | null;
    complaints: string | null;
    clients: { name: string };
  };

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

  const checkins = ((checkinsResult.data ?? []) as unknown as CheckinRow[]).map((c) => ({
    ...c,
    wellbeingBadge: scoreBadge(c.wellbeing),
    sleepBadge: scoreBadge(c.sleep),
    stressBadge: stressBadge(c.stress),
    adherenceBadge: adherenceBadge(c.nutrition_adherence),
  }));

  const alertEntries = buildAlertEntries((alertsResult.data ?? []) as unknown as AlertRow[]);

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

      {alertEntries.length > 0 && (
        <Card className="mt-6 border-destructive/30">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <CardTitle>Клиенты, требующие внимания</CardTitle>
            </div>
            <Badge variant="destructive">{alertEntries.length}</Badge>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Дата чек-ина</TableHead>
                  <TableHead>Алерты</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alertEntries.map((entry, i) => (
                  <TableRow key={`${entry.clientName}-${i}`}>
                    <TableCell className="font-medium">{entry.clientName}</TableCell>
                    <TableCell>{formatDate(entry.date)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {entry.types.map((type) => (
                          <Badge key={type} variant={ALERT_VARIANTS[type]}>
                            {ALERT_LABELS[type]}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Последние чек-ины</CardTitle>
          <ClipboardList className="h-5 w-5 text-muted-foreground" />
        </CardHeader>
        <CardContent className="p-0">
          {checkins.length === 0 ? (
            <p className="px-(--card-spacing) pb-(--card-spacing) text-sm text-muted-foreground">
              Нет чек-инов. После того как клиенты начнут отправлять чек-ины, они появятся здесь.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead>Самочувствие</TableHead>
                  <TableHead>Сон</TableHead>
                  <TableHead>Стресс</TableHead>
                  <TableHead>Адгеренс</TableHead>
                  <TableHead>Жалобы</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {checkins.map((checkin) => (
                  <TableRow key={checkin.id}>
                    <TableCell className="font-medium">{checkin.clients?.name ?? "—"}</TableCell>
                    <TableCell>{formatDate(checkin.date)}</TableCell>
                    <TableCell>
                      <Badge variant={checkin.wellbeingBadge.variant}>{checkin.wellbeingBadge.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={checkin.sleepBadge.variant}>{checkin.sleepBadge.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={checkin.stressBadge.variant}>{checkin.stressBadge.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={checkin.adherenceBadge.variant}>{checkin.adherenceBadge.label}</Badge>
                    </TableCell>
                    <TableCell className="max-w-40 truncate">
                      {checkin.complaints || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
