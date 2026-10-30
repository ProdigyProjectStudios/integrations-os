CREATE TABLE `node_results` (
	`execution_id` text NOT NULL,
	`node_id` text NOT NULL,
	`status` text NOT NULL,
	`output` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_checkpoint` ON `node_results` (`execution_id`,`node_id`);