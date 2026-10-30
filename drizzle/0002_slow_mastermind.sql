CREATE TABLE `backups` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`object_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`checksum` text NOT NULL,
	`bytes` integer NOT NULL,
	`rows` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `locks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `maintenance_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`detail` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`cursor` text,
	`generation` integer DEFAULT 0 NOT NULL,
	`next_at` integer DEFAULT 0 NOT NULL,
	`lease_id` text,
	`lease_until` integer,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `sync_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`remote_id` text NOT NULL,
	`remote_version` text NOT NULL,
	`remote_data` text NOT NULL,
	`local_data` text NOT NULL,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`generation` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `telemetry_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`lease_id` text,
	`lease_until` integer,
	`error` text
);
--> statement-breakpoint
ALTER TABLE `connections` ADD `token_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `connections` ADD `refresh_lease` text;--> statement-breakpoint
ALTER TABLE `connections` ADD `refresh_until` integer;