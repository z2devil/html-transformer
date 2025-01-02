import {
  ElementPaint,
  parseStackingContexts,
  StackingContext,
} from './stacking-context';
import { asString, Color, isTransparent } from '../css/types/color';
import { ElementContainer, FLAGS } from '../dom/element-container';
import { CSSParsedDeclaration } from '../css';
import { TextContainer } from '../dom/text-container';
import { BoundCurves } from './bound-curves';
import { isDimensionToken } from '../css/syntax/parser';
import { TextBounds } from '../css/layout/text';
import { ImageElementContainer } from '../dom/replaced-elements/image-element-container';
import { contentBox } from './box-sizing';
import { CanvasElementContainer } from '../dom/replaced-elements/canvas-element-container';
import { SVGElementContainer } from '../dom/replaced-elements/svg-element-container';
import { ReplacedElementContainer } from '../dom/replaced-elements';
import { EffectTarget, IElementEffect } from './effects';
import { contains } from '../core/bitwise';
import { FontMetrics } from './font-metrics';
import { IFrameElementContainer } from '../dom/replaced-elements/iframe-element-container';
import { PAINT_ORDER_LAYER } from '../css/property-descriptors/paint-order';
import { Renderer } from './renderer';
import { Context } from '../core/context';
import { ElementUtils, generateID, markTag } from '@acs/renderer';
import { Editor, Element } from '@acs/slate';

export interface TransformerOptions {
  editor: Editor;
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor: Color | null;
}

export class Transformer extends Renderer {
  private readonly _activeEffects: IElementEffect[] = [];
  private readonly fontMetrics: FontMetrics;

  constructor(context: Context, options: TransformerOptions) {
    super(context, options);
    this.fontMetrics = new FontMetrics(document);
    this._activeEffects = [];
    this.context.logger.debug(
      `Canvas renderer initialized (${options.width}x${options.height}) with scale ${options.scale}`
    );
  }

  applyEffects(effects: IElementEffect[]): void {
    while (this._activeEffects.length) {
      this.popEffect();
    }

    effects.forEach(effect => this.applyEffect(effect));
  }

  applyEffect(effect: IElementEffect): void {
    this._activeEffects.push(effect);
  }

  popEffect(): void {
    this._activeEffects.pop();
  }

  async renderStack(stack: StackingContext): Promise<Element[]> {
    const res: Element[] = [];
    const styles = stack.element.container.styles;
    if (styles.isVisible()) {
      res.push(...(await this.renderStackContent(stack)));
    }
    return res;
  }

  async renderNode(paint: ElementPaint): Promise<Element[]> {
    const res: Element[] = [];
    if (contains(paint.container.flags, FLAGS.DEBUG_RENDER)) {
      debugger;
    }

    if (paint.container.styles.isVisible()) {
      res.push(...(await this.renderNodeBackgroundAndBorders(paint)));
      res.push(...(await this.renderNodeContent(paint)));
    }
    return res;
  }

  renderText(
    text: TextBounds,
    baseline: number,
    middle: number,
    styles: {
      fontSize: number;
      fontWeight: number;
      fontFamily: string;
      fontColor: string;
      letterSpacing: number;
    }
  ): Element {
    const textElement = ElementUtils.create(this.options.editor, 'text');
    const paragraphElement = ElementUtils.create(
      this.options.editor,
      'paragraph'
    );
    const leafElement = {
      id: markTag('uuid', generateID()),
      type: 'leaf',
      props: {
        ...styles,
      },
      text: text.text,
    };
    paragraphElement.children = [leafElement];
    textElement.children = [paragraphElement];
    textElement.props.left = text.bounds.left;
    textElement.props.top = text.bounds.top;
    textElement.props.width = text.bounds.width;
    textElement.props.height = text.bounds.height;
    return textElement;
  }

  async renderTextNode(
    text: TextContainer,
    styles: CSSParsedDeclaration
  ): Promise<Element[]> {
    const res: Element[] = [];

    const fontFamily = fixIOSSystemFonts(styles.fontFamily).join(', ');
    const fontSize = styles.fontSize.number;
    const fontWeight = styles.fontWeight;
    const fontColor = asString(styles.color);
    const letterSpacing = styles.letterSpacing;

    console.log('[ styles ]', styles);
    console.log('[ fontFamily ]', fontFamily);
    console.log('[ fontSize ]', fontSize);
    console.log('[ fontColor ]', fontColor);

    const fontSizeStr = isDimensionToken(styles.fontSize)
      ? `${styles.fontSize.number}${styles.fontSize.unit}`
      : `${styles.fontSize.number}px`;
    const { baseline, middle } = this.fontMetrics.getMetrics(
      fontFamily,
      fontSizeStr
    );

    console.log('[ baseline ]', baseline);
    console.log('[ middle ]', middle);

    const paintOrder = styles.paintOrder;

    text.textBounds.forEach(text => {
      paintOrder.forEach(paintOrderLayer => {
        switch (paintOrderLayer) {
          case PAINT_ORDER_LAYER.FILL:
            if (text.text.trim().length) {
              res.push(
                this.renderText(text, baseline, middle, {
                  fontSize,
                  fontWeight,
                  fontFamily,
                  fontColor,
                  letterSpacing,
                })
              );
            }

            // const textShadows: TextShadow = styles.textShadow;
            // if (textShadows.length && text.text.trim().length) {
            //   textShadows
            //     .slice(0)
            //     .reverse()
            //     .forEach(textShadow => {
            //       // this.ctx.shadowColor = asString(textShadow.color);
            //       // this.ctx.shadowOffsetX =
            //       //   textShadow.offsetX.number * this.options.scale;
            //       // this.ctx.shadowOffsetY =
            //       //   textShadow.offsetY.number * this.options.scale;
            //       // this.ctx.shadowBlur = textShadow.blur.number;

            //       res.push(
            //         this.renderText(text, baseline, middle, {
            //           fontSize,
            //           fontWeight,
            //           fontFamily,
            //           fontColor,
            //           letterSpacing,
            //         })
            //       );
            //     });

            //   // this.ctx.shadowColor = '';
            //   // this.ctx.shadowOffsetX = 0;
            //   // this.ctx.shadowOffsetY = 0;
            //   // this.ctx.shadowBlur = 0;
            // }

            // if (styles.textDecorationLine.length) {
            //   // this.ctx.fillStyle = asString(
            //   //   styles.textDecorationColor || styles.color
            //   // );
            //   styles.textDecorationLine.forEach(textDecorationLine => {
            //     switch (textDecorationLine) {
            //       case TEXT_DECORATION_LINE.UNDERLINE:
            //         // Draws a line at the baseline of the font
            //         // TODO As some browsers display the line as more than 1px if the font-size is big,
            //         // need to take that into account both in position and size
            //         // this.ctx.fillRect(
            //         //   text.bounds.left,
            //         //   Math.round(text.bounds.top + baseline),
            //         //   text.bounds.width,
            //         //   1
            //         // );

            //         break;
            //       case TEXT_DECORATION_LINE.OVERLINE:
            //         // this.ctx.fillRect(
            //         //   text.bounds.left,
            //         //   Math.round(text.bounds.top),
            //         //   text.bounds.width,
            //         //   1
            //         // );
            //         break;
            //       case TEXT_DECORATION_LINE.LINE_THROUGH:
            //         // TODO try and find exact position for line-through
            //         // this.ctx.fillRect(
            //         //   text.bounds.left,
            //         //   Math.ceil(text.bounds.top + middle),
            //         //   text.bounds.width,
            //         //   1
            //         // );
            //         break;
            //     }
            //   });
            // }
            break;
          case PAINT_ORDER_LAYER.STROKE:
            // if (styles.webkitTextStrokeWidth && text.text.trim().length) {
            //   this.ctx.strokeStyle = asString(styles.webkitTextStrokeColor);
            //   this.ctx.lineWidth = styles.webkitTextStrokeWidth;
            //   // eslint-disable-next-line @typescript-eslint/no-explicit-any
            //   this.ctx.lineJoin = !!(window as any).chrome ? 'miter' : 'round';
            //   this.ctx.strokeText(
            //     text.text,
            //     text.bounds.left,
            //     text.bounds.top + baseline
            //   );
            // }
            // this.ctx.strokeStyle = '';
            // this.ctx.lineWidth = 0;
            // this.ctx.lineJoin = 'miter';
            break;
        }
      });
    });

    return res;
  }

  renderReplacedElement(
    container: ReplacedElementContainer,
    curves: BoundCurves,
    image: HTMLImageElement | HTMLCanvasElement
  ): Element | void {
    if (container.intrinsicWidth > 0 && container.intrinsicHeight > 0) {
      const box = contentBox(container);
      const imageElement = ElementUtils.create(this.options.editor, 'image');
      imageElement.props.left = box.left;
      imageElement.props.top = box.top;
      imageElement.props.width = box.width;
      imageElement.props.height = box.height;
      return imageElement;
    }
  }

  async renderNodeContent(paint: ElementPaint): Promise<Element[]> {
    const res: Element[] = [];
    this.applyEffects(paint.getEffects(EffectTarget.CONTENT));
    const container = paint.container;
    const curves = paint.curves;
    const styles = container.styles;

    for (const child of container.textNodes) {
      res.push(...(await this.renderTextNode(child, styles)));
    }

    if (container instanceof ImageElementContainer) {
      try {
        const image = await this.context.cache.match(container.src);
        const element = this.renderReplacedElement(container, curves, image);
        if (element) {
          res.push(element);
        }
      } catch (e) {
        this.context.logger.error(`Error loading image ${container.src}`);
      }
    }

    if (container instanceof CanvasElementContainer) {
      const element = this.renderReplacedElement(
        container,
        curves,
        container.canvas
      );
      if (element) {
        res.push(element);
      }
    }

    if (container instanceof SVGElementContainer) {
      try {
        const image = await this.context.cache.match(container.svg);
        const element = this.renderReplacedElement(container, curves, image);
        if (element) {
          res.push(element);
        }
      } catch (e) {
        this.context.logger.error(
          `Error loading svg ${container.svg.substring(0, 255)}`
        );
      }
    }

    if (container instanceof IFrameElementContainer && container.tree) {
      const iframeRenderer = new Transformer(this.context, {
        editor: this.options.editor,
        scale: this.options.scale,
        backgroundColor: container.backgroundColor,
        x: 0,
        y: 0,
        width: container.width,
        height: container.height,
      });

      res.push(...(await iframeRenderer.execute(container.tree)));
    }

    return res;
  }

  async renderStackContent(stack: StackingContext): Promise<Element[]> {
    const res: Element[] = [];

    if (contains(stack.element.container.flags, FLAGS.DEBUG_RENDER)) {
      debugger;
    }

    // https://www.w3.org/TR/css-position-3/#painting-order
    // 1. the background and borders of the element forming the stacking context.
    res.push(...(await this.renderNodeBackgroundAndBorders(stack.element)));
    // 2. the child stacking contexts with negative stack levels (most negative first).
    for (const child of stack.negativeZIndex) {
      res.push(...(await this.renderStack(child)));
    }
    // 3. For all its in-flow, non-positioned, block-level descendants in tree order:
    res.push(...(await this.renderNodeContent(stack.element)));

    for (const child of stack.nonInlineLevel) {
      res.push(...(await this.renderNode(child)));
    }
    // 4. All non-positioned floating descendants, in tree order. For each one of these,
    // treat the element as if it created a new stacking context, but any positioned descendants and descendants
    // which actually create a new stacking context should be considered part of the parent stacking context,
    // not this new one.
    for (const child of stack.nonPositionedFloats) {
      res.push(...(await this.renderStack(child)));
    }
    // 5. the in-flow, inline-level, non-positioned descendants, including inline tables and inline blocks.
    for (const child of stack.nonPositionedInlineLevel) {
      res.push(...(await this.renderStack(child)));
    }
    for (const child of stack.inlineLevel) {
      res.push(...(await this.renderNode(child)));
    }
    // 6. All positioned, opacity or transform descendants, in tree order that fall into the following categories:
    //  All positioned descendants with 'z-index: auto' or 'z-index: 0', in tree order.
    //  For those with 'z-index: auto', treat the element as if it created a new stacking context,
    //  but any positioned descendants and descendants which actually create a new stacking context should be
    //  considered part of the parent stacking context, not this new one. For those with 'z-index: 0',
    //  treat the stacking context generated atomically.
    //
    //  All opacity descendants with opacity less than 1
    //
    //  All transform descendants with transform other than none
    for (const child of stack.zeroOrAutoZIndexOrTransformedOrOpacity) {
      res.push(...(await this.renderStack(child)));
    }
    // 7. Stacking contexts formed by positioned descendants with z-indices greater than or equal to 1 in z-index
    // order (smallest first) then tree order.
    for (const child of stack.positiveZIndex) {
      res.push(...(await this.renderStack(child)));
    }

    return res;
  }

  async renderNodeBackgroundAndBorders(
    paint: ElementPaint
  ): Promise<Element[]> {
    const res: Element[] = [];

    this.applyEffects(paint.getEffects(EffectTarget.BACKGROUND_BORDERS));

    const styles = paint.container.styles;

    console.log('[ renderNodeBackgroundAndBorders ]', paint, styles);

    const hasBackground =
      !isTransparent(styles.backgroundColor) || styles.backgroundImage.length;
    const hasBorders =
      styles.borderTopWidth ||
      styles.borderRightWidth ||
      styles.borderBottomWidth ||
      styles.borderLeftWidth;

    if (hasBackground || hasBorders || styles.boxShadow.length) {
      const rectElement = ElementUtils.create(this.options.editor, 'rect');
      rectElement.props.left = paint.container.bounds.left;
      rectElement.props.top = paint.container.bounds.top;
      rectElement.props.width = paint.container.bounds.width;
      rectElement.props.height = paint.container.bounds.height;
      rectElement.props.backgroundColor = asString(styles.backgroundColor);
      rectElement.props.borderRadius = styles.borderTopLeftRadius[0].number;
      rectElement.props.borderWidth = Number(styles.borderTopWidth);
      rectElement.props.borderColor = asString(styles.borderTopColor);
      res.push(rectElement);

      // res.push(...(await this.renderBackgroundImage(paint.container)));
    }

    return res;
  }

  async execute(element: ElementContainer): Promise<Element[]> {
    const stack = parseStackingContexts(element);
    const res = await this.renderStack(stack);
    this.applyEffects([]);
    return res;
  }
}

// see https://github.com/niklasvh/html2canvas/pull/2645
const iOSBrokenFonts = ['-apple-system', 'system-ui'];

const fixIOSSystemFonts = (fontFamilies: string[]): string[] => {
  return /iPhone OS 15_(0|1)/.test(window.navigator.userAgent)
    ? fontFamilies.filter(
        fontFamily => iOSBrokenFonts.indexOf(fontFamily) === -1
      )
    : fontFamilies;
};
