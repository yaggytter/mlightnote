import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { callEngine } from "./engine";
import { ImportError, uploadImport } from "./imports";

vi.mock("./engine", () => ({ callEngine: vi.fn() }));
const engine = vi.mocked(callEngine);

describe("uploadImport", () => {
  beforeEach(() => engine.mockClear());

  it("hands the file's bytes to the engine and returns the project", async () => {
    // Arrange
    const file = new File(["<score-partwise/>"], "song.xml", { type: "application/xml" });
    engine.mockResolvedValueOnce({ id: "proj-1", title: "song", sourceName: "song.xml", sha256: "abc", size: 17, createdAt: "2026-01-01T00:00:00Z", warningCount: 0 });

    // Act
    const result = await uploadImport(file);

    // Assert
    expect(result.id).toBe("proj-1");
    expect(engine).toHaveBeenCalledWith("importFile", ["song.xml", expect.any(Uint8Array)], expect.any(Array));
    expect(new TextDecoder().decode(engine.mock.calls[0][1][1] as Uint8Array)).toBe("<score-partwise/>");
  });

  it("turns an engine failure into ImportError with its code and message", async () => {
    // Arrange
    engine.mockImplementationOnce(() => Promise.reject(new ApiError(422, { code: "IMPORT_UNSUPPORTED_FORMAT", message: "対応していないファイル形式です。" })));

    // Act / Assert
    const caught = await uploadImport(new File(["not xml"], "notes.txt")).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ImportError);
    expect((caught as ImportError).code).toBe("IMPORT_UNSUPPORTED_FORMAT");
    expect((caught as ImportError).message).toBe("対応していないファイル形式です。");
  });

  it("rejects a file over the size limit without reading it", async () => {
    // Arrange
    const file = new File(["x"], "huge.mid");
    Object.defineProperty(file, "size", { value: 51 * 1024 * 1024 });

    // Act / Assert
    const caught = await uploadImport(file).catch((e: unknown) => e);
    expect((caught as ImportError).code).toBe("IMPORT_INVALID_UPLOAD");
    expect(engine).not.toHaveBeenCalled();
  });
});
