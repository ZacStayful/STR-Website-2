import { BRAND, TRUST } from "./brand";
import { siteUrl } from "./url";

type SchemaItem = Record<string, unknown>;

export function organizationSchema(): SchemaItem {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BRAND.legalName,
    alternateName: BRAND.name,
    url: siteUrl(),
    sameAs: [BRAND.managementUrl],
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: TRUST.googleRatingNumeric,
      bestRating: 5,
    },
  };
}

export function personSchema(opts: {
  name: string;
  jobTitle: string;
  image: string;
  url?: string;
}): SchemaItem {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: opts.name,
    jobTitle: opts.jobTitle,
    image: opts.image,
    url: opts.url ?? siteUrl("/about"),
    worksFor: {
      "@type": "Organization",
      name: BRAND.legalName,
      url: siteUrl(),
    },
  };
}

export function webPageSchema(opts: {
  name: string;
  url: string;
  description: string;
  datePublished?: string;
  dateModified?: string;
}): SchemaItem {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: opts.name,
    url: opts.url,
    description: opts.description,
    ...(opts.datePublished ? { datePublished: opts.datePublished } : {}),
    ...(opts.dateModified ? { dateModified: opts.dateModified } : {}),
    isPartOf: {
      "@type": "WebSite",
      name: BRAND.name,
      url: siteUrl(),
    },
  };
}

export function webApplicationSchema(opts: {
  name: string;
  url: string;
  description: string;
}): SchemaItem {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: opts.name,
    url: opts.url,
    description: opts.description,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "GBP",
      description: "5 free reports, no card required",
    },
  };
}

export function softwareApplicationSchema(opts: {
  name: string;
  url: string;
  description: string;
  price?: string;
}): SchemaItem {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: opts.name,
    url: opts.url,
    description: opts.description,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers: {
      "@type": "Offer",
      price: opts.price ?? "29",
      priceCurrency: "GBP",
    },
  };
}

export function articleSchema(opts: {
  headline: string;
  url: string;
  description: string;
  datePublished: string;
  dateModified: string;
}): SchemaItem {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: opts.headline,
    url: opts.url,
    description: opts.description,
    datePublished: opts.datePublished,
    dateModified: opts.dateModified,
    author: { "@type": "Organization", name: BRAND.legalName },
    publisher: { "@type": "Organization", name: BRAND.legalName },
  };
}

export function faqSchema(items: Array<{ q: string; a: string }>): SchemaItem {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export function breadcrumbSchema(items: Array<{ name: string; url: string }>): SchemaItem {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export type { SchemaItem };
