"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProgramRow, ParsedContent } from "@/lib/program-utils";

export function ProgramEditor({
  program,
  parsedContent,
}: {
  program: ProgramRow;
  parsedContent: ParsedContent | null;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        href={`/programs/${program.id}`}
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Назад к программе
      </Link>

      <h1 className="text-2xl font-bold">Редактирование: {program.title}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Редактор программы
          </CardTitle>
        </CardHeader>
        <CardContent>
          {parsedContent ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Недель: {parsedContent.weeks?.length ?? 0}
              </p>
              <p className="text-sm text-muted-foreground">
                Заглушка — полный редактор будет реализован в задаче 10.8
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Программа пуста. Создайте содержимое через редактор (задача 10.8).
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
