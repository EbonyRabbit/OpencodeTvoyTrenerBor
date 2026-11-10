import { supabaseAdmin } from "@/lib/supabase-admin";

const PHOTO_BUCKET = "client-photos";
const PAGE_SIZE = 100;

async function collectFiles(clientId: string): Promise<string[]> {
  const bucket = supabaseAdmin.storage.from(PHOTO_BUCKET);
  const files: string[] = [];

  async function walk(path: string): Promise<void> {
    let offset = 0;
    while (true) {
      const { data, error } = await bucket.list(path, {
        limit: PAGE_SIZE,
        offset,
      });
      if (error) throw error;
      if (!data || data.length === 0) return;

      for (const entry of data) {
        const entryPath = `${path}/${entry.name}`;
        if (entry.id === null) {
          await walk(entryPath);
        } else {
          files.push(entryPath);
        }
      }

      if (data.length < PAGE_SIZE) return;
      offset += PAGE_SIZE;
    }
  }

  await walk(`clients/${clientId}`);
  return files;
}

export async function deleteClientPhotoStorage(clientId: string): Promise<void> {
  const files = await collectFiles(clientId);
  if (files.length === 0) return;

  const bucket = supabaseAdmin.storage.from(PHOTO_BUCKET);
  for (let i = 0; i < files.length; i += PAGE_SIZE) {
    const { error } = await bucket.remove(files.slice(i, i + PAGE_SIZE));
    if (error) throw error;
  }
}
