export default function Loading() {
  return (
    <div className="p-6">
      <div className="mx-auto max-w-3xl animate-pulse">
        <div className="mb-4 h-4 w-24 rounded bg-muted" />
        <div className="rounded-lg border bg-card">
          <div className="border-b p-4">
            <div className="h-5 w-32 rounded bg-muted" />
          </div>
          <div className="flex h-[60vh] flex-col gap-4 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`h-10 w-2/3 rounded-lg bg-muted ${
                    i % 2 === 0 ? "rounded-br-sm" : "rounded-bl-sm"
                  }`}
                />
              </div>
            ))}
          </div>
          <div className="border-t p-4">
            <div className="h-8 w-full rounded-lg bg-muted" />
          </div>
        </div>
      </div>
    </div>
  );
}
