import type { Job } from "pg-boss";
import { z } from "zod";
import { db } from "@workspace/lib/db/db";
import { domainCategories } from "@workspace/lib/db/schema";
import { runStructuredCompletionPrompt } from "@workspace/lib/onboarding";

export interface ClassifyDomainData {
	domain: string;
}

/**
 * The domain-level categories a citation can fall into, independent of any
 * brand. Mirrors CitationCategory in apps/web/src/lib/domain-categories.ts
 * minus "brand"/"competitor" (those are resolved per-brand, never cached
 * here) — keep the two lists in sync if either changes.
 */
const DOMAIN_CATEGORIES = [
	"editorial",
	"reviews",
	"ecommerce",
	"social",
	"developer",
	"pr",
	"reference",
	"institutional",
	"other",
] as const;

const CATEGORY_DEFINITIONS = `- editorial: news outlets, blogs, and other media/publishing sites (articles, guides, listicles)
- reviews: dedicated review/comparison/vendor-rating platforms (e.g. G2, Yelp, Trustpilot)
- ecommerce: online retailers, marketplaces, and shopping sites
- social: social media platforms, forums, and online communities (Reddit, X, Discord, etc.)
- developer: code hosting, package registries, developer Q&A, and technical documentation sites
- pr: press-release distribution wire services
- reference: encyclopedias, dictionaries, and structured knowledge/reference databases
- institutional: government, academic, medical, and research institution sites
- other: none of the above, or a generic business/personal site`;

const classificationSchema = z.object({
	category: z.enum(DOMAIN_CATEGORIES).describe(`The single best-fitting category for this domain:\n${CATEGORY_DEFINITIONS}`),
});

function buildPrompt(domain: string): string {
	return `Classify the website domain "${domain}" into exactly one category.

${CATEGORY_DEFINITIONS}

Base your answer on what the domain is generally known for, not on any single page. If you don't recognize the domain or it doesn't clearly fit any category, answer "other".`;
}

/**
 * Classifies a domain the curated lists in domain-categories.server.ts don't
 * recognize, and caches the result in domain_categories so future citations
 * from this domain skip the LLM call. Runs in the worker (not the web
 * request path) so page loads never wait on this.
 */
export async function classifyDomainJob(jobs: Job<ClassifyDomainData>[]): Promise<void> {
	for (const job of jobs) {
		const { domain } = job.data;
		try {
			const result = await runStructuredCompletionPrompt(buildPrompt(domain), classificationSchema);
			await db.insert(domainCategories).values({ domain, category: result.object.category }).onConflictDoNothing();
		} catch (error) {
			console.error(`[classify-domain] failed to classify "${domain}":`, error);
			throw error;
		}
	}
}
