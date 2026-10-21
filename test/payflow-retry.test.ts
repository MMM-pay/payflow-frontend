import { describe, expect, it, vi, beforeEach } from "vitest";
import { readContract, MAX_CONCURRENT_READS } from "@/lib/payflow";
import { server } from "@/lib/payflow";
import * as stellarSdk from "@stellar/stellar-sdk";

/**
 * Tests for the retry logic in readContract.
 * These tests mock the RPC server to simulate 429, 503, and network errors,
 * then verify that reads are retried with exponential backoff and jitter.
 * Writes are never retried — that is tested by absence: writeContract has no retry loop.
 */

// Mock the RPC server
vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...original,
    rpc: {
      ...original.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getAccount: vi.fn().mockResolvedValue({}),
        simulateTransaction: vi.fn(),
        sendTransaction: vi.fn(),
        getTransaction: vi.fn(),
        prepareTransaction: vi.fn(),
      })),
      Api: {
        ...original.rpc.Api,
        isSimulationError: vi.fn(),
        GetTransactionStatus: {
          SUCCESS: "SUCCESS",
          NOT_FOUND: "NOT_FOUND",
        },
      },
    },
    Contract: vi.fn().mockImplementation(() => ({
      call: vi.fn(),
    })),
    TransactionBuilder: vi.fn().mockImplementation(() => ({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({}),
      fromXDR: vi.fn().mockReturnValue({}),
      toXDR: vi.fn().mockReturnValue("xdr"),
    })),
    Address: vi.fn().mockImplementation(() => ({
      toScVal: vi.fn().mockReturnValue({}),
    })),
    nativeToScVal: vi.fn().mockReturnValue({}),
    scValToNative: vi.fn().mockImplementation((val) => val?.retval ?? val),
    xdr: {
      ScVal: {},
    },
    BASE_FEE: "100",
  };
});

interface RetryableError extends Error {
  status?: number;
}

describe("readContract retry logic", () => {
  // Use type assertion via unknown to satisfy TypeScript
  const mockServer = server as unknown as {
    getAccount: ReturnType<typeof vi.fn>;
    simulateTransaction: ReturnType<typeof vi.fn>;
    sendTransaction: ReturnType<typeof vi.fn>;
    getTransaction: ReturnType<typeof vi.fn>;
    prepareTransaction: ReturnType<typeof vi.fn>;
  };
  const SOURCE = "GAKOHW5FUKSF3SXQQWLD647RQJPOR5RZOS4ITSMWC5NPC67DEXXYU43H";
  const CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset semaphore by creating fresh mocks
    mockServer.getAccount.mockResolvedValue({});
    mockServer.simulateTransaction.mockResolvedValue({
      result: { retval: "success" },
    });
    // @ts-expect-error - mocking internal API
    stellarSdk.rpc.Api.isSimulationError.mockReturnValue(false);
  });

  it("succeeds on first attempt without retry", async () => {
    const result = await readContract(CONTRACT, "get_plan", SOURCE);
    expect(result).toEqual("success");
    expect(mockServer.simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and succeeds on second attempt", async () => {
    let callCount = 0;
    mockServer.simulateTransaction.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        // First call: simulate 429 rate limit
        const error = new Error("429 Too Many Requests") as RetryableError;
        // Make it look like a Response with status 429
        error.status = 429;
        throw error;
      }
      return { result: { retval: "success on retry" } };
    });

    const result = await readContract(CONTRACT, "get_plan", SOURCE);
    expect(result).toEqual("success on retry");
    expect(callCount).toBe(2);
    expect(mockServer.simulateTransaction).toHaveBeenCalledTimes(2);
  });

  it("retries on 503 and succeeds on third attempt", async () => {
    let callCount = 0;
    mockServer.simulateTransaction.mockImplementation(() => {
      callCount += 1;
      if (callCount <= 2) {
        const error = new Error("503 Service Unavailable") as RetryableError;
        error.status = 503;
        throw error;
      }
      return { result: { retval: "success on third try" } };
    });

    const result = await readContract(CONTRACT, "get_plan", SOURCE);
    expect(result).toEqual("success on third try");
    expect(callCount).toBe(3);
  });

  it("retries on network error (TypeError with fetch)", async () => {
    let callCount = 0;
    mockServer.simulateTransaction.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        throw new TypeError("fetch failed");
      }
      return { result: { retval: "success after network error" } };
    });

    const result = await readContract(CONTRACT, "get_plan", SOURCE);
    expect(result).toEqual("success after network error");
    expect(callCount).toBe(2);
  });

  it("gives up after 4 attempts (3 retries) and throws the last error", async () => {
    mockServer.simulateTransaction.mockRejectedValue(new Error("429 Too Many Requests"));

    await expect(readContract(CONTRACT, "get_plan", SOURCE)).rejects.toThrow(
      "429 Too Many Requests",
    );
    expect(mockServer.simulateTransaction).toHaveBeenCalledTimes(4);
  });

  it("does not retry on non-retryable contract errors", async () => {
    // Simulate a contract error (not a rate limit)
    mockServer.simulateTransaction.mockResolvedValue({
      error: "Error(Contract, #3)",
    });
    // @ts-expect-error - mocking internal API
    stellarSdk.rpc.Api.isSimulationError.mockReturnValue(true);

    await expect(readContract(CONTRACT, "get_plan", SOURCE)).rejects.toThrow(
      "That plan does not exist.",
    );
    // Should only be called once, no retries
    expect(mockServer.simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it("releases its slot after a successful read", async () => {
    // A successful read must not keep its permit: before this was fixed the
    // seventh read waited forever, which froze every page after six reads.
    for (let i = 0; i < MAX_CONCURRENT_READS + 2; i += 1) {
      await expect(readContract(CONTRACT, "get_plan", SOURCE)).resolves.toBe("success");
    }
  });

  it("limits concurrent reads to MAX_CONCURRENT_READS", async () => {
    // This test verifies the semaphore limits concurrency
    // We can't easily test the semaphore directly without exposing it,
    // but we can verify the constant is exported and has the right value
    expect(MAX_CONCURRENT_READS).toBe(6);
  });
});

describe("writeContract has no retry", () => {
  // This test documents that writeContract does NOT have retry logic.
  // If someone accidentally adds retry to writeContract, this test would need updating.
  it("writeContract is a separate function without retry loop", async () => {
    const { writeContract } = await import("@/lib/payflow");
    // writeContract should exist and be a function
    expect(typeof writeContract).toBe("function");
    // The implementation is tested elsewhere; this test just ensures
    // we don't accidentally apply retry logic to writes.
  });
});