import { IconInfoCircle } from "@tabler/icons-react";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";

function StatCard({ title, tooltip, value }: { title: string; tooltip: React.ReactNode; value: React.ReactNode }) {
	return (
		<Card className="flex flex-col">
			<CardHeader className="gap-0">
				<CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
					{title}
					<Tooltip>
						<TooltipTrigger asChild>
							<IconInfoCircle className="h-3.5 w-3.5 cursor-help" />
						</TooltipTrigger>
						<TooltipContent className="max-w-xs text-sm font-normal">{tooltip}</TooltipContent>
					</Tooltip>
				</CardTitle>
			</CardHeader>
			<CardContent className="flex-1 flex items-center">
				<div className="text-2xl sm:text-3xl lg:text-4xl font-bold">{value}</div>
			</CardContent>
		</Card>
	);
}

export function CitationStatsCards({
	brandShare,
	uniqueDomains,
	totalCitations,
	concentration,
}: {
	brandShare: number;
	uniqueDomains: number;
	totalCitations: number;
	/** HHI-style concentration (0–1) of this citation set. Undefined when
	 *  there are no citations (shouldn't happen here since the parent only
	 *  renders this card when totalCitations > 0, but kept optional to avoid
	 *  a NaN display if that ever changes). */
	concentration?: number;
}) {
	return (
		<div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
			<StatCard
				title="ブランド引用シェア"
				tooltip="全引用のうち、あなたのブランドのドメインへリンクしている割合です。高いほど、AIモデルがあなたのコンテンツを参照しやすいことを意味します。"
				value={`${brandShare}%`}
			/>
			<StatCard
				title="ユニークドメイン数"
				tooltip="この期間の全プロンプト評価にわたって引用された、重複を除いたドメインの数です。"
				value={uniqueDomains.toLocaleString()}
			/>
			{/* Kept deliberately simple: the user doesn't need the Google AI Mode
			    search/shopping nuance. Those surfaces aren't citations in the
			    traditional sense (they point back into Google's own product/search
			    results, not an external domain w.r.t. the model), so they're
			    excluded from this count and broken out in the Google Shopping card. */}
			<StatCard
				title="総引用数"
				tooltip="全プロンプト評価にわたって、AIモデルが引用した外部ウェブサイトの総数です。"
				value={totalCitations.toLocaleString()}
			/>
			{concentration != null && (
				<StatCard
					title="出典の集中度"
					tooltip="引用ドメインの偏りを示すハーフィンダール指数(0〜100)。数値が高いほど少数のドメインに引用が集中しており、他の情報源が薄い「空白」の可能性を示します。"
					value={`${Math.round(concentration * 100)}`}
				/>
			)}
		</div>
	);
}
