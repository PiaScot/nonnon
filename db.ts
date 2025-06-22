import { createClient } from "npm:@supabase/supabase-js";

function assertEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    console.error(`Not Found ${name} environment value`);
    Deno.exit(-1);
  }
  return value;
}

export const siteTable = assertEnv("SITE_TABLE");
export const articleTable = assertEnv("ARTICLE_TABLE");
export const generalRemoveTable = assertEnv("GENERAL_REMOVE_TAGS_TABLE");
export const supabase = createClient(
  assertEnv("SUPABASE_URL"),
  assertEnv("SERVICE_ROLE_KEY"),
);
