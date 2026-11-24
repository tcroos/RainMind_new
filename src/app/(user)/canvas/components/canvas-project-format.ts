/**
 * 列表卡上的日期行：统一成「更新于 2026年11月24日」的绝对日期。
 * 相对时间（今天 10:49）会随打开时刻变化，同一张卡换个时间看读数就变了，
 * 一排卡片放在一起反而难横向比较；固定年月日最稳。
 */
export function formatCanvasUpdatedDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `更新于 ${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}
