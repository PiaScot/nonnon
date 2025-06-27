// check.ts
import { generalRemoveTable, siteTable, supabase } from "./db.ts";
import type { Site } from "./types.ts";
import { getHtmlText, processArticleHtml } from "./extractor.ts";
import { getDomain } from "./utils.ts";

/**
 * 指定されたURLに対してデバッグ情報を取得・表示するメイン関数
 */
async function runCheck() {
  const targetUrl = "https://www.nandemo-uketori.com/archives/40174436.html";
  console.log(`--- 🕵️ Starting check for: ${targetUrl} ---`);

  try {
    // --- 1. サイト情報の取得 ---
    const domain = getDomain(targetUrl);
    if (!domain) return;

    const { data: site, error: siteError } = await supabase
      .from<Site>(siteTable)
      .select("*")
      .eq("domain", domain)
      .maybeSingle();

    if (siteError) {
      throw new Error(`Failed to fetch site: ${siteError.message}`);
    }
    if (!site) throw new Error(`Site not found for domain: ${domain}`);
    console.log(`✅ Found Site: ${site.title} (ID: ${site.id})`);

    const { data: generalTagsData } = await supabase
      .from(generalRemoveTable)
      .select("selector");
    const generalRemoveTags = generalTagsData?.map((t: any) => t.selector) ||
      [];
    const siteSpecificTags = site.scrape_options?.removeSelectorTags ?? [];

    const finalRemoveSelectors = [
      ...new Set([...generalRemoveTags, ...siteSpecificTags]),
    ];

    console.log("\n--- 📝 Final Remove Selectors ---");
    console.log(`Total count: ${finalRemoveSelectors.length}`);
    console.log(finalRemoveSelectors);
    console.log("---------------------------------");

    // --- 3. HTMLの取得と処理 ---
    console.log("\n--- 🌐 Fetching and processing HTML ---");
    const mobileHTML = await getHtmlText(targetUrl, "mobile");

    const { data: allowedHostsData, error: hostsError } = await supabase
      .from("allowed_embed_hosts")
      .select("hostname");
    if (hostsError) {
      throw new Error(`Failed to fetch allowed hosts: ${hostsError.message}`);
    }
    const allowedHostsSet = new Set(
      allowedHostsData?.map((h) => h.hostname) || [],
    );

    const processedHtml = processArticleHtml(
      mobileHTML,
      targetUrl,
      finalRemoveSelectors,
      allowedHostsSet,
    );
    console.log("✅ HTML processed successfully.");

    console.log("\n--- 📄 Processed HTML Content ---");
    console.log(processedHtml);
    console.log("---------------------------------");
  } catch (error) {
    console.error("\n--- ❌ An error occurred ---");
    console.error(error.message);
    Deno.exit(1);
  }

  console.log("\n--- ✨ Check finished ---");
}

await runCheck();
