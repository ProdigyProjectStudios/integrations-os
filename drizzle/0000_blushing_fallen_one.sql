CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`execution_id` text,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_tenant` ON `audit` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`encrypted_tokens` text,
	`status` text NOT NULL,
	`synced_at` integer,
	`summary` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connection_tenant` ON `connections` (`workspace_id`,`provider`);--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`status` text NOT NULL,
	`receipt` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `executions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`workflow_name` text NOT NULL,
	`workflow_version` integer NOT NULL,
	`config` text NOT NULL,
	`trace_id` text NOT NULL,
	`status` text NOT NULL,
	`mode` text NOT NULL,
	`source` text NOT NULL,
	`scenario` text NOT NULL,
	`payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`replay_of` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`next_at` integer NOT NULL,
	`lease_id` text,
	`lease_until` integer,
	`error` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `execution_idempotency` ON `executions` (`workspace_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `execution_queue` ON `executions` (`status`,`next_at`);--> statement-breakpoint
CREATE INDEX `execution_tenant` ON `executions` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_identity` ON `members` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`expires_at` integer NOT NULL,
	`redirect_uri` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spans` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`trace_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`service` text NOT NULL,
	`attempt` integer NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`input` text NOT NULL,
	`output` text,
	`error` text,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `span_execution` ON `spans` (`execution_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`version` integer NOT NULL,
	`config` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
