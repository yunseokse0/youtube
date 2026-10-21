import { describe, expect, it } from "vitest";
import {
  getYoutubePublicBaseUrl,
  isDisallowedPublicIngestHost,
  normalizeYoutubeIngestBaseUrl,
  readYoutubePublicBaseUrlFromEnv,
  resolveToonaLinkCredentials,
} from "@/lib/toona-link";
import type { StoredAccount } from "@/lib/accounts-storage";

describe("toona-link", () => {
  it("resolveToonaLinkCredentials uses account toonaEmail", () => {
    process.env.NEXT_PUBLIC_TOONA_API_BASE_URL = "http://13.125.221.195:4000";
    delete process.env.TOONA_AUTO_LINK;
    delete process.env.TOONA_AUTO_LINK_EMAIL;

    const account: StoredAccount = {
      id: "finalent",
      name: "test",
      companyName: "DIN",
      password: "secret",
      toonaEmail: "sssss@gmail.com",
      startDate: null,
      endDate: null,
      createdAt: Date.now(),
    };

    const creds = resolveToonaLinkCredentials(account, "din-pass");
    expect(creds).toEqual({
      toonaBaseUrl: "http://13.125.221.195:4000",
      toonaEmail: "sssss@gmail.com",
      toonaPassword: "din-pass",
    });
  });

  it("resolveToonaLinkCredentials falls back to env email", () => {
    process.env.NEXT_PUBLIC_TOONA_API_BASE_URL = "http://localhost:4000";
    process.env.TOONA_AUTO_LINK_EMAIL = "default@example.com";

    const creds = resolveToonaLinkCredentials(undefined, "pw");
    expect(creds?.toonaEmail).toBe("default@example.com");
  });

  it("resolveToonaLinkCredentials returns null when disabled", () => {
    process.env.TOONA_AUTO_LINK = "false";
    process.env.NEXT_PUBLIC_TOONA_API_BASE_URL = "http://localhost:4000";
    process.env.TOONA_AUTO_LINK_EMAIL = "default@example.com";

    expect(resolveToonaLinkCredentials(undefined, "pw")).toBeNull();
  });

  it("getYoutubePublicBaseUrl prefers env", () => {
    process.env.YOUTUBE_PUBLIC_BASE_URL = "https://excel.heyob.co.kr";
    delete process.env.NEXTAUTH_URL;
    const req = new Request("http://localhost/login");
    expect(getYoutubePublicBaseUrl(req)).toBe("https://excel.heyob.co.kr");
  });

  it("getYoutubePublicBaseUrl falls back to NEXTAUTH_URL", () => {
    delete process.env.YOUTUBE_PUBLIC_BASE_URL;
    process.env.NEXTAUTH_URL = "https://excel.heyob.co.kr/";
    const req = new Request("http://localhost/login");
    expect(getYoutubePublicBaseUrl(req)).toBe("https://excel.heyob.co.kr");
  });

  it("blocks public IP as youtube ingest baseUrl", () => {
    expect(isDisallowedPublicIngestHost("3.37.127.90")).toBe(true);
    expect(isDisallowedPublicIngestHost("localhost")).toBe(false);
    expect(normalizeYoutubeIngestBaseUrl("http://3.37.127.90:3000")).toBeNull();
    expect(normalizeYoutubeIngestBaseUrl("https://excel.heyob.co.kr")).toBe(
      "https://excel.heyob.co.kr"
    );
    process.env.YOUTUBE_PUBLIC_BASE_URL = "http://3.37.127.90:3000";
    delete process.env.NEXTAUTH_URL;
    expect(readYoutubePublicBaseUrlFromEnv()).toBeNull();
  });
});
