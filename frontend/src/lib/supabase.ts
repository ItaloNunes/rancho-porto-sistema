import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY não configurados — o login do painel interno não vai funcionar.",
  );
}

export const supabase = createClient(url ?? "http://localhost", anonKey ?? "anon");
