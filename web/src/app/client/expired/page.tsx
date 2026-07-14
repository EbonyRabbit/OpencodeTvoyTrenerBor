export default function ClientExpiredPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 px-4 text-center">
        <h1 className="text-2xl font-bold">Ссылка недействительна</h1>
        <p className="text-sm text-muted-foreground">
          Срок действия ссылки истёк или она недействительна.
          Обратитесь к тренеру для получения новой ссылки.
        </p>
      </div>
    </div>
  );
}
