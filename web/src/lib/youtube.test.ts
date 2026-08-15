import { describe, it, expect } from "vitest";
import { extractYouTubeVideoId } from "@/lib/youtube";

describe("extractYouTubeVideoId", () => {
  it("extracts watch url ids", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(extractYouTubeVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ&t=42")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("extracts youtu.be short urls", () => {
    expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ?si=abc")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("extracts embed, shorts and live urls", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(extractYouTubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(extractYouTubeVideoId("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("returns null for invalid input", () => {
    expect(extractYouTubeVideoId("")).toBeNull();
    expect(extractYouTubeVideoId("https://example.com/video")).toBeNull();
    expect(extractYouTubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(extractYouTubeVideoId("ftp://youtu.be/abc")).toBeNull();
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(extractYouTubeVideoId("https://www.youtube.com/shorts/123456789012345678901234")).toBeNull();
    expect(extractYouTubeVideoId("youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(extractYouTubeVideoId("not a url")).toBeNull();
  });

  it("enforces https only", () => {
    expect(extractYouTubeVideoId("http://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(extractYouTubeVideoId("http://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  it("returns null instead of throwing on malformed urls", () => {
    expect(extractYouTubeVideoId("https://x:99999/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(extractYouTubeVideoId("https://[::1/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(extractYouTubeVideoId("https://you tube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
});