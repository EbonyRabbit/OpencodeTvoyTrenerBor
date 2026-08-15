export default function Loading() {
  return (
    <div className="p-6">
      <div className="mx-auto max-w-5xl space-y-6 animate-pulse">
        <div className="h-4 w-24 rounded bg-muted" />
        <div className="h-8 w-48 rounded bg-muted" />
        <div className="rounded-lg border bg-card">
          <div className="p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="mb-6 last:mb-0">
                <div className="mb-3 h-4 w-32 rounded bg-muted" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div
                      key={j}
                      className="aspect-[3/4] rounded-lg bg-muted"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-center gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 w-8 rounded bg-muted" />
          ))}
        </div>
      </div>
    </div>
  );
}
