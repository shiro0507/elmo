/**
 * /app/$brand/visibility - Visibility charts page
 *
 * Shows prompts with visibility scores and trend charts.
 * Data is fetched client-side via TanStack Query hooks in PromptsDisplay,
 * so no route loader is needed (allows immediate rendering with skeletons).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { PromptsDisplay } from "@/components/prompts-display";
import { getAppName, getBrandName, buildTitle } from "@/lib/route-head";
import { coercePromptOrder, DEFAULT_PROMPT_ORDER, type PromptOrder } from "@/lib/prompt-order";

export const Route = createFileRoute("/_authed/app/$brand/visibility")({
	// The prompts list's sort order (#60) is this route's own search key, on top
	// of the brand-wide filter keys validated by the `$brand` layout route. The
	// default order is omitted so default state keeps a clean URL.
	validateSearch: (search: Record<string, unknown>): { order?: PromptOrder } => {
		const order = coercePromptOrder(search.order);
		return order === DEFAULT_PROMPT_ORDER ? {} : { order };
	},
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle("AI言及率", { appName, brandName }) },
				{ name: "description", content: "LLMが自社ブランドに関するプロンプトにどう応答しているかを追跡できます。" },
			],
		};
	},
	component: VisibilityPage,
});

function VisibilityPage() {
	const { brand: brandId } = Route.useParams();

	const infoContent = (
		<>
			自社ブランド・製品・
			<Link to="/app/$brand/settings/competitors" params={{ brand: brandId }} className="underline">
				競合
			</Link>
			に関連するプロンプトに、各LLMがどう応答しているかを確認できます。
		</>
	);

	return (
		<PromptsDisplay
			pageTitle="AI言及率"
			pageDescription="自社に関連するプロンプトを、LLMがどう評価しているか確認できます。"
			pageInfoContent={infoContent}
			editLink={`/app/${brandId}/settings/prompts`}
		/>
	);
}
