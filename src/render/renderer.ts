import { Context } from '../core/context';
import { RenderConfigurations } from './transformer';

export class Renderer {
  constructor(
    protected readonly context: Context,
    protected readonly options: RenderConfigurations
  ) {}
}
