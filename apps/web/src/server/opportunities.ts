/**
 * AI-generated Opportunities.
 *
 * We assemble a compact, deterministic digest of the brand's tracked
 * AI-visibility data (overall + per-platform visibility, per-prompt standing vs
 * the leading competitor over 7d + 30d with tags + citation difficulty, and the
 * citation landscape), then make a SINGLE structured LLM completion — no web
 * search, no agent loop — to turn it into categorized opportunities (Creation /
 * Existing content / Outreach / Social), each with a plain-language "why". The
 * server then attaches each opportunity's related prompts (resolved to IDs) and
 * its cited pages split into the brand's vs competitors' — the page renders that.
 *
 * Provider selection reuses the same config as onboarding / prompt-idea
 * generation (`runStructuredCompletionPrompt` → `resolveResearchProvider`, which
 * honors ONBOARDING_LLM_TARGET / the preference order). Reports are persisted to
 * the brand_opportunities table (append-only) and served as-is until the latest
 * is older than REFRESH_AFTER_DAYS, so a normal page load doesn't trigger an LLM call.
 */
import { createServerFn } from "@tanstack/react-start";
import { db } from "@workspace/lib/db/db";
import { brandOpportunities, brands, competitors } from "@workspace/lib/db/schema";
import { runStructuredCompletionPrompt } from "@workspace/lib/onboarding";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { extractDomain } from "@/lib/domain-categories";
import { categorizeDomain } from "@/lib/domain-categories.server";
import {
	getBrandMentionRateByModel,
	getPerPromptCitationPages,
	getPerPromptDailyCitationStats,
	getPerPromptDailyCompetitorMentions,
	getPerPromptRunStats,
	type PerPromptDailyCompetitorRow,
	type PerPromptRunStats,
} from "@/lib/postgres-read";
import { isBrandedPrompt } from "@/lib/prompt-tags";
import { getTimezoneLookbackRange, resolveTimezone } from "@/lib/timezone-utils";
import { computeVolatility, type DailyDomainCount, stabilityScore } from "@/lib/visibility-stats";
import { resolveFilteredPrompts } from "@/server/prompt-resolution";

// ============================================================================
// Structured output (LLM) — the server enriches it before the page renders it.
// ============================================================================

export const CATEGORIES = ["creation", "existing-content", "outreach", "social"] as const;

const OpportunitySchema = z.object({
	category: z
		.enum(CATEGORIES)
		.describe(
			"Which workstream this belongs to: creation (net-new content to publish or earn — comparisons, guides, 'best of' angles for topics the brand is absent on), existing-content (a page already getting cited that's slipping, or could win the mention with a refresh), outreach (earn a placement on a third-party site assistants cite — review platforms, editorial roundups), social (show up in the community conversations assistants pull from — Reddit, YouTube, forums).",
		),
	title: z
		.string()
		.describe(
			'Short, specific, action-oriented — name the concrete surface or angle, not a metric. e.g. "Get into PCMag\'s best-CRM roundup" or "Answer the recurring r/CRM \'which CRM\' threads".',
		),
	why: z
		.string()
		.describe(
			"One or two tight sentences, in plain language a marketer who has never used this tool will understand, on WHY this is worth doing — the motivation and the payoff. You may include one concrete stat from the data if it strengthens the case (and say what it measures). Do NOT propose on-page specifics you can't verify — you cannot see page contents, so never say things like 'add an FAQ / schema / H2s'. Don't restate long page titles (the UI lists the cited pages).",
		),
	relatedPrompts: z
		.array(z.string())
		.describe("The tracked prompts (verbatim, exactly as written in the data) this helps. May be empty."),
});

export const opportunitiesSchema = z.object({
	summary: z
		.array(z.string())
		.describe(
			"3-5 bullets, ONE short sentence each (≈20 words max): where the brand is being out-cited by competitors, where AI sources its answers, and the through-line of the plan. Do NOT restate the brand's overall or per-platform visibility, and do NOT define what a metric means — the user already has dedicated Overview and Visibility pages for those.",
		),
	opportunities: z
		.array(OpportunitySchema)
		.describe("8-12 prioritized opportunities spread across the categories the data supports, highest impact first."),
	risks: z
		.array(z.string())
		.describe("2-4 very concise caveats (one short sentence each): hard-to-win areas, or tactics to avoid."),
});

/** Raw LLM output. The server enriches it before returning (see OpportunitiesReport). */
type RawReport = z.infer<typeof opportunitiesSchema>;

export interface ReportPrompt {
	text: string;
	/** Resolved tracked-prompt id for deep-linking, or null if it didn't match. */
	promptId: string | null;
}
export interface CitedPage {
	title: string | null;
	domain: string;
	url: string;
}
export interface ReportOpportunity extends Omit<RawReport["opportunities"][number], "relatedPrompts"> {
	relatedPrompts: ReportPrompt[];
	/** Cited pages on the brand's own domains, for the prompts this opportunity targets. */
	yourCitations: CitedPage[];
	/** Cited pages on competitor domains, for the prompts this opportunity targets. */
	competitorCitations: CitedPage[];
}
export interface OpportunitiesReport extends Omit<RawReport, "opportunities"> {
	opportunities: ReportOpportunity[];
}

export type OpportunitiesReason = "insufficient-data" | null;
export interface OpportunitiesResponse {
	report: OpportunitiesReport | null;
	reason: OpportunitiesReason;
	generatedFor: { brandName: string } | null;
	lastEvaluatedAt: string | null;
}

// ============================================================================
// Guidance — fed to the model as system context. Rephrased for this task; do not
// treat as a verbatim copy of any source. No brand names here — data comes below.
// ============================================================================

const GUIDANCE = `あなたはAI可視性(AEO)戦略アドバイザーとして、このツールがどのように数値を算出しているかを知らないコンテンツ/マーケティングチームにアドバイスをします。ブランドのトラッキングデータから、AIアシスタントの回答(ChatGPT、Perplexity、Google AI、Claude、Copilot)でブランドがより頻繁に引用されるための、優先順位付けされた実践的な機会(opportunities)を作成してください。

以下のデータの読み方(参照する際は読者向けに都度説明してください):
- 「Visibility」「named in X%」— トラッキング対象プロンプトへのアシスタントの回答(または全回答)のうち、ブランドが言及された割合。高いほど良い。これは share-of-voice ではありません。
- プロンプトごとの「you X% · top rival Y%」— そのプロンプトの回答のうち、自社が言及された割合 vs 最も多く言及された競合1社の割合。
- 「difficulty」(wide-open / contested / locked-in)— そのプロンプトで引用元がどれだけ入れ替わるか: wide-open = 引用元がよく変わる(参入しやすい)、locked-in = 常に同じ引用元が勝っている。
- プロンプト後の「[tags]」— グルーピング用のトピックタグ。
- 「cited via」— それらの回答の元になっているサードパーティドメイン。
opportunityの「why」で数値を引用する際は、それが何を計測しているかを平易に説明してください。要約スペースを使って指標の定義やブランド全体・プラットフォーム別のvisibilityを繰り返すのはやめてください — ユーザーはすでに専用のOverviewページとVisibilityページを持っています。

すべてのopportunityを次の4カテゴリのいずれかに分類してください:
- creation(新規コンテンツ) — 新規に公開/獲得すべきコンテンツ: 比較・「代替品」角度の記事、カテゴリガイド、ブランドが不在のトピックに対する「おすすめ◯選」系コンテンツ。
- existing-content(既存コンテンツ) — すでに引用されているが順位が落ちてきているページ、またはリフレッシュすれば言及を獲得できそうなページ。
- outreach(アウトリーチ) — アシスタントが引用するサードパーティサイト(独立系レビューサイト、編集部の「おすすめ◯選」まとめ記事)への掲載を獲得する。
- social(ソーシャル) — アシスタントが参照するコミュニティの会話(Reddit、YouTube、フォーラム、Q&A)に登場する。

アシスタントはブランド自身のサイトよりも独立したサードパーティ面(レビュー、まとめ記事、比較、コミュニティ)に大きく依存する傾向があるため、ほとんどのopportunityはサードパーティでの露出獲得であるべきです。明らかに手薄なトピックがある場合は、自社所有の新規コンテンツにも価値があります。

アシスタントごとの情報源の傾向(背景知識のみ。適切な面を選ぶための参考情報であり、アシスタント別のセクションとして出力しないでください):
- ChatGPT — Bing連携。ドメインの権威性と鮮度を重視。Wikipedia・Reddit・大手メディアに強く依存。
- Perplexity — 厳選された権威あるドメインや、一般公開されているレポートを好む。新しさを評価。
- Google AI / Gemini — Knowledge Graphと確立された編集部/小売の権威性に依存。
- Copilot — Bing連携。LinkedInとGitHubでの存在感を評価。
- Claude — Brave連携。選別的で、事実が詰まった出典の明確なページを好む。

厳守ルール — すべての提案をコンテンツ/マーケティングチームにとって現実的なものにしてください:
- 倫理的であること: ブランド自身のWikipedia/百科事典項目の作成・編集は絶対に提案しない(利益相反であり、ポリシー違反)。また、偽のレビュー、報酬付き・非開示のレビュー、やらせ(astroturfing)、サクラアカウント、その他あらゆる組織的な不正行為も絶対に提案しない — アシスタントはこうした行為をますます検知し、ペナルティを課すようになっています。
- 手が届く費用であること: コンテンツマーケターが実行できる、低〜中コストの施策を優先してください — コンテンツ制作、既存のまとめ記事への掲載を編集者に働きかける、誠実なコミュニティ参加、通常のレビュー施策など。主な施策として、高額または専門的な取り組み(臨床/研究所レベルの試験、専門家の雇用、専門家によるAMA開催、大規模な有料スポンサーシップ、PRリテイナー契約など)を提案しないでください。
- 検証可能であること: あなたはページの中身を見ることができないため、FAQの追加・構造化データ(schema)・見出し(headings)の追加など、ページ内部の具体的な変更は絶対に提案しないでください。検証できない内部の編集ではなく、存在感を獲得・創出することを提案してください。
- データに基づき具体的であること: すべてのopportunityをブランドの実際のデータに紐づけ、具体的な面(実在するサイト、まとめ記事、コミュニティ、比較の切り口)を名指ししてください — 曖昧な「クエリクラスタ」のような表現は避けてください。競合がすでに引用されているがブランドはされていない面を優先してください。競合が所有するドメインは絶対に提案しないでください。
- 「*」印が付いたクエリはブランド名を含む指名検索です。ブランド名を含まないカテゴリクエリこそが新規の可視性を獲得できる場なので、そちらの重みを高くしてください。`;

const TASK = `上記のデータのみを使用して、以下の構造化出力を返してください:
- summary: 3〜5個の箇条書き、それぞれ短い一文で(競合との差、AIがどこから情報を得ているか、施策全体の一貫した流れ)。全体/プラットフォーム別のvisibilityの繰り返しや、指標の定義はしないでください。
- opportunities: 8〜12件の優先順位付けされた機会(インパクトが大きい順)。それぞれカテゴリに分類し、平易な言葉での「why」(専門知識のない人にも伝わる、実施する動機)と、それが役立つトラッキング対象プロンプト(データに書かれている通りの文言)を含めてください。データが裏付けるカテゴリに分散させてください — 4カテゴリすべてを無理に埋める必要はありません。
- risks: 2〜4件の短い注意点(攻略が難しい領域や、避けるべき施策)。`;

// ============================================================================
// Digest builder
// ============================================================================

const TOP_PROMPTS = 30;
const pct = (v: number) => Math.round(v * 100);

/** Citation volatility (stability 0..100) → a plain difficulty label. Low
 * stability = sources rotate = wide open; high = entrenched = locked in. */
function difficultyLabel(stability: number | null): "wide-open" | "contested" | "locked-in" | "n/a" {
	if (stability === null) return "n/a";
	if (stability < 40) return "wide-open";
	if (stability < 70) return "contested";
	return "locked-in";
}

/** Map a tracked model id to its assistant/platform family for the digest. */
function modelToPlatform(model: string): string {
	const m = model.toLowerCase();
	if (m.includes("claude")) return "Claude";
	if (m.includes("gemini") || m.includes("google")) return "Gemini";
	if (m.includes("sonar") || m.includes("perplex")) return "Perplexity";
	if (m.includes("copilot")) return "Copilot";
	if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4") || m.includes("chatgpt"))
		return "ChatGPT";
	return model;
}

function resolveRange(lookback: "1w" | "1m", timezone: string) {
	return getTimezoneLookbackRange(lookback, timezone, { allStrategy: "1y" }) as {
		fromDateStr: string;
		toDateStr: string;
	};
}

/** Top competitor (by mentions) per prompt, with rate = mentions / runs. */
function topCompetitorByPrompt(
	rows: PerPromptDailyCompetitorRow[],
	runsByPrompt: Map<string, PerPromptRunStats>,
): Map<string, { name: string; rate: number }> {
	const byPrompt = new Map<string, Map<string, number>>();
	for (const r of rows) {
		let m = byPrompt.get(r.prompt_id);
		if (!m) {
			m = new Map();
			byPrompt.set(r.prompt_id, m);
		}
		m.set(r.competitor, (m.get(r.competitor) ?? 0) + Number(r.mentions));
	}
	const out = new Map<string, { name: string; rate: number }>();
	for (const [pid, m] of byPrompt) {
		let best = { name: "", count: 0 };
		for (const [name, count] of m) if (count > best.count) best = { name, count };
		const runs = runsByPrompt.get(pid)?.runs ?? 0;
		out.set(pid, { name: best.name, rate: runs > 0 ? Math.min(1, best.count / runs) : 0 });
	}
	return out;
}

type CitationOwner = "brand" | "competitor" | "other";
interface DigestCitation extends CitedPage {
	owner: CitationOwner;
	count: number;
}

interface Digest {
	text: string;
	brandName: string;
	prompts: { id: string; value: string }[];
	/** Per prompt, its cited pages tagged by owner — for the per-opportunity drill-downs. */
	citationsByPrompt: Map<string, DigestCitation[]>;
}

/** Assemble the deterministic digest text + the structured bits the server needs
 * to enrich the LLM output. Returns null if there isn't enough data. */
async function buildDigest(brandId: string, timezoneParam: string): Promise<Digest | null> {
	const timezone = resolveTimezone(timezoneParam);
	const r30 = resolveRange("1m", timezone);
	const r7 = resolveRange("1w", timezone);

	const prompts = await resolveFilteredPrompts(brandId, {});
	if (prompts.length === 0) return null;
	const promptIds = prompts.map((p) => p.id);
	const isBranded = new Map(prompts.map((p) => [p.id, isBrandedPrompt(p)]));
	const promptText = new Map(prompts.map((p) => [p.id, p.value]));
	const tagsByPrompt = new Map(prompts.map((p) => [p.id, p.tags ?? []]));

	const [brandRows, competitorRows, run30, comp30, daily30, pages30, run7, comp7, byModel] = await Promise.all([
		db
			.select({ name: brands.name, website: brands.website, additionalDomains: brands.additionalDomains })
			.from(brands)
			.where(eq(brands.id, brandId))
			.limit(1),
		db
			.select({ name: competitors.name, domains: competitors.domains })
			.from(competitors)
			.where(eq(competitors.brandId, brandId)),
		getPerPromptRunStats(brandId, r30.fromDateStr, r30.toDateStr, timezone, promptIds),
		getPerPromptDailyCompetitorMentions(brandId, r30.fromDateStr, r30.toDateStr, timezone, promptIds),
		getPerPromptDailyCitationStats(brandId, r30.fromDateStr, r30.toDateStr, timezone, promptIds),
		getPerPromptCitationPages(brandId, r30.fromDateStr, r30.toDateStr, timezone, promptIds),
		getPerPromptRunStats(brandId, r7.fromDateStr, r7.toDateStr, timezone, promptIds),
		getPerPromptDailyCompetitorMentions(brandId, r7.fromDateStr, r7.toDateStr, timezone, promptIds),
		getBrandMentionRateByModel(brandId, r30.fromDateStr, r30.toDateStr, timezone, promptIds),
	]);

	const totalRuns = run30.reduce((s, r) => s + r.runs, 0);
	if (totalRuns === 0) return null;

	const brandName = brandRows[0]?.name ?? "the brand";
	const brandDomains = new Set(
		[extractDomain(brandRows[0]?.website || ""), ...(brandRows[0]?.additionalDomains || []).map(extractDomain)].filter(
			Boolean,
		),
	);
	const competitorDomains = new Set(
		competitorRows.flatMap((c) => (c.domains || []).map(extractDomain)).filter(Boolean),
	);
	const catOf = (domain: string) => categorizeDomain(domain, brandDomains, competitorDomains);
	const ownerOf = (domain: string): CitationOwner => {
		const c = catOf(domain);
		return c === "brand" ? "brand" : c === "competitor" ? "competitor" : "other";
	};

	const run30By = new Map(run30.map((r) => [r.prompt_id, r]));
	const run7By = new Map(run7.map((r) => [r.prompt_id, r]));
	const leader30 = topCompetitorByPrompt(comp30, run30By);
	const leader7 = topCompetitorByPrompt(comp7, run7By);

	const dailyByPrompt = new Map<string, DailyDomainCount[]>();
	for (const row of daily30) {
		let list = dailyByPrompt.get(row.prompt_id);
		if (!list) {
			list = [];
			dailyByPrompt.set(row.prompt_id, list);
		}
		list.push({ date: String(row.date), domain: row.domain, count: Number(row.count) });
	}

	// Per-prompt cited pages (URL-level), tagged by owner — powers both the
	// "cited via" digest line and the per-opportunity drill-downs.
	const citationsByPrompt = new Map<string, DigestCitation[]>();
	for (const row of pages30) {
		if (!row.url) continue;
		let list = citationsByPrompt.get(row.prompt_id);
		if (!list) {
			list = [];
			citationsByPrompt.set(row.prompt_id, list);
		}
		list.push({ title: row.title, domain: row.domain, url: row.url, count: row.count, owner: ownerOf(row.domain) });
	}

	// Rank prompts by the gap to the leading competitor (30d); branded flagged.
	const ranked = promptIds
		.map((pid) => {
			const brand30 = run30By.get(pid)?.brand_mention_rate ?? 0;
			const l30 = leader30.get(pid) ?? { name: "", rate: 0 };
			return { pid, gap: l30.rate - brand30 };
		})
		.sort((a, b) => b.gap - a.gap)
		.slice(0, TOP_PROMPTS);

	const queryLines = ranked.map(({ pid }, i) => {
		const brand30 = run30By.get(pid)?.brand_mention_rate ?? 0;
		const brand7 = run7By.get(pid)?.brand_mention_rate ?? 0;
		const l30 = leader30.get(pid) ?? { name: "", rate: 0 };
		const l7 = leader7.get(pid) ?? { name: "", rate: 0 };
		const stability = stabilityScore(computeVolatility(dailyByPrompt.get(pid) ?? []).weightedVolatility);
		const difficulty = difficultyLabel(stability);
		const tags = tagsByPrompt.get(pid) ?? [];
		const citedVia = [
			...new Set((citationsByPrompt.get(pid) ?? []).filter((c) => c.owner !== "brand").map((c) => c.domain)),
		].slice(0, 3);
		const leaderStr = l30.name ? `${l30.name} ${pct(l30.rate)}% (7d ${pct(l7.rate)}%)` : "no competitor cited";
		const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";
		return `${i + 1}. ${isBranded.get(pid) ? "*" : ""}"${promptText.get(pid)}"${tagStr} — you ${pct(brand30)}% (7d ${pct(brand7)}%), top rival ${leaderStr}, difficulty ${difficulty}; cited via: ${citedVia.length ? citedVia.join(", ") : "no citations yet"}`;
	});

	// Global citation landscape: aggregate cited pages to domains by category.
	const domainAgg = new Map<string, { count: number; title: string | null; cat: ReturnType<typeof catOf> }>();
	const mix = { brand: 0, competitor: 0, community: 0, thirdParty: 0 };
	for (const row of pages30) {
		const cat = catOf(row.domain);
		const cur = domainAgg.get(row.domain);
		if (cur) cur.count += row.count;
		else domainAgg.set(row.domain, { count: row.count, title: row.title, cat });
		if (cat === "brand") mix.brand += row.count;
		else if (cat === "competitor") mix.competitor += row.count;
		else if (cat === "social") mix.community += row.count;
		else mix.thirdParty += row.count;
	}
	const totalCites = mix.brand + mix.competitor + mix.community + mix.thirdParty || 1;
	const sortByCount = (a: { count: number }, b: { count: number }) => b.count - a.count;
	const entries = [...domainAgg.entries()].map(([domain, v]) => ({ domain, ...v }));
	const fmtDomain = (e: { domain: string; title: string | null }) =>
		e.title ? `${e.domain} ("${e.title}")` : e.domain;

	const thirdPartyTop = entries
		.filter((e) => e.cat !== "brand" && e.cat !== "competitor" && e.cat !== "social")
		.sort(sortByCount)
		.slice(0, 10);
	const communityTop = entries
		.filter((e) => e.cat === "social")
		.sort(sortByCount)
		.slice(0, 5);
	const competitorPages = entries
		.filter((e) => e.cat === "competitor")
		.sort(sortByCount)
		.slice(0, 8);

	// Per-platform + overall visibility (30d), aggregated from the tracked models.
	const platformAgg = new Map<string, { runs: number; mentioned: number }>();
	let allRuns = 0;
	let allMentioned = 0;
	for (const m of byModel) {
		if (m.runs <= 0) continue;
		allRuns += m.runs;
		allMentioned += m.brand_mentioned_count;
		const platform = modelToPlatform(m.model);
		const cur = platformAgg.get(platform) ?? { runs: 0, mentioned: 0 };
		cur.runs += m.runs;
		cur.mentioned += m.brand_mentioned_count;
		platformAgg.set(platform, cur);
	}
	const platformLines = [...platformAgg.entries()].map(([p, v]) => `${p} ${pct(v.mentioned / v.runs)}%`);
	const brandedCount = [...isBranded.values()].filter(Boolean).length;
	const overallVis = allRuns > 0 ? allMentioned / allRuns : 0;

	const text = [
		`BRAND: ${brandName}`,
		`COMPETITORS TRACKED: ${competitorRows.map((c) => c.name).join(", ") || "none"}`,
		`WINDOWS: 30 days (primary) with 7-day figures in parentheses for momentum.`,
		``,
		`OVERALL (30d): ${promptIds.length} tracked prompts (${brandedCount} branded); the brand is named in ${pct(overallVis)}% of all answers (overall visibility); ${competitorRows.length} competitors tracked.`,
		`PER-PLATFORM VISIBILITY (share of each assistant's answers, across tracked prompts, that name the brand; 30d): ${platformLines.join(" · ") || "no data"}`,
		``,
		`PROMPTS (top ${ranked.length} of ${promptIds.length} by gap to the leading competitor; "*" = branded; "[...]" = topic tags):`,
		...queryLines,
		``,
		`CITATION LANDSCAPE (where answers to these prompts are sourced, 30d):`,
		`- Source mix: third-party ${pct(mix.thirdParty / totalCites)}%, competitor-owned ${pct(mix.competitor / totalCites)}%, community ${pct(mix.community / totalCites)}%, brand-owned ${pct(mix.brand / totalCites)}%.`,
		`- Independent third-party domains most cited: ${thirdPartyTop.map(fmtDomain).join("; ") || "none"}`,
		`- Community sources most cited: ${communityTop.map(fmtDomain).join("; ") || "none"}`,
		`- Competitor-owned pages cited (you cannot get listed on these — for context only): ${competitorPages.map(fmtDomain).join("; ") || "none"}`,
	].join("\n");

	return { text, brandName, prompts: prompts.map((p) => ({ id: p.id, value: p.value })), citationsByPrompt };
}

/** From an opportunity's related prompt IDs, gather its cited pages (deduped by
 * URL) split into the brand's own vs competitors'. */
function citationsForPrompts(
	promptIds: string[],
	citationsByPrompt: Map<string, DigestCitation[]>,
): { yourCitations: CitedPage[]; competitorCitations: CitedPage[] } {
	const seen = new Set<string>();
	const yours: DigestCitation[] = [];
	const comp: DigestCitation[] = [];
	for (const pid of promptIds) {
		for (const c of citationsByPrompt.get(pid) ?? []) {
			if (seen.has(c.url)) continue;
			seen.add(c.url);
			if (c.owner === "brand") yours.push(c);
			else if (c.owner === "competitor") comp.push(c);
		}
	}
	const byCount = (a: DigestCitation, b: DigestCitation) => b.count - a.count;
	const strip = ({ title, domain, url }: DigestCitation): CitedPage => ({ title, domain, url });
	return {
		yourCitations: yours.sort(byCount).slice(0, 8).map(strip),
		competitorCitations: comp.sort(byCount).slice(0, 8).map(strip),
	};
}

/** Regenerate at most this often; stored generations newer than this are served
 * from cache. Surfaced as "Refreshed weekly" on the page — kept a touch under 7 days. */
const REFRESH_AFTER_DAYS = 6;
const MAX_GENERATION_ATTEMPTS = 3;

/** Resolve the LLM output's prompt strings to tracked IDs (for deep-linking) and
 * attach each opportunity's cited pages split into the brand's vs competitors'. */
function enrichReport(raw: RawReport, digest: Digest): OpportunitiesReport {
	const idByText = new Map(digest.prompts.map((p) => [p.value.trim().toLowerCase(), p.id]));
	return {
		...raw,
		opportunities: raw.opportunities.map((o) => {
			const relatedPrompts: ReportPrompt[] = o.relatedPrompts.map((text) => ({
				text,
				promptId: idByText.get(text.trim().toLowerCase()) ?? null,
			}));
			const ids = relatedPrompts.map((p) => p.promptId).filter((id): id is string => id !== null);
			return { ...o, relatedPrompts, ...citationsForPrompts(ids, digest.citationsByPrompt) };
		}),
	};
}

/** Generate the report, retrying until the model's output satisfies the schema.
 * Returns the validated report plus the model id that produced it. */
async function generateValidReport(prompt: string): Promise<{ report: RawReport; model: string | null } | null> {
	for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
		try {
			const result = await runStructuredCompletionPrompt(prompt, opportunitiesSchema);
			const parsed = opportunitiesSchema.safeParse(result.object);
			if (parsed.success) return { report: parsed.data, model: result.modelVersion ?? null };
			console.warn(`[opportunities] schema mismatch (attempt ${attempt}/${MAX_GENERATION_ATTEMPTS})`);
		} catch (err) {
			console.warn(`[opportunities] generation error (attempt ${attempt}/${MAX_GENERATION_ATTEMPTS}):`, err);
		}
	}
	return null;
}

// ============================================================================
// Server function
// ============================================================================

export const getOpportunitiesFn = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string(), timezone: z.string().default("UTC") }))
	.handler(async ({ data }): Promise<OpportunitiesResponse> => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		// Serve the most recent stored report while it's fresh. Every generation is
		// kept (append-only); we regenerate only when the latest is stale.
		const [latest] = await db
			.select()
			.from(brandOpportunities)
			.where(eq(brandOpportunities.brandId, data.brandId))
			.orderBy(desc(brandOpportunities.createdAt))
			.limit(1);
		const lastEvaluatedAt = latest?.createdAt.toISOString() ?? null;
		const isFresh = latest && Date.now() - new Date(latest.createdAt).getTime() < REFRESH_AFTER_DAYS * 86_400_000;
		if (latest && isFresh) {
			return { report: latest.report as OpportunitiesReport, reason: null, generatedFor: null, lastEvaluatedAt };
		}

		const digest = await buildDigest(data.brandId, data.timezone);
		if (!digest) {
			if (latest)
				return { report: latest.report as OpportunitiesReport, reason: null, generatedFor: null, lastEvaluatedAt };
			return { report: null, reason: "insufficient-data", generatedFor: null, lastEvaluatedAt };
		}

		const prompt = `${GUIDANCE}\n\n=== BRAND DATA ===\n${digest.text}\n\n=== TASK ===\n${TASK}`;
		const generated = await generateValidReport(prompt);
		if (!generated) {
			// Couldn't get a schema-valid report — serve the last good one if we have it.
			if (latest)
				return { report: latest.report as OpportunitiesReport, reason: null, generatedFor: null, lastEvaluatedAt };
			throw new Error("Failed to generate a valid opportunities report");
		}

		const report = enrichReport(generated.report, digest);
		const [savedReport] = await db
			.insert(brandOpportunities)
			.values({ brandId: data.brandId, report, model: generated.model })
			.returning({ createdAt: brandOpportunities.createdAt });

		return {
			report,
			reason: null,
			generatedFor: { brandName: digest.brandName },
			lastEvaluatedAt: savedReport?.createdAt.toISOString() ?? null,
		};
	});
