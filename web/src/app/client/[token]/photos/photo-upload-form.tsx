"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, Upload, Camera } from "lucide-react";
import { uploadPhoto } from "../actions";
import type { PhotoType } from "@/types/supabase";
import { PHOTO_TYPE_LABELS } from "@/lib/photos";

const PHOTO_TYPES: PhotoType[] = ["front", "side", "back"];

export function PhotoUploadForm({
  uploadedTypes,
}: {
  uploadedTypes: PhotoType[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [selectedType, setSelectedType] = useState<PhotoType | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<PhotoType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }

    setError(null);
    setSelectedFile(file);

    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setPreview(url);
  };

  const handleUpload = async () => {
    if (!selectedType || !selectedFile) return;

    setUploading(true);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("file", selectedFile);

      const result = await uploadPhoto(selectedType, fd);

      if (result.error) {
        setError(result.error);
      } else {
        setUploaded(selectedType);
        setSelectedFile(null);
        setSelectedType(null);
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = null;
        }
        setPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        router.refresh();
      }
    } catch {
      setError("Произошла ошибка при загрузке");
    } finally {
      setUploading(false);
    }
  };

  const availableTypes = PHOTO_TYPES.filter((t) => !uploadedTypes.includes(t));

  if (availableTypes.length === 0 && !uploaded) {
    return (
      <Card>
        <CardContent className="py-6 text-center">
          <Check className="mx-auto mb-2 h-6 w-6 text-green-600" />
          <p className="text-sm font-medium">Все фото за сегодня загружены</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Фронтальное, боковое, заднее
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Загрузить фото</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {uploaded && (
          <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700" role="status">
            <Check className="h-4 w-4" />
            {PHOTO_TYPE_LABELS[uploaded]} загружено
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Тип фото
          </p>
          <div className="flex gap-2">
            {PHOTO_TYPES.map((type) => {
              const isUploaded = uploadedTypes.includes(type);
              const isSelected = selectedType === type;
              return (
                <Button
                  key={type}
                  variant={isSelected ? "default" : "outline"}
                  size="sm"
                  disabled={isUploaded}
                  onClick={() => setSelectedType(type)}
                  className="flex-1"
                >
                  <Camera className="mr-1 h-3 w-3" />
                  {PHOTO_TYPE_LABELS[type]}
                  {isUploaded && (
                    <Check className="ml-1 h-3 w-3 text-green-600" />
                  )}
                </Button>
              );
            })}
          </div>
        </div>

        {selectedType && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Выберите фото
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
            />
          </div>
        )}

        {preview && selectedFile && (
          <div className="relative aspect-[3/4] w-full max-w-[200px] overflow-hidden rounded-lg border bg-muted">
            <img
              src={preview}
              alt={PHOTO_TYPE_LABELS[selectedType!]}
              className="h-full w-full object-cover"
            />
            <Badge className="absolute left-2 top-2" variant="secondary">
              {PHOTO_TYPE_LABELS[selectedType!]}
            </Badge>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {selectedType && selectedFile && (
          <Button
            onClick={handleUpload}
            disabled={uploading}
            className="w-full"
          >
            {uploading ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Загрузка...
              </>
            ) : (
              <>
                <Upload className="mr-1 h-4 w-4" />
                Загрузить {PHOTO_TYPE_LABELS[selectedType].toLowerCase()}
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
