import { parse } from "jsr:@libs/xml";
import { getDomain, randomUA } from "./utils.ts";
import { getContent } from "./extractor.ts";
import { articleTable, supabase } from "./db.ts";

const MAX_SAVE_ARTICLES = 20000;

// brdige supabase <-> ts code ${articleTable} type
export interface Article {
  id: number;
  site_id: number | null;
  title: string | null;
  url: string | null;
  category: string | null;
  content: string | null;
  pub_date: string | null; // ISO8601 string (timestamp with time zone)
  thumbnail: string | null;
  created_at: string | null; // ISO8601 string (timestamp with time zone)
}

// bridge supabase <-> ts code ${siteTable} type
export interface Site {
  id: number;
  url: string | null;
  title: string | null;
  rss: string | null;
  category: string | null;
  last_access: string; // ISO8601 string (timestamp with time zone)
  duration_access: number | null;
  scrape_options: ScrapeOptions | null;
  domain: string | null;
}

export interface ScrapeOptions {
  mainSelectorTag: string;
  removeSelectorTags?: string[];
}

export async function scrapeSite(
  site: Site,
) {
  if (!site.rss) {
    console.log(`Error: Not register rss in ${site.id}`);
    return;
  }
  const res = await fetch(site.rss, {
    headers: {
      "User-Agent": randomUA(),
      Accept: "application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) {
    console.log(`HTTP ${res.status}`);
    return;
  }
  const xml = parse(await res.text());
  const chan = xml.rss?.channel ?? xml["rdf:RDF"]?.channel;
  const rawItems = (() => {
    const r = chan?.item ?? xml["rdf:RDF"]?.item ?? [];
    return Array.isArray(r) ? r : [r];
  })();
  const siteTitle = chan?.title ?? "";

  const start = performance.now();
  for (const item of rawItems) {
    try {
      const link = item.link?.split("?")[0] ?? "";
      const title = item.title ?? "";
      const pubDate = item.pubDate ?? item["dc:date"] ?? "";

      const content = await getContent(link);
      if (!content) {
        console.warn(`✘ Failed to get articles site id = ${site.id}`);
        continue;
      }

      let thumbnail = "";
      const siteDomain = getDomain(link);

      const imgTagRegex = /<img[^>]+src=[\"\']([^\"\']+)[\"\']/gi;
      let match: RegExpExecArray | null = imgTagRegex.exec(content);
      while (match) {
        const src = match[1];
        if (src) {
          try {
            const imageUrl = new URL(src, link);
            if (siteDomain && imageUrl.hostname.includes(siteDomain)) {
              thumbnail = imageUrl.toString();
              break;
            }
          } catch (e) {
            console.warn(e);
          }
        }
        match = imgTagRegex.exec(content);
      }

      if (!thumbnail) {
        const imageUrlRegex =
          /(https?:\/\/[^\s<>"]+\.(?:jpg|png|gif|jpeg|webp))(?:\?.*?)?(?:#.*?)?/gi;
        const urlMatch = imageUrlRegex.exec(content);
        if (urlMatch?.[1]) {
          thumbnail = urlMatch[1];
        }
      }

      if (!thumbnail) {
        console.warn(`Not found thumbnail site id = ${site.id}`);
      }

      const { data: exists } = await supabase
        .from<Article>(articleTable)
        .select("id")
        .eq("url", link)
        .limit(1);

      if (exists && exists.length > 0) {
        break;
      }

      await supabase.from(articleTable).insert({
        site_id: site.id,
        title,
        url: link,
        category: site.category,
        content,
        pub_date: pubDate,
        thumbnail,
      });
    } catch (err) {
      console.error(
        `[scrapeSite][item error] siteId=${site.id}\n  ↳ ${err}`,
      );
    }
  }
  const end = performance.now();
  console.log(
    `Process time site id=${site.id}  ${(end - start).toFixed(2)} ms`,
  );

  const { count } = await supabase
    .from<Article>(articleTable)
    .select("id", { count: "exact", head: true });

  if ((count ?? 0) > MAX_SAVE_ARTICLES) {
    const { data: oldArticles } = await supabase
      .from(articleTable)
      .select("id")
      .order("pub_date", { ascending: true })
      .limit((count ?? 0) - MAX_SAVE_ARTICLES);

    if (oldArticles && oldArticles.length > 0) {
      const ids = oldArticles.map((a: any) => a.id);
      await supabase.from(articleTable).delete().in("id", ids);
    }
  }
}
