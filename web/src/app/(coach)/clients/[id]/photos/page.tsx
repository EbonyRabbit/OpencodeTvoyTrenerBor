import { redirect } from "next/navigation";
import { verifySession } from "@/lib/dal";

// Photo storage disabled — clients save photos on their own devices
// Original page preserved in git history

export default async function PhotosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ profile }] = await Promise.all([
    verifySession(),
    params,
  ]);

  if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
    redirect("/dashboard");
  }

  return (
    <div className="p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Фото</h2>
          <p className="text-sm text-muted-foreground">
            Фото хранятся у клиента на телефоне
          </p>
        </div>
        <div className="rounded-lg border bg-card p-6 text-center">
          <p className="text-2xl mb-2">📸</p>
          <p className="text-sm text-muted-foreground">
            Клиент делает фото при каждом замере (фронт, бок, зад) и сохраняет у себя на телефоне.
          </p>
        </div>
      </div>
    </div>
  );
}
