import { type Cheerio, type CheerioAPI, load } from "npm:cheerio";
import type { Element } from "npm:domhandler";

import { getDomain, randomUA } from "./utils.ts";
import Encoding from "npm:encoding-japanese";
import DOMPurify from "npm:isomorphic-dompurify";
import beautify from "npm:js-beautify";

import { articleTable, siteTable, supabase } from "./db.ts";
import { ScrapeOptions } from "./site.ts";

const LAZY = ["data-src", "data-lazy-src", "data-original"];

export async function getHtmlText(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": randomUA(),
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja-JP,ja;q=0.9",
    },
  });
  if (!resp.ok) throw new Error(`fetch error ${resp.status}`);

  const buf = new Uint8Array(await resp.arrayBuffer());
  let charset = (
    resp.headers.get("content-type")?.match(/charset="?([^;" ]+)/i)?.[1] ?? ""
  ).toUpperCase();
  if (!charset) {
    const det = Encoding.detect(buf);
    charset = typeof det === "string" ? det.toUpperCase() : "UTF8";
  }

  let text: string;
  if (charset !== "UTF8" && charset !== "UNICODE") {
    text = Encoding.convert(buf, {
      from: charset,
      to: "UNICODE",
      type: "string",
    }) as string;
  } else {
    text = new TextDecoder(charset).decode(buf);
  }

  return removeDuplicateEmptyLine(text);
}

function removeDuplicateEmptyLine(text: string) {
  return text.replace(/\n\s*\n+/g, "\n");
}

export function baseExtract(
  html: string,
  opt: ScrapeOptions,
  articleURL: string,
): string {
  const $: CheerioAPI = load(html);
  const root: Cheerio<Element> = $(opt.mainSelectorTag) as Cheerio<Element>;

  if (!root.length) {
    console.error(
      `Error: Can't make root Element specified mainSelector => ${opt.mainSelectorTag}`,
    );
    return "";
  }

  if (opt.removeSelectorTags) {
    for (const sel of opt.removeSelectorTags) {
      root.find(sel).remove();
    }
  }

  filterScriptTags($, root);
  unwrapAnchoredMedia($, root);
  convertVideoJs($, root);
  unwrapVideoWrappers($, root);
  normalizeImages($, root);
  normalizeLoneVideos($, root);
  convertImgurEmbeds($, root);
  removeEmptyStyledBlocks($, root);
  unwrapNoscript($, root);
  collapseBr($, root);
  absolutizeSrc($, root, articleURL);
  const dirty = root.map((_, el) => $(el).html() ?? "")
    .get()
    .join("\n");

  const allow = ["iframe", "script", "noscript"];
  const clean = DOMPurify.sanitize(dirty, {
    ADD_TAGS: allow,
    ADD_ATTR: [
      "src",
      "alt",
      "href",
      "controls",
      "playsinline",
      "referrerpolicy",
    ],
  });
  const output = beautify.html(clean, { indent_size: 2 });
  return removeDuplicateEmptyLine(output.trim());
}

export async function getContent(articleURL: string): Promise<string> {
  try {
    const domain = getDomain(articleURL);
    const { data: siteRows, error: fetchError } = await supabase
      .from(siteTable)
      .select("*")
      .eq("domain", domain)
      .limit(1);

    if (fetchError) {
      console.error(fetchError);
      Deno.exit(1);
    }

    if (!siteRows.length) {
      console.log("Failed to fetch record with equal domain in getContent()");
      Deno.exit(1);
    }
    const sopt = siteRows[0].scrape_options;
    if (!sopt.mainSelectorTag) {
      console.log("Not found mainSelectorTag");
      return "";
    }

    const html = await getHtmlText(articleURL);
    if (!html) throw new Error("Failed to get html");

    const tidy = baseExtract(html, sopt, articleURL);
    return tidy || "";
  } catch (err) {
    console.error(err);
    return "";
  }
}

function unwrapAnchoredMedia($: CheerioAPI, root: Cheerio<Element>) {
  const MEDIA_RE = /\.(jpe?g|png|gif|webp|mp4|webm|mov|m4v)(\?.*)?$/i;
  const VIDEO_RE = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;

  root.find("a").each((_, a) => {
    const $a = $(a);

    let url = ($a.attr("href") || "").trim();
    if (!MEDIA_RE.test(url)) {
      const $m = $a.find("img,video,source").first();
      url = ($m.attr("src")?.trim() ?? "") ||
        LAZY.map((k) => $m.attr(k)?.trim()).find(Boolean) || "";
    }
    if (!MEDIA_RE.test(url)) return;

    if (VIDEO_RE.test(url)) {
      $a.replaceWith(
        `<video src="${url}" class="my-formatted" controls playsinline style="width:100%;height:auto;display:block;"></video>`,
      );
    } else {
      $a.replaceWith(
        `<img src="${url}" class="my-formatted" referrerpolicy="no-referrer" style="width:100%;height:auto;display:block;" loading="lazy" />`,
      );
    }
  });
}
function unwrapVideoWrappers($: CheerioAPI, root: Cheerio<Element>) {
  root.find(":is(div,figure,section):has(> video)")
    .filter((_, el) => $(el).children("video").length === 1)
    .each((_, el) => {
      const $wrap = $(el);
      const $video = $wrap.children("video").first();
      $wrap.replaceWith($video);
    });

  root.find("video:has(> video)").each((_, outer) => {
    const $outer = $(outer);
    const $inner = $outer.children("video").first();

    const src = $inner.attr("src") ||
      $inner.find("source[type='video/mp4']").attr("src") || "";
    if (src) $outer.attr("src", src);

    $inner.remove();
  });
}
function convertVideoJs($: CheerioAPI, root: Cheerio<Element>) {
  root.find("video-js").each((_, vjs) => {
    const $vjs = $(vjs);

    const src = ($vjs.attr("src") || "").trim() ||
      $vjs.find("source[type*='mp4'],source[src$='.mp4']")
        .first().attr("src")?.trim() ||
      "";

    if (!src) {
      // console.warn("convertVideoJs: src not found – skipped:\n", $.html($vjs));
      return;
    }

    const $video = $("<video>")
      .attr({
        src,
        controls: "",
        playsinline: "",
        loading: "lazy",
        style: "max-width:100%;height:auto;display:block",
      })
      .addClass("my-formatted");

    const poster = $vjs.attr("poster");
    if (poster) $video.attr("poster", poster);

    $vjs.replaceWith($video);
  });
}

function normalizeImages($: CheerioAPI, root: Cheerio<Element>) {
  root.find("img:not(.my-formatted)").each((_, img) => {
    const $img = $(img);
    let src = ($img.attr("src") || "").trim();

    const isDummy = !src || src.startsWith("data:") || src === "#" ||
      src.startsWith("about:");
    if (isDummy) {
      src = LAZY.map((k) => $img.attr(k)?.trim()).find(Boolean) || "";
    }
    if (!src) {
      // console.warn(
      //   "normalizeImages: <img> without src - removed:",
      //   $.html($img),
      // );
      $img.remove();
      return;
    }

    const $new = $("<img>")
      .attr({
        src,
        loading: "lazy",
        referrerpolicy: "no-referrer",
        style: "max-width:100%;height:auto;display:block",
      })
      .addClass("my-formatted");

    $img.replaceWith($new);
  });
}

function normalizeLoneVideos($: CheerioAPI, root: Cheerio<Element>) {
  root.find("video:not(.my-formatted)").each((_, v) => {
    const $v = $(v);

    let src = $v.attr("src")?.trim() || "";
    if (!src) {
      src = $v.find("source[type*='mp4'],source[src$='.mp4']")
        .first().attr("src")?.trim() || "";
      if (!src) {
        // console.warn(
        //   "normalizeLoneVideos: <video> w/o src removed",
        //   $.html($v),
        // );
        $v.remove();
        return;
      }
    }

    const $new = $("<video>")
      .attr({
        src,
        controls: "",
        playsinline: "",
        style: "max-width:100%;height:auto;display:block",
        loading: "lazy",
      })
      .addClass("my-formatted");

    $v.replaceWith($new);
  });
}

function convertImgurEmbeds($: CheerioAPI, root: Cheerio<Element>) {
  root.find('script[src*="imgur.com/js/embed.js"]').remove();
  root.find("blockquote.imgur-embed-pub[data-id]").each((_, el) => {
    const id = $(el).attr("data-id")?.trim();
    $(el).replaceWith(
      `<img src="https://i.imgur.com/${id}.jpg" loading="lazy" referrerpolicy="no-referrer" />`,
    );
  });
}

function removeEmptyStyledBlocks($: CheerioAPI, root: Cheerio<Element>) {
  const SKIP_TAGS = new Set([
    "img",
    "video",
    "iframe",
    "embed",
    "source",
    "audio",
    "picture",
    "canvas",
  ]);
  root.find("[style]").each((_, el) => {
    const tag = (el as Element).tagName?.toLowerCase() || "";
    if (SKIP_TAGS.has(tag)) return;
    const $el = $(el);

    const hasChild = $el.children().length > 0;
    const hasVisibleChild =
      $el.find("img,video,iframe,source,embed").length > 0;
    const plainText = $el.text().replace(/\s|&nbsp;/g, "");

    if (!hasChild && !hasVisibleChild && plainText === "") {
      $el.remove();
    }
  });
}

function unwrapNoscript($: CheerioAPI, root: Cheerio<Element>) {
  root.find("noscript").each((_i, el) => {
    const $ns = $(el);
    const inner = $ns.html() ?? "";
    const $$ = load(inner);
    const $if = $$("iframe").first();

    if ($if.length) {
      if ($if.attr("data-src") && !$if.attr("src")) {
        $if.attr("src", $if.attr("data-src"));
      }
      $ns.replaceWith($if);
    } else {
      $ns.remove();
    }
  });
}

function collapseBr($: CheerioAPI, root: Cheerio<Element>, limit = 2) {
  let streak: Cheerio<Element>[] = [];

  root.find("br").each((_, br) => {
    const $br = $(br);
    const prev = $br.prev();
    if (prev.length && prev[0].tagName?.toLowerCase() === "br") {
      streak.push($br);
    } else {
      if (streak.length >= limit) {
        streak.slice(limit - 1).forEach(($b) => $b.remove());
      }
      streak = [$br];
    }
  });

  if (streak.length >= limit) {
    streak.slice(limit).forEach(($b) => $b.remove());
  }
}

function absolutizeSrc(
  $: CheerioAPI,
  root: Cheerio<Element>,
  pageURL: string,
) {
  const origin = new URL(pageURL).origin;

  root.find("[src]").each((_, el) => {
    const $el = $(el);
    let src = ($el.attr("src") || "").trim();
    if (!src) return;

    if (/^https?:\/\//i.test(src)) return;

    if (src.startsWith("//")) {
      src = new URL(pageURL).protocol + src;
    } else if (src.startsWith("/")) {
      src = origin + src;
    } else if (!/^https?:\/\//i.test(src)) {
      src = new URL(src, pageURL).href;
    }

    $el.attr("src", src);
  });
}

function filterScriptTags(
  $: CheerioAPI,
  root: Cheerio<Element>,
  pageURL?: string,
) {
  const ALLOW_SCRIPT_HOSTS = new Set([
    "platform.twitter.com",
    "www.youtube.com",
    "www.instagram.com",
    "i.imgur.com",
    "imgur.com",
  ]);

  let baseOrigin: string | undefined;
  if (pageURL) {
    try {
      baseOrigin = new URL(pageURL).origin;
    } catch {
    }
  }

  root.find("script").each((_i, el) => {
    const $s = $(el);
    let src = $s.attr("src")?.trim();

    if (!src) {
      $s.remove();
      return;
    }

    if (src.startsWith("//")) src = "https:" + src;

    try {
      const abs = baseOrigin ? new URL(src, baseOrigin) : new URL(src);

      const host = abs.hostname;
      if (!ALLOW_SCRIPT_HOSTS.has(host)) $s.remove();
    } catch {
      $s.remove();
    }
  });
}
