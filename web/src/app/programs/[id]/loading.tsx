export default function Loading() {
  return (
    <div className="p-6">
      <div className="mx-auto max-w-4xl space-y-6 animate-pulse">
        <div className="h-4 w-24 rounded bg-muted" />
        <div className="space-y-2">
          <div className="h-8 w-64 rounded bg-muted" />
          <div className="h-4 w-96 rounded bg-muted" />
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="h-32 rounded-lg border bg-card p-4" />
          <div className="h-32 rounded-lg border bg-card p-4" />
        </div>
        <div className="h-64 rounded-lg border bg-card p-4" />
      </div>
    </div>
  );
}
