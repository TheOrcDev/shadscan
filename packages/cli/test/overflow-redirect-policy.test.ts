import { describe, expect, it } from "vitest";
import {
  createCanonicalRedirectPolicy,
  followCanonicalServerRedirect,
} from "../src/overflow-check/redirect-policy";

describe("canonical redirect policy", () => {
  it("allows redirects that stay on the requested origin", () => {
    const policy = createCanonicalRedirectPolicy(
      "https://example.com/dashboard"
    );

    expect(policy).not.toBeNull();
    expect(
      policy &&
        followCanonicalServerRedirect(
          policy,
          "https://example.com/sign-in?next=%2Fdashboard"
        )
    ).toMatchObject({
      originalOrigin: "https://example.com",
      resolvedOrigin: "https://example.com",
    });
  });

  it("allows an apex host to redirect to its www alias on the same port", () => {
    const policy = createCanonicalRedirectPolicy("http://example.com:8080/");

    expect(
      policy &&
        followCanonicalServerRedirect(
          policy,
          "http://www.example.com:8080/welcome"
        )
    ).toMatchObject({
      originalOrigin: "http://example.com:8080",
      resolvedOrigin: "http://www.example.com:8080",
    });
  });

  it("allows a default-port HTTP origin to upgrade to HTTPS", () => {
    const policy = createCanonicalRedirectPolicy("http://example.com/");

    expect(
      policy &&
        followCanonicalServerRedirect(policy, "https://example.com/welcome")
    ).toMatchObject({
      originalOrigin: "http://example.com",
      resolvedOrigin: "https://example.com",
    });
  });

  it("allows the hostname alias and default-port upgrade in one redirect", () => {
    const policy = createCanonicalRedirectPolicy("http://example.com/");

    expect(
      policy &&
        followCanonicalServerRedirect(policy, "https://www.example.com/welcome")
    ).toMatchObject({
      originalOrigin: "http://example.com",
      resolvedOrigin: "https://www.example.com",
    });
  });

  it("does not treat an IP address as an apex host with a www alias", () => {
    const policy = createCanonicalRedirectPolicy("http://127.0.0.1/");

    expect(
      policy && followCanonicalServerRedirect(policy, "http://www.127.0.0.1/")
    ).toBeNull();
  });

  it("does not derive an alias from a host with repeated www prefixes", () => {
    const policy = createCanonicalRedirectPolicy(
      "https://www.www.example.com/"
    );

    expect(
      policy &&
        followCanonicalServerRedirect(policy, "https://www.example.com/")
    ).toBeNull();
  });

  it.each([
    ["https://app.example.com/", "https://www.app.example.com/"],
    ["https://www.app.example.com/", "https://app.example.com/"],
  ])("does not treat a project subdomain as an apex alias: %s", (initialUrl, nextUrl) => {
    const policy = createCanonicalRedirectPolicy(initialUrl);

    expect(policy && followCanonicalServerRedirect(policy, nextUrl)).toBeNull();
  });

  it("allows a www host to redirect to its anchored apex alias", () => {
    const policy = createCanonicalRedirectPolicy("https://www.example.com/");

    expect(
      policy &&
        followCanonicalServerRedirect(policy, "https://example.com/welcome")
    ).toMatchObject({
      originalOrigin: "https://www.example.com",
      resolvedOrigin: "https://example.com",
    });
  });

  it("allows one hostname change followed by one protocol upgrade", () => {
    const policy = createCanonicalRedirectPolicy("http://example.com/");
    const aliasedPolicy =
      policy &&
      followCanonicalServerRedirect(policy, "http://www.example.com/");

    expect(
      aliasedPolicy &&
        followCanonicalServerRedirect(
          aliasedPolicy,
          "https://www.example.com/welcome"
        )
    ).toMatchObject({
      originalOrigin: "http://example.com",
      resolvedOrigin: "https://www.example.com",
    });
  });

  it("rejects bouncing back after the anchored hostname alias is used", () => {
    const policy = createCanonicalRedirectPolicy("https://example.com/");
    const aliasedPolicy =
      policy &&
      followCanonicalServerRedirect(policy, "https://www.example.com/");

    expect(
      aliasedPolicy &&
        followCanonicalServerRedirect(aliasedPolicy, "https://example.com/")
    ).toBeNull();
  });

  it.each([
    ["an arbitrary sibling", "https://app.example.com/"],
    ["an unrelated host", "https://example.net/"],
    ["a repeated www prefix", "https://www.www.example.com/"],
    ["a protocol downgrade", "http://example.com/"],
    ["an unexpected port", "https://example.com:8443/"],
  ])("rejects %s", (_description, nextUrl) => {
    const policy = createCanonicalRedirectPolicy("https://example.com/");

    expect(policy && followCanonicalServerRedirect(policy, nextUrl)).toBeNull();
  });

  it.each([
    [
      "a custom source port",
      "http://example.com:8080/",
      "https://example.com/",
    ],
    [
      "a custom destination port",
      "http://example.com/",
      "https://example.com:8443/",
    ],
  ])("rejects an HTTP to HTTPS upgrade from %s", (_description, initialUrl, nextUrl) => {
    const policy = createCanonicalRedirectPolicy(initialUrl);

    expect(policy && followCanonicalServerRedirect(policy, nextUrl)).toBeNull();
  });

  it.each([
    "not a URL",
    "file:///tmp/index.html",
    "https://user@example.com/",
    "https://user:secret@example.com/",
  ])("rejects an invalid initial target: %s", (initialUrl) => {
    expect(createCanonicalRedirectPolicy(initialUrl)).toBeNull();
  });

  it.each([
    "not a URL",
    "data:text/html,hello",
    "https://user@example.com/",
    "https://user:secret@example.com/",
  ])("rejects an invalid redirect target: %s", (nextUrl) => {
    const policy = createCanonicalRedirectPolicy("https://example.com/");

    expect(policy && followCanonicalServerRedirect(policy, nextUrl)).toBeNull();
  });
});
