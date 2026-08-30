// Photo storage disabled - clients save photos on their own devices
// Original page preserved in git history

export default async function PhotosPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Прогресс-фото</h2>
        <p className="text-sm text-muted-foreground">
          Фото хранятся у вас на телефоне
        </p>
      </div>
      <div className="rounded-lg border bg-card p-6 text-center">
        <p className="text-2xl mb-2">📸</p>
        <p className="text-sm text-muted-foreground">
          Делайте фото при каждом замере (фронт, бок, зад) и сохраняйте у себя на телефоне
          для отслеживания прогресса.
        </p>
      </div>
    </div>
  );
}
