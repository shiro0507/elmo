/**
 * Enqueues background LLM classification for domains the curated category
 * lists (apps/web/src/lib/domain-categories.server.ts) don't recognize. The
 * web app only ever sends this job — the worker classifies the domain and
 * writes the result to domain_categories (see apps/worker/src/jobs/classify-domain.ts).
 * Fire-and-forget: the current request still shows "other" for these domains;
 * the cached category shows up starting from the next time they're read.
 */
import { getBoss } from "@/lib/boss-client";

const CLASSIFY_DOMAIN_QUEUE = "classify-domain";

// Dedupe repeat enqueues of the same domain (from concurrent requests, or
// across different brands citing the same third-party site) for a day.
const DEDUPE_WINDOW_SECONDS = 24 * 60 * 60;

/** Best-effort — a failure to enqueue shouldn't break the page that triggered it. */
export async function enqueueClassifyDomains(domains: Iterable<string>): Promise<void> {
	const unique = [...new Set(domains)];
	if (unique.length === 0) return;

	try {
		const boss = await getBoss();
		await Promise.all(
			unique.map((domain) =>
				boss.send(
					CLASSIFY_DOMAIN_QUEUE,
					{ domain },
					{ singletonKey: `domain-${domain}`, singletonSeconds: DEDUPE_WINDOW_SECONDS },
				),
			),
		);
	} catch (error) {
		console.error("[classify-domain] failed to enqueue:", error);
	}
}
