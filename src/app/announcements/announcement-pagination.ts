export function paginationWindow(page: number, totalPages: number): (number | null)[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
    const pages = new Set([1, totalPages, page - 1, page, page + 1]);
    if (page <= 3) [2, 3, 4].forEach((value) => pages.add(value));
    if (page >= totalPages - 2) [totalPages - 3, totalPages - 2, totalPages - 1].forEach((value) => pages.add(value));
    const sorted = [...pages].filter((value) => value >= 1 && value <= totalPages).sort((a, b) => a - b);
    const result: (number | null)[] = [];
    sorted.forEach((value, index) => {
        if (index && value - sorted[index - 1] > 1) result.push(null);
        result.push(value);
    });
    return result;
}
