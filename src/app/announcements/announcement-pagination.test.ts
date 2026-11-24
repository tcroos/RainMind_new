import { describe, expect, it } from "vitest";
import { paginationWindow } from "./announcement-pagination";

describe("announcement pagination navigation", () => {
    it("keeps all pages reachable without gaps for short lists", () => {
        expect(paginationWindow(2, 4)).toEqual([1, 2, 3, 4]);
        expect(paginationWindow(1, 1)).toEqual([1]);
    });
    it("keeps first, last and current neighbors visible for long lists", () => {
        expect(paginationWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
        expect(paginationWindow(1, 10)).toEqual([1, 2, 3, 4, null, 10]);
        expect(paginationWindow(10, 10)).toEqual([1, null, 7, 8, 9, 10]);
    });
});
