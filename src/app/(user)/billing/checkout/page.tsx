import { BillingCheckoutPage } from "./checkout-client";

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ product?: string | string[]; from?: string | string[] }> }) {
    const params = await searchParams;
    const productId = Array.isArray(params.product) ? params.product[0] : params.product;
    const from = Array.isArray(params.from) ? params.from[0] : params.from;
    /* from：积分不足弹窗带过来的「刚才所在页面」，只接受站内路径，防开放跳转 */
    const returnTo = from && from.startsWith("/") && !from.startsWith("//") ? from : "";
    return <BillingCheckoutPage productId={productId?.trim() || ""} returnTo={returnTo} />;
}
