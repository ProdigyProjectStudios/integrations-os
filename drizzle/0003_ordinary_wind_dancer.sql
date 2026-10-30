CREATE INDEX `backup_tenant` ON `backups` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `execution_tenant_status` ON `executions` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `sync_records_tenant` ON `sync_records` (`workspace_id`,`provider`,`status`);--> statement-breakpoint
CREATE INDEX `telemetry_due` ON `telemetry_outbox` (`status`,`next_at`);