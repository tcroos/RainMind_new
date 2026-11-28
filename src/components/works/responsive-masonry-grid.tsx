"use client";

import { Children, type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const MASONRY_ROW_HEIGHT = 4;

export function masonryRowSpan(contentHeight: number, rowHeight: number, rowGap: number) {
    return Math.max(1, Math.ceil((contentHeight + rowGap) / (rowHeight + rowGap)));
}

/** colSpans：可选，每项横跨几列（大卡）；列数不够时自动退回 1 列 */
export function masonryPlacements(rowSpans: number[], columnCount: number, colSpans: number[] = []) {
    const columnEnds = Array.from({ length: Math.max(1, Math.floor(columnCount)) }, () => 0);
    return rowSpans.map((value, itemIndex) => {
        const rowSpan = Math.max(1, Math.ceil(value));
        const colSpan = Math.max(1, Math.min(columnEnds.length, Math.floor(colSpans[itemIndex] || 1)));
        let columnIndex = 0;
        let best = Number.POSITIVE_INFINITY;
        for (let index = 0; index + colSpan <= columnEnds.length; index += 1) {
            const top = Math.max(...columnEnds.slice(index, index + colSpan));
            if (top < best) {
                best = top;
                columnIndex = index;
            }
        }
        const rowStart = best + 1;
        for (let index = columnIndex; index < columnIndex + colSpan; index += 1) columnEnds[index] = best + rowSpan;
        return colSpan > 1 ? { column: columnIndex + 1, rowStart, rowSpan, colSpan } : { column: columnIndex + 1, rowStart, rowSpan };
    });
}

export function ResponsiveMasonryGrid({ children, className, ariaLabel, colSpans }: { children: ReactNode; className: string; ariaLabel: string; colSpans?: number[] }) {
    const gridRef = useRef<HTMLDivElement>(null);
    const [measured, setMeasured] = useState(false);

    useLayoutEffect(() => {
        const grid = gridRef.current;
        if (!grid) return;
        const items = Array.from(grid.children) as HTMLElement[];
        let frame = 0;
        const layout = () => {
            items.forEach((item) => {
                item.style.removeProperty("grid-column-start");
                item.style.removeProperty("grid-column-end");
                item.style.removeProperty("grid-row-start");
                item.style.removeProperty("grid-row-end");
            });
            const rowGap = Number.parseFloat(getComputedStyle(grid).rowGap) || 0;
            const columnCount = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length;
            /* 大卡只在 3 列及以上才横跨；先按跨列宽度量一次高度，避免按单列高度算行数 */
            const spans = items.map((_, index) => (columnCount >= 3 ? colSpans?.[index] || 1 : 1));
            items.forEach((item, index) => {
                if (spans[index] > 1) item.style.gridColumnEnd = `span ${spans[index]}`;
            });
            const measuredSpans = items.map((item) => masonryRowSpan((item.firstElementChild as HTMLElement | null)?.getBoundingClientRect().height || 0, MASONRY_ROW_HEIGHT, rowGap));
            masonryPlacements(measuredSpans, columnCount, spans).forEach((placement, index) => {
                const item = items[index];
                item.style.gridColumnStart = String(placement.column);
                if (spans[index] > 1) item.style.gridColumnEnd = `span ${spans[index]}`;
                item.style.gridRowStart = String(placement.rowStart);
                item.style.gridRowEnd = `span ${placement.rowSpan}`;
            });
            setMeasured(true);
        };
        const scheduleLayout = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(layout);
        };

        layout();

        const contentObserver = new ResizeObserver(scheduleLayout);
        items.forEach((item) => {
            const content = item.firstElementChild;
            if (content) contentObserver.observe(content);
        });

        const gridObserver = new ResizeObserver(scheduleLayout);
        gridObserver.observe(grid);
        return () => {
            cancelAnimationFrame(frame);
            contentObserver.disconnect();
            gridObserver.disconnect();
        };
    }, [children, colSpans]);

    return (
        <div ref={gridRef} className={cn("grid min-w-0 items-start gap-x-2 gap-y-4 sm:gap-x-3 sm:gap-y-5", measured ? "auto-rows-[4px]" : "auto-rows-auto", className)} aria-label={ariaLabel}>
            {Children.map(children, (child) => (
                <div className="min-w-0">
                    <div className="min-w-0">{child}</div>
                </div>
            ))}
        </div>
    );
}
