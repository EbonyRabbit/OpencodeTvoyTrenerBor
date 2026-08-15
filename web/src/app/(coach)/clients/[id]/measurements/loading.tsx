export default function Loading() {
  return (
    <div className="p-6">
      <div className="mx-auto max-w-7xl space-y-6 animate-pulse">
        <div className="h-4 w-24 rounded bg-muted" />
        <div className="h-8 w-48 rounded bg-muted" />
        <div className="rounded-lg border bg-card">
          <div className="border-b p-4">
            <div className="flex gap-4">
              {Array.from({ length: 15 }).map((_, i) => (
                <div key={i} className="h-4 flex-1 rounded bg-muted" />
              ))}
            </div>
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="border-b p-4">
              <div className="flex gap-4">
                {Array.from({ length: 15 }).map((_, j) => (
                  <div key={j} className="h-4 flex-1 rounded bg-muted" />
                ))}
              </div>
            </div>
          ))}
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
