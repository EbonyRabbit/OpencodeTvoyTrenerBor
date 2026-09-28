import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase-server";
import { resetExerciseSwap } from "../actions";

type SwapRow = {
  id: string;
  original_name: string;
  replacement_name: string;
  created_at: string;
};

export async function ExerciseSwapsSection({ clientId }: { clientId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_exercise_swaps")
    .select("id, original_name, replacement_name, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<SwapRow[]>();
  const swaps = data ?? [];
  if (swaps.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Замены упражнений</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {swaps.map((s) => (
          <form
            key={s.id}
            action={async () => {
              "use server";
              await resetExerciseSwap(clientId, s.id);
            }}
            className="flex items-center justify-between gap-3 py-1 text-sm"
          >
            <span className="text-muted-foreground">
              {s.replacement_name}
              <span className="ml-2 text-xs">вместо «{s.original_name}»</span>
            </span>
            <Button type="submit" variant="outline" size="sm">
              Сбросить
            </Button>
          </form>
        ))}
      </CardContent>
    </Card>
  );
}
