/**
 * Renders the AI-generated Opportunities dashboard from getOpportunitiesFn.
 * Opportunities are grouped into Creation / Existing content / Outreach / Social;
 * each card leads with a plain-language "why", then three drill-downs — Prompts /
 * Your citations / Competitor citations — to explore the underlying data.
 */
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { CitedPage, OpportunitiesReport as OpportunitiesReportData, ReportPrompt } from "@/server/opportunities";

const CATEGORY_META = [
	{
		key: "creation",
		label: "新規コンテンツ",
		desc: "新規に公開・獲得すべきコンテンツ。比較記事、ガイド、自社が手薄なトピックの「おすすめ◯選」系コンテンツなど。",
	},
	{
		key: "existing-content",
		label: "既存コンテンツ",
		desc: "すでに引用されているが順位が落ちてきているページ、更新すれば言及を獲得できそうなページ。",
	},
	{
		key: "outreach",
		label: "アウトリーチ",
		desc: "AIが引用するサードパーティのレビューサイトや編集部のまとめ記事への掲載を獲得する。",
	},
	{
		key: "social",
		label: "ソーシャル",
		desc: "AIが参照するコミュニティ(Reddit、YouTube、フォーラムなど)への露出。",
	},
] as const;

type Opportunity = OpportunitiesReportData["opportunities"][number];
type Tab = "prompts" | "your" | "comp";

function Bullet() {
	return <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />;
}

function BulletList({ items }: { items: string[] }) {
	return (
		<ul className="space-y-2.5">
			{items.map((item, i) => (
				<li key={`${i}-${item}`} className="flex gap-2.5 text-pretty text-base">
					<Bullet />
					<span>{item}</span>
				</li>
			))}
		</ul>
	);
}

const ROW = "block truncate rounded px-1.5 py-1 text-xs hover:bg-muted hover:text-foreground";

function PromptLink({ prompt, brandId }: { prompt: ReportPrompt; brandId: string }) {
	if (!prompt.promptId) return <span className={`${ROW} text-muted-foreground`}>{prompt.text}</span>;
	return (
		<Link to="/app/$brand/prompts/$promptId" params={{ brand: brandId, promptId: prompt.promptId }} className={ROW}>
			{prompt.text}
		</Link>
	);
}

function CiteLink({ page }: { page: CitedPage }) {
	return (
		<a href={page.url} target="_blank" rel="noopener noreferrer" className={ROW}>
			{page.title || page.domain} <span className="text-muted-foreground">· {page.domain}</span>
		</a>
	);
}

function Panel({ children }: { children: React.ReactNode }) {
	return <div className="mt-2 rounded-md bg-muted/30 p-1">{children}</div>;
}

function OpportunityCard({ o, brandId }: { o: Opportunity; brandId: string }) {
	const [open, setOpen] = useState<Tab | null>(null);
	const tabs: { key: Tab; label: string; count: number }[] = [
		{ key: "prompts", label: "プロンプト", count: o.relatedPrompts.length },
		{ key: "your", label: "自社の引用", count: o.yourCitations.length },
		{ key: "comp", label: "競合の引用", count: o.competitorCitations.length },
	];
	return (
		<div className="rounded-xl border border-border p-4">
			<h3 className="text-pretty text-base font-semibold">{o.title}</h3>
			<p className="mt-1 text-pretty text-sm text-muted-foreground">{o.why}</p>

			<div className="mt-3 border-t border-border/60 pt-3">
				<div className="flex flex-wrap gap-2">
					{tabs.map((t) => (
						<button
							key={t.key}
							type="button"
							onClick={() => setOpen(open === t.key ? null : t.key)}
							className={`inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs ${open === t.key ? "bg-muted" : "hover:bg-muted/50"}`}
						>
							{t.label} <span className="tabular-nums text-muted-foreground">({t.count})</span>
							<span className={`text-[0.625rem] text-muted-foreground ${open === t.key ? "rotate-180" : ""}`}>▾</span>
						</button>
					))}
				</div>

				{open === "prompts" && (
					<Panel>
						{o.relatedPrompts.length === 0 ? (
							<p className="px-1.5 py-1 text-xs text-muted-foreground">紐づく具体的なプロンプトはありません。</p>
						) : (
							o.relatedPrompts.map((p, i) => <PromptLink key={`${i}-${p.text}`} prompt={p} brandId={brandId} />)
						)}
					</Panel>
				)}
				{open === "your" && (
					<Panel>
						{o.yourCitations.length === 0 ? (
							<p className="px-1.5 py-1 text-xs text-muted-foreground">これらのプロンプトではまだ自社は引用されていません。</p>
						) : (
							o.yourCitations.map((c, i) => <CiteLink key={`${i}-${c.url}`} page={c} />)
						)}
					</Panel>
				)}
				{open === "comp" && (
					<Panel>
						{o.competitorCitations.length === 0 ? (
							<p className="px-1.5 py-1 text-xs text-muted-foreground">これらのプロンプトで引用された競合ページはありません。</p>
						) : (
							o.competitorCitations.map((c, i) => <CiteLink key={`${i}-${c.url}`} page={c} />)
						)}
					</Panel>
				)}
			</div>
		</div>
	);
}

export function OpportunitiesReport({ report, brandId }: { report: OpportunitiesReportData; brandId: string }) {
	return (
		<div className="space-y-8">
			{report.summary.length > 0 && (
				<section className="rounded-xl border border-border bg-muted/30 p-5">
					<h2 className="text-sm font-semibold text-muted-foreground">まとめ</h2>
					<div className="mt-2.5">
						<BulletList items={report.summary} />
					</div>
				</section>
			)}

			{CATEGORY_META.map((c) => {
				const opps = report.opportunities.filter((o) => o.category === c.key);
				if (opps.length === 0) return null;
				return (
					<section key={c.key} className="space-y-3">
						<div className="space-y-0.5">
							<h2 className="text-base font-semibold">
								{c.label} <span className="font-normal text-muted-foreground">({opps.length})</span>
							</h2>
							<p className="text-pretty text-sm text-muted-foreground">{c.desc}</p>
						</div>
						<div className="space-y-3">
							{opps.map((o, i) => (
								<OpportunityCard key={`${i}-${o.title}`} o={o} brandId={brandId} />
							))}
						</div>
					</section>
				);
			})}

			{report.risks.length > 0 && (
				<section className="space-y-3">
					<h2 className="text-base font-semibold">留意点</h2>
					<BulletList items={report.risks} />
				</section>
			)}

			<p className="text-xs text-muted-foreground">
				トラッキングしている引用データからAIが生成しています。あくまで出発点としての提案です。実施前に自身の判断で確認してください。
			</p>
		</div>
	);
}
