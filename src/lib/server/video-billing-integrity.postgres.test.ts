import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPostgresRepositories, initializePostgresSchema, postgresQuery } from "./database";
import { consumeUserPoints, refundUserPoints } from "@/lib/auth/store-actions";
import { completeReconciledVideoTask, createVideoTask, getVideoTask } from "./video-task-store";

const enabled = process.env.VOZEB_PRO_RUN_ISOLATED_VIDEO_BILLING === "1";
const databaseName = `vozeb_video_billing_test_${process.pid}_${Date.now()}`;
let admin: Client;
let created = false;

describe.skipIf(!enabled)("isolated PostgreSQL video billing integrity", () => {
    beforeAll(async () => {
        const source = process.env.DATABASE_URL || process.env.POSTGRES_URL;
        if (!source) throw new Error("An administrative local PostgreSQL connection is required");
        const url = new URL(source);
        if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only a local PostgreSQL server may create this isolated test database");
        admin = new Client({ connectionString: source });
        await admin.connect();
        await admin.query(`CREATE DATABASE "${databaseName}"`);
        created = true;
        url.pathname = `/${databaseName}`;
        vi.stubEnv("DATABASE_URL", url.toString());
        vi.stubEnv("VOZEB_PRO_DATABASE_PROVIDER", "postgres");
        await initializePostgresSchema();
        await postgresQuery("UPDATE app_settings SET model_point_costs = $1::jsonb, entitlements_enabled = true WHERE id = 'default'", [JSON.stringify({ video: 800 })]);
        const repos = createPostgresRepositories();
        await repos.settings.upsertEntitlementPlan({ id: "test", name: "Test", enabled: true, dailyPoints: 0, limits: {}, features: [], sortOrder: 0 });
        await repos.users.createWithNextAccountId({ id: "video-user", username: "video_integrity", displayName: "Test", bio: "", role: "user", adminPermissions: [], status: "active", planId: "test", pointsBalance: 800000, passwordHash: "test-only", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }, 120000);

    afterAll(async () => {
        const scope = globalThis as typeof globalThis & { __vozebProPostgresPool?: { end(): Promise<void> }; __vozebProPostgresSchemaReady?: Promise<void> };
        await scope.__vozebProPostgresPool?.end();
        delete scope.__vozebProPostgresPool;
        delete scope.__vozebProPostgresSchemaReady;
        try { if (created) await admin.query(`DROP DATABASE "${databaseName}"`); }
        finally { await admin?.end(); vi.unstubAllEnvs(); }
    });

    it("persists the confirmed charge and serializes duplicate consumption and refunds", async () => {
        const charge = { units: 1200.25, points: 480100 };
        const consume = () => consumeUserPoints("video-user", "video", charge.units, "video", "video-request", "a".repeat(64), charge);
        const [first, second] = await Promise.all([consume(), consume()]);
        expect(first).toMatchObject({ units: 1200.25, cost: 480100 });
        expect(second.recordId).toBe(first.recordId);
        expect((await postgresQuery("SELECT count(*) AS total FROM point_records WHERE type='consume'")).rows[0].total).toBe("1");
        expect(Number((await postgresQuery("SELECT units FROM quota_usage WHERE user_id=$1 AND usage_kind='video'", ["video-user"])).rows[0].units)).toBe(1200.25);
        const task = await createVideoTask({ userId: "video-user", config: { apiSource: "system", baseUrl: "/api/ai/system/test", apiKey: "system", apiFormat: "openai", model: "video" }, upstream: { id: "upstream", provider: "generation", model: "video", pointsCost: first.cost, pointsUnits: first.units, pointsRecordId: first.recordId }, billingSnapshot: { version: 1, outputSeconds: 5, references: [], referenceSeconds: 0, totalSeconds: 5, charge } });
        expect((await getVideoTask(task.id))?.billingSnapshot?.charge).toEqual(charge);
        await expect(refundUserPoints("video-user", "video", first.cost, "video", first.units, "active-rejected", first.recordId)).rejects.toThrow("尚未确认失败或取消");
        await postgresQuery("UPDATE generation_tasks SET status='error', payload=jsonb_set(payload,'{status}','\"error\"'::jsonb) WHERE id=$1", [task.id]);
        await Promise.all([refundUserPoints("video-user", "video", first.cost, "video", first.units, "refund-one", first.recordId), refundUserPoints("video-user", "video", first.cost, "video", first.units, "refund-two", first.recordId)]);
        expect((await postgresQuery("SELECT count(*) AS total FROM point_records WHERE type='refund'")).rows[0].total).toBe("1");
        expect(Number((await postgresQuery("SELECT points_balance FROM users WHERE id='video-user'")).rows[0].points_balance)).toBe(800000);
        expect(Number((await postgresQuery("SELECT units FROM quota_usage WHERE user_id=$1 AND usage_kind='video'", ["video-user"])).rows[0].units)).toBe(0);
    });

    it("excludes success and refund in both deterministic commit orders", async () => {
        for (const order of ["success-first", "refund-first"] as const) {
            const charge = await consumeUserPoints("video-user", "video", 1, "video", order, (order === "success-first" ? "a" : "b").repeat(64), { units: 1, points: 4 });
            const task = await createVideoTask({ userId: "video-user", config: { apiSource: "system", baseUrl: "/api/ai/system/test", apiKey: "system", apiFormat: "openai", model: "video" }, upstream: { id: "original", provider: "generation", model: "video", pointsCost: 4, pointsRecordId: charge.recordId } });
            await postgresQuery("UPDATE generation_tasks SET status='error', payload=jsonb_set(payload,'{status}','\"error\"'::jsonb) || $2::jsonb WHERE id=$1", [task.id, JSON.stringify({ error: "视频生成超时" })]);
            const refund = () => refundUserPoints("video-user", "video", 4, "video", 1, `refund-${order}`, charge.recordId);
            if (order === "success-first") {
                expect((await completeReconciledVideoTask(task.id, { url: "/api/reference-assets/result.mp4" }))?.status).toBe("success");
                await expect(refund()).rejects.toThrow("不能退款");
            } else {
                await refund();
                expect(await completeReconciledVideoTask(task.id, { url: "/api/reference-assets/result.mp4" })).toBeNull();
                expect((await getVideoTask(task.id))?.status).toBe("error");
            }
            const rows = await postgresQuery("SELECT type FROM point_records WHERE source_record_id=$1", [charge.recordId]);
            expect(rows.rows.length).toBe(order === "refund-first" ? 1 : 0);
        }
    });

    it("never commits both success and refund when they race on the same consumption", async () => {
        const charge = await consumeUserPoints("video-user", "video", 1, "video", "racing", "c".repeat(64), { units: 1, points: 4 });
        const task = await createVideoTask({ userId: "video-user", config: { apiSource: "system", baseUrl: "/api/ai/system/test", apiKey: "system", apiFormat: "openai", model: "video" }, upstream: { id: "original", provider: "generation", model: "video", pointsCost: 4, pointsRecordId: charge.recordId } });
        await Promise.allSettled([
            completeReconciledVideoTask(task.id, { url: "/api/reference-assets/race.mp4" }),
            refundUserPoints("video-user", "video", 4, "video", 1, "racing-refund", charge.recordId),
        ]);
        const current = await getVideoTask(task.id);
        const refunds = await postgresQuery("SELECT id FROM point_records WHERE source_record_id=$1 AND type='refund'", [charge.recordId]);
        expect(current?.status === "success" && refunds.rows.length > 0).toBe(false);
        expect(current?.status === "success" || refunds.rows.length === 1).toBe(true);
    });
});
