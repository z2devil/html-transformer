import { Context } from '../../core/context';

export class Bounds {
  constructor(
    readonly left: number,
    readonly top: number,
    readonly width: number,
    readonly height: number
  ) {}

  add(x: number, y: number, w: number, h: number): Bounds {
    return new Bounds(
      this.left + x,
      this.top + y,
      this.width + w,
      this.height + h
    );
  }

  static fromClientRect(context: Context, clientRect: ClientRect): Bounds {
    return new Bounds(
      clientRect.left + context.windowBounds.left,
      clientRect.top + context.windowBounds.top,
      clientRect.width,
      clientRect.height
    );
  }

  static fromDOMRectList(context: Context, domRectList: DOMRectList): Bounds {
    const domRects = Array.from(domRectList).filter(rect => rect.width !== 0);
    if (!domRects.length) {
      return Bounds.EMPTY;
    }
    // return domRect
    //   ? new Bounds(
    //       domRect.left + context.windowBounds.left,
    //       domRect.top + context.windowBounds.top,
    //       domRect.width,
    //       domRect.height
    //     )
    //   : Bounds.EMPTY;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    domRects.forEach(domRect => {
      left = Math.min(left, domRect.left);
      top = Math.min(top, domRect.top);
      right = Math.max(right, domRect.right);
      bottom = Math.max(bottom, domRect.bottom);
    });
    const res = new Bounds(
      left + context.windowBounds.left,
      top + context.windowBounds.top,
      right - left,
      bottom - top
    );
    console.log('[ Bounds ]', res);
    return res;
  }

  static EMPTY = new Bounds(0, 0, 0, 0);
}

export const parseBounds = (context: Context, node: Element): Bounds => {
  return Bounds.fromClientRect(context, node.getBoundingClientRect());
};

export const parseDocumentSize = (document: Document): Bounds => {
  const body = document.body;
  const documentElement = document.documentElement;

  if (!body || !documentElement) {
    throw new Error(`Unable to get document size`);
  }
  const width = Math.max(
    Math.max(body.scrollWidth, documentElement.scrollWidth),
    Math.max(body.offsetWidth, documentElement.offsetWidth),
    Math.max(body.clientWidth, documentElement.clientWidth)
  );

  const height = Math.max(
    Math.max(body.scrollHeight, documentElement.scrollHeight),
    Math.max(body.offsetHeight, documentElement.offsetHeight),
    Math.max(body.clientHeight, documentElement.clientHeight)
  );

  return new Bounds(0, 0, width, height);
};
