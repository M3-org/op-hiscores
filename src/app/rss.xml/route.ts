import { db } from "@/lib/data/db";
import { overallSummaries } from "@/lib/data/schema";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-static";
export const revalidate = 3600; // Revalidate every hour

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s/g, "") // Remove headers
    .replace(/\*\*([^*]+)\*\*/g, "$1") // Bold
    .replace(/\*([^*]+)\*/g, "$1") // Italic
    .replace(/`([^`]+)`/g, "$1") // Inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Links
    .replace(/^[-*+]\s/gm, "• ") // List items
    .trim();
}

export async function GET() {
  const [dailySummaries, weeklySummaries, monthlySummaries] = await Promise.all(
    [
      db
        .select()
        .from(overallSummaries)
        .where(eq(overallSummaries.intervalType, "day"))
        .orderBy(desc(overallSummaries.date))
        .limit(30),
      db
        .select()
        .from(overallSummaries)
        .where(eq(overallSummaries.intervalType, "week"))
        .orderBy(desc(overallSummaries.date))
        .limit(4),
      db
        .select()
        .from(overallSummaries)
        .where(eq(overallSummaries.intervalType, "month"))
        .orderBy(desc(overallSummaries.date))
        .limit(1),
    ],
  );

  const siteUrl = process.env.SITE_URL;
  const title = "Contributor Analytics";

  const formatItem = (
    summary: (typeof dailySummaries)[number],
    intervalType: string,
    labelPrefix: string,
  ) => {
    const description = summary.summary
      ? stripMarkdown(summary.summary).slice(0, 500)
      : `${labelPrefix} contributor activity summary`;

    return `
    <item>
      <title>${labelPrefix}: ${summary.date}</title>
      <link>${siteUrl}/summary/${intervalType}/${summary.date}</link>
      <guid isPermaLink="true">${siteUrl}/summary/${intervalType}/${summary.date}</guid>
      <pubDate>${new Date(summary.date).toUTCString()}</pubDate>
      <description>${escapeXml(description)}${description.length >= 500 ? "..." : ""}</description>
    </item>`;
  };

  const items = [
    ...monthlySummaries.map((s) => formatItem(s, "month", "Monthly Summary")),
    ...weeklySummaries.map((s) => formatItem(s, "week", "Weekly Summary")),
    ...dailySummaries.map((s) => formatItem(s, "day", "Daily Summary")),
  ].join("");

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${siteUrl}</link>
    <description>Daily contributor activity summaries and analytics</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${siteUrl}/rss.xml" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
