import { z } from "zod";

const latLngSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export const PlacesAutocompleteBodySchema = z.object({
  input: z.string().min(2),
  sessionToken: z.string().min(1),
  origin: latLngSchema.nullish(),
});

export const PlacesDetailsQuerySchema = z.object({
  sessionToken: z.string().min(1),
});

export const PlacesReverseQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
