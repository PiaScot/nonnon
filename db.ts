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
export const supabaseURL = assertEnv("SUPABASE_URL");
export const generalRemoveTable = assertEnv("GENERAL_REMOVE_TAGS_TABLE");
export const supabase = createClient(
  assertEnv("SUPABASE_URL"),
  assertEnv("SERVICE_ROLE_KEY"),
);

const MAX_ARTICLES = 10000;
const BATCH_SIZE = 500;

export async function maintainArticleLimit() {
  console.log("\n🚀 Starting to check and maintain article limit...");

  try {
    let { count, error: countError } = await supabase.from(articleTable).select(
      "id",
      {
        count: "exact",
        head: true,
      },
    );

    if (countError) {
      throw new Error(`❌ Failed to count articles: ${countError.message}`);
    }

    let articleCount = count || 0;
    console.log(`ℹ️ Current number of articles: ${articleCount}`);

    if (articleCount <= MAX_ARTICLES) {
      console.log(
        "✅ The number of articles is within the limit. No cleanup needed.",
      );
      return;
    }

    while (articleCount > MAX_ARTICLES) {
      const limit = Math.min(articleCount - MAX_ARTICLES, BATCH_SIZE);
      console.log(`🗑️ Limit exceeded. Deleting oldest ${limit} articles...`);

      const { data: oldArticles, error: selectError } = await supabase
        .from(articleTable)
        .select("id")
        .order("created_at", { ascending: true })
        .limit(limit);

      if (selectError) {
        throw new Error(
          `❌ Failed to select old articles to delete: ${selectError.message}`,
        );
      }

      if (!oldArticles || oldArticles.length === 0) {
        console.log("✅ No more old articles to delete. Exiting loop.");
        break;
      }

      const idsToDelete = oldArticles.map((a) => a.id);
      const { error: deleteError } = await supabase.from(articleTable).delete()
        .in("id", idsToDelete);

      if (deleteError) {
        throw new Error(`❌ Failed to delete articles: ${deleteError.message}`);
      }

      console.log(`✅ Successfully deleted ${idsToDelete.length} articles.`);

      // ループ継続のために記事数を再取得
      const res = await supabase.from(articleTable).select("id", {
        count: "exact",
        head: true,
      });
      if (res.error) {
        throw new Error(`❌ Failed to re-count articles: ${res.error.message}`);
      }
      articleCount = res.count || 0;
      console.log(`ℹ️ Remaining articles: ${articleCount}`);
    }

    console.log("✨ Article cleanup process finished.");
  } catch (error) {
    console.error(error.message);
    // エラーを再スローして、呼び出し元でキャッチできるようにする
    throw error;
  }
}

