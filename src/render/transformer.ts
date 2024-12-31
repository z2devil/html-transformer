import {
  ElementPaint,
  parseStackingContexts,
  StackingContext,
} from './stacking-context';
import { asString, Color, isTransparent } from '../css/types/color';
import { ElementContainer, FLAGS } from '../dom/element-container';
import { BORDER_STYLE } from '../css/property-descriptors/border-style';
import { CSSParsedDeclaration } from '../css';
import { TextContainer } from '../dom/text-container';
import { Path, transformPath } from './path';
import { BACKGROUND_CLIP } from '../css/property-descriptors/background-clip';
import {
  BoundCurves,
  calculateBorderBoxPath,
  calculateContentBoxPath,
  calculatePaddingBoxPath,
} from './bound-curves';
import { BezierCurve, isBezierCurve } from './bezier-curve';
import { Vector } from './vector';
import {
  CSSImageType,
  CSSURLImage,
  isLinearGradient,
  isRadialGradient,
} from '../css/types/image';
import {
  parsePathForBorder,
  parsePathForBorderDoubleInner,
  parsePathForBorderDoubleOuter,
  parsePathForBorderStroke,
} from './border';
import {
  calculateBackgroundRendering,
  getBackgroundValueForIndex,
} from './background';
import { isDimensionToken } from '../css/syntax/parser';
import { segmentGraphemes, TextBounds } from '../css/layout/text';
import { ImageElementContainer } from '../dom/replaced-elements/image-element-container';
import { contentBox } from './box-sizing';
import { CanvasElementContainer } from '../dom/replaced-elements/canvas-element-container';
import { SVGElementContainer } from '../dom/replaced-elements/svg-element-container';
import { ReplacedElementContainer } from '../dom/replaced-elements';
import {
  EffectTarget,
  IElementEffect,
  isClipEffect,
  isOpacityEffect,
  isTransformEffect,
} from './effects';
import { contains } from '../core/bitwise';
import {
  calculateGradientDirection,
  calculateRadius,
  processColorStops,
} from '../css/types/functions/gradient';
import {
  FIFTY_PERCENT,
  getAbsoluteValue,
} from '../css/types/length-percentage';
import { TEXT_DECORATION_LINE } from '../css/property-descriptors/text-decoration-line';
import { FontMetrics } from './font-metrics';
import { DISPLAY } from '../css/property-descriptors/display';
import { Bounds } from '../css/layout/bounds';
import { LIST_STYLE_TYPE } from '../css/property-descriptors/list-style-type';
import { computeLineHeight } from '../css/property-descriptors/line-height';
import {
  CHECKBOX,
  INPUT_COLOR,
  InputElementContainer,
  RADIO,
} from '../dom/replaced-elements/input-element-container';
import { TEXT_ALIGN } from '../css/property-descriptors/text-align';
import { TextareaElementContainer } from '../dom/elements/textarea-element-container';
import { SelectElementContainer } from '../dom/elements/select-element-container';
import { IFrameElementContainer } from '../dom/replaced-elements/iframe-element-container';
import { TextShadow } from '../css/property-descriptors/text-shadow';
import { PAINT_ORDER_LAYER } from '../css/property-descriptors/paint-order';
import { Renderer } from './renderer';
import { Context } from '../core/context';
import { DIRECTION } from '../css/property-descriptors/direction';
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

const MASK_OFFSET = 10000;

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
    fontSize: number,
    fontWeight: string,
    fontFamily: string,
    fontColor: string,
    letterSpacing: number,
    baseline: number
  ): Element {
    // if (letterSpacing === 0) {
    //   this.ctx.fillText(
    //     text.text,
    //     text.bounds.left,
    //     text.bounds.top + baseline
    //   );
    // } else {
    //   const letters = segmentGraphemes(text.text);
    //   letters.reduce((left, letter) => {
    //     this.ctx.fillText(letter, left, text.bounds.top + baseline);

    //     return left + this.ctx.measureText(letter).width;
    //   }, text.bounds.left);
    // }
    const textElement = ElementUtils.create(this.options.editor, 'text');
    const paragraphElement = ElementUtils.create(
      this.options.editor,
      'paragraph'
    );
    const leafElement = {
      id: markTag('uuid', generateID()),
      type: 'leaf',
      props: {
        fontSize,
        fontWeight,
        fontFamily,
        fontColor,
        letterSpacing,
      },
      text: text.text,
    };
    paragraphElement.children = [leafElement];
    textElement.children = [paragraphElement];
    textElement.props.left = text.bounds.left;
    textElement.props.top = text.bounds.top;
    textElement.props.width = text.bounds.width;
    textElement.props.height = baseline; //text.bounds.height;

    return textElement;
  }

  private createFontStyle(styles: CSSParsedDeclaration): string[] {
    const fontVariant = styles.fontVariant
      .filter(variant => variant === 'normal' || variant === 'small-caps')
      .join('');
    const fontFamily = fixIOSSystemFonts(styles.fontFamily).join(', ');
    const fontSize = isDimensionToken(styles.fontSize)
      ? `${styles.fontSize.number}${styles.fontSize.unit}`
      : `${styles.fontSize.number}px`;

    return [
      [
        styles.fontStyle,
        fontVariant,
        styles.fontWeight,
        fontSize,
        fontFamily,
      ].join(' '),
      fontFamily,
      fontSize,
    ];
  }

  async renderTextNode(
    text: TextContainer,
    styles: CSSParsedDeclaration
  ): Promise<Element[]> {
    const res: Element[] = [];

    const [font, fontFamily, fontSize] = this.createFontStyle(styles);
    console.log('[ styles ]', styles);

    console.log('[ font ]', font);
    console.log('[ fontFamily ]', fontFamily);
    console.log('[ fontSize ]', fontSize);
    // this.ctx.font = font;

    // this.ctx.direction = styles.direction === DIRECTION.RTL ? 'rtl' : 'ltr';
    // this.ctx.textAlign = 'left';
    // this.ctx.textBaseline = 'alphabetic';
    const { baseline, middle } = this.fontMetrics.getMetrics(
      fontFamily,
      fontSize
    );

    console.log('[ baseline ]', baseline);
    console.log('[ middle ]', middle);

    const paintOrder = styles.paintOrder;

    text.textBounds.forEach(text => {
      paintOrder.forEach(paintOrderLayer => {
        switch (paintOrderLayer) {
          case PAINT_ORDER_LAYER.FILL:
            // this.ctx.fillStyle = asString(styles.color);
            console.log('[ color ]', asString(styles.color));
            if (text.text.trim().length) {
              res.push(
                this.renderText(
                  text,
                  styles.fontSize.number,
                  styles.fontWeight.toString(),
                  fontFamily,
                  asString(styles.color),
                  styles.letterSpacing,
                  baseline
                )
              );
            }
            const textShadows: TextShadow = styles.textShadow;

            if (textShadows.length && text.text.trim().length) {
              textShadows
                .slice(0)
                .reverse()
                .forEach(textShadow => {
                  // this.ctx.shadowColor = asString(textShadow.color);
                  // this.ctx.shadowOffsetX =
                  //   textShadow.offsetX.number * this.options.scale;
                  // this.ctx.shadowOffsetY =
                  //   textShadow.offsetY.number * this.options.scale;
                  // this.ctx.shadowBlur = textShadow.blur.number;

                  res.push(
                    this.renderText(
                      text,
                      styles.fontSize.number,
                      styles.fontWeight.toString(),
                      fontFamily,
                      styles.color.toString(),
                      styles.letterSpacing,
                      baseline
                    )
                  );
                });

              // this.ctx.shadowColor = '';
              // this.ctx.shadowOffsetX = 0;
              // this.ctx.shadowOffsetY = 0;
              // this.ctx.shadowBlur = 0;
            }

            if (styles.textDecorationLine.length) {
              // this.ctx.fillStyle = asString(
              //   styles.textDecorationColor || styles.color
              // );
              styles.textDecorationLine.forEach(textDecorationLine => {
                switch (textDecorationLine) {
                  case TEXT_DECORATION_LINE.UNDERLINE:
                    // Draws a line at the baseline of the font
                    // TODO As some browsers display the line as more than 1px if the font-size is big,
                    // need to take that into account both in position and size
                    // this.ctx.fillRect(
                    //   text.bounds.left,
                    //   Math.round(text.bounds.top + baseline),
                    //   text.bounds.width,
                    //   1
                    // );

                    break;
                  case TEXT_DECORATION_LINE.OVERLINE:
                    // this.ctx.fillRect(
                    //   text.bounds.left,
                    //   Math.round(text.bounds.top),
                    //   text.bounds.width,
                    //   1
                    // );
                    break;
                  case TEXT_DECORATION_LINE.LINE_THROUGH:
                    // TODO try and find exact position for line-through
                    // this.ctx.fillRect(
                    //   text.bounds.left,
                    //   Math.ceil(text.bounds.top + middle),
                    //   text.bounds.width,
                    //   1
                    // );
                    break;
                }
              });
            }
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
    if (
      image &&
      container.intrinsicWidth > 0 &&
      container.intrinsicHeight > 0
    ) {
      const box = contentBox(container);

      // const path = calculatePaddingBoxPath(curves);
      // this.path(path);
      // this.ctx.save();
      // this.ctx.clip();
      // this.ctx.drawImage(
      //   image,
      //   0,
      //   0,
      //   container.intrinsicWidth,
      //   container.intrinsicHeight,
      //   box.left,
      //   box.top,
      //   box.width,
      //   box.height
      // );
      // this.ctx.restore();
      const rectElement = ElementUtils.create(this.options.editor, 'rect');
      rectElement.props.left = box.left;
      rectElement.props.top = box.top;
      rectElement.props.width = box.width;
      rectElement.props.height = box.height;
      return rectElement;
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
      // if (container.width && container.height) {
      //   this.ctx.drawImage(
      //     canvas,
      //     0,
      //     0,
      //     container.width,
      //     container.height,
      //     container.bounds.left,
      //     container.bounds.top,
      //     container.bounds.width,
      //     container.bounds.height
      //   );
      // }
    }

    // if (container instanceof InputElementContainer) {
    //   const size = Math.min(container.bounds.width, container.bounds.height);

    //   if (container.type === CHECKBOX) {
    //     if (container.checked) {
    //       this.ctx.save();
    //       this.path([
    //         new Vector(
    //           container.bounds.left + size * 0.39363,
    //           container.bounds.top + size * 0.79
    //         ),
    //         new Vector(
    //           container.bounds.left + size * 0.16,
    //           container.bounds.top + size * 0.5549
    //         ),
    //         new Vector(
    //           container.bounds.left + size * 0.27347,
    //           container.bounds.top + size * 0.44071
    //         ),
    //         new Vector(
    //           container.bounds.left + size * 0.39694,
    //           container.bounds.top + size * 0.5649
    //         ),
    //         new Vector(
    //           container.bounds.left + size * 0.72983,
    //           container.bounds.top + size * 0.23
    //         ),
    //         new Vector(
    //           container.bounds.left + size * 0.84,
    //           container.bounds.top + size * 0.34085
    //         ),
    //         new Vector(
    //           container.bounds.left + size * 0.39363,
    //           container.bounds.top + size * 0.79
    //         ),
    //       ]);

    //       this.ctx.fillStyle = asString(INPUT_COLOR);
    //       this.ctx.fill();
    //       this.ctx.restore();
    //     }
    //   } else if (container.type === RADIO) {
    //     if (container.checked) {
    //       this.ctx.save();
    //       this.ctx.beginPath();
    //       this.ctx.arc(
    //         container.bounds.left + size / 2,
    //         container.bounds.top + size / 2,
    //         size / 4,
    //         0,
    //         Math.PI * 2,
    //         true
    //       );
    //       this.ctx.fillStyle = asString(INPUT_COLOR);
    //       this.ctx.fill();
    //       this.ctx.restore();
    //     }
    //   }
    // }

    // if (isTextInputElement(container) && container.value.length) {
    //   const [fontFamily, fontSize] = this.createFontStyle(styles);
    //   const { baseline } = this.fontMetrics.getMetrics(fontFamily, fontSize);

    //   this.ctx.font = fontFamily;
    //   this.ctx.fillStyle = asString(styles.color);

    //   this.ctx.textBaseline = 'alphabetic';
    //   this.ctx.textAlign = canvasTextAlign(container.styles.textAlign);

    //   const bounds = contentBox(container);

    //   let x = 0;

    //   switch (container.styles.textAlign) {
    //     case TEXT_ALIGN.CENTER:
    //       x += bounds.width / 2;
    //       break;
    //     case TEXT_ALIGN.RIGHT:
    //       x += bounds.width;
    //       break;
    //   }

    //   const textBounds = bounds.add(x, 0, 0, -bounds.height / 2 + 1);

    //   this.ctx.save();
    //   this.path([
    //     new Vector(bounds.left, bounds.top),
    //     new Vector(bounds.left + bounds.width, bounds.top),
    //     new Vector(bounds.left + bounds.width, bounds.top + bounds.height),
    //     new Vector(bounds.left, bounds.top + bounds.height),
    //   ]);

    //   this.ctx.clip();
    //   this.renderText(
    //     new TextBounds(container.value, textBounds),
    //     styles.letterSpacing,
    //     baseline
    //   );
    //   this.ctx.restore();
    //   this.ctx.textBaseline = 'alphabetic';
    //   this.ctx.textAlign = 'left';
    // }

    // if (contains(container.styles.display, DISPLAY.LIST_ITEM)) {
    //   if (container.styles.listStyleImage !== null) {
    //     const img = container.styles.listStyleImage;
    //     if (img.type === CSSImageType.URL) {
    //       let image;
    //       const url = (img as CSSURLImage).url;
    //       try {
    //         image = await this.context.cache.match(url);
    //         this.ctx.drawImage(
    //           image,
    //           container.bounds.left - (image.width + 10),
    //           container.bounds.top
    //         );
    //       } catch (e) {
    //         this.context.logger.error(`Error loading list-style-image ${url}`);
    //       }
    //     }
    //   } else if (
    //     paint.listValue &&
    //     container.styles.listStyleType !== LIST_STYLE_TYPE.NONE
    //   ) {
    //     const [fontFamily] = this.createFontStyle(styles);

    //     this.ctx.font = fontFamily;
    //     this.ctx.fillStyle = asString(styles.color);

    //     this.ctx.textBaseline = 'middle';
    //     this.ctx.textAlign = 'right';
    //     const bounds = new Bounds(
    //       container.bounds.left,
    //       container.bounds.top +
    //         getAbsoluteValue(
    //           container.styles.paddingTop,
    //           container.bounds.width
    //         ),
    //       container.bounds.width,
    //       computeLineHeight(styles.lineHeight, styles.fontSize.number) / 2 + 1
    //     );

    //     this.renderText(
    //       new TextBounds(paint.listValue, bounds),
    //       styles.letterSpacing,
    //       computeLineHeight(styles.lineHeight, styles.fontSize.number) / 2 + 2
    //     );
    //     this.ctx.textBaseline = 'bottom';
    //     this.ctx.textAlign = 'left';
    //   }
    // }
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

  // mask(paths: Path[]): void {
  //   this.ctx.beginPath();
  //   this.ctx.moveTo(0, 0);
  //   this.ctx.lineTo(this.canvas.width, 0);
  //   this.ctx.lineTo(this.canvas.width, this.canvas.height);
  //   this.ctx.lineTo(0, this.canvas.height);
  //   this.ctx.lineTo(0, 0);
  //   this.formatPath(paths.slice(0).reverse());
  //   this.ctx.closePath();
  // }

  // path(paths: Path[]): void {
  //   this.ctx.beginPath();
  //   this.formatPath(paths);
  //   this.ctx.closePath();
  // }

  // formatPath(paths: Path[]): void {
  //   paths.forEach((point, index) => {
  //     const start: Vector = isBezierCurve(point) ? point.start : point;
  //     if (index === 0) {
  //       this.ctx.moveTo(start.x, start.y);
  //     } else {
  //       this.ctx.lineTo(start.x, start.y);
  //     }

  //     if (isBezierCurve(point)) {
  //       this.ctx.bezierCurveTo(
  //         point.startControl.x,
  //         point.startControl.y,
  //         point.endControl.x,
  //         point.endControl.y,
  //         point.end.x,
  //         point.end.y
  //       );
  //     }
  //   });
  // }

  // renderRepeat(
  //   path: Path[],
  //   pattern: CanvasPattern | CanvasGradient,
  //   offsetX: number,
  //   offsetY: number
  // ): void {
  //   this.path(path);
  //   this.ctx.fillStyle = pattern;
  //   this.ctx.translate(offsetX, offsetY);
  //   this.ctx.fill();
  //   this.ctx.translate(-offsetX, -offsetY);
  // }

  // resizeImage(
  //   image: HTMLImageElement,
  //   width: number,
  //   height: number
  // ): HTMLCanvasElement | HTMLImageElement {
  //   if (image.width === width && image.height === height) {
  //     return image;
  //   }

  //   const ownerDocument = this.canvas.ownerDocument ?? document;
  //   const canvas = ownerDocument.createElement('canvas');
  //   canvas.width = Math.max(1, width);
  //   canvas.height = Math.max(1, height);
  //   const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  //   ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, width, height);
  //   return canvas;
  // }

  async renderBackgroundImage(container: ElementContainer): Promise<Element[]> {
    const res: Element[] = [];
    let index = container.styles.backgroundImage.length - 1;
    for (const backgroundImage of container.styles.backgroundImage
      .slice(0)
      .reverse()) {
      if (backgroundImage.type === CSSImageType.URL) {
        let image;
        const url = (backgroundImage as CSSURLImage).url;
        try {
          image = await this.context.cache.match(url);
        } catch (e) {
          this.context.logger.error(`Error loading background-image ${url}`);
        }

        if (image) {
          const [path, x, y, width, height] = calculateBackgroundRendering(
            container,
            index,
            [image.width, image.height, image.width / image.height]
          );
          // const pattern = this.ctx.createPattern(
          //   this.resizeImage(image, width, height),
          //   'repeat'
          // ) as CanvasPattern;
          // this.renderRepeat(path, pattern, x, y);
          const rectElement = ElementUtils.create(this.options.editor, 'rect');
          rectElement.props.left = x;
          rectElement.props.top = y;
          rectElement.props.width = width;
          rectElement.props.height = height;
          res.push(rectElement);
        }
      } else if (isLinearGradient(backgroundImage)) {
        const [path, x, y, width, height] = calculateBackgroundRendering(
          container,
          index,
          [null, null, null]
        );
        const [lineLength, x0, x1, y0, y1] = calculateGradientDirection(
          backgroundImage.angle,
          width,
          height
        );

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        const gradient = ctx.createLinearGradient(x0, y0, x1, y1);

        processColorStops(backgroundImage.stops, lineLength).forEach(
          colorStop =>
            gradient.addColorStop(colorStop.stop, asString(colorStop.color))
        );

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        if (width > 0 && height > 0) {
          // const pattern = this.ctx.createPattern(
          //   canvas,
          //   'repeat'
          // ) as CanvasPattern;
          // this.renderRepeat(path, pattern, x, y);
          const rectElement = ElementUtils.create(this.options.editor, 'rect');
          rectElement.props.left = x;
          rectElement.props.top = y;
          rectElement.props.width = width;
          rectElement.props.height = height;
          res.push(rectElement);
        }
      } else if (isRadialGradient(backgroundImage)) {
        const [path, left, top, width, height] = calculateBackgroundRendering(
          container,
          index,
          [null, null, null]
        );
        const position =
          backgroundImage.position.length === 0
            ? [FIFTY_PERCENT]
            : backgroundImage.position;
        const x = getAbsoluteValue(position[0], width);
        const y = getAbsoluteValue(position[position.length - 1], height);

        const [rx, ry] = calculateRadius(backgroundImage, x, y, width, height);
        if (rx > 0 && ry > 0) {
          // const radialGradient = this.ctx.createRadialGradient(
          //   left + x,
          //   top + y,
          //   0,
          //   left + x,
          //   top + y,
          //   rx
          // );
          // processColorStops(backgroundImage.stops, rx * 2).forEach(colorStop =>
          //   radialGradient.addColorStop(
          //     colorStop.stop,
          //     asString(colorStop.color)
          //   )
          // );
          // this.path(path);
          // this.ctx.fillStyle = radialGradient;
          // if (rx !== ry) {
          //   // transforms for elliptical radial gradient
          //   const midX = container.bounds.left + 0.5 * container.bounds.width;
          //   const midY = container.bounds.top + 0.5 * container.bounds.height;
          //   const f = ry / rx;
          //   const invF = 1 / f;
          //   this.ctx.save();
          //   this.ctx.translate(midX, midY);
          //   this.ctx.transform(1, 0, 0, f, 0, 0);
          //   this.ctx.translate(-midX, -midY);
          //   this.ctx.fillRect(
          //     left,
          //     invF * (top - midY) + midY,
          //     width,
          //     height * invF
          //   );
          //   this.ctx.restore();
          // } else {
          //   this.ctx.fill();
          // }
        }
      }
      index--;
    }
    return res;
  }

  async renderNodeBackgroundAndBorders(
    paint: ElementPaint
  ): Promise<Element[]> {
    const res: Element[] = [];

    console.log('[ paint ]', paint);

    this.applyEffects(paint.getEffects(EffectTarget.BACKGROUND_BORDERS));
    const styles = paint.container.styles;
    const hasBackground =
      !isTransparent(styles.backgroundColor) || styles.backgroundImage.length;

    // const borders = [
    //   {
    //     style: styles.borderTopStyle,
    //     color: styles.borderTopColor,
    //     width: styles.borderTopWidth,
    //   },
    //   {
    //     style: styles.borderRightStyle,
    //     color: styles.borderRightColor,
    //     width: styles.borderRightWidth,
    //   },
    //   {
    //     style: styles.borderBottomStyle,
    //     color: styles.borderBottomColor,
    //     width: styles.borderBottomWidth,
    //   },
    //   {
    //     style: styles.borderLeftStyle,
    //     color: styles.borderLeftColor,
    //     width: styles.borderLeftWidth,
    //   },
    // ];

    const backgroundPaintingArea = calculateBackgroundCurvedPaintingArea(
      getBackgroundValueForIndex(styles.backgroundClip, 0),
      paint.curves
    );

    if (hasBackground || styles.boxShadow.length) {
      // this.ctx.save();
      // this.path(backgroundPaintingArea);
      // this.ctx.clip();

      // if (!isTransparent(styles.backgroundColor)) {
      //   this.ctx.fillStyle = asString(styles.backgroundColor);
      //   this.ctx.fill();
      // }

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

      res.push(...(await this.renderBackgroundImage(paint.container)));

      // this.ctx.restore();

      // styles.boxShadow
      //   .slice(0)
      //   .reverse()
      //   .forEach(shadow => {
      //     this.ctx.save();
      //     const borderBoxArea = calculateBorderBoxPath(paint.curves);
      //     const maskOffset = shadow.inset ? 0 : MASK_OFFSET;
      //     const shadowPaintingArea = transformPath(
      //       borderBoxArea,
      //       -maskOffset + (shadow.inset ? 1 : -1) * shadow.spread.number,
      //       (shadow.inset ? 1 : -1) * shadow.spread.number,
      //       shadow.spread.number * (shadow.inset ? -2 : 2),
      //       shadow.spread.number * (shadow.inset ? -2 : 2)
      //     );

      //     if (shadow.inset) {
      //       this.path(borderBoxArea);
      //       this.ctx.clip();
      //       this.mask(shadowPaintingArea);
      //     } else {
      //       this.mask(borderBoxArea);
      //       this.ctx.clip();
      //       this.path(shadowPaintingArea);
      //     }

      //     this.ctx.shadowOffsetX = shadow.offsetX.number + maskOffset;
      //     this.ctx.shadowOffsetY = shadow.offsetY.number;
      //     this.ctx.shadowColor = asString(shadow.color);
      //     this.ctx.shadowBlur = shadow.blur.number;
      //     this.ctx.fillStyle = shadow.inset
      //       ? asString(shadow.color)
      //       : 'rgba(0,0,0,1)';

      //     this.ctx.fill();
      //     this.ctx.restore();
      //   });
    }

    // let side = 0;
    // for (const border of borders) {
    //   if (
    //     border.style !== BORDER_STYLE.NONE &&
    //     !isTransparent(border.color) &&
    //     border.width > 0
    //   ) {
    //     if (border.style === BORDER_STYLE.DASHED) {
    //       await this.renderDashedDottedBorder(
    //         border.color,
    //         border.width,
    //         side,
    //         paint.curves,
    //         BORDER_STYLE.DASHED
    //       );
    //     } else if (border.style === BORDER_STYLE.DOTTED) {
    //       await this.renderDashedDottedBorder(
    //         border.color,
    //         border.width,
    //         side,
    //         paint.curves,
    //         BORDER_STYLE.DOTTED
    //       );
    //     } else if (border.style === BORDER_STYLE.DOUBLE) {
    //       await this.renderDoubleBorder(
    //         border.color,
    //         border.width,
    //         side,
    //         paint.curves
    //       );
    //     } else {
    //       await this.renderSolidBorder(border.color, side, paint.curves);
    //     }
    //   }
    //   side++;
    // }

    return res;
  }

  async execute(element: ElementContainer): Promise<Element[]> {
    // if (this.options.backgroundColor) {
    //   this.ctx.fillStyle = asString(this.options.backgroundColor);
    //   this.ctx.fillRect(
    //     this.options.x,
    //     this.options.y,
    //     this.options.width,
    //     this.options.height
    //   );
    // }
    const stack = parseStackingContexts(element);

    const res = await this.renderStack(stack);
    this.applyEffects([]);
    return res;
  }
}

// const isTextInputElement = (
//   container: ElementContainer
// ): container is
//   | InputElementContainer
//   | TextareaElementContainer
//   | SelectElementContainer => {
//   if (container instanceof TextareaElementContainer) {
//     return true;
//   } else if (container instanceof SelectElementContainer) {
//     return true;
//   } else if (
//     container instanceof InputElementContainer &&
//     container.type !== RADIO &&
//     container.type !== CHECKBOX
//   ) {
//     return true;
//   }
//   return false;
// };

const calculateBackgroundCurvedPaintingArea = (
  clip: BACKGROUND_CLIP,
  curves: BoundCurves
): Path[] => {
  switch (clip) {
    case BACKGROUND_CLIP.BORDER_BOX:
      return calculateBorderBoxPath(curves);
    case BACKGROUND_CLIP.CONTENT_BOX:
      return calculateContentBoxPath(curves);
    case BACKGROUND_CLIP.PADDING_BOX:
    default:
      return calculatePaddingBoxPath(curves);
  }
};

// const canvasTextAlign = (textAlign: TEXT_ALIGN): CanvasTextAlign => {
//   switch (textAlign) {
//     case TEXT_ALIGN.CENTER:
//       return 'center';
//     case TEXT_ALIGN.RIGHT:
//       return 'right';
//     case TEXT_ALIGN.LEFT:
//     default:
//       return 'left';
//   }
// };

// see https://github.com/niklasvh/html2canvas/pull/2645
const iOSBrokenFonts = ['-apple-system', 'system-ui'];

const fixIOSSystemFonts = (fontFamilies: string[]): string[] => {
  return /iPhone OS 15_(0|1)/.test(window.navigator.userAgent)
    ? fontFamilies.filter(
        fontFamily => iOSBrokenFonts.indexOf(fontFamily) === -1
      )
    : fontFamilies;
};
