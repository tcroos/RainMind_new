import type { Metadata } from "next";
import Link from "next/link";

import { SiteLogo } from "@/components/layout/site-logo";
import { getPublicSiteSettings } from "@/lib/server/site-metadata";
import { loadGallery, parseGalleryFilters } from "./gallery-data";
import { GalleryPublishLink } from "./gallery-publish-link";
import { GalleryThemeToggle } from "./gallery-theme-toggle";
import { GalleryView } from "./gallery-view";

type GallerySearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
    const site = await getPublicSiteSettings();
    return {
        title: `作品广场 | ${site.title}`,
        description: "浏览社区公开发布并通过审核的图片、视频、画布与短剧作品。",
        alternates: { canonical: "/gallery" },
        robots: { index: true, follow: true },
    };
}

export default async function GalleryPage({ searchParams }: { searchParams: GallerySearchParams }) {
    const sitePromise = getPublicSiteSettings();
    const filters = parseGalleryFilters(await searchParams);
    const [site, gallery] = await Promise.all([sitePromise, loadGallery(filters)]);

    return (
        <main className="app-scroll-page bg-background text-foreground">
            {/* 顶栏不画下边框：滚动时靠背景模糊和下面整段留白区分层次，
                左右边距与内容区同一套 max-width / padding，标题和 logo 才在同一条竖线上。 */}
            <header className="sticky top-0 z-20 bg-background/85 backdrop-blur-xl">
                <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between gap-3 px-5 sm:h-[72px] sm:px-9 lg:px-12">
                    <Link href="/" className="flex min-w-0 items-center gap-2.5 text-foreground" aria-label={site.title}>
                        <SiteLogo logoUrl={site.logoUrl || "/logo.svg"} className="size-7 sm:size-8" />
                        <span className="truncate text-sm font-semibold sm:text-base">{site.title}</span>
                    </Link>
                    <div className="flex shrink-0 items-center gap-2">
                        <GalleryThemeToggle />
                        <GalleryPublishLink className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl !bg-[var(--brand-600)] px-4 text-[13px] font-medium !text-white transition hover:opacity-90" />
                    </div>
                </div>
            </header>

            <GalleryView filters={filters} gallery={gallery} basePath="/gallery" />
        </main>
    );
}
