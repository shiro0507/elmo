/**
 * "Citation concentration" — how few/dominant the cited domains are for a
 * given set of citations (one prompt, or a whole brand). Part of the
 * content-gap detection design in 空白の判定基準.md, metric ①: a prompt
 * whose AI answers keep citing the same 1-2 domains is a candidate content
 * gap (no one else has filled the space yet).
 *
 * Pure arithmetic over domain -> citation-count pairs, so it runs the same
 * way server-side (batch per-prompt query) and client-side (derived from an
 * already-fetched domainDistribution) without needing its own DB access.
 */

export interface CitationConcentration {
	uniqueDomains: number;
	totalCitations: number;
	/** Share of citations held by the single most-cited domain, 0–1. */
	maxShareRatio: number;
	/** Herfindahl-Hirschman-style index: sum of each domain's squared share.
	 *  1/uniqueDomains (spread evenly) up to 1 (one domain owns everything). */
	hhi: number;
}

export function computeCitationConcentration(
	domainCounts: Iterable<{ domain: string; count: number }>,
): CitationConcentration | null {
	const counts: number[] = [];
	let total = 0;
	let maxCount = 0;

	for (const { count } of domainCounts) {
		if (count <= 0) continue;
		counts.push(count);
		total += count;
		if (count > maxCount) maxCount = count;
	}

	if (total === 0) return null;

	const hhi = counts.reduce((sum, count) => {
		const share = count / total;
		return sum + share * share;
	}, 0);

	return {
		uniqueDomains: counts.length,
		totalCitations: total,
		maxShareRatio: maxCount / total,
		hhi,
	};
}

/** Coarse 低/中/高 bucketing for badges — HHI 0.5 is roughly "1-2 domains own
 *  the space", 0.25 is roughly "3-4 domains share it", below that citations
 *  are spread across enough sources that it's not a content-gap candidate. */
export function concentrationLevel(hhi: number): "低" | "中" | "高" {
	if (hhi >= 0.5) return "高";
	if (hhi >= 0.25) return "中";
	return "低";
}
