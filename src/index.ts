import { Bounds, parseBounds, parseDocumentSize } from './css/layout/bounds';
import { COLORS, isTransparent, parseColor } from './css/types/color';
import {
  CloneConfigurations,
  CloneOptions,
  DocumentCloner,
  WindowOptions,
} from './dom/document-cloner';
import { isBodyElement, isHTMLElement, parseTree } from './dom/node-parser';
import { CacheStorage } from './core/cache-storage';
import { Transformer, TransformerOptions } from './render/transformer';
import { Context, ContextOptions } from './core/context';
import { Editor, Node } from '@acs/slate';

export type Options = CloneOptions &
  WindowOptions &
  TransformerOptions &
  ContextOptions & {
    backgroundColor: string | null;
    removeContainer?: boolean;
  };

const htmlTransformer = (
  editor: Editor,
  element: HTMLElement,
  options: Partial<Options> = {}
): Promise<Node[]> => {
  return transformElement(editor, element, options);
};

export default htmlTransformer;

if (typeof window !== 'undefined') {
  CacheStorage.setContext(window);
}

const transformElement = async (
  editor: Editor,
  element: HTMLElement,
  opts: Partial<Options>
): Promise<Node[]> => {
  if (!element || typeof element !== 'object') {
    return Promise.reject('Invalid element provided as first argument');
  }
  const ownerDocument = element.ownerDocument;

  if (!ownerDocument) {
    throw new Error(`Element is not attached to a Document`);
  }

  const defaultView = ownerDocument.defaultView;

  if (!defaultView) {
    throw new Error(`Document is not attached to a Window`);
  }

  const resourceOptions = {
    allowTaint: opts.allowTaint ?? false,
    imageTimeout: opts.imageTimeout ?? 15000,
    proxy: opts.proxy,
    useCORS: opts.useCORS ?? false,
  };

  const contextOptions = {
    logging: opts.logging ?? true,
    cache: opts.cache,
    ...resourceOptions,
  };

  const windowOptions = {
    windowWidth: opts.windowWidth ?? defaultView.innerWidth,
    windowHeight: opts.windowHeight ?? defaultView.innerHeight,
    scrollX: opts.scrollX ?? defaultView.pageXOffset,
    scrollY: opts.scrollY ?? defaultView.pageYOffset,
  };

  const windowBounds = new Bounds(
    windowOptions.scrollX,
    windowOptions.scrollY,
    windowOptions.windowWidth,
    windowOptions.windowHeight
  );

  const context = new Context(contextOptions, windowBounds);

  const cloneOptions: CloneConfigurations = {
    allowTaint: opts.allowTaint ?? false,
    onclone: opts.onclone,
    ignoreElements: opts.ignoreElements,
    inlineImages: false,
    copyStyles: false,
  };

  context.logger.debug(
    `Starting document clone with size ${windowBounds.width}x${
      windowBounds.height
    } scrolled to ${-windowBounds.left},${-windowBounds.top}`
  );

  const documentCloner = new DocumentCloner(context, element, cloneOptions);
  const clonedElement = documentCloner.clonedReferenceElement;
  if (!clonedElement) {
    return Promise.reject(`Unable to find element in cloned iframe`);
  }

  const container = await documentCloner.toIFrame(ownerDocument, windowBounds);

  const { width, height, left, top } =
    isBodyElement(clonedElement) || isHTMLElement(clonedElement)
      ? parseDocumentSize(clonedElement.ownerDocument)
      : parseBounds(context, clonedElement);

  const backgroundColor = parseBackgroundColor(
    context,
    clonedElement,
    opts.backgroundColor
  );

  const renderOptions: TransformerOptions = {
    editor,
    backgroundColor,
    scale: opts.scale ?? defaultView.devicePixelRatio ?? 1,
    x: (opts.x ?? 0) + left,
    y: (opts.y ?? 0) + top,
    width: opts.width ?? Math.ceil(width),
    height: opts.height ?? Math.ceil(height),
  };

  let res: Node[];

  context.logger.debug(
    `Document cloned, element located at ${left},${top} with size ${width}x${height} using computed rendering`
  );

  context.logger.debug(`Starting DOM parsing`);
  const root = parseTree(context, clonedElement);

  if (backgroundColor === root.styles.backgroundColor) {
    root.styles.backgroundColor = COLORS.TRANSPARENT;
  }

  context.logger.debug(
    `Starting renderer for element at ${renderOptions.x},${renderOptions.y} with size ${renderOptions.width}x${renderOptions.height}`
  );

  const transformer = new Transformer(context, renderOptions);
  res = await transformer.execute(root);

  if (opts.removeContainer ?? true) {
    if (!DocumentCloner.destroy(container)) {
      context.logger.error(
        `Cannot detach cloned iframe as it is not in the DOM anymore`
      );
    }
  }

  context.logger.debug(`Finished rendering`);
  return res;
};

const parseBackgroundColor = (
  context: Context,
  element: HTMLElement,
  backgroundColorOverride?: string | null
) => {
  const ownerDocument = element.ownerDocument;
  // http://www.w3.org/TR/css3-background/#special-backgrounds
  const documentBackgroundColor = ownerDocument.documentElement
    ? parseColor(
        context,
        getComputedStyle(ownerDocument.documentElement)
          .backgroundColor as string
      )
    : COLORS.TRANSPARENT;
  const bodyBackgroundColor = ownerDocument.body
    ? parseColor(
        context,
        getComputedStyle(ownerDocument.body).backgroundColor as string
      )
    : COLORS.TRANSPARENT;

  const defaultBackgroundColor =
    typeof backgroundColorOverride === 'string'
      ? parseColor(context, backgroundColorOverride)
      : backgroundColorOverride === null
      ? COLORS.TRANSPARENT
      : 0xffffffff;

  return element === ownerDocument.documentElement
    ? isTransparent(documentBackgroundColor)
      ? isTransparent(bodyBackgroundColor)
        ? defaultBackgroundColor
        : bodyBackgroundColor
      : documentBackgroundColor
    : defaultBackgroundColor;
};
