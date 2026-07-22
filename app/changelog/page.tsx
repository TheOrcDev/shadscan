import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getChangelogReleases } from "@/lib/changelog";
import { createPageMetadata } from "@/lib/site-metadata";

export const dynamic = "force-static";

export const metadata = createPageMetadata({
  description:
    "Release notes for every Shadscan version: new rules, CLI features, web scanner improvements, and fixes.",
  imageAlt: "Shadscan release changelog",
  imagePath: "/changelog/opengraph-image",
  path: "/changelog",
  title: "Changelog",
});

const formatReleaseDate = (date: string): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  });

export default async function ChangelogPage() {
  const releases = await getChangelogReleases();

  return (
    <main className="flex-1 bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <header>
          <p className="font-mono text-muted-foreground text-sm">Releases</p>
          <h1 className="mt-2 font-heading font-medium text-3xl">Changelog</h1>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            Release notes for the Shadscan CLI and web scanner. Prereleases
            publish under the npm <code>next</code> tag; stable releases under{" "}
            <code>latest</code>.
          </p>
        </header>

        <div className="mt-12 flex flex-col gap-12">
          {releases.map((release) => (
            <article
              aria-labelledby={`${release.anchorId}-title`}
              className="scroll-mt-10"
              id={release.anchorId}
              key={release.version}
            >
              <header className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    className="font-mono font-semibold text-foreground text-sm hover:underline"
                    href={`#${release.anchorId}`}
                  >
                    v{release.version}
                  </a>
                  <Badge variant="outline">{release.channel}</Badge>
                  <time
                    className="text-muted-foreground text-sm"
                    dateTime={release.date}
                  >
                    {formatReleaseDate(release.date)}
                  </time>
                </div>
                <h2
                  className="font-heading font-medium text-2xl"
                  id={`${release.anchorId}-title`}
                >
                  {release.title}
                </h2>
                <p className="text-muted-foreground">{release.summary}</p>
              </header>

              <ul className="mt-5 flex list-disc flex-col gap-2 pl-5 text-sm leading-6">
                {release.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>

              <div
                className="typeset mt-6"
                // Trusted build-time content authored in this repository.
                // biome-ignore lint/security/noDangerouslySetInnerHtml: local markdown rendered at build time
                dangerouslySetInnerHTML={{ __html: release.bodyHtml }}
              />

              <Separator className="mt-12" />
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
