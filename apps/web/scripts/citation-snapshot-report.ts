#!/usr/bin/env tsx
/**
 * Citation + mention snapshot report — one calendar day (UTC), raw data for
 * manual Excel analysis. Produces four CSVs:
 *
 *   a) citations_by_type      — every cited domain that day, with its
 *                                category and citation count.
 *   b) citations_unbranded    — same, but scoped to unbranded prompts only,
 *                                broken out per tag (a multi-tag prompt's
 *                                citations count toward each of its tags).
 *   c) citations_branded      — same as (b), for branded prompts.
 *   d) mentions               — one row per citation: keyword, tags,
 *                                branded/unbranded, the full AI response
 *                                text, and the cited url/domain/category.
 *                                Raw/unaggregated, for pivoting in Excel.
 *                                TODO: per-product mention columns (e.g. a
 *                                specific product line, not just the
 *                                registered brand/competitor names) aren't
 *                                tracked anywhere — add a product-name list
 *                                + text search over `response` here if/when
 *                                needed. Search-volume (e.g. from Rakko) is
 *                                also not joined — low priority per 2026-08-25.
 *
 * Domain categorization reuses the exact production logic (curated lists +
 * the domain_categories LLM-classification cache) via categorizeDomainsCached
 * — no separate/duplicated classification rules. Response-text extraction
 * reuses extractTextContent (same dispatcher the prompt-detail page uses).
 *
 * Usage (must run with cwd = apps/web so tsx picks up its tsconfig paths):
 *   cd apps/web
 *   DATABASE_URL="postgresql://..." pnpm tsx scripts/citation-snapshot-report.ts --brand=brand-4 --date=2026-08-24
 *   DATABASE_URL="postgresql://..." pnpm tsx scripts/citation-snapshot-report.ts --brand=brand-4 --date=2026-08-24 --out=../../reports
 *
 * --date is a UTC calendar day boundary (00:00:00 to 23:59:59 UTC), same
 * convention as the earlier one-off SQL exports for this project.
 */
import { parseArgs } from "node:util";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { brands, competitors, prompts, citations, promptRuns } from "@workspace/lib/db/schema";
import { getEffectiveBrandedStatus, isSystemTag } from "@workspace/lib/tag-utils";
import { extractTextContent } from "@workspace/lib/text-extraction";
import { extractDomain } from "../src/lib/domain-categories";
import { categorizeDomainsCached } from "../src/lib/domain-categories.server";

const { values } = parseArgs({
	options: {
		brand: { type: "string" },
		date: { type: "string" },
		out: { type: "string", default: "." },
	},
});

if (!values.brand || !values.date) {
	console.error("Usage: pnpm tsx scripts/citation-snapshot-report.ts --brand=<brandId> --date=YYYY-MM-DD [--out=<dir>]");
	process.exit(1);
}
if (!process.env.DATABASE_URL) {
	console.error("DATABASE_URL is required.");
	process.exit(1);
}

const brandId = values.brand;
const dateStr = values.date;
const outDir = resolve(process.cwd(), values.out ?? ".");
mkdirSync(outDir, { recursive: true });

const db = drizzle(process.env.DATABASE_URL);

function csvCell(v: string | number): string {
	const s = String(v);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function writeCsv(path: string, header: string[], rows: (string | number)[][]): void {
	const lines = [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))];
	writeFileSync(path, lines.join("\n") + "\n", "utf-8");
	console.log(`wrote ${rows.length} rows -> ${path}`);
}

async function main() {
	const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
	const dayEnd = new Date(`${dateStr}T00:00:00.000Z`);
	dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
	if (Number.isNaN(dayStart.getTime())) {
		console.error(`Invalid --date: ${dateStr} (expected YYYY-MM-DD)`);
		process.exit(1);
	}

	const [brandRow] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
	if (!brandRow) {
		console.error(`No brand found with id "${brandId}"`);
		process.exit(1);
	}
	const competitorsList = await db.select().from(competitors).where(eq(competitors.brandId, brandId));
	const allPrompts = await db
		.select({ id: prompts.id, value: prompts.value, tags: prompts.tags, systemTags: prompts.systemTags })
		.from(prompts)
		.where(eq(prompts.brandId, brandId));
	const promptById = new Map(allPrompts.map((p) => [p.id, p]));

	const primaryBrandDomain = extractDomain(brandRow.website || "");
	const additionalBrandDomains = (brandRow.additionalDomains || []).map(extractDomain);
	const brandDomains = new Set([primaryBrandDomain, ...additionalBrandDomains].filter(Boolean));
	const competitorDomains = new Set(competitorsList.flatMap((c) => c.domains.map(extractDomain)).filter(Boolean));

	const dayCitations = await db
		.select({
			domain: citations.domain,
			url: citations.url,
			promptId: citations.promptId,
			promptRunId: citations.promptRunId,
		})
		.from(citations)
		.where(and(eq(citations.brandId, brandId), gte(citations.createdAt, dayStart), lt(citations.createdAt, dayEnd)));

	console.log(`Brand: ${brandRow.name} (${brandId})`);
	console.log(`Day: ${dateStr} (UTC)`);
	console.log(`Citations found: ${dayCitations.length}`);
	if (dayCitations.length === 0) {
		console.log("Nothing to report — no citations on this day for this brand.");
		return;
	}

	const allDomains = dayCitations.map((c) => c.domain);
	const categoryByDomain = await categorizeDomainsCached(allDomains, brandDomains, competitorDomains);

	const runIds = [...new Set(dayCitations.map((c) => c.promptRunId))];
	const runRows = await db
		.select({ id: promptRuns.id, model: promptRuns.model, provider: promptRuns.provider, rawOutput: promptRuns.rawOutput })
		.from(promptRuns)
		.where(inArray(promptRuns.id, runIds));
	const runById = new Map(runRows.map((r) => [r.id, r]));

	// (a) domain x category, across all prompts
	const byDomainType = new Map<string, { domain: string; category: string; count: number }>();
	// (b)/(c) tag x category x domain, split by branded/unbranded
	const byTagUnbranded = new Map<string, { tag: string; category: string; domain: string; count: number }>();
	const byTagBranded = new Map<string, { tag: string; category: string; domain: string; count: number }>();
	// (d) one row per citation, unaggregated
	const mentionRows: (string | number)[][] = [];

	for (const c of dayCitations) {
		const category = categoryByDomain.get(c.domain) ?? "other";

		const aKey = `${c.domain}|${category}`;
		const aEntry = byDomainType.get(aKey);
		if (aEntry) aEntry.count++;
		else byDomainType.set(aKey, { domain: c.domain, category, count: 1 });

		const prompt = promptById.get(c.promptId);
		if (!prompt) continue;
		const { isBranded } = getEffectiveBrandedStatus(prompt.systemTags ?? [], prompt.tags ?? []);
		const topicalTags = (prompt.tags ?? []).filter((t) => !isSystemTag(t));
		const tagList = topicalTags.length > 0 ? topicalTags : ["(no tag)"];
		const target = isBranded ? byTagBranded : byTagUnbranded;
		for (const tag of tagList) {
			const key = `${tag}|${category}|${c.domain}`;
			const entry = target.get(key);
			if (entry) entry.count++;
			else target.set(key, { tag, category, domain: c.domain, count: 1 });
		}

		const run = runById.get(c.promptRunId);
		const responseText = run ? extractTextContent(run.rawOutput, run.provider ?? run.model) : "(run not found)";
		mentionRows.push([
			prompt.value,
			topicalTags.join(", "),
			isBranded ? "branded" : "unbranded",
			run?.model ?? "",
			responseText,
			c.url,
			c.domain,
			category,
		]);
	}

	const suffix = `${brandId}_${dateStr}`;
	writeCsv(
		resolve(outDir, `citations_by_type_${suffix}.csv`),
		["domain", "category", "count"],
		[...byDomainType.values()].sort((a, b) => b.count - a.count).map((r) => [r.domain, r.category, r.count]),
	);
	writeCsv(
		resolve(outDir, `citations_unbranded_${suffix}.csv`),
		["tag", "category", "domain", "count"],
		[...byTagUnbranded.values()]
			.sort((a, b) => b.count - a.count)
			.map((r) => [r.tag, r.category, r.domain, r.count]),
	);
	writeCsv(
		resolve(outDir, `citations_branded_${suffix}.csv`),
		["tag", "category", "domain", "count"],
		[...byTagBranded.values()].sort((a, b) => b.count - a.count).map((r) => [r.tag, r.category, r.domain, r.count]),
	);
	writeCsv(
		resolve(outDir, `mentions_${suffix}.csv`),
		["keyword", "tags", "branded_unbranded", "model", "response", "url", "domain", "category"],
		mentionRows,
	);
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
