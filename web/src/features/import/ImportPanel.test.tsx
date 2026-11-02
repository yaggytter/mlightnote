import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ImportPanel } from "./ImportPanel";
import * as importsApi from "../../services/api/imports";

describe("ImportPanel", () => {
  it("calls onImported with the new project id after a successful upload", async () => {
    // Arrange
    vi.spyOn(importsApi, "uploadImport").mockResolvedValue({
      id: "proj-1",
      title: "song.xml",
      sourceName: "song.xml",
      sha256: "abc",
      size: 10,
      createdAt: "2026-01-01T00:00:00Z",
    });
    const onImported = vi.fn();
    render(<ImportPanel onImported={onImported} />);
    const file = new File(["<score-partwise/>"], "song.xml", { type: "application/xml" });

    // Act
    const input = screen.getByRole("button", { name: "ファイルを選択" });
    await userEvent.click(input);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    // Assert
    await waitFor(() => expect(onImported).toHaveBeenCalledWith("proj-1"));
  });

  it("shows the server error message when the upload fails", async () => {
    // Arrange
    vi.spyOn(importsApi, "uploadImport").mockRejectedValue(
      new importsApi.ImportError("IMPORT_UNSUPPORTED_FORMAT", "対応していないファイル形式です。"),
    );
    render(<ImportPanel onImported={vi.fn()} />);
    // Named .xml so the input's accept filter (enforced by userEvent.upload)
    // lets it through; the server, not the browser, is what rejects it here.
    const file = new File(["not actually valid MusicXML"], "corrupt.xml", { type: "application/xml" });

    // Act
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);

    // Assert
    expect(await screen.findByRole("alert")).toHaveTextContent("対応していないファイル形式です。");
  });
});
