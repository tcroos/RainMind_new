import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LibraryShowcaseEmptyState } from "./library-ui";

describe("library showcase stack render", () => {
    it("renders two stacked images and a lower min-height", () => {
        const html = renderToStaticMarkup(
            <LibraryShowcaseEmptyState
                images={["/back.webp", "/front.webp"]}
                title="还没有提示词"
                description="说明"
                action={<button>新增</button>}
            />,
        );

        expect(html).toContain('src="/back.webp"');
        expect(html).toContain('src="/front.webp"');
        expect(html).toContain("-rotate-[4deg]");
        expect(html).toContain("min-height:min(760px, calc(100dvh - 140px))");
        expect(html.indexOf("/back.webp")).toBeLessThan(html.indexOf("/front.webp"));
    });
});
