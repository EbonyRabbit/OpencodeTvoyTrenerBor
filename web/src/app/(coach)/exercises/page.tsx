import { redirect } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Video } from "lucide-react";
import { AddExerciseDialog } from "./_components/add-exercise-dialog";
import { ExerciseForm } from "./_components/exercise-form";

const LIBRARY_PAGE_LIMIT = 1000;

export const metadata = {
  title: "Библиотека упражнений | ТвойТренерБот",
};

function difficultyLabel(value: string | null): string | null {
  if (!value) return null;
  const labels: Record<string, string> = {
    beginner: "Новичок",
    intermediate: "Средний",
    advanced: "Продвинутый",
  };
  return labels[value] ?? value;
}

export default async function ExercisesPage() {
  const { profile } = await verifySession();
  if (!profile || (profile.role !== "admin" && profile.role !== "coach")) {
    redirect("/dashboard");
  }

  const { data, error } = await supabaseAdmin
    .from("exercises")
    .select("id, name, name_key, aliases, description_ru, description_en, technique_ru, technique_en, features_ru, features_en, video_url, demo_video_url, muscle_group, equipment, difficulty, contraindications, created_at, updated_at")
    .order("name", { ascending: true })
    .limit(LIBRARY_PAGE_LIMIT);

  const truncated = (data?.length ?? 0) >= LIBRARY_PAGE_LIMIT;

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Библиотека упражнений</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Упражнения с техникой и видео - показываются в боте и на портале клиента
          </p>
        </div>
        <AddExerciseDialog />
      </div>

      <div className="mb-4 text-sm text-muted-foreground">
        <p>
          Чтобы открыть форму редактирования, нажмите на название упражнения. Техника и видео
          доступны клиентам в боте через кнопку «📚 Техника и видео» и на портале.
        </p>
      </div>

      {error && (
        <div className="text-sm text-destructive">
          Ошибка загрузки упражнений. Попробуйте позже.
        </div>
      )}

      {!error && (data?.length ?? 0) === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Библиотека пуста. Добавьте первое упражнение.
        </div>
      )}

      {truncated && (
        <div className="mb-4 text-sm text-amber-600">
          Показаны первые {LIBRARY_PAGE_LIMIT} упражнений - библиотека может содержать больше записей.
        </div>
      )}

      <ul className="space-y-2">
        {(data ?? []).map((exercise) => (
          <li key={exercise.id}>
            <details className="group rounded-lg border bg-card">
              <summary className="cursor-pointer list-none px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{exercise.name}</span>
                    {exercise.video_url && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Video className="h-3 w-3" />
                        видео
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {difficultyLabel(exercise.difficulty) && (
                      <span>{difficultyLabel(exercise.difficulty)}</span>
                    )}
                    {exercise.muscle_group && <span>{exercise.muscle_group}</span>}
                    {exercise.equipment && <span>· {exercise.equipment}</span>}
                  </div>
                </div>
              </summary>
              <div className="border-t px-4 py-4">
                <ExerciseForm exercise={exercise} />
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}