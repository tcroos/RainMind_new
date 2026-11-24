import { getLocalMediaRegistration } from "@/lib/server/local-media-registry";

const REFERENCE_OBJECT_SEGMENT = "/media/reference/";
const STORAGE_KEY_PATTERN = /^(?:temporary|permanent)\/[^?#]+$/;

/**
 * Older video tasks persisted a 1h R2 presigned URL as result.url (BUG-088). Map such a URL back to
 * the stable site route so readers neither re-upload it nor hit an expired signature. The mapping
 * only applies when a reference-scope object registration owns exactly that object, so it never
 * rewrites upstream provider URLs or URLs that merely look similar. The signature is never read.
 */
export async function stableVideoResultUrl<T extends string | undefined>(url: T): Promise<T> {
    if (!url || !/^https:\/\//i.test(url)) return url;
    let pathname: string;
    try {
        pathname = decodeURIComponent(new URL(url).pathname);
    } catch {
        return url;
    }
    const marker = pathname.lastIndexOf(REFERENCE_OBJECT_SEGMENT);
    if (marker < 0) return url;
    const storageKey = pathname.slice(marker + REFERENCE_OBJECT_SEGMENT.length);
    if (!STORAGE_KEY_PATTERN.test(storageKey) || storageKey.split("/").includes("..")) return url;

    const registration = await getLocalMediaRegistration(storageKey).catch(() => null);
    const objectKey = registration?.externalObjectKey?.replace(/^\/+/, "");
    const ownsObject = Boolean(
        registration &&
            registration.scope === "reference" &&
            registration.storageProvider === "object" &&
            objectKey &&
            pathname.replace(/^\/+/, "").endsWith(objectKey) &&
            objectKey.endsWith(`${REFERENCE_OBJECT_SEGMENT.slice(1)}${storageKey}`),
    );
    if (!ownsObject) return url;
    return `/api/reference-assets/${storageKey.split("/").map(encodeURIComponent).join("/")}` as T;
}