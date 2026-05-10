import { Controller, Get } from '@nestjs/common';

type HealthResponse = {
  name: string;
  status: 'ok';
};

@Controller()
export class AppController {
  @Get()
  getHealth(): HealthResponse {
    return {
      name: 'ofertando-backend',
      status: 'ok',
    };
  }
}
