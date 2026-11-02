import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { callEngine } from "./engine";
import { fetchRenderMusicXml } from "./projects";

vi.mock("./engine", () => ({ callEngine: vi.fn() }));
const engine = vi.mocked(callEngine);

describe("fetchRenderMusicXml", () => {
  beforeEach(() => engine.mockClear());

  it("returns the engine's display MusicXML for the query", async () => {
    // Arrange
    engine.mockResolvedValueOnce("<score-partwise/>");

    // Act
    const xml = await fetchRenderMusicXml("proj-1", { concertPitch: true });

    // Assert
    expect(xml).toBe("<score-partwise/>");
    expect(engine).toHaveBeenCalledWith("render", ["proj-1", { concertPitch: true }]);
  });

  it("passes engine errors through", async () => {
    // Arrange
    engine.mockImplementationOnce(() => Promise.reject(new ApiError(404, { code: "PROJECT_NOT_FOUND", message: "プロジェクトが見つかりません。" })));

    // Act / Assert
    const caught = await fetchRenderMusicXml("missing").catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("PROJECT_NOT_FOUND");
  });
});
