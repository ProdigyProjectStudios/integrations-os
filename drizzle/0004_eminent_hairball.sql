CREATE TABLE `demo_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`runs` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demo_sessions_workspace_id_unique` ON `demo_sessions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `demo_expiry` ON `demo_sessions` (`expires_at`);