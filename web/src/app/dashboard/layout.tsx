import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { logout } from "@/lib/auth-actions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await verifySession();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-semibold">ТвойТренерБот</h1>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Дашборд
            </Link>
            <Link href="/clients" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Клиенты
            </Link>
            <Link href="/programs" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Программы
            </Link>
            {profile?.role === "admin" || profile?.role === "coach" ? (
              <Link href="/exercises" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                Упражнения
              </Link>
            ) : null}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">{profile?.name}</span>
          <form action={logout}>
            <button
              type="submit"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Выйти
            </button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
