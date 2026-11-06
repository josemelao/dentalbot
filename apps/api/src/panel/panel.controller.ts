import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Redirect,
  UnauthorizedException,
} from '@nestjs/common';
import { AppEnv } from '../config/env';
import { CatalogRepository } from '../db/repositories/catalog.repository';
import { KnowledgeRepository } from '../db/repositories/knowledge.repository';
import { TicketsRepository } from '../db/repositories/tickets.repository';
import { ENV } from '../db/tokens';
import { EscalationService } from '../pipeline/escalation.service';
import { ReminderService } from '../scheduling/reminder.service';
import { PanelService } from './panel.service';
import { renderPanel, renderTicket } from './panel.view';

const keywords = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

/**
 * Pilot panel. The token is a shared secret, not authentication: it exists to
 * keep the clinic operational until the real inbox with login arrives.
 */
@Controller('painel')
export class PanelController {
  constructor(
    @Inject(ENV) private readonly env: AppEnv,
    private readonly panel: PanelService,
    private readonly knowledge: KnowledgeRepository,
    private readonly catalog: CatalogRepository,
    private readonly tickets: TicketsRepository,
    private readonly escalation: EscalationService,
    private readonly reminders: ReminderService,
  ) {}

  @Get()
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('cache-control', 'no-store')
  async index(
    @Query('token') token?: string,
    @Query('date') date?: string,
  ): Promise<string> {
    this.assertToken(token);

    const data = await this.panel.load(date);
    if (!data) {
      throw new NotFoundException('No active clinic');
    }

    return renderPanel(data, this.env.panelToken!);
  }

  @Get('tickets/:id')
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('cache-control', 'no-store')
  async ticket(
    @Param('id') id: string,
    @Query('token') token?: string,
  ): Promise<string> {
    this.assertToken(token);
    const clinic = await this.requireClinic();

    const detail = await this.panel.openTicket(clinic.id, id);
    if (!detail) {
      throw new NotFoundException('Ticket not found');
    }

    return renderTicket(detail, this.env.panelToken!);
  }

  @Post('faq/:id')
  @Redirect()
  async updateFaq(
    @Param('id') id: string,
    @Body() body: Record<string, string | undefined>,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertToken(body.token);
    const clinic = await this.requireClinic();

    await this.knowledge.update(clinic.id, id, {
      answer: body.answer ?? '',
      keywords: keywords(body.keywords),
      status: (body.status as 'draft' | 'approved' | 'retired') ?? 'draft',
    });

    return this.back(body.token);
  }

  @Post('faq')
  @Redirect()
  async createFaq(
    @Body() body: Record<string, string | undefined>,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertToken(body.token);
    const clinic = await this.requireClinic();

    if (body.question?.trim() && body.answer?.trim()) {
      await this.knowledge.create({
        tenantId: clinic.id,
        category: body.category?.trim() || 'geral',
        question: body.question.trim(),
        answer: body.answer.trim(),
        keywords: keywords(body.keywords),
        status: body.status === 'approved' ? 'approved' : 'draft',
      });
    }

    return this.back(body.token);
  }

  @Post('servicos/:id')
  @Redirect()
  async updateService(
    @Param('id') id: string,
    @Body() body: Record<string, string | undefined>,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertToken(body.token);
    const clinic = await this.requireClinic();

    const duration = Number(body.durationMinutes);
    const price = Number(body.price);

    if (Number.isFinite(duration) && duration > 0 && Number.isFinite(price) && price >= 0) {
      await this.catalog.updateServicePricing(clinic.id, id, {
        durationMinutes: Math.round(duration),
        price,
        priceDisclosureAllowed: body.priceDisclosureAllowed === 'on',
        status: body.status === 'inactive' ? 'inactive' : 'active',
      });
    }

    return this.back(body.token);
  }

  @Post('tickets/:id/assumir')
  @Redirect()
  async assumeTicket(
    @Param('id') id: string,
    @Body() body: Record<string, string | undefined>,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertToken(body.token);
    const clinic = await this.requireClinic();
    const ticket = await this.requireTicket(clinic.id, id);

    await this.escalation.accept({ tenantId: clinic.id, ticket, userId: null });
    return this.back(body.token);
  }

  @Post('tickets/:id/responder')
  @Redirect()
  async replyTicket(
    @Param('id') id: string,
    @Body() body: Record<string, string | undefined>,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertToken(body.token);
    const clinic = await this.requireClinic();
    const ticket = await this.requireTicket(clinic.id, id);

    const answer = body.answer?.trim();
    if (answer) {
      await this.escalation.reply({
        tenantId: clinic.id,
        ticket,
        userId: null,
        text: answer,
      });
    }

    return this.back(body.token);
  }

  @Post('tickets/:id/encerrar')
  @Redirect()
  async closeTicket(
    @Param('id') id: string,
    @Body() body: Record<string, string | undefined>,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertToken(body.token);
    const clinic = await this.requireClinic();
    const ticket = await this.requireTicket(clinic.id, id);

    await this.escalation.resolve({ tenantId: clinic.id, ticket });
    return this.back(body.token);
  }

  @Post('agendamentos/:id/confirmar')
  @Redirect()
  async sendConfirmation(
    @Param('id') id: string,
    @Body() body: Record<string, string | undefined>,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertToken(body.token);
    const clinic = await this.requireClinic();

    await this.reminders.sendNow(clinic.id, id);
    return this.back(body.token);
  }

  private assertToken(token: string | undefined): void {
    if (!this.env.panelToken) {
      throw new NotFoundException('Panel is not configured');
    }
    if (token !== this.env.panelToken) {
      throw new UnauthorizedException('Invalid panel token');
    }
  }

  private async requireClinic(): Promise<{ id: string }> {
    const clinic = await this.panel.activeClinic();
    if (!clinic) throw new NotFoundException('No active clinic');
    return clinic;
  }

  private async requireTicket(tenantId: string, id: string) {
    const ticket = await this.tickets.findById(tenantId, id);
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  private back(token: string | undefined): { url: string; statusCode: number } {
    return { url: `/painel?token=${encodeURIComponent(token ?? '')}`, statusCode: 303 };
  }
}
