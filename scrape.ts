// scrape.ts
import { type Cheerio, type CheerioAPI, load } from "npm:cheerio";
import type { Element } from "npm:domhandler";

import { randomUA } from "./utils.ts";
import Encoding from "npm:encoding-japanese";
import DOMPurify from "npm:isomorphic-dompurify";
import beautify from "npm:js-beautify";

import { supabase } from "./db.ts";
import { scrapeSite } from "./site.ts";

export async function getHtmlText(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": randomUA(),
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja-JP,ja;q=0.9",
    },
  });
  if (!resp.ok) throw new Error(`fetch error ${resp.status} for ${url}`);

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

export interface ExtractOpt {
  // Cheerio<Element> の Element に対してfind(tagName) を受け取り条件に従って
  // 不要なタグを type:Element として操作し削除するutilities

  /** メイン抽出用CSSセレクタ */
  mainSelectorTag: string;
  /** 除去したい要素のCSSセレクタリスト */
  removeSelectorTags?: string[];
  // 外側の不要なアンカー要素を削除しimgタグのみ表示させる
  transVisibleImage?: string;
  /** data-srcやlazy-dara-src属性など、src属性に格納し画像タグの属性をよりスリムにする **/
  imgDataSrcToImgSrc?: string;
  // iframe 要素にあるsrc属性の修正
  iframeSrcToWithSuffixInItemFix?: boolean;
  // video コンテンツを不要な属性を落としスリムにする
  simplifyVideoElement?: string;
  // 空要素となっているtag <center></center>のようなタグを削除する
  removeEmptyTag?: string;
  /** DOMPurifyに追加で許可するタグ */
  sanitizedAddTags?: string[];

  // sanitizeをしjs-beautifyでformatした後文字列として操作をするutilities

  /** br連続をまとめる上限回数 */
  reducebr?: number;
  // アフィリエイトIDを削除し著者になるべく収益を発生させないようにする処理
  removeAffiID?: boolean;
  // img src="data:image/..." にマッチし style,alt 属性をモバイル環境下でも閲覧しやすい環境にする。
  fixBase64Img?: boolean;
  // imgurのblockquoteタグをimgタグに変換する関数（data-id属性が存在する場合のみ）
  imgurToImg?: boolean;
  // twitter card をみえるようにするためにtwitter-api の js を追加する
  twitterEmbed?: boolean;
  // 正規表現として任意のタグを削除する ※find(tag).remove() で消えない用
  removeTagAsString?: string;
  // img タグなどsrc属性がhttps? で始まらない場合それを付加する
  toFullURL?: string;
  // 文字列としてタグ間の文字列を削除する
  removeTagStr?: string;
  // tag 操作のoperation の最後に行われる
  // operation を繰り返すことでタグの中身のないもが増えるため最後に削除する
  removeString?: string;
}

export function baseExtract(html: string, opt: ExtractOpt): string {
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

  if (opt.transVisibleImage) {
    root.find(opt.transVisibleImage)
      .has("img, video, source")
      .each((_i, el) => {
        const $a = $(el);
        const $childVideo = $a.find("video, source").first();
        if ($childVideo.length) {
          const videoSrc = $childVideo.attr("src") || $a.attr("href") || "";
          if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(videoSrc)) {
            console.log(`Found video Element => ${videoSrc}`);
            $a.replaceWith(
              `<video src="${videoSrc}" controls playsinline
              style="max-width:100%;height:auto;"></video>`,
            );
            return;
          }
        }

        const $img = $a.find("img").first();
        const imgSrc = $img.attr("src") ??
          $img.attr("data-src") ??
          $img.attr("data-eio-rsrc") ??
          "";
        if (imgSrc && /\.(jpe?g|png|gif|webp)(\?.*)?$/i.test(imgSrc)) {
          $img.attr("src", imgSrc);
          $a.replaceWith($img);
        }
      });
  }

  if (opt.imgDataSrcToImgSrc) {
    const tag = opt.imgDataSrcToImgSrc; // e.g. "data-src"
    root.find(`img[${tag}]`).each(function () {
      const $oldImg = $(this);
      const dataSrc = $oldImg.attr(tag);
      if (!dataSrc) {
        console.log(`Found img[${tag}] but, no value => ${dataSrc}`);
        return;
      }
      const $newImg = $("<img>").attr("src", dataSrc);
      $oldImg.replaceWith($newImg);
    });
  }

  if (opt.iframeSrcToWithSuffixInItemFix) {
    root.find("iframe").each((_, iframe) => {
      const src = $(iframe).attr("src");
      if (src?.includes("itemfix.com")) {
        $(iframe).attr("src", `https:${src}`);
      }
    });
  }

  if (opt.simplifyVideoElement) {
    // 指定されたクラス名のdiv要素を対象とする
    const tag = opt.simplifyVideoElement;
    root.find(tag).each((_, container) => {
      const $container = $(container);
      const source = $container.find('source[type="video/mp4"]');
      if (source.length) {
        const src = source.attr("src");
        if (src) {
          $container.replaceWith(`<video src="${src}" controls></video>`);
        }
      }
    });
  }

  if (opt.removeEmptyTag) {
    const tag = opt.removeEmptyTag;
    root.find(tag).each(function () {
      const content = $(this).text().trim();
      if (!content) {
        $(this).remove(); // Remove if it's empty or contains only non-visible characters
      }
    });
  }
  /* ========= noscript 内にある iframe を展開 ========= */
  // dompurify は noscript をうまく抜き出せないので事前に取得
  root.find("noscript").each((_i, el) => {
    const $ns = $(el);
    const inner = $ns.html() ?? "";
    const $$ = load(inner); // noscript の中をパース
    const $if = $$("iframe").first(); // <iframe> を抜く

    if ($if.length) {
      // lazyload 用 data-src → src に昇格
      if ($if.attr("data-src") && !$if.attr("src")) {
        $if.attr("src", $if.attr("data-src"));
      }
      $ns.replaceWith($if); // noscript → iframe 差し替え
    } else {
      $ns.remove(); // iframe 無ければ削除
    }
  });

  const dirty = root.map((_, el) => $(el).html() ?? "")
    .get()
    .join("\n");
  const allow = opt.sanitizedAddTags ?? ["iframe", "script", "noscript"];
  const clean = DOMPurify.sanitize(dirty, {
    ADD_TAGS: allow,
    ADD_ATTR: ["src", "alt", "href", "controls", "playsinline"],
  });
  let output = beautify.html(clean, { indent_size: 2 });

  if (opt.reducebr) {
    output = output.replace(
      new RegExp(`(?:<br\\s*/?>\\s*){${opt.reducebr},}`, "gi"),
      "<br>",
    );
  }

  if (opt.removeAffiID) {
    output = output.replace(/affi_id=[^/]+\//, "");
  }

  if (opt.fixBase64Img) {
    const pattern = /(<img\s+[^>]*src="data:image\/[^"]+"[^>]*)(>)/gi;
    output = output.replace(
      pattern,
      '$1 style="width: 32px; height: 32px;" alt="emoji"$2',
    );
  }

  if (opt.imgurToImg) {
    output = output.replace(
      /<script\b[^>]*embed\.js[^<]*<\/script>/gi,
      "",
    );

    output = output.replace(
      /<blockquote\b[^>]*\bdata-id="([^"]+)"[^>]*>[\s\S]*?<\/blockquote>/gi,
      (_: string, id: string) => `<img src="https://i.imgur.com/${id}.jpg" />`,
    );
  }
  if (opt.twitterEmbed) {
    // blockquote.twitter-tweet が 1 つでもあれば widgets.js を末尾に挿入
    if (
      /<blockquote[^>]+twitter-tweet/i.test(output) &&
      !/platform\.twitter\.com\/widgets\.js/i.test(output)
    ) {
      output +=
        '\n<script async src="https://platform.twitter.com/widgets.js"></script>';
    }
  }

  if (opt.removeTagStr) {
    const regex = new RegExp(
      `<${opt.removeTagAsString}[\\s\\S]*?<\\/${opt.removeTagAsString}>`,
      "gi",
    );
    output = output.replace(regex, "");
  }

  if (opt.toFullURL) {
    const base = opt.toFullURL.replace(/\/+$/, "");

    root.find("[src]").each((_i, el) => {
      let src = $(el).attr("src") ?? "";
      src = src.trim().replace(/\s+/g, "");
      if (/^https?:\/\//i.test(src)) return;
      const abs = `${base}/${src.replace(/^\/+/, "")}`;
      $(el).attr("src", abs);
    });
  }

  if (opt.removeString) {
    const regex = new RegExp(opt.removeString, "gis");
    output = output.replace(regex, "");
  }

  return removeDuplicateEmptyLine(output.trim());
}

export async function getContent(articleURL: string): Promise<string> {
  try {
    const urlObj = new URL(articleURL);
    const host = urlObj.hostname.replace(/^(www|m|amp)\./i, "");
    let key = host;
    if (host === "blog.livedoor.jp") {
      const segs = urlObj.pathname.split("/").filter(Boolean);
      if (segs.length > 0) {
        key = `${host}/${segs[0]}`;
      }
    }
    const { data: siteRows, error: fetchError } = await supabase
      .from("antena_sites")
      .select("rss, category, domain, scrape_options")
      .eq("domain", key)
      .limit(1);

    if (fetchError) {
      console.error(fetchError);
      Deno.exit(1);
    }

    if (!siteRows.length) {
      console.log("Fetch error domain from antena_sites");
      Deno.exit(1);
    }
    const scrapeOptions = siteRows[0].scrape_options;
    if (!scrapeOptions) {
      console.log(`Error: cannot fetch scrape_options domain => ${key}`);
      return "";
    }

    const html = await getHtmlText(articleURL);
    if (!html) throw new Error("本文の取得に失敗");

    const tidy = baseExtract(html, scrapeOptions);
    return tidy || "";
  } catch (err) {
    console.error(`[getContent] ${articleURL}\n  ↳ ${err}`);
    return "";
  }
}

async function testOne_site(articleURL: string, debug?: boolean) {
  try {
    const text = await getHtmlText(articleURL);
    if (text === "") {
      console.log(`Cannot get text from ${articleURL}`);
    }
    console.log(`${articleURL} text length -> ${text.length}`);
    const urlObj = new URL(articleURL);
    const host = urlObj.hostname.replace(/^wwww\./, "");
    let key = host;
    if (host === "blog.livedoor.jp") {
      // pathname = "/pururungazou/" → ["pururungazou"]
      const segs = urlObj.pathname.split("/").filter(Boolean);
      if (segs.length > 0) {
        key = `${host}/${segs[0]}`;
      }
    }

    if (debug) {
      console.log(host);
      console.log(text);
    }

    if (!(key in EXTRACTOR)) {
      throw new Error(
        `Not found pre-defined scraping table domain -> ${host}`,
      );
    }

    const extract = EXTRACTOR[key];
    const extracted = await extract(text);
    console.log(extracted);

    const content = `<!DOCTYPE html>
      <html lang="ja">
      <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>記事一覧ビューア</title>
      <style>
      <!– before my used style
      body { 
        margin: 0;
        padding: 0;
        width: 100vw;
        overflow-x: hidden;
        font-family: Arial, sans-serif;
        font-size: 16px;
        wrap: text-wrap;
      }
      .article { 
        margin-bottom: 10px;
        padding: 10px;
        border-top: 3px solid #aaa;
        width: 100vw;
        box-sizing: border-box;
      }
      img {
        width: 100%;
        height: auto;
        display: block;
        max-width: none;
      }
      iframe, video, embed, object {
        max-width: 100%;
        width: 100% !important;
        height: auto;
        aspect-ratio: 16 / 9;
        display: block;
      }
      .idname {
        margin-top: 20px;
        padding: 0.5rem;
        font-size: 12px;
        background: #eaf3ff;
        border-bottom: solid 3px #516ab6;
      }

      .txt {
        margin: 20px 0px 40px 5px;
        font-size: 18px;
        font-weight: bold;
      }
      –>

      *{box-sizing:border-box;margin:0;padding:0}
      body{
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
        font-size:16px;line-height:1.6;
        width:100vw;overflow-x:hidden;
        padding:8px;
      }

      .article{border-top:3px solid #aaa;margin-bottom:24px}
      img,video{
        max-width:100%;height:auto;display:block;margin:8px 0;
      }
      iframe,embed,object{
        max-width:100% !important;
        width:100% !important;
        height:auto !important;
        aspect-ratio:16/9;
        display:block;margin:8px 0;
      }
      iframe[src*="youtube"],iframe[src*="youtu.be"],
      iframe[src*="vimeo"]{
        max-width:100% !important;width:100% !important;height:auto !important;
        aspect-ratio:16/9;
      }

      table{
        width:100%;display:block;overflow-x:auto;border-collapse:collapse;margin:12px 0;
      }
      td,th{padding:4px;border:1px solid #ccc;font-size:14px}

      pre,code{
        font-family:SFMono-Regular,Consolas,"Liberation Mono",Menlo,monospace;
        white-space:pre-wrap;word-wrap:break-word;overflow-x:auto;
      }
      pre{background:#f7f7f7;border:1px solid #e1e1e1;border-radius:4px;padding:8px;margin:12px 0}

      .idname{margin:20px 0 4px;background:#eaf3ff;padding:.5rem;border-bottom:3px solid #516ab6;font-size:12px}
      .txt{margin:20px 0 40px 5px;font-size:18px;font-weight:bold}

      </style>
      </head>
      <body>
      <section class="article">
      <p><a href="${articleURL}" target=_"blank">${articleURL}</a></p>
      ${extracted}
      </section>
      </body>
      </html>
      `;

    const data = new TextEncoder().encode(content);
    Deno.writeFileSync("/mnt/c/Users/untun/Downloads/preview.html", data);
    console.log("Update preview.html file");
  } catch (err) {
    console.log(err);
    return;
  }
}

async function testOne_site_with_query(articleURL: string, debug?: boolean) {
  try {
    const text = await getHtmlText(articleURL);
    if (text === "") {
      console.log(`Cannot get text from ${articleURL}`);
    }
    console.log(`${articleURL} text length -> ${text.length}`);
    const urlObj = new URL(articleURL);
    const host = urlObj.hostname.replace(/^www\./, "");
    let key = host;
    if (host === "blog.livedoor.jp") {
      // pathname = "/pururungazou/" → ["pururungazou"]
      const segs = urlObj.pathname.split("/").filter(Boolean);
      if (segs.length > 0) {
        key = `${host}/${segs[0]}`;
      }
    }

    const { data: siteRows, error: fetchError } = await supabase
      .from("antena_sites")
      .select("scrape_options")
      .eq("domain", key)
      .limit(1);

    if (fetchError) {
      throw fetchError;
    }

    if (!siteRows?.length) {
      throw new Error("antena_sitesテーブルに未登録");
    }
    const scrapeOptions = siteRows[0].scrape_options as ExtractOpt;

    const extracted = baseExtract(text, scrapeOptions);
    console.log(extracted);

    const content = `<!DOCTYPE html>
      <html lang="ja">
      <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>記事一覧ビューア</title>
      <style>
      <!– before my used style
      body { 
        margin: 0;
        padding: 0;
        width: 100vw;
        overflow-x: hidden;
        font-family: Arial, sans-serif;
        font-size: 16px;
        wrap: text-wrap;
      }
      img {
        width: 100%;
        height: auto;
        display: block;
        max-width: none;
      }
      iframe, video, embed, object {
        max-width: 100%;
        width: 100% !important;
        height: auto;
        aspect-ratio: 16 / 9;
        display: block;
      }
      .idname {
        margin-top: 20px;
        padding: 0.5rem;
        font-size: 12px;
        background: #eaf3ff;
        border-bottom: solid 3px #516ab6;
      }

      .txt {
        margin: 20px 0px 40px 5px;
        font-size: 18px;
        font-weight: bold;
      }
      –>

      *{box-sizing:border-box;margin:0;padding:0}
      body{
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
        font-size:16px;line-height:1.6;
        width:100vw;overflow-x:hidden;
        padding:8px;
      }

      .article{border-top:3px solid #aaa;margin-bottom:24px}
      img,video{
        max-width:100%;height:auto;display:block;margin:8px 0;
      }
      iframe,embed,object{
        max-width:100% !important;
        width:100% !important;
        height:auto !important;
        aspect-ratio:16/9;
        display:block;margin:8px 0;
      }
      iframe[src*="youtube"],iframe[src*="youtu.be"],
      iframe[src*="vimeo"]{
        max-width:100% !important;width:100% !important;height:auto !important;
        aspect-ratio:16/9;
      }

      table{
        width:100%;display:block;overflow-x:auto;border-collapse:collapse;margin:12px 0;
      }
      td,th{padding:4px;border:1px solid #ccc;font-size:14px}

      pre,code{
        font-family:SFMono-Regular,Consolas,"Liberation Mono",Menlo,monospace;
        white-space:pre-wrap;word-wrap:break-word;overflow-x:auto;
      }
      pre{background:#f7f7f7;border:1px solid #e1e1e1;border-radius:4px;padding:8px;margin:12px 0}

      .idname{margin:20px 0 4px;background:#eaf3ff;padding:.5rem;border-bottom:3px solid #516ab6;font-size:12px}
      .txt{margin:20px 0 40px 5px;font-size:18px;font-weight:bold}

      </style>
      </head>
      <body>
      <section class="article">
      <p><a href="${articleURL}" target=_"blank">${articleURL}</a></p>
      ${extracted}
      </section>
      </body>
      </html>
      `;

    const data = new TextEncoder().encode(content);
    Deno.writeFileSync("/mnt/c/Users/untun/Downloads/preview.html", data);
    console.log("Update preview.html file");
  } catch (err) {
    console.log(err);
    return;
  }
}

// await testOne_site("http://anihatsu.com/archives/95217759.html");
// await testOne_site_with_query(
//   "http://m4ex.com/other-title/100kano3",
// );

async function testDomainList() {
  const { data: siteRows, error: fetchError } = await supabase
    .from("antena_sites")
    .select("rss, category, domain, scrape_options");

  if (fetchError) {
    console.error(fetchError);
    Deno.exit(1);
  }

  if (!siteRows.length) {
    console.log("Fetch error domain from antena_sites");
    Deno.exit(1);
  }

  for (const site of siteRows) {
    const domain = site.domain;
    const opt = site.scrape_options as ExtractOpt;
    if (!opt) {
      continue;
    }
    const fixed = fixSelectorsInJSON({ ...opt });
    // 変化がある場合のみ更新
    if (JSON.stringify(fixed) !== JSON.stringify(opt)) {
      console.log(domain);
      console.log(fixed);
      // const { error: updateErr } = await supabase
      //   .from("antena_sites")
      //   .update({ scrape_options: fixed })
      //   .eq("domain", domain);

      //   if (updateErr) {
      //     console.error(`Update failed for ${domain}:`, updateErr);
      //   } else {
      //     console.log(`Updated scrape_options for ${domain}`);
      //   }
      // }
    }
    // scrapeSite(site.rss, supabase, site.category);
    // console.log(domain);
    // console.log(fixedOptions);
  }
}

// エスケープが必要な属性セレクターの修正
function fixEscapeSelector(selector: string): string {
  return selector.replace(
    /\[([^\]=]+)([*^$|~]?=)([^\]"']+)\]/g,
    (_, attr, operator, value) => `[${attr}${operator}"${value.trim()}"]`,
  );
}

// JSON内のセレクターを修正
function fixSelectorsInJSON(scrapeOptions: ExtractOpt): ExtractOpt {
  if (scrapeOptions.removeSelectorTags) {
    scrapeOptions.removeSelectorTags = scrapeOptions.removeSelectorTags.map(
      (tag: string) => fixEscapeSelector(tag),
    );
  }
  return scrapeOptions;
}

async function testAllOptions() {
  const { data: siteRows, error: fetchError } = await supabase
    .from("antena_sites")
    .select("rss, category, domain, scrape_options");

  if (fetchError) {
    console.error(fetchError);
    Deno.exit(1);
  }

  if (!siteRows.length) {
    console.log("Fetch error domain from antena_sites");
    Deno.exit(1);
  }

  for (const site of siteRows) {
    const domain = site.domain;
    const opt = site.scrape_options as ExtractOpt;
    if (!opt) {
      continue;
    }
    scrapeSite(site.rss, supabase, site.category);
  }
}

// await testDomainList();

// await testAllOptions();
