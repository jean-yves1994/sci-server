import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TenantContext } from '../common/tenant-context';
import { MarkReadDto, NotificationQueryDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Your notifications' })
  list(@CurrentUser() user: TenantContext, @Query() query: NotificationQueryDto) {
    return this.notifications.list(user, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Number of unread notifications' })
  async unreadCount(@CurrentUser() user: TenantContext) {
    return { count: await this.notifications.countUnread(user) };
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark specific notifications as read' })
  async markRead(@CurrentUser() user: TenantContext, @Body() dto: MarkReadDto) {
    return { updated: await this.notifications.markRead(user, dto.ids) };
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark every notification as read' })
  async markAllRead(@CurrentUser() user: TenantContext) {
    return { updated: await this.notifications.markAllRead(user) };
  }
}
