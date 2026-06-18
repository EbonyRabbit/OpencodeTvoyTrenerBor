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
        <h1 className="text-lg font-semibold">ТвойТренерБот</h1>
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
