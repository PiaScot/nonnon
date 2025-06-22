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

export interface Site {
  id: number;
  url: string | null;
  domain: string | null;
  title: string | null;
  rss: string | null;
  category: string | null;
  last_access: string; // ISO8601 string (timestamp with time zone)
  duration_access: number | null;
  scrape_options: ScrapeOptions | null;
}

export interface ScrapeOptions {
  mainSelectorTag: string;
  removeSelectorTags?: string[];
}
