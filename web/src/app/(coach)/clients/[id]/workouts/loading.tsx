export default function Loading() {
  return (
    <div className="p-6">
      <div className="mx-auto max-w-5xl space-y-6 animate-pulse">
        <div className="h-4 w-24 rounded bg-muted" />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4">
              <div className="mb-2 h-3 w-24 rounded bg-muted" />
              <div className="h-8 w-16 rounded bg-muted" />
            </div>
          ))}
        </div>
        <div className="rounded-lg border bg-card">
          <div className="border-b p-4">
            <div className="flex gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-4 flex-1 rounded bg-muted" />
              ))}
            </div>
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border-b p-4">
              <div className="flex gap-4">
                {Array.from({ length: 6 }).map((_, j) => (
                  <div key={j} className="h-4 flex-1 rounded bg-muted" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
