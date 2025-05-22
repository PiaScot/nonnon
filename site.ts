import { parse } from "jsr:@libs/xml";
import { randomUA } from "./utils.ts";
import { getContent } from "./extractor.ts";
import { articleTable, siteTable, supabase } from "./db.ts";

export interface Article {
  siteID: number;
  title: string;
  url: string;
  category: string;
  content: string;
  pubDate: string;
  thumbnail: string;
}

export default class Site {
  url = ""; // the site top page url
  title = ""; // the site title name
  rawItems: any[] = []; // rawItems after parsed xml
  lastBuildDate: Date | null = null;

  // need info for db operation
  id = 0; // site id from pre-defined supabase
  lastAccess = ""; // last fetched the site
  durationAccess = 0; // interval the site how often publish articles

  pubDates: Date[] = []; // need info for calculate durationAccess

  articles: Article[] = []; // tiny up from rawItems to articles with <Article> type

  constructor(
    readonly rss: string,
    private category: string,
  ) {}

  async init(): Promise<this> {
    let xml: any;

    const chan = xml.rss?.channel ?? xml["rdf:RDF"]?.channel;
    this.rawItems = (() => {
      const r = chan?.item ?? xml["rdf:RDF"]?.item ?? [];
      return Array.isArray(r) ? r : [r];
    })();

    this.url = chan?.link ?? this.rss;
    this.title = chan?.title ?? "";

    const rawDate = chan?.lastBuildDate ?? this.rawItems?.[0]?.pubDate;
    this.lastBuildDate = rawDate ? new Date(rawDate) : null;

    const { data: siteRows } = await supabase
      .from(siteTable)
      .select("id, category")
      .eq("rss", this.rss)
      .limit(1);

    if (siteRows?.length) {
      this.id = siteRows[0].id;
      this.category = siteRows[0].category;
    } else {
      let description: string = (chan?.description ?? "").toString().trim();
      if (!description) {
        const fallback = this.rawItems // ← 先に this.rawItems に格納してある前提
          .slice(0, 3) //   上位 3 件
          .map((it) => {
            const title = it.title ?? "(no title)";
            const date = it.pubDate ?? it["dc:date"] ?? "";
            return `・${title} (${date})`;
          })
          .join("\n");
        description = fallback || "(no description)";
      }
      const url = new URL(this.rss).origin;
      console.log(`\n=== Detect unregister site ===
URL  : ${this.url}
RSS  : ${this.rss}
TITLE: ${this.title}
ITEMS: New ${this.rawItems.length}
DESCRIPTION: \n${description}
------------------------------`);
      const ans = prompt("Register this site？ (y/N) > ");
      if (ans?.toLowerCase() === "y") {
        const { data, error } = await supabase.from("antena_sites")
          .insert({
            url: this.url,
            rss: this.rss,
            title: this.title,
            category: this.category,
            last_access: new Date().toISOString(),
          })
          .select("id");
        if (error) throw error;
        this.id = data![0].id;
        console.log(`... registered with antena_sites.id = ${this.id}.\n`);
      } else {
        console.log("... skip to register.\n");
      }
    }
    return this;
  }

  intervalPublishedArticles() {
    if (this.pubDates.length <= 1) return;

    this.pubDates.sort((a, b) => a.getTime() - b.getTime());
    const intervals = this.pubDates.slice(1).map((d, i) =>
      (d.getTime() - this.pubDates[i].getTime()) / 1_000
    );
    const avg = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    this.durationAccess = Math.round(avg);
    console.log(`  → Average interval: ${this.durationAccess} seconds`);
  }

  info() {
    console.log("========  Site info  ========");
    console.log(`ID        : ${this.id}`);
    console.log(`TITLE     : ${this.title}`);
    console.log(`URL       : ${this.url}`);
    console.log(`RSS       : ${this.rss}`);
    console.log(`CATEGORY  : ${this.category}`);
    console.log(`ARTICLES : ${this.articles.length}`);
    if (this.durationAccess) {
      console.log(`POST EVERY: ~${this.durationAccess} sec`);
    }
    console.log("------------------------------");

    if (this.articles.length === 0) {
      console.log("(no articles fetched yet)\n");
      return;
    }

    console.log("Articles:");
    this.articles.forEach((a, i) => {
      const date = new Date(a.pubDate);
      const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
      const YYYY = jst.getFullYear();
      const MM = String(jst.getMonth() + 1).padStart(2, "0");
      const DD = String(jst.getDate()).padStart(2, "0");
      const hh = String(jst.getHours()).padStart(2, "0");
      const mm = String(jst.getMinutes()).padStart(2, "0");
      const ss = String(jst.getSeconds()).padStart(2, "0");
      const formatted = `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
      console.log(
        `${String(i + 1).padStart(2, "0")}. ${formatted} ${a.title}`,
      );
    });
    console.log("==============================\n");
  }
}

export async function scrapeSite(
  supabase: any,
  rss: string,
  category?: string,
) {
  const res = await fetch(rss, {
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

  const { data: siteRows } = await supabase
    .from(siteTable)
    .select("id, category")
    .eq("rss", rss)
    .limit(1);

  if (!siteRows?.length) throw new Error("antena_sitesテーブルに未登録");

  const siteId = siteRows[0].id;
  const siteCategory = category ?? siteRows[0].category;

  const start = performance.now();

  for (const item of rawItems) {
    const link = item.link?.split("?")[0] ?? "";
    const title = item.title ?? "";
    const pubDate = item.pubDate ?? item["dc:date"] ?? "";

    const content = await getContent(link);
    if (!content) {
      console.warn(`✘ Failed to get articles: ${link}`);
      continue;
    }

    let thumbnail = "";
    const siteDomain = link ? new URL(link).hostname : "";

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
          console.warn(`Invalid image URL found: ${src}`, e);
        }
      }
      match = imgTagRegex.exec(content);
    }

    if (!thumbnail) {
      const imageUrlRegex =
        /(https?:\/\/[^\s<>"]+\.(?:jpg|png|gif|jpeg|webp))(?:\?.*?)?(?:#.*?)?/gi;
      const urlMatch = imageUrlRegex.exec(content);
      if (urlMatch && urlMatch[1]) {
        thumbnail = urlMatch[1];
      }
    }

    if (!thumbnail) {
      console.warn(`Not found thumbnail from: ${link}`);
    }

    const { data: exists } = await supabase
      .from(articleTable)
      .select("id")
      .eq("url", link)
      .limit(1);

    if (exists && exists.length > 0) {
      break;
    }

    await supabase.from("articles").insert({
      site_id: siteId,
      title,
      url: link,
      category: siteCategory,
      content,
      pub_date: pubDate,
      thumbnail,
    });
  }

  const end = performance.now();
  console.log(
    `Process time ${siteTitle} (${rss})  ${(end - start).toFixed(2)} ms`,
  );

  const { count } = await supabase
    .from("articles")
    .select("id", { count: "exact", head: true })
    .eq("site_id", siteId);

  if ((count ?? 0) > 10000) {
    const { data: oldArticles } = await supabase
      .from("articles")
      .select("id")
      .eq("site_id", siteId)
      .order("pub_date", { ascending: true })
      .limit((count ?? 0) - 10000);

    if (oldArticles && oldArticles.length > 0) {
      const ids = oldArticles.map((a: any) => a.id);
      await supabase.from("articles").delete().in("id", ids);
    }
  }
}
