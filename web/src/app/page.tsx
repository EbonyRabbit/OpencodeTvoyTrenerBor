import { NavMenu } from "@/app/(coach)/_components/nav-menu";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b bg-white px-6 py-3 dark:bg-black">
        <h1 className="text-lg font-semibold">ТвойТренерБот</h1>
        <NavMenu />
      </header>
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-center py-32 px-16 bg-white dark:bg-black">
        <h1 className="text-4xl font-bold tracking-tight text-black dark:text-zinc-50">
          Панель управления фитнес-коучингом
        </h1>
      </main>
    </div>
  );
}