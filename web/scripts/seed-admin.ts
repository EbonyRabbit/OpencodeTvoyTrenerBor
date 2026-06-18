import { createClient } from "@supabase/supabase-js";

async function seed() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing environment variables.");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const email = "admin@tvoitrener.ru";
  const password = "admin123!";

  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    console.log("Admin user already exists. Skipping.");
    return;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: "Главный тренер", role: "admin" },
  });

  if (error) {
    console.error("Error creating admin user:", error.message);
    process.exit(1);
  }

  console.log(`Admin user created: ${email} / ${password}`);
}

seed();
