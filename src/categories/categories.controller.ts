import { Controller, Get } from '@nestjs/common';

import { CategoriesService } from './categories.service';
import type { CategoryResponse } from './types/category-response.type';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  // Public: powers the category nav, filters and the offer-creation select.
  @Get()
  list(): Promise<CategoryResponse[]> {
    return this.categoriesService.list();
  }
}
