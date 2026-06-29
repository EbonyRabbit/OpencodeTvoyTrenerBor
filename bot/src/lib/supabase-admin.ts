import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types.js";
import { config } from "../config.js";

export const supabaseAdmin = createClient<Database>(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
