import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { sha256Hex } from "./sha256";

describe("sha256", () => {
  test.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"],
  ])("%j", (input, want) => {
    expect(sha256Hex(input)).toBe(want);
  });

  test("agrees with node:crypto on binary data of every padding length", () => {
    for (let n = 0; n < 200; n++) {
      const data = new Uint8Array(n).map((_, i) => (i * 31 + n) & 0xff);
      expect(sha256Hex(data)).toBe(createHash("sha256").update(data).digest("hex"));
    }
  });
});
