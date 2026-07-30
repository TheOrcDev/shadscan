"use client";

import {
  BoundingBoxIcon,
  DownloadSimpleIcon,
  TextTIcon,
} from "@phosphor-icons/react";
import type { ReactElement } from "react";
import { toast } from "sonner";
import { ShadscanMark } from "@/components/shadscan-mark";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { LOGOMARK_SVG, LOGOTYPE_SVG } from "@/lib/brand-assets";

interface BrandAssetsMenuProps {
  /** Optional; the item is omitted rather than pointing at a page that does not exist. */
  brandAssetsUrl?: string;
  brandGuidelinesUrl?: string;
  children: ReactElement;
}

/**
 * Clipboard writes need a permission the browser can refuse, so a failure is
 * reported rather than swallowed — a silent "copied" toast over an empty
 * clipboard is worse than an honest error.
 */
const copySvg = async (svg: string, label: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(svg);
    toast.success(`${label} copied as SVG`);
  } catch {
    toast.error(
      `${label} could not be copied; your browser blocked clipboard access.`
    );
  }
};

/**
 * Right-click affordance on the wordmark for copying shadscan's marks, so
 * anyone writing about the project can take a correct asset without hunting
 * for a downloads page.
 */
function BrandAssetsMenu({
  brandAssetsUrl,
  brandGuidelinesUrl,
  children,
}: BrandAssetsMenuProps) {
  const hasLinks = Boolean(brandGuidelinesUrl || brandAssetsUrl);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>

      <ContextMenuContent className="w-fit">
        <ContextMenuItem
          onClick={async () => {
            await copySvg(LOGOMARK_SVG, "Logomark");
          }}
        >
          <ShadscanMark className="size-4" />
          Copy Logomark as SVG
        </ContextMenuItem>

        <ContextMenuItem
          onClick={async () => {
            await copySvg(LOGOTYPE_SVG, "Logotype");
          }}
        >
          <TextTIcon />
          Copy Logotype as SVG
        </ContextMenuItem>

        {hasLinks ? <ContextMenuSeparator /> : null}

        {brandGuidelinesUrl ? (
          <ContextMenuItem asChild>
            <a
              href={brandGuidelinesUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              <BoundingBoxIcon />
              Brand Guidelines
            </a>
          </ContextMenuItem>
        ) : null}

        {brandAssetsUrl ? (
          <ContextMenuItem asChild>
            <a download href={brandAssetsUrl} rel="noopener noreferrer">
              <DownloadSimpleIcon />
              Download Brand Assets
            </a>
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export type { BrandAssetsMenuProps };
export { BrandAssetsMenu };
