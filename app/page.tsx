import { CodeBlockCommand } from "@/components/code-block-command";
import { ShadscanMark } from "@/components/shadscan-mark";
import { SiteStructuredData } from "@/components/site-structured-data";

export default function Page() {
  return (
    <>
      <SiteStructuredData />
      <main className="grid flex-1 place-items-center bg-background px-4">
        <div className="flex w-full max-w-2xl flex-col items-center gap-6">
          <ShadscanMark
            accessibleTitle="shadscan"
            className="size-16 text-foreground"
          />
          <div className="w-full">
            <CodeBlockCommand
              bun="bunx --package=@shadscan/cli@next shadscan"
              npm="npx @shadscan/cli@next"
              pnpm="pnpm dlx @shadscan/cli@next"
              yarn="yarn dlx --package @shadscan/cli@next shadscan"
            />
          </div>
        </div>
      </main>
    </>
  );
}
