import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HeroButton {
  text: string;
  url: string;
}

interface HeroButtons {
  primary?: HeroButton;
  secondary?: HeroButton;
}

interface HeroProps {
  buttons?: HeroButtons;
  className?: string;
  description: string;
  heading: string;
  logo?: ReactNode;
  media?: ReactNode;
}

const externalLinkProps = (url: string) =>
  url.startsWith("http") ? { rel: "noreferrer", target: "_blank" } : {};

const Hero = ({
  logo,
  heading,
  description,
  buttons,
  media,
  className,
}: HeroProps) => (
  <section className={cn("py-8 sm:py-10", className)}>
    <div className="overflow-hidden">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center">
          <div className="flex w-full flex-col items-center gap-4 text-center sm:gap-5">
            {logo ? (
              <div className="flex w-full items-center justify-center">
                {logo}
              </div>
            ) : null}
            <h1 className="max-w-xl text-pretty text-center font-semibold text-4xl tracking-tight md:text-5xl lg:max-w-3xl">
              {heading}
            </h1>
            <p className="mx-auto max-w-3xl text-balance text-center text-muted-foreground text-sm lg:text-base">
              {description}
            </p>
            {buttons?.primary || buttons?.secondary ? (
              <div className="flex w-full flex-col items-center gap-2 sm:flex-row sm:justify-center">
                {buttons?.primary ? (
                  <Button asChild className="w-full sm:w-auto" size="lg">
                    <a
                      href={buttons.primary.url}
                      {...externalLinkProps(buttons.primary.url)}
                    >
                      {buttons.primary.text}
                      <ArrowRightIcon data-icon="inline-end" />
                    </a>
                  </Button>
                ) : null}
                {buttons?.secondary ? (
                  <Button
                    asChild
                    className="w-full sm:w-auto"
                    size="lg"
                    variant="outline"
                  >
                    <a
                      href={buttons.secondary.url}
                      {...externalLinkProps(buttons.secondary.url)}
                    >
                      {buttons.secondary.text}
                    </a>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          {media ? (
            <div className="mt-8 flex w-full justify-center sm:mt-10">
              {media}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  </section>
);

export { Hero };
