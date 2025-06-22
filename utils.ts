const pcUA = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15",
] as const;

const mobileUA = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.78 Mobile Safari/537.36",
  "Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.62 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Samsung Galaxy S23) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/124.0.6367.78 Mobile Safari/537.36",
] as const;

export function getDomain(articleURL: string): string {
  const urlObj = new URL(articleURL);
  const host = urlObj.hostname.replace(/^www\./, "");
  let domain = host;
  if (host === "blog.livedoor.jp") {
    const segs = urlObj.pathname.split("/").filter(Boolean);
    if (segs.length > 0) {
      domain = `${host}/${segs[0]}`;
    }
  }
  return domain;
}

export const randomPCUA = () => pcUA[Math.floor(Math.random() * pcUA.length)];
export const randomMobileUA = () =>
  mobileUA[Math.floor(Math.random() * mobileUA.length)];
