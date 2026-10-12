ALTER TABLE "applications" ADD COLUMN "import_ref" text;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_import_ref_unique" UNIQUE("import_ref");