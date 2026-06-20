import { Helmet } from "react-helmet-async";

interface SeoProps {
  title: string;
  description?: string;
  /** Discourage indexing (e.g. the authenticated app). */
  noindex?: boolean;
  path?: string;
}

const SITE = "https://studyassistant.app";

export function Seo({ title, description, noindex, path = "/" }: SeoProps) {
  const url = `${SITE}${path}`;
  return (
    <Helmet>
      <title>{title}</title>
      {description && <meta name="description" content={description} />}
      <link rel="canonical" href={url} />
      {noindex && <meta name="robots" content="noindex, nofollow" />}
      <meta property="og:title" content={title} />
      {description && <meta property="og:description" content={description} />}
      <meta property="og:url" content={url} />
    </Helmet>
  );
}
