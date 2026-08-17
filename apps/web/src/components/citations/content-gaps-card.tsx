import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Separator } from "@workspace/ui/components/separator";
import { Tooltip, TooltipTrigger, TooltipContent } from "@workspace/ui/components/tooltip";
import { IconInfoCircle, IconAlertTriangle } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { ListPagination, usePagedList } from "@/components/list-pagination";

const PAGE_SIZE = 6;

export function ContentGapsCard({
	prompts,
	brandId,
}: {
	prompts: Array<{ id: string; value: string; competitorCitationCount: number; uniqueCompetitors: number }>;
	brandId: string;
}) {
	const { page, setPage, pageItems, totalItems } = usePagedList(prompts, PAGE_SIZE);

	return (
		<Card className="h-full flex flex-col">
			<CardHeader>
				<CardTitle className="flex items-center gap-1.5">
					コンテンツギャップ
					<Tooltip>
						<TooltipTrigger asChild>
							<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
						</TooltipTrigger>
						<TooltipContent className="max-w-xs text-sm font-normal">
							競合は引用されているのにあなたのブランドは引用されていないプロンプト — 引用機会を改善できる余地です。
						</TooltipContent>
					</Tooltip>
				</CardTitle>
				<CardDescription>競合は引用されているのにあなたのブランドは引用されていないプロンプト</CardDescription>
			</CardHeader>
			<Separator />
			<CardContent className="flex-1 flex flex-col">
				<div className="divide-y divide-border/50 flex-1">
					{pageItems.map((prompt) => (
						<Link
							key={prompt.id}
							to="/app/$brand/prompts/$promptId"
							params={{ brand: brandId, promptId: prompt.id }}
							className="flex items-start gap-2.5 py-2 group"
						>
							<div className="shrink-0 mt-0.5">
								<IconAlertTriangle className="h-3.5 w-3.5 text-amber-500" />
							</div>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-1.5">
									<span className="text-sm font-medium truncate text-foreground group-hover:underline">
										{prompt.value}
									</span>
								</div>
								<p className="text-xs text-muted-foreground mt-0.5">
									競合{prompt.uniqueCompetitors}社が計{prompt.competitorCitationCount}回引用 &mdash;
									あなたのブランドは0回
								</p>
							</div>
						</Link>
					))}
				</div>
				<ListPagination page={page} pageSize={PAGE_SIZE} totalItems={totalItems} onPageChange={setPage} />
			</CardContent>
		</Card>
	);
}
