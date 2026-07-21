import {
  isJsxElement,
  isJsxSelfClosingElement,
  type JsxOpeningLikeElement,
  type Node,
} from "typescript";
import { getJsxTagName, walkNodes } from "../ast";
import { POTENTIAL_NAVIGATION_NAME_PATTERN } from "./constants";

const isPotentialNavigationTag = (tagName: string): boolean =>
  tagName === "nav" ||
  tagName === "NavigationMenu" ||
  POTENTIAL_NAVIGATION_NAME_PATTERN.test(tagName);

const subtreeHasPotentialNavigation = (node: Node): boolean => {
  let found = false;

  walkNodes(node, (candidate) => {
    if (found) {
      return;
    }

    let opening: JsxOpeningLikeElement | null = null;
    if (isJsxElement(candidate)) {
      opening = candidate.openingElement;
    } else if (isJsxSelfClosingElement(candidate)) {
      opening = candidate;
    }
    const tagName = opening ? getJsxTagName(opening) : null;
    found = Boolean(tagName && isPotentialNavigationTag(tagName));
  });

  return found;
};

export { isPotentialNavigationTag, subtreeHasPotentialNavigation };
