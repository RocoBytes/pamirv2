-- Optional itinerary attachment for eventos (file stored in Google Drive)
ALTER TABLE "eventos" ADD COLUMN "itinerario_file_id" TEXT;
ALTER TABLE "eventos" ADD COLUMN "itinerario_file_name" TEXT;
ALTER TABLE "eventos" ADD COLUMN "itinerario_file_url" TEXT;
