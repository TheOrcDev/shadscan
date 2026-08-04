import {
  forEachChild,
  isJsxElement,
  isJsxSelfClosingElement,
  type JsxOpeningLikeElement,
  type Node,
} from "typescript";
import {
  collectUiModuleImports,
  resolveUiTagName,
  type UiModuleImports,
} from "../anatomy";
import {
  getJsxAttributeValue,
  getJsxTagName,
  getLineNumber,
  type ParsedSourceFile,
  parseProjectSourceFiles,
} from "../ast";
import type { AuditRule } from "../audit";
import { advisory, notApplicable, pass } from "./rule-result";

/**
 * ButtonGroup joins its children into one shape — its own variants apply
 * `rounded-l-none` and `border-l-0` to every child after the first — and its
 * whole answer to focus is
 * `[&>*]:focus-visible:relative [&>*]:focus-visible:z-10`, which lifts the
 * focused child above its neighbours rather than lighting the group. That is
 * right for buttons, which all share a geometry and a ring.
 *
 * It reads as broken around a text input, whose focus ring is drawn around the
 * input's own box — including the edge flush against the button — so the ring
 * runs down the middle of a control that looks like a single pill. InputGroup
 * is the component for that composition: its wrapper reacts to descendant
 * focus and InputGroupInput gives up its own ring.
 *
 * Deliberately narrow: this reports only a text-entry control. ButtonGroup is
 * an open container that legitimately holds buttons, selects, separators and
 * arbitrary wrappers, so anything else inside it is none of this rule's
 * business.
 */

const BUTTON_GROUP_MODULE = "button-group";

const TEXT_CONTROLS = [
  { component: "Input", moduleFile: "input" },
  { component: "Textarea", moduleFile: "textarea" },
] as const;

/** Native input types that are buttons or hidden, not text entry. */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

interface TextControlHit {
  /** How the control is written in source, for the evidence message. */
  label: string;
  line: number;
}

interface ResolvedControl {
  component: string;
  imports: UiModuleImports;
}

const getOpeningElement = (node: Node): JsxOpeningLikeElement | null => {
  if (isJsxSelfClosingElement(node)) {
    return node;
  }

  return isJsxElement(node) ? node.openingElement : null;
};

/**
 * A native `<input>` counts only when it is text entry. An unreadable `type`
 * is treated as text, since `type` defaults to text when absent or dynamic.
 */
const isTextEntryInput = (element: JsxOpeningLikeElement): boolean => {
  const type = getJsxAttributeValue(element, "type");

  if (type.kind === "static" && typeof type.value === "string") {
    return !NON_TEXT_INPUT_TYPES.has(type.value.toLowerCase());
  }

  return true;
};

const isTextControl = (
  element: JsxOpeningLikeElement,
  controls: readonly ResolvedControl[]
): boolean => {
  const tagName = getJsxTagName(element);

  if (!tagName) {
    return false;
  }

  if (tagName === "textarea") {
    return true;
  }

  if (tagName === "input") {
    return isTextEntryInput(element);
  }

  for (const { component, imports } of controls) {
    if (resolveUiTagName(tagName, imports) === component) {
      return component === "Textarea" || isTextEntryInput(element);
    }
  }

  return false;
};

/** First text control anywhere beneath `root`, or null. */
const findTextControl = (
  root: Node,
  file: ParsedSourceFile,
  controls: readonly ResolvedControl[]
): TextControlHit | null => {
  let hit: TextControlHit | null = null;

  // Descends the whole subtree rather than reading direct children: the shape
  // that actually ships wraps the control in a form primitive
  // (ButtonGroup > FormControl > Input), and a direct-children scan misses it.
  const visit = (node: Node): void => {
    if (hit) {
      return;
    }

    const element = getOpeningElement(node);

    if (element && isTextControl(element, controls)) {
      hit = {
        label: `<${getJsxTagName(element)}>`,
        line: getLineNumber(file, element),
      };
      return;
    }

    forEachChild(node, visit);
  };

  forEachChild(root, visit);
  return hit;
};

const isButtonGroup = (node: Node, groupImports: UiModuleImports): boolean => {
  const element = getOpeningElement(node);
  const tagName = element ? getJsxTagName(element) : null;

  return Boolean(
    tagName && resolveUiTagName(tagName, groupImports) === "ButtonGroup"
  );
};

const scanFile = (
  file: ParsedSourceFile,
  uiAlias: string | undefined
): { groupCount: number; violation: TextControlHit | null } => {
  const groupImports = collectUiModuleImports(
    file.sourceFile,
    uiAlias,
    BUTTON_GROUP_MODULE
  );

  if (groupImports.locals.size === 0 && groupImports.namespaces.size === 0) {
    return { groupCount: 0, violation: null };
  }

  const controls: ResolvedControl[] = TEXT_CONTROLS.map(
    ({ component, moduleFile }) => ({
      component,
      imports: collectUiModuleImports(file.sourceFile, uiAlias, moduleFile),
    })
  );

  let groupCount = 0;
  let violation: TextControlHit | null = null;

  const visit = (node: Node): void => {
    if (isButtonGroup(node, groupImports)) {
      groupCount += 1;
      violation ??= findTextControl(node, file, controls);
    }

    forEachChild(node, visit);
  };

  forEachChild(file.sourceFile, visit);
  return { groupCount, violation };
};

const buttonGroupHoldsOnlyButtonsRule: AuditRule = {
  adapters: ["core"],
  category: "forms",
  confidence: "medium",
  description:
    "Checks that ButtonGroup joins buttons rather than wrapping a text input, whose focus ring would cover only part of the joined control.",
  id: "button-group-holds-only-buttons",
  maxScore: 0,
  run: async ({ project }) => {
    if (!project.shadcn.configPath) {
      return notApplicable("No valid shadcn configuration was found.");
    }

    const files = await parseProjectSourceFiles(project);
    const uiAlias = project.shadcn.aliases.ui;
    let groupCount = 0;

    for (const file of files) {
      const scan = scanFile(file, uiAlias);
      groupCount += scan.groupCount;

      if (scan.violation) {
        return advisory(
          `ButtonGroup wraps ${scan.violation.label}, so the focus ring covers only the input and stops where the button begins.`,
          "Move the text control into an InputGroup with InputGroupInput and an InputGroupAddon, which lights the whole control on focus. ButtonGroup keeps a per-child focus ring and is meant for joining buttons.",
          file.filePath,
          scan.violation.line
        );
      }
    }

    if (groupCount === 0) {
      return notApplicable("No ButtonGroup compositions were found.");
    }

    return pass(
      `All ${groupCount} ButtonGroup compositions join buttons rather than text inputs.`
    );
  },
  severity: "warning",
  title: "ButtonGroup holds buttons, not text inputs",
};

export { buttonGroupHoldsOnlyButtonsRule };
