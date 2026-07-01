import { Helmet } from "react-helmet-async";
import {
  DEFAULT_OG_IMAGE,
  SITE_NAME,
  TWITTER_HANDLE,
  absoluteUrl,
} from "@/lib/seo";

interface SeoProps {
  /** Full page title (rendered verbatim into <title>). */
  title: string;
  description?: string;
  /** Keywords for the legacy <meta name="keywords">. */
  keywords?: string[];
  /** Site-relative path used for the canonical + og:url. */
  path?: string;
  /** Discourage indexing (e.g. authenticated app pages). */
  noindex?: boolean;
  /** Absolute (or site-relative) social preview image URL. */
  image?: string;
  /** Open Graph type — "website" (default) or "article" for the blog. */
  type?: "website" | "article";
  /** Article-only metadata (future blog support). */
  article?: {
    publishedTime?: string;
    modifiedTime?: string;
    author?: string;
    tags?: string[];
    section?: string;
  };
  /** One or more JSON-LD structured-data objects to inject. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

/**
 * Single source of truth for a page's head tags: title, description, canonical,
 * robots, Open Graph, Twitter cards, and JSON-LD structured data. Overrides the
 * static defaults in index.html on a per-route basis via react-helmet-async.
 */
export function Seo({
  title,
  description,
  keywords,
  path = "/",
  noindex,
  image,
  type = "website",
  article,
  jsonLd,
}: SeoProps) {
  const url = absoluteUrl(path);
  const ogImage = image
    ? image.startsWith("http")
      ? image
      : absoluteUrl(image)
    : DEFAULT_OG_IMAGE;
  const blocks = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];

  return (
    <Helmet prioritizeSeoTags>
      <title>{title}</title>
      {description && <meta name="description" content={description} />}
      {keywords && keywords.length > 0 && (
        <meta name="keywords" content={keywords.join(", ")} />
      )}
      <link rel="canonical" href={url} />
      <meta
        name="robots"
        content={noindex ? "noindex, nofollow" : "index, follow"}
      />

      {/* Open Graph */}
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={title} />
      {description && <meta property="og:description" content={description} />}
      <meta property="og:url" content={url} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />

      {/* Article-specific OG (blog) */}
      {type === "article" && article?.publishedTime && (
        <meta property="article:published_time" content={article.publishedTime} />
      )}
      {type === "article" && article?.modifiedTime && (
        <meta property="article:modified_time" content={article.modifiedTime} />
      )}
      {type === "article" && article?.author && (
        <meta property="article:author" content={article.author} />
      )}
      {type === "article" && article?.section && (
        <meta property="article:section" content={article.section} />
      )}
      {type === "article" &&
        article?.tags?.map((tag) => (
          <meta key={tag} property="article:tag" content={tag} />
        ))}

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content={TWITTER_HANDLE} />
      <meta name="twitter:title" content={title} />
      {description && <meta name="twitter:description" content={description} />}
      <meta name="twitter:image" content={ogImage} />

      {/* JSON-LD structured data */}
      {blocks.map((block, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(block)}
        </script>
      ))}
    </Helmet>
  );
}
