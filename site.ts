import { load } from "npm:cheerio";

import { parse } from "jsr:@libs/xml";
import { articleTable, siteTable, supabase } from "./db.ts";
import type { Site } from "./types.ts";
import { randomMobileUA } from "./utils.ts";
import { getHtmlText, processArticleHtml } from "./extractor.ts";

const MAX_SAVE_ARTICLES = 200000;

async function cleanupOldArticles() {
  const { count, error: countError } = await supabase.from(articleTable).select(
    "id",
    { count: "exact", head: true },
  );
  if (countError) {
    console.error(`Failed to count articles: ${countError.message}`);
    return;
  }
  if (count && count > MAX_SAVE_ARTICLES) {
    const limit = count - MAX_SAVE_ARTICLES;
    console.log(`Limit exceeded. Deleting oldest ${limit} articles...`);
    const { data: oldArticles, error: selectError } = await supabase.from(
      articleTable,
    ).select("id").order("pub_date", { ascending: true }).limit(limit);
    if (selectError || !oldArticles || oldArticles.length === 0) return;
    const idsToDelete = oldArticles.map((a: any) => a.id);
    await supabase.from(articleTable).delete().in("id", idsToDelete);
  }
}

export async function scrapeSite(
  site: Site,
  generalRemoveTags: string[],
  allowedHosts: Set<string>,
) {
  if (!site.rss || !site.domain) {
    console.warn(`[SKIP] RSS or Domain not registered for siteId=${site.id}`);
    return;
  }
  console.log(`--- Scraping Site ID: ${site.id} (${site.title}) ---`);

  const res = await fetch(site.rss, {
    headers: {
      "User-Agent": randomMobileUA(),
      Accept: "application/rss+xml,application/xml",
    },
  });
  if (!res.ok) {
    console.error(`  -> HTTP ${res.status} for RSS: ${site.rss}`);
    return;
  }

  const xml = parse(await res.text());
  const chan = xml.rss?.channel ?? xml["rdf:RDF"]?.channel;
  const rawItems = (() => {
    const r = chan?.item ?? xml["rdf:RDF"]?.item ?? [];
    return Array.isArray(r) ? r : [r];
  })();

  if (rawItems.length === 0) {
    console.warn("[WARN]  -> No items found in RSS feed.");
    return;
  }

  const start = performance.now();
  for (const item of rawItems) {
    const link = (item.link?.split("?")[0] ?? "").trim();
    if (!link) continue;

    try {
      const { data: existingArticle } = await supabase.from(articleTable)
        .select("id").eq("url", link).maybeSingle();
      if (existingArticle) {
        console.log(
          `[INFO]  -> Article already exists. Skipping for this site. URL: ${link}`,
        );
        continue;
      }

      const mobileHTML = await getHtmlText(link, "mobile");
      if (!mobileHTML) {
        console.error(`[ERROR]  -> ✘ Failed to fetch HTML for: ${link}`);
        continue;
      }

      const siteSpecificTags = site.scrape_options?.removeSelectorTags ?? [];
      const finalRemoveSelectors = [
        ...new Set([...generalRemoveTags, ...siteSpecificTags]),
      ];
      const content = processArticleHtml(
        mobileHTML,
        link,
        finalRemoveSelectors,
        allowedHosts,
      );

      if (!content) {
        console.error(`[ERROR]  -> ✘ Failed to get content for: ${link}`);
        continue;
      }
      let thumbnail = "";
      const $content = load(content);
      $content("img.my-formatted:not([src^='data:'])").each((_, img) => {
        const src = $content(img).attr("src");
        if (
          src && site.domain && src.includes(site.domain) &&
          !src.includes("logo")
        ) {
          thumbnail = src;
          return false;
        }
      });
      if (!thumbnail) {
        thumbnail =
          $content("img.my-formatted:not([src^='data:'])").first().attr(
            "src",
          ) ?? "";
      }
      const pubDate = item.pubDate ?? item["dc:date"] ??
        new Date().toISOString();
      const newArticle = {
        site_id: site.id,
        title: item.title ?? "",
        url: link,
        category: site.category,
        content,
        pub_date: new Date(pubDate).toISOString(),
        thumbnail,
      };

      const { error: insertError } = await supabase.from(articleTable).insert(
        newArticle,
      );
      if (insertError) {
        console.error(
          `[ERROR]  -> ❌ Failed to insert article: ${insertError.message}`,
        );
      } else {
        console.log(`[INFO]  -> ✅ Successfully inserted: ${newArticle.title}`);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        console.error(
          `[scrapeSite][item error] siteId=${site.id} url=${item.link}\n  ↳ ${err.message}`,
        );
      }
    }
  }
  console.log(
    `[INFO]  -> Process time: ${(performance.now() - start).toFixed(2)} ms`,
  );
}
