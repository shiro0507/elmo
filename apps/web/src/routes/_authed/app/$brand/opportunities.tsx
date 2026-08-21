/**
 * /app/$brand/opportunities — AI-generated opportunities.
 *
 * The page renders a structured opportunities report. We assemble a deterministic
 * digest of the brand's tracked citation data (per-query standing vs the leading
 * competitor over 7d + 30d, citation difficulty, where answers are sourced, and
 * per-platform visibility) and make a single structured LLM completion (no web
 * search) to turn it into categorized opportunities. The report is cached
 * server-side and regenerated only when stale — see server/opportunities.ts.
 */

import { IconClock, IconLoader2 } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { OpportunitiesReport } from "@/components/opportunities-report";
import { PageHeader } from "@/components/page-header";
import { useOpportunities } from "@/hooks/use-opportunities";
import { buildTitle, getAppName, getBrandName } from "@/lib/route-head";

export const Route = createFileRoute("/_authed/app/$brand/opportunities")({
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle("解析結果", { appName, brandName }) },
				{ name: "description", content: "AI引用を増やすための、AIが生成した施策提案です。" },
			],
		};
	},
	component: OpportunitiesPage,
});

function OpportunitiesPage() {
	const { brand: brandId } = Route.useParams();
	const { data, isLoading, isError } = useOpportunities(brandId);

	const infoContent = "AI言及率・引用の指標をもとにした提案です。毎週更新されます。";

	let content: React.ReactNode;
	if (isLoading) {
		content = <LoadingState />;
	} else if (isError) {
		content = <EmptyCard>現在、提案を生成できませんでした。ページを再読み込みしてもう一度お試しください。</EmptyCard>;
	} else if (!data || data.reason === "insufficient-data" || !data.report) {
		content = (
			<EmptyCard>
				提案を行うにはもう少しトラッキングデータが必要です — プロンプトが数日間実行されてから、再度確認してください。
			</EmptyCard>
		);
	} else {
		content = <OpportunitiesReport report={data.report} brandId={brandId} />;
	}

	return (
		<PageHeader
			title="解析結果"
			subtitle="AIからの引用を増やし、自社の言及を増やすために、何をすべきかの提案です。"
			infoContent={infoContent}
		>
			<div className="space-y-6">
				{data?.report && data.lastEvaluatedAt && <LastEvaluatedAt date={data.lastEvaluatedAt} />}
				{content}
			</div>
		</PageHeader>
	);
}

function LastEvaluatedAt({ date }: { date: string }) {
	return (
		<p className="flex items-center gap-1.5 text-sm text-muted-foreground">
			<IconClock className="size-4" aria-hidden />
			最終評価:{" "}
			<time dateTime={date}>
				{new Date(date).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
			</time>
		</p>
	);
}

function EmptyCard({ children }: { children: React.ReactNode }) {
	return (
		<div className="rounded-xl border border-border">
			<p className="px-6 py-10 text-center text-sm text-muted-foreground">{children}</p>
		</div>
	);
}

function LoadingState() {
	return (
		<div className="space-y-6">
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				<IconLoader2 className="size-4 animate-spin" />
				引用状況を分析し、施策を作成しています…
			</div>
			<div className="space-y-2">
				<Skeleton className="h-6 w-2/3" />
				<Skeleton className="h-4 w-full max-w-[70ch]" />
				<Skeleton className="h-4 w-1/2" />
			</div>
			<div className="space-y-3">
				{[0, 1, 2].map((i) => (
					<Skeleton key={i} className="h-28 w-full rounded-xl" />
				))}
			</div>
		</div>
	);
}
