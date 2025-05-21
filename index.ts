import { siteTable, supabase } from "./db.ts";
import { scrapeSite } from "./site.ts";

console.log("Start scraping process");

async function runScraping() {
  const { data: antenaSites, error } = await supabase.from(siteTable)
    .select("*");
  if (error) {
    console.error("Error: failed to fetch antena_sites", error.message);
    Deno.exit(1);
  }

  const now = new Date();
  for (const site of antenaSites) {
    const lastAccess = site.last_access
      ? new Date(site.last_access)
      : new Date(0);
    const duration = Number(site.duration_access) * 1000;

    if (now.getTime() - lastAccess.getTime() >= duration) {
      try {
        console.log(`Processing site: ${site.url}`);
        await scrapeSite(supabase, site.rss, site.category);
        await supabase.from("antena_sites").update({
          last_access: now.toISOString(),
        }).eq("id", site.id);
        console.log(`Successfully scraped and updated: ${site.url}`);
      } catch (e) {
        console.error(`Error scraping ${site.url}:`, e);
      }
    } else {
      console.log(`Skipping site (not due for scraping): ${site.url}`);
    }
  }

  console.log("Finish scraping process");
}

await runScraping();
