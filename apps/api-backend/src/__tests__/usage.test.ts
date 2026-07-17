import { expect, test } from "bun:test";
import { computeCost } from "../libs/usage";
import type { ProviderTarget } from "../providers";

const target: ProviderTarget = {
    modelId: "m",
    providerId: "p",
    providerSlug: "faketest",
    baseUrl: null,
    providerModelId: "fake-model",
    pricePerInputToken: "0.000001",
    pricePerOutputToken: "0.000002",
    contextLength: 8192,
    maxOutputTokens: null,
    priority: 0,
};

test("computeCost prices input and output tokens separately", () => {
    // 100 * 0.000001 + 50 * 0.000002 = 0.0001 + 0.0001
    expect(computeCost({ promptTokens: 100, completionTokens: 50 }, target)).toBe("0.00020000");
});

test("computeCost is zero for zero usage", () => {
    expect(computeCost({ promptTokens: 0, completionTokens: 0 }, target)).toBe("0.00000000");
});

test("computeCost handles realistic Groq-scale prices", () => {
    const groq = { ...target, pricePerInputToken: "0.0000005900", pricePerOutputToken: "0.0000007900" };
    // 42 * 5.9e-7 + 4 * 7.9e-7 = 0.00002478 + 0.00000316 = 0.00002794
    expect(computeCost({ promptTokens: 42, completionTokens: 4 }, groq)).toBe("0.00002794");
});
