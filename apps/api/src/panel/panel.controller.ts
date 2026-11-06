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
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { AppEnv } from '../config/env';
import { CatalogRepository } from '../db/repositories/catalog.repository';
import { KnowledgeRepository } from '../db/repositories/knowledge.repository';
import { MessageTemplatesRepository } from '../db/repositories/message-templates.repository';
import { TicketsRepository } from '../db/repositories/tickets.repository';
import { ENV } from '../db/tokens';
import { isLocked, setTemplateOverride } from '../messages/templates';
import { EscalationService } from '../pipeline/escalation.service';
import { PendingReplyService, ShadowModeService } from '../pipeline/pending-reply.service';
import { ReminderService } from '../scheduling/reminder.service';
import { RescheduleProposalService } from '../scheduling/reschedule-proposal.service';
import { AttendanceService } from '../scheduling/attendance.service';
import { DateTime } from 'luxon';
import { PanelAuthService, PanelSession } from './panel-auth.service';
import { PanelService } from './panel.service';
import { renderLogin, renderPanel, renderTicket } from './panel.view';

const keywords = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

const cookieHeader = (req: any): string | undefined => req?.headers?.cookie;

/**
 * Pilot panel.
 *
 * Access is a signed session cookie. The legacy `PANEL_TOKEN` is accepted only
 * outside production, as a bootstrap for the local demo.
 */
@Controller('painel')
export class PanelController {
  constructor(
    @Inject(ENV) private readonly env: AppEnv,
    private readonly panel: PanelService,
    private readonly auth: PanelAuthService,
    private readonly knowledge: KnowledgeRepository,
    private readonly catalog: CatalogRepository,
    private readonly tickets: TicketsRepository,
    private readonly escalation: EscalationService,
    private readonly reminders: ReminderService,
    private readonly proposals: RescheduleProposalService,
    private readonly templates: MessageTemplatesRepository,
    private readonly pendingReplies: PendingReplyService,
    private readonly shadow: ShadowModeService,
    private readonly attendance: AttendanceService,
  ) {}

  @Get('login')
  @Header('content-type', 'text/html; charset=utf-8')
  loginPage(@Query('error') error?: string): string {
    return renderLogin(error ? 'invalid' : undefined);
  }

  @Post('login')
  async login(
    @Body() body: Record<string, string | undefined>,
    @Res() res: any,
  ): Promise<void> {
    const session = await this.auth.login(body.email ?? '', body.password ?? '');
    if (!session) {
      res.redirect(303, '/painel/login?error=1');
      return;
    }

    res.cookie(this.auth.cookieName(), session, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/painel',
      maxAge: this.auth.cookieMaxAgeSeconds() * 1000,
    });
    res.redirect(303, '/painel');
  }

  @Get('logout')
  logout(@Res() res: any): void {
    res.clearCookie(this.auth.cookieName(), { path: '/painel' });
    res.redirect(303, '/painel/login');
  }

  @Get()
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('cache-control', 'no-store')
  async index(
    @Query('token') token?: string,
    @Query('date') date?: string,
    @Req() req?: any,
  ): Promise<string> {
    this.assertAccess(token, cookieHeader(req));

    const data = await this.panel.load(date);
    if (!data) {
      throw new NotFoundException('No active clinic');
    }

    return renderPanel(data, token ?? '');
  }

  @Get('tickets/:id')
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('cache-control', 'no-store')
  async ticket(
    @Param('id') id: string,
    @Query('token') token?: string,
    @Req() req?: any,
  ): Promise<string> {
    this.assertAccess(token, cookieHeader(req));
    const clinic = await this.requireClinic();

    const detail = await this.panel.openTicket(clinic.id, id);
    if (!detail) {
      throw new NotFoundException('Ticket not found');
    }

    return renderTicket(detail, token ?? '');
  }

  @Post('tickets/:id/assumir')
  @Redirect()
  async assumeTicket(
    @Param('id') id: string,
    @Body() body: Record<string, string | undefined>,
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    const session = this.assertAccess(body.token, cookieHeader(req));
    const clinic = await this.requireClinic();
    const ticket = await this.requireTicket(clinic.id, id);

    await this.escalation.accept({
      tenantId: clinic.id,
      ticket,
      userId: session?.userId ?? null,
    });
    return this.back(body.token);
  }

  @Post('tickets/:id/responder')
  @Redirect()
  async replyTicket(
    @Param('id') id: string,
    @Body() body: Record<string, string | undefined>,
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    const session = this.assertAccess(body.token, cookieHeader(req));
    const clinic = await this.requireClinic();
    const ticket = await this.requireTicket(clinic.id, id);

    const answer = body.answer?.trim();
    if (answer) {
      await this.escalation.reply({
        tenantId: clinic.id,
        ticket,
        userId: session?.userId ?? null,
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
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertAccess(body.token, cookieHeader(req));
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
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertAccess(body.token, cookieHeader(req));
    const clinic = await this.requireClinic();

    await this.reminders.sendNow(clinic.id, id);
    return this.back(body.token);
  }

  @Post('shadow')
  @Redirect()
  async toggleShadow(
    @Body() body: Record<string, string | undefined>,
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertAccess(body.token, cookieHeader(req));
    const clinic = await this.requireClinic();

    await this.shadow.setEnabled(clinic.id, body.enabled === 'on');
    return this.back(body.token);
  }

  @Post('pendentes/:id/enviar')
  @Redirect()
  async approvePending(
    @Param('id') id: string,
    @Body() body: Record<string, string | undefined>,
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    const session = this.assertAccess(body.token, cookieHeader(req));
    const clinic = await this.requireClinic();

    await this.pendingReplies.approve({
      tenantId: clinic.id,
      id,
      userId: session?.userId ?? null,
      content: body.content,
    });

    return this.back(body.token);
  }

  @Post('pendentes/:id/descartar')
  @Redirect()
  async discardPending(
    @Param('id') id: string,
    @Body() body: Record<string, string | undefined>,
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    const session = this.assertAccess(body.token, cookieHeader(req));
    const clinic = await this.requireClinic();

    await this.pendingReplies.discard({
      tenantId: clinic.id,
      id,
      userId: session?.userId ?? null,
    });

    return this.back(body.token);
  }

  @Post('horarios')
  @Redirect()
  async addWorkingHour(
    @Body() body: Record<string, string | undefined>,
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertAccess(body.token, cookieHeader(req));
    const clinic = await this.requireClinic();

    const weekday = Number(body.weekday);
    const startTime = body.startTime ?? '';
    const endTime = body.endTime ?? '';
    const valid = /^\d{2}:\d{2}$/.test(startTime) && /^\d{2}:\d{2}$/.test(endTime);

    if (body.professionalId && Number.isInteger(weekday) && valid) {
      const locations = await this.catalog.listActiveLocations(clinic.id);
      const location = locations[0];
      if (location) {
        await this.catalog.upsertWorkingHour(clinic.id, {
          professionalId: body.professionalId,
          locationId: location.id,
          weekday,
          startTime,
          endTime,
        });
      }
    }

    return this.back(body.token);
  }

  @Post('horarios/:id/excluir')
  @Redirect()
  async deleteWorkingHour(
    @Param('id') id: string,
    @Body() body: Record<string, string | undefined>,
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertAccess(body.token, cookieHeader(req));
    const clinic = await this.requireClinic();
    await this.catalog.deleteWorkingHour(clinic.id, id);
    return this.back(body.token);
  }

  @Post('folgas')
  @Redirect()
  async addTimeOff(
    @Body() body: Record<string, string | undefined>,
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertAccess(body.token, cookieHeader(req));
    const clinic = await this.requireClinic();

    const timezone = await this.attendance.timezoneFor(clinic.id);
    const start = DateTime.fromISO(body.startDate ?? '', { zone: timezone }).startOf('day');
    const end = DateTime.fromISO(body.endDate ?? '', { zone: timezone }).endOf('day');

    if (body.professionalId && start.isValid && end.isValid && start < end) {
      await this.catalog.addTimeOff(clinic.id, {
        professionalId: body.professionalId,
        startAt: start.toJSDate(),
        endAt: end.toJSDate(),
        reason: body.reason?.trim() || null,
      });
    }

    return this.back(body.token);
  }

  @Post('folgas/:id/excluir')
  @Redirect()
  async deleteTimeOff(
    @Param('id') id: string,
    @Body() body: Record<string, string | undefined>,
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertAccess(body.token, cookieHeader(req));
    const clinic = await this.requireClinic();
    await this.catalog.deleteTimeOff(clinic.id, id);
    return this.back(body.token);
  }

  @Post('feriados')
  @Redirect()
  async addHoliday(
    @Body() body: Record<string, string | undefined>,
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertAccess(body.token, cookieHeader(req));
    const clinic = await this.requireClinic();

    const date = body.date ?? '';
    const name = body.name?.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && name) {
      const locations = await this.catalog.listActiveLocations(clinic.id);
      await this.catalog.addHoliday(clinic.id, {
        locationId: locations[0]?.id ?? null,
        date,
        name,
      });
    }

    return this.back(body.token);
  }

  @Post('feriados/:id/excluir')
  @Redirect()
  async deleteHoliday(
    @Param('id') id: string,
    @Body() body: Record<string, string | undefined>,
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertAccess(body.token, cookieHeader(req));
    const clinic = await this.requireClinic();
    await this.catalog.deleteHoliday(clinic.id, id);
    return this.back(body.token);
  }

  @Post('agendamentos/:id/presenca')
  @Redirect()
  async markAttendance(
    @Param('id') id: string,
    @Body() body: Record<string, string | undefined>,
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertAccess(body.token, cookieHeader(req));
    const clinic = await this.requireClinic();

    const mark = body.status === 'NO_SHOW' ? 'NO_SHOW' : 'ATTENDED';
    await this.attendance.mark(clinic.id, id, mark);

    return this.back(body.token);
  }

  @Post('agendamentos/:id/propor')
  @Redirect()
  async proposeReschedule(
    @Param('id') id: string,
    @Body() body: Record<string, string | undefined>,
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    const session = this.assertAccess(body.token, cookieHeader(req));
    const clinic = await this.requireClinic();

    await this.proposals.propose({
      tenantId: clinic.id,
      appointmentId: id,
      userId: session?.userId ?? null,
    });

    return this.back(body.token);
  }

  @Post('faq/:id')
  @Redirect()
  async updateFaq(
    @Param('id') id: string,
    @Body() body: Record<string, string | undefined>,
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertAccess(body.token, cookieHeader(req));
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
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertAccess(body.token, cookieHeader(req));
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

  @Post('templates/:key')
  @Redirect()
  async updateTemplate(
    @Param('key') key: string,
    @Body() body: Record<string, string | undefined>,
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertAccess(body.token, cookieHeader(req));
    const clinic = await this.requireClinic();

    if (!isLocked(key)) {
      const variants = (body.variants ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (variants.length > 0) {
        await this.templates.upsert(clinic.id, key, variants);
        setTemplateOverride(key, variants);
      }
    }

    return this.back(body.token);
  }

  @Post('servicos/:id')
  @Redirect()
  async updateService(
    @Param('id') id: string,
    @Body() body: Record<string, string | undefined>,
    @Req() req?: any,
  ): Promise<{ url: string; statusCode: number }> {
    this.assertAccess(body.token, cookieHeader(req));
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

  /** Session cookie wins; the legacy token is a non-production bootstrap only. */
  private assertAccess(
    token: string | undefined,
    cookie: string | undefined,
  ): PanelSession | null {
    const session = this.auth.verify(cookie);
    if (session) return session;

    const bootstrapAllowed = this.env.nodeEnv !== 'production';
    if (bootstrapAllowed && this.env.panelToken && token === this.env.panelToken) {
      return null;
    }

    throw new UnauthorizedException('Authentication required');
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
    const suffix = token ? `?token=${encodeURIComponent(token)}` : '';
    return { url: `/painel${suffix}`, statusCode: 303 };
  }
}
