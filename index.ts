import { siteTable, supabase } from "./db.ts";
import { scrapeSite, type Site } from "./site.ts";

async function runScraping() {
  try {
    const { data: antenaSites, error } = await supabase.from(siteTable).select(
      "*",
    );

    if (!antenaSites || error) {
      console.error(
        `Failed to fetch antenaSites in runScraping() ${error.message}`,
      );
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
          await scrapeSite(supabase, site);
          await supabase.from<Site>(siteTable).update({
            last_access: now.toISOString(),
          }).eq("id", site.id);
          console.log(`Successfully scraped and updated: ${site.id}`);
        } catch (e) {
          console.error(`Error scraping ${site.id}: ${e}`);
        }
      } else {
        console.log(
          `${site.id}: Skipping site (not elapsed next scraping time)`,
        );
      }
    }
  } catch (e) {
    console.error("Fatal error at runScraping:", e);
    Deno.exit(1);
  }
}

await runScraping();
