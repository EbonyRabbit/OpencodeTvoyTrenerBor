export interface ExerciseFormData {
  name: string;
  aliases: string[];
  descriptionRu: string;
  descriptionEn: string;
  techniqueRu: string;
  techniqueEn: string;
  featuresRu: string[];
  featuresEn: string[];
  videoUrl: string;
  muscleGroup: string;
  equipment: string;
  difficulty: string;
  contraindications: string;
}

export function defaultExerciseForm(): ExerciseFormData {
  return {
    name: "",
    aliases: [],
    descriptionRu: "",
    descriptionEn: "",
    techniqueRu: "",
    techniqueEn: "",
    featuresRu: [],
    featuresEn: [],
    videoUrl: "",
    muscleGroup: "",
    equipment: "",
    difficulty: "",
    contraindications: "",
  };
}