import { supabase } from "./db.ts";
import { scrapeSite } from "./site.ts";
import type { Site } from "./types.ts";

async function runScraping() {
  console.log("🚀 Starting scraping process...");

  try {
    const { data: allowedHostsData, error: hostsError } = await supabase
      .from("allowed_embed_hosts")
      .select("hostname");
    if (hostsError) {
      throw new Error(`Failed to fetch allowed hosts: ${hostsError.message}`);
    }
    const allowedHostsSet = new Set(
      allowedHostsData?.map((h) => h.hostname) || [],
    );

    const { data: generalTagsData, error: generalTagsError } = await supabase
      .from("general_remove_tags")
      .select("selector");
    if (generalTagsError) {
      throw new Error(
        `Failed to fetch general tags: ${generalTagsError.message}`,
      );
    }
    const generalRemoveTags = generalTagsData?.map((t) => t.selector) || [];

    console.log(
      `- Loaded ${allowedHostsSet.size} allowed hosts and ${generalRemoveTags.length} general remove tags.`,
    );

    const { data: sitesToScrape, error: rpcError } = await supabase.rpc(
      "get_sites_to_scrape",
    );
    if (rpcError) {
      throw new Error(
        `Failed to call get_sites_to_scrape RPC: ${rpcError.message}`,
      );
    }

    if (!sitesToScrape || sitesToScrape.length === 0) {
      console.log("- No sites to scrape at this time. Finishing process.");
      return;
    }
    console.log(
      `- Found ${sitesToScrape.length} sites to scrape. Starting parallel processing...`,
    );

    const scrapePromises = sitesToScrape.map((site) =>
      scrapeSiteAndUpdateTimestamp(site, generalRemoveTags, allowedHostsSet)
    );

    const results = await Promise.allSettled(scrapePromises);

    logResults(results);
  } catch (e) {
    console.error("❌ Fatal error at runScraping:", e.message);
    Deno.exit(1);
  }
}

async function scrapeSiteAndUpdateTimestamp(
  site: Site,
  generalTags: string[],
  allowedHosts: Set<string>,
): Promise<number> {
  await scrapeSite(site, generalTags, allowedHosts);
  const { error } = await supabase
    .from("antena_sites")
    .update({ last_access: new Date().toISOString() })
    .eq("id", site.id);

  if (error) {
    throw new Error(
      `Failed to update last_access for site ${site.id}: ${error.message}`,
    );
  }
  return site.id;
}

function logResults(results: PromiseSettledResult<number>[]) {
  console.log("\n--- Scraping results ---");
  let successCount = 0;
  let failureCount = 0;

  results.forEach((result) => {
    if (result.status === "fulfilled") {
      console.log(`✅ Success: Site ID ${result.value}`);
      successCount++;
    } else {
      console.error(`❌ Failure: ${result.reason?.message || "Unknown error"}`);
      failureCount++;
    }
  });
  console.log("------------------------");
  console.log(
    `✨ Process finished. Success: ${successCount}, Failure: ${failureCount}.`,
  );
}

await runScraping();
