import { IconExternalLink, IconInfoCircle, IconSearch } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@workspace/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Separator } from "@workspace/ui/components/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { useMemo, useState } from "react";
import {
	extractFilenameFromUrl,
	formatUrlForDisplay,
	getCategoryColorClass,
	getCategoryLabel,
	UnderlineTabs,
} from "@/components/citations/shared";
import type { CitationData } from "@/components/citations/types";
import { ListPagination, usePagedList } from "@/components/list-pagination";

export function TopUrlsCard({
	urls,
	sourceTabs,
	pageTypeTabs,
	maxUrls,
	brandId,
	brandName,
	brandShare,
	brandIsCited,
}: {
	urls: CitationData["specificUrls"];
	sourceTabs: { key: string; label: string }[];
	pageTypeTabs: { key: string; label: string }[];
	maxUrls: number;
	brandId?: string;
	brandName?: string;
	brandShare: number;
	brandIsCited: boolean;
}) {
	const [urlSearch, setUrlSearch] = useState("");
	const [selectedCategory, setSelectedCategory] = useState<string>("all");
	const [selectedPageType, setSelectedPageType] = useState<string>("all");

	const filteredUrls = useMemo(() => {
		let result = urls;
		if (selectedCategory !== "all") {
			result = result.filter((u) => u.category === selectedCategory);
		}
		if (selectedPageType !== "all") {
			result = result.filter((u) => u.pageType === selectedPageType);
		}
		if (urlSearch) {
			const q = urlSearch.toLowerCase();
			result = result.filter(
				(u) =>
					u.url.toLowerCase().includes(q) || u.title?.toLowerCase().includes(q) || u.domain.toLowerCase().includes(q),
			);
		}
		return result;
	}, [urls, selectedCategory, selectedPageType, urlSearch]);

	const { page, setPage, pageItems, totalItems } = usePagedList(filteredUrls, maxUrls);

	return (
		<Card className="gap-4">
			<CardHeader>
				<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
					<div className="space-y-1 min-w-0">
						<CardTitle className="flex items-center gap-1.5">
							引用の多いURL
							<Tooltip>
								<TooltipTrigger asChild>
									<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
								</TooltipTrigger>
								<TooltipContent className="max-w-xs text-sm font-normal">
									<p className="mb-2">
										AIモデルによって最も頻繁に引用されている個別ページです。カテゴリでフィルターして、ブランド・競合・その他の情報源に絞り込めます。
									</p>
									<p>
										<strong>競合</strong>ドメインとは、
										{brandId ? (
											<Link to="/app/$brand/settings/competitors" params={{ brand: brandId }} className="underline">
												追跡中の競合リスト
											</Link>
										) : (
											"追跡中の競合リスト"
										)}
										に含まれるものだけを指します。
									</p>
								</TooltipContent>
							</Tooltip>
						</CardTitle>
						<CardDescription>
							LLMが引用した個別ページ
							{brandIsCited && brandName && (
								<>
									{" "}
									&mdash; {brandName}は全引用のうち<strong>{brandShare}%</strong>を占めています
								</>
							)}
						</CardDescription>
					</div>
					<div className="relative w-full sm:w-48 shrink-0">
						<IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
						<Input
							placeholder="URLを検索..."
							value={urlSearch}
							onChange={(e) => {
								setUrlSearch(e.target.value);
								setPage(0);
							}}
							className="h-8 pl-8 text-xs"
						/>
					</div>
				</div>
			</CardHeader>
			<Separator />
			<CardContent>
				{sourceTabs.length > 2 && (
					<UnderlineTabs
						tabs={sourceTabs}
						activeKey={selectedCategory}
						onSelect={(key) => {
							setSelectedCategory(key);
							setPage(0);
						}}
					/>
				)}
				{pageTypeTabs.length > 2 && (
					<div className="flex items-center flex-wrap gap-1.5 mt-3">
						{pageTypeTabs.map((t) => (
							<button
								key={t.key}
								type="button"
								onClick={() => {
									setSelectedPageType(t.key);
									setPage(0);
								}}
								className={`px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors ${selectedPageType === t.key ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"}`}
							>
								{t.label}
							</button>
						))}
					</div>
				)}
				<div className="divide-y divide-border mt-1">
					{pageItems.map((citation) => {
						const displayUrl = formatUrlForDisplay(citation.url);
						const domainEndIndex = displayUrl.indexOf("/");
						const domainPart = domainEndIndex > 0 ? displayUrl.substring(0, domainEndIndex) : displayUrl;
						const pathPart = domainEndIndex > 0 ? displayUrl.substring(domainEndIndex) : "";

						return (
							<a
								key={citation.url}
								href={citation.url}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-start justify-between gap-3 py-3 group"
							>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2 mb-0.5">
										<Badge
											className={`text-[10px] px-1.5 py-0 h-[18px] border-0 shadow-none ${getCategoryColorClass(citation.category)}`}
										>
											{getCategoryLabel(citation.category)}
										</Badge>
										{citation.isNew && (
											<Badge className="text-[10px] px-1.5 py-0 h-[18px] border-0 shadow-none bg-green-100 text-green-700">
												新規
											</Badge>
										)}
										<span className="text-sm font-medium truncate group-hover:underline">
											{citation.title || extractFilenameFromUrl(citation.url)}
										</span>
									</div>
									<div className="text-xs text-muted-foreground truncate">
										<span className="font-semibold">{domainPart}</span>
										{pathPart && <span>{pathPart}</span>}
									</div>
								</div>
								<div className="flex items-center gap-3 shrink-0 pt-0.5">
									{citation.avgPosition != null && (
										<Tooltip>
											<TooltipTrigger asChild>
												<span className="text-[11px] text-muted-foreground tabular-nums">
													平均 {citation.avgPosition.toFixed(1)}
												</span>
											</TooltipTrigger>
											<TooltipContent className="text-xs">
												平均引用位置(数値が低いほど回答の早い段階で引用されている)
											</TooltipContent>
										</Tooltip>
									)}
									<Tooltip>
										<TooltipTrigger asChild>
											<span className="text-sm font-semibold tabular-nums min-w-[2rem] text-right">
												{citation.count.toLocaleString()}
											</span>
										</TooltipTrigger>
										<TooltipContent className="text-xs">
											全プロンプト評価にわたって、このURLが引用された合計回数
										</TooltipContent>
									</Tooltip>
									<IconExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
								</div>
							</a>
						);
					})}
					{filteredUrls.length === 0 && (
						<p className="text-sm text-muted-foreground text-center pt-8 pb-4">現在のフィルターに該当するURLがありません。</p>
					)}
				</div>
				<ListPagination page={page} pageSize={maxUrls} totalItems={totalItems} onPageChange={setPage} />
			</CardContent>
		</Card>
	);
}
