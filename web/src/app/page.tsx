export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-center py-32 px-16 bg-white dark:bg-black">
        <h1 className="text-4xl font-bold tracking-tight text-black dark:text-zinc-50">
          ТвойТренерБот
        </h1>
        <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
          Панель управления фитнес-коучингом
        </p>
      </main>
    </div>
  );
}
